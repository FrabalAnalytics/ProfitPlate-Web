const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extractUuid(value: unknown) {
  return String(value ?? "").match(uuidPattern)?.[0] ?? "";
}

export type ProductionHistoryRow = {
  production_run_id: string;
  created_at: string;
  recipe_name: string;
  target_output_qty: number;
  actual_output_qty: number | null;
  output_uom: string | null;
  ingredient_name: string;
  target_qty_required: number;
  actual_qty_used: number;
  waste_variance_qty: number;
  expected_output_from_actual_qty: number;
  output_variance_qty: number;
  unit_cost: number;
  naira_loss: number;
  origin: string;
};

export type StockVarianceHistoryRow = {
  stock_count_id: string;
  created_at: string;
  ingredient_name: string;
  system_qty: number;
  counted_qty: number;
  variance_qty: number;
  unit_cost: number;
  hard_currency_impact: number;
  uom: string | null;
};

export type WasteHistoryRow = {
  waste_event_id: string;
  created_at: string;
  ingredient_name: string;
  quantity: number;
  uom: string | null;
  unit_cost: number;
  waste_cost: number;
  waste_reason: string;
  waste_stage: string;
  notes: string | null;
};

export type MenuSaleHistoryRow = {
  menu_sale_id: string;
  created_at: string;
  operating_date: string;
  pos_business_date: string | null;
  recipe_name: string;
  sold_quantity: number;
  output_uom: string | null;
  component_name: string;
  depleted_qty: number;
  unit_cost: number;
  cost_impact: number;
  selling_unit_price: number;
  total_revenue: number;
  gross_profit: number;
  gross_margin_pct: number | null;
  component_uom: string | null;
};

export function normalizeProductionHistoryRow(
  row: unknown,
): ProductionHistoryRow | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const historyRow = row as Partial<ProductionHistoryRow>;
  const productionRunId = extractUuid(historyRow.production_run_id);

  if (!productionRunId) {
    return null;
  }

  return {
    production_run_id: productionRunId,
    created_at:
      typeof historyRow.created_at === "string" ? historyRow.created_at : "",
    recipe_name:
      typeof historyRow.recipe_name === "string"
        ? historyRow.recipe_name
        : "Production run",
    target_output_qty: Number(historyRow.target_output_qty) || 0,
    actual_output_qty:
      historyRow.actual_output_qty === null ||
      historyRow.actual_output_qty === undefined
        ? null
        : Number(historyRow.actual_output_qty) || 0,
    output_uom:
      typeof historyRow.output_uom === "string" ? historyRow.output_uom : null,
    ingredient_name:
      typeof historyRow.ingredient_name === "string"
        ? historyRow.ingredient_name
        : "Ingredient",
    target_qty_required: Number(historyRow.target_qty_required) || 0,
    actual_qty_used: Number(historyRow.actual_qty_used) || 0,
    waste_variance_qty: Number(historyRow.waste_variance_qty) || 0,
    expected_output_from_actual_qty:
      Number(historyRow.expected_output_from_actual_qty) || 0,
    output_variance_qty: Number(historyRow.output_variance_qty) || 0,
    unit_cost: Number(historyRow.unit_cost) || 0,
    naira_loss: Number(historyRow.naira_loss) || 0,
    origin:
      typeof historyRow.origin === "string"
        ? historyRow.origin
        : "kitchen_prep_line",
  };
}

export function isProductionHistoryRow(
  row: ProductionHistoryRow | null,
): row is ProductionHistoryRow {
  return Boolean(row);
}

