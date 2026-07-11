export type PosImportRecipe = {
  id: string;
  name: string;
};

export type PosImportMapping = {
  pos_item_key: string;
  recipe_id: string;
};

export type SalesImportPreviewRow = {
  id: string;
  rowNumber: number;
  menuItem: string;
  posItemCode: string;
  posItemKey: string;
  businessDate: string;
  transactionTimestamp: string;
  sourceTransactionId: string;
  sourceCheckId: string;
  sourceLocationName: string;
  rowFingerprint: string;
  dateStatus: "verified" | "missing_date" | "unverified";
  soldQuantity: number;
  grossSales: number;
  discountAmount: number;
  promoAmount: number;
  voidAmount: number;
  netSales: number;
  hasRevenueData: boolean;
  recipeId: string;
  matchedRecipeName: string;
  matchSource: "name" | "mapping" | null;
  error: string | null;
};

const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function getRecipeId(recipe: PosImportRecipe) {
  return String(recipe.id).match(uuidPattern)?.[0] ?? recipe.id;
}

function normalizeImportKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function buildPosItemKey(label: unknown, code?: unknown) {
  const normalizedCode = normalizeImportKey(code);
  const normalizedLabel = normalizeImportKey(label);

  return normalizedCode || normalizedLabel;
}

function parseImportNumber(value: unknown) {
  const rawValue = String(value ?? "").trim();
  const isAccountingNegative = rawValue.startsWith("(") && rawValue.endsWith(")");
  const normalizedValue = rawValue
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .match(/-?\d+(\.\d+)?/)?.[0];
  const parsedValue = Number(normalizedValue ?? NaN);

  if (!Number.isFinite(parsedValue)) {
    return 0;
  }

  return isAccountingNegative ? -1 * Math.abs(parsedValue) : parsedValue;
}

function toIsoDate(year: number, month: number, day: number) {
  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return "";
  }

  return parsedDate.toISOString().slice(0, 10);
}

function parseImportDate(value: unknown) {
  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    return "";
  }

  const isoMatch = rawValue.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);

  if (isoMatch) {
    return toIsoDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  const slashMatch = rawValue.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);

  if (slashMatch) {
    const firstPart = Number(slashMatch[1]);
    const secondPart = Number(slashMatch[2]);
    const yearPart = Number(slashMatch[3]);
    const fullYear = yearPart < 100 ? 2000 + yearPart : yearPart;
    const day = firstPart > 12 ? firstPart : secondPart > 12 ? secondPart : firstPart;
    const month =
      firstPart > 12 ? secondPart : secondPart > 12 ? firstPart : secondPart;

    return toIsoDate(fullYear, month, day);
  }

  const parsedTime = Date.parse(rawValue);

  if (Number.isNaN(parsedTime)) {
    return "";
  }

  return new Date(parsedTime).toISOString().slice(0, 10);
}

function parseImportTimestamp(value: unknown) {
  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    return "";
  }

  const parsedTime = Date.parse(rawValue);

  if (Number.isNaN(parsedTime)) {
    return "";
  }

  return new Date(parsedTime).toISOString();
}

