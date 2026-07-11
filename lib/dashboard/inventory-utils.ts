import type { Recipe, RecipeComponent } from "./recipe-normalizers";

export type InventoryItem = {
  id: string;
  organization_id: string | null;
  tenant_id: string | null;
  location_id: string | null;
  origin_inventory_item_id?: string | null;
  recipe_id: string | null;
  name: string | null;
  sku: string | null;
  department: string | null;
  item_type: "raw_material" | "semi_finished" | "final_product";
  cost_type: "purchased" | "manufactured";
  base_uom: string | null;
  recipe_uom: string | null;
  on_hand_uom: string | null;
  on_hand_qty: number;
  current_cost_per_base_uom: number;
  yield_pct: number;
  shrinkage_factor_pct: number;
  is_high_value: boolean;
  is_active: boolean;
  created_at: string;
};

const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extractUuid(value: unknown) {
  return String(value ?? "").match(uuidPattern)?.[0] ?? "";
}

function getRecipeId(recipe: Recipe) {
  return extractUuid(recipe.id) || recipe.id;
}

export function recipesFromManufacturedInventory(
  items: InventoryItem[],
): Recipe[] {
  const recipesById = new Map<string, Recipe>();

  for (const item of items) {
    if (item.cost_type !== "manufactured" || !item.recipe_id) {
      continue;
    }

    if (!recipesById.has(item.recipe_id)) {
      recipesById.set(item.recipe_id, {
        id: item.recipe_id,
        tenant_id: item.tenant_id,
        organization_id: item.organization_id,
        name: item.name ?? "Sub-recipe",
        recipe_type: "sub_recipe",
        output_uom: item.on_hand_uom ?? item.recipe_uom ?? item.base_uom,
        standard_batch_output_qty: 1,
        standard_yield_pct: item.yield_pct ?? 1,
        resolved_unit_cost: item.current_cost_per_base_uom ?? 0,
        selling_price: 0,
        is_active: item.is_active,
        created_at: item.created_at,
      });
    }
  }

  return Array.from(recipesById.values());
}

export function getInventoryDisplayKey(item: InventoryItem) {
  const locationKey = extractUuid(item.location_id) || "unassigned";

  if (item.cost_type === "purchased") {
    return `purchased:${locationKey}:${(item.sku || item.name || item.id).trim().toLowerCase()}`;
  }

  return `manufactured:${locationKey}:${(item.name || item.sku || item.recipe_id || item.id)
    .trim()
    .toLowerCase()}`;
}

export function dedupeActiveInventoryItems(items: InventoryItem[]) {
  const displayItemsByKey = new Map<string, InventoryItem>();

  for (const item of items) {
    if (!item.is_active) {
      continue;
    }

    const key = getInventoryDisplayKey(item);

    if (!displayItemsByKey.has(key)) {
      displayItemsByKey.set(key, item);
    }
  }

  return Array.from(displayItemsByKey.values());
}

export function dedupeActiveRecipes(
  recipeItems: Recipe[],
  componentItems: RecipeComponent[] = [],
) {
  const recipesByKey = new Map<string, Recipe>();

  for (const recipe of recipeItems) {
    if (!recipe.is_active) {
      continue;
    }

    const key = `${recipe.recipe_type}:${recipe.name.trim().toLowerCase()}`;
    const existingRecipe = recipesByKey.get(key);
    const recipeComponentCount = componentItems.filter(
      (component) => extractUuid(component.recipe_id) === getRecipeId(recipe),
    ).length;
    const existingComponentCount = existingRecipe
      ? componentItems.filter(
          (component) =>
            extractUuid(component.recipe_id) === getRecipeId(existingRecipe),
        ).length
      : 0;
    const recipeBatchOutput = Number(recipe.standard_batch_output_qty ?? 1);
    const existingBatchOutput = Number(
      existingRecipe?.standard_batch_output_qty ?? 1,
    );

    if (
      !existingRecipe ||
      recipeBatchOutput > existingBatchOutput ||
      (recipeBatchOutput === existingBatchOutput &&
        recipeComponentCount > existingComponentCount) ||
      (recipeBatchOutput === existingBatchOutput &&
        recipeComponentCount === existingComponentCount &&
        new Date(recipe.created_at).getTime() >
          new Date(existingRecipe.created_at).getTime())
    ) {
      recipesByKey.set(key, recipe);
    }
  }

  return Array.from(recipesByKey.values());
}

export function dedupeRecipeComponentsByIngredient(
  components: RecipeComponent[],
) {
  const componentsByIngredient = new Map<string, RecipeComponent>();

  for (const component of components) {
    const ingredientNameKey = component.ingredient_name?.trim().toLowerCase();
    const ingredientIdKey = extractUuid(component.component_inventory_item_id);
    const ingredientKey = ingredientNameKey
      ? `name:${ingredientNameKey}`
      : ingredientIdKey
        ? `id:${ingredientIdKey}`
        : component.id;
    const existingComponent = componentsByIngredient.get(ingredientKey);

    if (
      !existingComponent ||
      new Date(component.created_at).getTime() >
        new Date(existingComponent.created_at).getTime()
    ) {
      componentsByIngredient.set(ingredientKey, component);
    }
  }

  return Array.from(componentsByIngredient.values());
}
