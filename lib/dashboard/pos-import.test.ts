import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPosItemKey,
  buildSalesImportPreview,
  type PosImportMapping,
  type PosImportRecipe,
} from "./pos-import.ts";

const recipes: PosImportRecipe[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Jollof Rice" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Asun Portion" },
];

test("normalizes POS codes before labels", () => {
  assert.equal(buildPosItemKey("Jollof Rice", " JOL-001 "), "jol001");
  assert.equal(buildPosItemKey(" Jollof Rice "), "jollofrice");
});

test("matches menu names and calculates net sales from deductions", () => {
  const [row] = buildSalesImportPreview(
    [
      "Item,Qty,Gross Sales,Discount,Promo,Void",
      "Jollof Rice,3,\"15,000\",500,250,0",
    ].join("\n"),
    recipes,
    [],
  );

  assert.equal(row.recipeId, recipes[0].id);
  assert.equal(row.matchSource, "name");
  assert.equal(row.soldQuantity, 3);
  assert.equal(row.grossSales, 15_000);
  assert.equal(row.netSales, 14_250);
  assert.equal(row.error, null);
});

test("reuses saved POS-code mappings when labels differ", () => {
  const mappings: PosImportMapping[] = [
    {
      pos_item_key: "asun001",
      recipe_id: recipes[1].id,
    },
  ];
  const [row] = buildSalesImportPreview(
    "PLU,Description,Quantity,Net Sales\nASUN-001,Spicy Goat,2,9000",
    recipes,
    mappings,
  );

  assert.equal(row.matchedRecipeName, "Asun Portion");
  assert.equal(row.matchSource, "mapping");
  assert.equal(row.netSales, 9_000);
  assert.equal(row.grossSales, 9_000);
});

test("preserves quoted delimiters and flags invalid rows", () => {
  const rows = buildSalesImportPreview(
    'Item,Qty,Net\n"Rice, Party Size",0,5000',
    recipes,
    [],
  );

  assert.equal(rows[0].menuItem, "Rice, Party Size");
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[0].error, "Map this POS item to a final menu item.");
});

test("accepts tab-delimited exports and accounting-style deductions", () => {
  const [row] = buildSalesImportPreview(
    "Item\tQty\tNet\tDiscount\nJollof Rice\t1\t9500\t(500)",
    recipes,
    [],
  );

  assert.equal(row.discountAmount, 500);
  assert.equal(row.netSales, 9_500);
  assert.equal(row.grossSales, 10_000);
});

test("detects business dates and POS transaction identity", () => {
  const [row] = buildSalesImportPreview(
    [
      "Business Date,Transaction ID,Check ID,Item,Qty,Net",
      "09/07/2026,RCPT-42,CHK-7,Jollof Rice,2,12000",
    ].join("\n"),
    recipes,
    [],
  );

  assert.equal(row.businessDate, "2026-07-09");
  assert.equal(row.sourceTransactionId, "RCPT-42");
  assert.equal(row.sourceCheckId, "CHK-7");
  assert.equal(row.dateStatus, "verified");
  assert.match(row.rowFingerprint, /2026-07-09/);
});

test("marks POS rows as provisional when no date evidence exists", () => {
  const [row] = buildSalesImportPreview(
    "Item,Qty,Net\nJollof Rice,1,5000",
    recipes,
    [],
  );

  assert.equal(row.businessDate, "");
  assert.equal(row.dateStatus, "unverified");
});