function parseDelimitedRows(input: string) {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const nextCharacter = input[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      currentCell += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && (character === "," || character === "\t")) {
      currentRow.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentCell = "";
      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

export function buildSalesImportPreview(
  input: string,
  activeFinalMenuItems: PosImportRecipe[],
  posSalesItemMappings: PosImportMapping[],
): SalesImportPreviewRow[] {
  const parsedRows = parseDelimitedRows(input);

  if (parsedRows.length === 0) {
    return [];
  }

  const menuHeaderKeys = new Set([
    "menuitem",
    "item",
    "itemname",
    "recipe",
    "recipename",
    "product",
    "productname",
    "description",
    "itemdescription",
    "menuname",
    "dish",
    "dishname",
    "name",
  ]);
  const codeHeaderKeys = new Set([
    "code",
    "itemcode",
    "productcode",
    "sku",
    "plu",
    "barcode",
    "posid",
    "positemid",
    "itemid",
  ]);
  const quantityHeaderKeys = new Set([
    "quantity",
    "qty",
    "count",
    "units",
    "quantitysold",
    "soldquantity",
    "soldqty",
    "qtysold",
    "netqty",
    "netquantity",
    "itemquantity",
    "unitssold",
  ]);
  const grossSalesHeaderKeys = new Set([
    "gross",
    "grosssales",
    "grosssale",
    "grossamount",
    "grossrevenue",
    "sales",
    "salesamount",
    "amount",
    "total",
    "linetotal",
  ]);
  const netSalesHeaderKeys = new Set([
    "net",
    "netsales",
    "netsale",
    "netamount",
    "netrevenue",
    "revenue",
  ]);
  const discountHeaderKeys = new Set([
    "discount",
    "discounts",
    "discountamount",
    "discountvalue",
  ]);
  const promoHeaderKeys = new Set([
    "promo",
    "promos",
    "promotion",
    "promotions",
    "promoamount",
    "comp",
    "compamount",
    "complimentary",
  ]);
  const voidHeaderKeys = new Set([
    "void",
    "voids",
    "voidamount",
    "refund",
    "refunds",
    "refundamount",
    "cancelled",
    "cancelledamount",
  ]);
  const businessDateHeaderKeys = new Set([
    "date",
    "businessdate",
    "salesdate",
    "tradingdate",
    "operatingdate",
    "businessday",
    "salebusinessdate",
  ]);
  const timestampHeaderKeys = new Set([
    "timestamp",
    "datetime",
    "transactiontime",
    "transactiondatetime",
    "createdat",
    "closedat",
    "ordertime",
    "saletime",
  ]);
  const transactionHeaderKeys = new Set([
    "transactionid",
    "transaction",
    "receiptid",
    "receipt",
    "ticketid",
    "ticket",
    "orderid",
    "orderno",
    "billno",
    "invoice",
    "invoiceno",
  ]);
  const checkHeaderKeys = new Set([
    "checkid",
    "check",
    "checkno",
    "tabid",
    "billid",
  ]);
  const locationHeaderKeys = new Set([
    "location",
    "outlet",
    "branch",
    "store",
    "site",
    "revenuecenter",
  ]);
  const firstRowKeys = parsedRows[0].map(normalizeImportKey);
  const menuColumnIndex = firstRowKeys.findIndex((key) =>
    menuHeaderKeys.has(key),
  );
  const codeColumnIndex = firstRowKeys.findIndex((key) =>
    codeHeaderKeys.has(key),
  );
  const quantityColumnIndex = firstRowKeys.findIndex((key) =>
    quantityHeaderKeys.has(key),
  );
  const grossSalesColumnIndex = firstRowKeys.findIndex((key) =>
    grossSalesHeaderKeys.has(key),
  );
  const netSalesColumnIndex = firstRowKeys.findIndex((key) =>
    netSalesHeaderKeys.has(key),
  );
  const discountColumnIndex = firstRowKeys.findIndex((key) =>
    discountHeaderKeys.has(key),
  );
  const promoColumnIndex = firstRowKeys.findIndex((key) =>
    promoHeaderKeys.has(key),
  );
  const voidColumnIndex = firstRowKeys.findIndex((key) =>
    voidHeaderKeys.has(key),
  );
  const businessDateColumnIndex = firstRowKeys.findIndex((key) =>
    businessDateHeaderKeys.has(key),
  );
  const timestampColumnIndex = firstRowKeys.findIndex((key) =>
    timestampHeaderKeys.has(key),
  );
  const transactionColumnIndex = firstRowKeys.findIndex((key) =>
    transactionHeaderKeys.has(key),
  );
  const checkColumnIndex = firstRowKeys.findIndex((key) =>
    checkHeaderKeys.has(key),
  );
  const locationColumnIndex = firstRowKeys.findIndex((key) =>
    locationHeaderKeys.has(key),
  );
  const hasHeader =
    menuColumnIndex >= 0 ||
    codeColumnIndex >= 0 ||
    quantityColumnIndex >= 0 ||
    grossSalesColumnIndex >= 0 ||
    netSalesColumnIndex >= 0;
  const menuIndex = menuColumnIndex >= 0 ? menuColumnIndex : 0;
  const codeIndex = codeColumnIndex >= 0 ? codeColumnIndex : -1;
  const quantityIndex = quantityColumnIndex >= 0 ? quantityColumnIndex : 1;
  const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
  const menuItemsByName = new Map(
    activeFinalMenuItems.map((recipe) => [
      normalizeImportKey(recipe.name),
      recipe,
    ]),
  );
  const menuItemsById = new Map(
    activeFinalMenuItems.map((recipe) => [getRecipeId(recipe), recipe]),
  );
  const mappingsByPosKey = new Map(
    posSalesItemMappings.map((mapping) => [
      mapping.pos_item_key,
      mapping.recipe_id,
    ]),
  );

  return dataRows.map((row, index) => {
    const menuItem = String(row[menuIndex] ?? "").trim();
    const posItemCode = codeIndex >= 0 ? String(row[codeIndex] ?? "").trim() : "";
    const posItemKey = buildPosItemKey(menuItem, posItemCode);
    const sourceTransactionId =
      transactionColumnIndex >= 0
        ? String(row[transactionColumnIndex] ?? "").trim()
        : "";
    const sourceCheckId =
      checkColumnIndex >= 0 ? String(row[checkColumnIndex] ?? "").trim() : "";
    const sourceLocationName =
      locationColumnIndex >= 0 ? String(row[locationColumnIndex] ?? "").trim() : "";
    const transactionTimestamp =
      timestampColumnIndex >= 0
        ? parseImportTimestamp(row[timestampColumnIndex])
        : "";
    const businessDate =
      businessDateColumnIndex >= 0
        ? parseImportDate(row[businessDateColumnIndex])
        : transactionTimestamp
          ? transactionTimestamp.slice(0, 10)
          : "";
    const soldQuantity = parseImportNumber(row[quantityIndex]);
    const importedGrossSales =
      grossSalesColumnIndex >= 0 ? parseImportNumber(row[grossSalesColumnIndex]) : 0;
    const importedNetSales =
      netSalesColumnIndex >= 0 ? parseImportNumber(row[netSalesColumnIndex]) : 0;
    const discountAmount =
      discountColumnIndex >= 0
        ? Math.abs(parseImportNumber(row[discountColumnIndex]))
        : 0;
    const promoAmount =
      promoColumnIndex >= 0 ? Math.abs(parseImportNumber(row[promoColumnIndex])) : 0;
    const voidAmount =
      voidColumnIndex >= 0 ? Math.abs(parseImportNumber(row[voidColumnIndex])) : 0;
    const hasRevenueData =
      grossSalesColumnIndex >= 0 ||
      netSalesColumnIndex >= 0 ||
      discountColumnIndex >= 0 ||
      promoColumnIndex >= 0 ||
      voidColumnIndex >= 0;
    const grossSales =
      importedGrossSales > 0
        ? importedGrossSales
        : importedNetSales > 0
          ? importedNetSales + discountAmount + promoAmount + voidAmount
          : 0;
    const netSales =
      importedNetSales > 0
        ? importedNetSales
        : Math.max(grossSales - discountAmount - promoAmount - voidAmount, 0);
    const rowFingerprint = [
      businessDate,
      transactionTimestamp,
      sourceTransactionId || sourceCheckId,
      posItemKey,
      soldQuantity,
      netSales,
    ]
      .map((part) => String(part ?? "").trim().toLowerCase())
      .join("|");
    const dateStatus = businessDate
      ? "verified"
      : businessDateColumnIndex >= 0 || timestampColumnIndex >= 0
        ? "missing_date"
        : "unverified";
    const mappedRecipeId = mappingsByPosKey.get(posItemKey) ?? "";
    const mappedRecipe = menuItemsById.get(mappedRecipeId);
    const namedRecipe = menuItemsByName.get(normalizeImportKey(menuItem));
    const matchedRecipe = mappedRecipe ?? namedRecipe ?? null;
    const recipeId = matchedRecipe ? getRecipeId(matchedRecipe) : "";
    const matchSource = mappedRecipe
      ? "mapping"
      : namedRecipe
        ? "name"
        : null;
    let error: string | null = null;

    if (!posItemKey) {
      error = "POS item name or code is blank.";
    } else if (!recipeId) {
      error = "Map this POS item to a final menu item.";
    } else if (!Number.isFinite(soldQuantity) || soldQuantity <= 0) {
      error = "Quantity sold must be above zero.";
    }

    return {
      id: `sales-import-${index + 1}`,
      rowNumber: hasHeader ? index + 2 : index + 1,
      menuItem,
      posItemCode,
      posItemKey,
      businessDate,
      transactionTimestamp,
      sourceTransactionId,
      sourceCheckId,
      sourceLocationName,
      rowFingerprint,
      dateStatus,
      soldQuantity,
      grossSales,
      discountAmount,
      promoAmount,
      voidAmount,
      netSales,
      hasRevenueData,
      recipeId,
      matchedRecipeName: matchedRecipe?.name ?? "",
      matchSource,
      error,
    };
  });
}
