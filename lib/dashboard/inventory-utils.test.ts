import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeActiveInventoryItems,
  dedupeActiveRecipes,
  dedupeRecipeComponentsByIngredient,
  getInventoryDisplayKey,
  recipesFromManufacturedInventory,
  type InventoryItem,
} from "./inventory-utils.ts";
import type { Recipe, RecipeComponent } from "./recipe-normalizers.ts";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

function inventoryItem(
  overrides: Partial<InventoryItem> = {},
): InventoryItem {
  return {
    id: ids[0],
    organization_id: ids[1],
    tenant_id: null,
    location_id: null,
    recipe_id: null,
    name: "Tomatoes",
    sku: "TOM-01",
    department: "Kitchen",
    item_type: "raw_material",
    cost_type: "purchased",
    base_uom: "kg",
    recipe_uom: "kg",
    on_hand_uom: "kg",
    on_hand_qty: 10,
    current_cost_per_base_uom: 500,
    yield_pct: 1,
    shrinkage_factor_pct: 0,
    is_high_value: false,
    is_active: true,
    created_at: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: ids[0],
    tenant_id: null,
    organization_id: ids[1],
    name: "Jollof Rice",
    recipe_type: "sub_recipe",
    output_uom: "kg",
    standard_batch_output_qty: 1,
    standard_yield_pct: 1,
    resolved_unit_cost: 1000,
    selling_price: 0,
    is_active: true,
    created_at: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

test("builds stable purchased and manufactured inventory keys", () => {
  assert.equal(
    getInventoryDisplayKey(inventoryItem()),
    "purchased:unassigned:tom-01",
  );
  assert.equal(
    getInventoryDisplayKey(
      inventoryItem({ cost_type: "manufactured", sku: null, name: "Pepper Sauce" }),
    ),
    "manufactured:unassigned:pepper sauce",
  );
});

test("keeps separate active inventory records for each location balance", () => {
  const first = inventoryItem({ location_id: ids[0] });
  const duplicateInSameLocation = inventoryItem({
    id: ids[2],
    location_id: ids[0],
    name: "Fresh Tomatoes",
  });
  const sameSkuInAnotherLocation = inventoryItem({
    id: ids[3],
    location_id: ids[2],
  });
  const inactive = inventoryItem({ id: ids[3], sku: "ONION", is_active: false });

  assert.deepEqual(
    dedupeActiveInventoryItems([
      first,
      duplicateInSameLocation,
      sameSkuInAnotherLocation,
      inactive,
    ]),
    [first, sameSkuInAnotherLocation],
  );
});

test("creates one recipe fallback per manufactured recipe ID", () => {
  const manufactured = inventoryItem({
    cost_type: "manufactured",
    recipe_id: ids[2],
    name: "Pepper Sauce",
    on_hand_uom: "litre",
    current_cost_per_base_uom: 1200,
    yield_pct: 0.9,
  });
  const duplicate = inventoryItem({
    id: ids[3],
    cost_type: "manufactured",
    recipe_id: ids[2],
    name: "Pepper Sauce duplicate",
  });
  const [fallback] = recipesFromManufacturedInventory([
    inventoryItem(),
    manufactured,
    duplicate,
  ]);

  assert.equal(fallback.id, ids[2]);
  assert.equal(fallback.name, "Pepper Sauce");
  assert.equal(fallback.output_uom, "litre");
  assert.equal(fallback.resolved_unit_cost, 1200);
});

test("prefers recipe duplicates by batch, components, then recency", () => {
  const oldRecipe = recipe();
  const largerBatch = recipe({
    id: ids[2],
    standard_batch_output_qty: 4,
    created_at: "2026-07-02T10:00:00.000Z",
  });
  const inactive = recipe({ id: ids[3], is_active: false });

  assert.deepEqual(
    dedupeActiveRecipes([oldRecipe, largerBatch, inactive]),
    [largerBatch],
  );
});

test("keeps the newest component for each ingredient", () => {
  const base: RecipeComponent = {
    id: ids[0],
    organization_id: ids[1],
    recipe_id: ids[2],
    component_inventory_item_id: ids[3],
    component_recipe_id: null,
    qty_in_recipe_uom: 1,
    recipe_uom: "kg",
    ingredient_name: "Tomatoes",
    ingredient_unit_cost: 500,
    created_at: "2026-07-01T10:00:00.000Z",
  };
  const latest = {
    ...base,
    id: ids[1],
    qty_in_recipe_uom: 1.5,
    created_at: "2026-07-02T10:00:00.000Z",
  };

  assert.deepEqual(dedupeRecipeComponentsByIngredient([base, latest]), [latest]);
});
