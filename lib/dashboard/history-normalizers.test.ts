import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMenuSaleHistoryRow,
  normalizeProductionHistoryRow,
  normalizeStockVarianceHistoryRow,
  normalizeWasteHistoryRow,
} from "./history-normalizers.ts";

const ids = {
  production: "11111111-1111-4111-8111-111111111111",
  stock: "22222222-2222-4222-8222-222222222222",
  waste: "33333333-3333-4333-8333-333333333333",
  sale: "44444444-4444-4444-8444-444444444444",
};

test("rejects malformed history payloads without identifiers", () => {
  assert.equal(normalizeProductionHistoryRow(null), null);
  assert.equal(normalizeStockVarianceHistoryRow({ stock_count_id: "bad" }), null);
  assert.equal(normalizeWasteHistoryRow("bad"), null);
  assert.equal(normalizeMenuSaleHistoryRow({}), null);
});

test("normalizes production history values and nullable output", () => {
  const row = normalizeProductionHistoryRow({
    production_run_id: ids.production,
    target_output_qty: "12.5",
    actual_output_qty: null,
    actual_qty_used: "8",
    naira_loss: "450.25",
  });

  assert.equal(row?.target_output_qty, 12.5);
  assert.equal(row?.actual_output_qty, null);
  assert.equal(row?.actual_qty_used, 8);
  assert.equal(row?.naira_loss, 450.25);
  assert.equal(row?.recipe_name, "Production run");
  assert.equal(row?.origin, "kitchen_prep_line");
});

test("normalizes stock variance numeric strings and fallbacks", () => {
  const row = normalizeStockVarianceHistoryRow({
    stock_count_id: ids.stock,
    system_qty: "20",
    counted_qty: "18.5",
    variance_qty: "-1.5",
    hard_currency_impact: "3000",
  });

  assert.equal(row?.system_qty, 20);
  assert.equal(row?.counted_qty, 18.5);
  assert.equal(row?.variance_qty, -1.5);
  assert.equal(row?.hard_currency_impact, 3000);
  assert.equal(row?.ingredient_name, "Ingredient");
});

test("normalizes waste history while preserving operational labels", () => {
  const row = normalizeWasteHistoryRow({
    waste_event_id: ids.waste,
    ingredient_name: "Beef fillet",
    quantity: "0.75",
    waste_cost: "4200",
    waste_reason: "over-trimming",
    waste_stage: "prep",
    notes: 42,
  });

  assert.equal(row?.quantity, 0.75);
  assert.equal(row?.waste_cost, 4200);
  assert.equal(row?.waste_reason, "over-trimming");
  assert.equal(row?.notes, null);
});

test("normalizes menu-sale financial values and nullable margin", () => {
  const row = normalizeMenuSaleHistoryRow({
    menu_sale_id: ids.sale,
    created_at: "2026-07-09T18:30:00.000Z",
    operating_date: "2026-07-08",
    pos_business_date: "2026-07-08",
    recipe_name: "Jollof Rice",
    sold_quantity: "3",
    total_revenue: "15000",
    gross_profit: "6000",
    gross_margin_pct: null,
  });

  assert.equal(row?.sold_quantity, 3);
  assert.equal(row?.total_revenue, 15000);
  assert.equal(row?.gross_profit, 6000);
  assert.equal(row?.gross_margin_pct, null);
  assert.equal(row?.operating_date, "2026-07-08");
  assert.equal(row?.pos_business_date, "2026-07-08");
  assert.equal(row?.component_name, "Component");
});
