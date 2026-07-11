export type Recipe = {
  id: string;
  tenant_id: string | null;
  organization_id: string | null;
  name: string;
  recipe_type: "sub_recipe" | "final_menu_item" | "final_dish";
  output_uom: string | null;
  standard_batch_output_qty: number;
  standard_yield_pct: number;
  resolved_unit_cost: number;
  selling_price: number;
  is_active: boolean;
  created_at: string;
};

export type RecipeComponent = {
  id: string;
  organization_id: string | null;
  recipe_id: string;
  component_inventory_item_id: string | null;
  component_recipe_id: string | null;
  qty_in_recipe_uom: number;
  recipe_uom: string;
  ingredient_name?: string | null;
  ingredient_unit_cost?: number | null;
  created_at: string;
};

const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function extractUuid(value: unknown) {
  return String(value ?? "").match(uuidPattern)?.[0] ?? "";
}

export function getRecipeId(recipe: Recipe) {
  return extractUuid(recipe.id) || recipe.id;
}

export function normalizeRecipeRow(row: unknown): Recipe | null {
  if (!row) {
    return null;
  }

  if (typeof row === "string") {
    const quotedValues = Array.from(row.matchAll(/"([^"]*)"/g)).map(
      (match) => match[1],
    );
    const id = extractUuid(row);

    if (!id) {
      return null;
    }

    return {
      id,
      tenant_id: null,
      organization_id: null,
      name: quotedValues[1] ?? "Sub-recipe",
      recipe_type: row.includes("final_menu_item")
        ? "final_menu_item"
        : "sub_recipe",
      output_uom: row.includes(",kg,") ? "kg" : "unit",
      standard_batch_output_qty: 1,
      standard_yield_pct: 1,
      resolved_unit_cost: 0,
      selling_price: 0,
      is_active: !row.includes(",f,"),
      created_at: "",
    };
  }

  if (typeof row === "object") {
    const recipe = row as Partial<Recipe> & Record<string, unknown>;
    const objectValues = Object.values(recipe);
    const id = extractUuid(recipe.id) || objectValues.map(extractUuid).find(Boolean);

    if (!id) {
      return null;
    }

    return {
      id,
      tenant_id: typeof recipe.tenant_id === "string" ? recipe.tenant_id : null,
      organization_id:
        typeof recipe.organization_id === "string" ? recipe.organization_id : null,
      name: typeof recipe.name === "string" ? recipe.name : "Sub-recipe",
      recipe_type:
        recipe.recipe_type === "final_menu_item" ||
        recipe.recipe_type === "final_dish"
          ? recipe.recipe_type
          : "sub_recipe",
      output_uom: typeof recipe.output_uom === "string" ? recipe.output_uom : "kg",
      standard_batch_output_qty:
        Number(recipe.standard_batch_output_qty) > 0
          ? Number(recipe.standard_batch_output_qty)
          : 1,
      standard_yield_pct:
        Number(recipe.standard_yield_pct) > 0
          ? Number(recipe.standard_yield_pct)
          : 1,
      resolved_unit_cost: Number(recipe.resolved_unit_cost) || 0,
      selling_price: Number(recipe.selling_price) || 0,
      is_active: recipe.is_active !== false,
      created_at: typeof recipe.created_at === "string" ? recipe.created_at : "",
    };
  }

  return null;
}

export function isRecipe(recipe: Recipe | null): recipe is Recipe {
  return Boolean(recipe);
}

export function normalizeRecipeComponentRow(
  row: unknown,
): RecipeComponent | null {
  if (!row) {
    return null;
  }

  if (typeof row === "string") {
    const uuids = Array.from(row.matchAll(uuidPattern)).map((match) => match[0]);
    const numericValues = row.match(/,([0-9]+(?:\.[0-9]+)?),/g) ?? [];

    if (uuids.length < 4) {
      return null;
    }

    return {
      id: uuids[0],
      organization_id: uuids[1],
      recipe_id: uuids[2],
      component_inventory_item_id: uuids[3],
      component_recipe_id: uuids[4] ?? null,
      qty_in_recipe_uom: Number(numericValues[0]?.replaceAll(",", "")) || 0,
      recipe_uom: row.includes(",kg,") ? "kg" : "unit",
      ingredient_name: null,
      ingredient_unit_cost: null,
      created_at: "",
    };
  }

  if (typeof row === "object") {
    const component = row as Partial<RecipeComponent>;
    const id = extractUuid(component.id);
    const recipeId = extractUuid(component.recipe_id);

    if (!id || !recipeId) {
      return null;
    }

    return {
      id,
      organization_id: extractUuid(component.organization_id) || null,
      recipe_id: recipeId,
      component_inventory_item_id:
        extractUuid(component.component_inventory_item_id) || null,
      component_recipe_id: extractUuid(component.component_recipe_id) || null,
      qty_in_recipe_uom: Number(component.qty_in_recipe_uom) || 0,
      recipe_uom:
        typeof component.recipe_uom === "string" ? component.recipe_uom : "unit",
      ingredient_name:
        typeof component.ingredient_name === "string"
          ? component.ingredient_name
          : null,
      ingredient_unit_cost:
        Number(component.ingredient_unit_cost) >= 0
          ? Number(component.ingredient_unit_cost)
          : null,
      created_at:
        typeof component.created_at === "string" ? component.created_at : "",
    };
  }

  return null;
}

export function isRecipeComponent(
  component: RecipeComponent | null,
): component is RecipeComponent {
  return Boolean(component);
}
