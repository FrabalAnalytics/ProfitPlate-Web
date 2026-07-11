import assert from "node:assert/strict";
import test from "node:test";
import {
  getRecipeId,
  normalizeRecipeComponentRow,
  normalizeRecipeRow,
} from "./recipe-normalizers.ts";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];

test("rejects recipe rows without an identifiable UUID", () => {
  assert.equal(normalizeRecipeRow(null), null);
  assert.equal(normalizeRecipeRow({ name: "No ID" }), null);
  assert.equal(normalizeRecipeRow("malformed"), null);
});

test("normalizes recipe object values and positive defaults", () => {
  const recipe = normalizeRecipeRow({
    id: ids[0],
    name: "Jollof Rice",
    recipe_type: "final_menu_item",
    standard_batch_output_qty: "12",
    standard_yield_pct: "0.9",
    resolved_unit_cost: "850",
    selling_price: "2500",
  });

  assert.equal(recipe?.recipe_type, "final_menu_item");
  assert.equal(recipe?.standard_batch_output_qty, 12);
  assert.equal(recipe?.standard_yield_pct, 0.9);
  assert.equal(recipe?.resolved_unit_cost, 850);
  assert.equal(recipe?.is_active, true);
  assert.equal(recipe && getRecipeId(recipe), ids[0]);
});

test("preserves the legacy string-row recipe fallback", () => {
  const recipe = normalizeRecipeRow(
    `${ids[0]},"ignored","Legacy Jollof",final_menu_item,kg,f,`,
  );

  assert.equal(recipe?.name, "Legacy Jollof");
  assert.equal(recipe?.recipe_type, "final_menu_item");
  assert.equal(recipe?.output_uom, "kg");
  assert.equal(recipe?.is_active, false);
});

test("normalizes component object references and numeric values", () => {
  const component = normalizeRecipeComponentRow({
    id: ids[0],
    organization_id: ids[1],
    recipe_id: ids[2],
    component_inventory_item_id: ids[3],
    component_recipe_id: null,
    qty_in_recipe_uom: "1.25",
    recipe_uom: "kg",
    ingredient_unit_cost: "900",
  });

  assert.equal(component?.recipe_id, ids[2]);
  assert.equal(component?.component_inventory_item_id, ids[3]);
  assert.equal(component?.qty_in_recipe_uom, 1.25);
  assert.equal(component?.ingredient_unit_cost, 900);
});

test("preserves the legacy string-row component fallback", () => {
  const component = normalizeRecipeComponentRow(
    `${ids.join(",")},1.5,kg,`,
  );

  assert.equal(component?.id, ids[0]);
  assert.equal(component?.recipe_id, ids[2]);
  assert.equal(component?.component_inventory_item_id, ids[3]);
  assert.equal(component?.component_recipe_id, ids[4]);
  assert.equal(component?.qty_in_recipe_uom, 1.5);
  assert.equal(component?.recipe_uom, "kg");
});
