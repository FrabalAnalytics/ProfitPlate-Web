export type DashboardDateFilter = "today" | "7d" | "30d" | "all";

const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function extractUuid(value: unknown) {
  const match = String(value ?? "").match(uuidPattern);
  return match?.[0] ?? "";
}

export function formatCurrencyAmount(
  currency: string,
  value: number,
  maximumFractionDigits = 2,
) {
  return `${currency}\u00a0${value.toLocaleString(undefined, {
    maximumFractionDigits,
  })}`;
}

export function formatSignedCurrencyAmount(
  currency: string,
  value: number,
  maximumFractionDigits = 2,
) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";

  return `${sign}${formatCurrencyAmount(
    currency,
    Math.abs(value),
    maximumFractionDigits,
  )}`;
}

export function getDateKey(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toDateString();
}

export function getDateMs(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function getLocalDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getDateFilterStart(
  filter: DashboardDateFilter,
  referenceDate = new Date(),
) {
  const start = new Date(referenceDate);

  start.setHours(0, 0, 0, 0);

  if (filter === "7d") {
    start.setDate(start.getDate() - 6);
  }

  if (filter === "30d") {
    start.setDate(start.getDate() - 29);
  }

  return start.getTime();
}

export function isWithinDateFilter(
  value: string,
  filter: DashboardDateFilter,
  referenceDate = new Date(),
) {
  if (filter === "all") {
    return true;
  }

  const dateMs = getDateMs(value);

  return dateMs > 0 && dateMs >= getDateFilterStart(filter, referenceDate);
}

export function formatShortDate(value: number) {
  if (!value) {
    return "No activity yet";
  }

  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function escapeCsvValue(value: unknown) {
  const normalizedValue =
    value === null || value === undefined ? "" : String(value);

  if (
    normalizedValue.includes(",") ||
    normalizedValue.includes("\"") ||
    normalizedValue.includes("\n")
  ) {
    return `"${normalizedValue.replaceAll("\"", "\"\"")}"`;
  }

  return normalizedValue;
}