export function normalizeStockVarianceHistoryRow(
  row: unknown,
): StockVarianceHistoryRow | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const historyRow = row as Partial<StockVarianceHistoryRow>;
  const stockCountId = extractUuid(historyRow.stock_count_id);

  if (!stockCountId) {
    return null;
  }

  return {
    stock_count_id: stockCountId,
    created_at:
      typeof historyRow.created_at === "string" ? historyRow.created_at : "",
    ingredient_name:
      typeof historyRow.ingredient_name === "string"
        ? historyRow.ingredient_name
        : "Ingredient",
    system_qty: Number(historyRow.system_qty) || 0,
    counted_qty: Number(historyRow.counted_qty) || 0,
    variance_qty: Number(historyRow.variance_qty) || 0,
    unit_cost: Number(historyRow.unit_cost) || 0,
    hard_currency_impact: Number(historyRow.hard_currency_impact) || 0,
    uom: typeof historyRow.uom === "string" ? historyRow.uom : null,
  };
}

export function isStockVarianceHistoryRow(
  row: StockVarianceHistoryRow | null,
): row is StockVarianceHistoryRow {
  return Boolean(row);
}

export function normalizeWasteHistoryRow(row: unknown): WasteHistoryRow | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const historyRow = row as Partial<WasteHistoryRow>;
  const wasteEventId = extractUuid(historyRow.waste_event_id);

  if (!wasteEventId) {
    return null;
  }

  return {
    waste_event_id: wasteEventId,
    created_at:
      typeof historyRow.created_at === "string" ? historyRow.created_at : "",
    ingredient_name:
      typeof historyRow.ingredient_name === "string"
        ? historyRow.ingredient_name
        : "Ingredient",
    quantity: Number(historyRow.quantity) || 0,
    uom: typeof historyRow.uom === "string" ? historyRow.uom : null,
    unit_cost: Number(historyRow.unit_cost) || 0,
    waste_cost: Number(historyRow.waste_cost) || 0,
    waste_reason:
      typeof historyRow.waste_reason === "string"
        ? historyRow.waste_reason
        : "spoilage",
    waste_stage:
      typeof historyRow.waste_stage === "string"
        ? historyRow.waste_stage
        : "prep",
    notes: typeof historyRow.notes === "string" ? historyRow.notes : null,
  };
}

export function isWasteHistoryRow(
  row: WasteHistoryRow | null,
): row is WasteHistoryRow {
  return Boolean(row);
}

export function normalizeMenuSaleHistoryRow(
  row: unknown,
): MenuSaleHistoryRow | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const historyRow = row as Partial<MenuSaleHistoryRow>;
  const menuSaleId = extractUuid(historyRow.menu_sale_id);

  if (!menuSaleId) {
    return null;
  }

  return {
    menu_sale_id: menuSaleId,
    created_at:
      typeof historyRow.created_at === "string" ? historyRow.created_at : "",
    operating_date:
      typeof historyRow.operating_date === "string"
        ? historyRow.operating_date
        : typeof historyRow.created_at === "string"
          ? historyRow.created_at.slice(0, 10)
          : "",
    pos_business_date:
      typeof historyRow.pos_business_date === "string"
        ? historyRow.pos_business_date
        : null,
    recipe_name:
      typeof historyRow.recipe_name === "string"
        ? historyRow.recipe_name
        : "Menu item",
    sold_quantity: Number(historyRow.sold_quantity) || 0,
    output_uom:
      typeof historyRow.output_uom === "string" ? historyRow.output_uom : null,
    component_name:
      typeof historyRow.component_name === "string"
        ? historyRow.component_name
        : "Component",
    depleted_qty: Number(historyRow.depleted_qty) || 0,
    unit_cost: Number(historyRow.unit_cost) || 0,
    cost_impact: Number(historyRow.cost_impact) || 0,
    selling_unit_price: Number(historyRow.selling_unit_price) || 0,
    total_revenue: Number(historyRow.total_revenue) || 0,
    gross_profit: Number(historyRow.gross_profit) || 0,
    gross_margin_pct:
      historyRow.gross_margin_pct === null ||
      historyRow.gross_margin_pct === undefined
        ? null
        : Number(historyRow.gross_margin_pct) || 0,
    component_uom:
      typeof historyRow.component_uom === "string"
        ? historyRow.component_uom
        : null,
  };
}

export function isMenuSaleHistoryRow(
  row: MenuSaleHistoryRow | null,
): row is MenuSaleHistoryRow {
  return Boolean(row);
}
