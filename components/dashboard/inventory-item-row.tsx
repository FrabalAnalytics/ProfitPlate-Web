"use client";

import type { FormEvent } from "react";
import type { InventoryItem } from "@/lib/dashboard/inventory-utils";

type InventoryLocation = {
  id: string;
  name: string;
  location_type?: string;
};

const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extractUuid(value: unknown) {
  return String(value ?? "").match(uuidPattern)?.[0] ?? "";
}

export function InventoryItemRow({
  item,
  locations,
  currency,
  disabled,
  onUpdate,
}: {
  item: InventoryItem;
  locations: InventoryLocation[];
  currency: string;
  disabled: boolean;
  onUpdate: (
    itemId: string,
    patch: Partial<
      Pick<InventoryItem, "current_cost_per_base_uom" | "is_active">
    >,
  ) => Promise<void>;
}) {
  async function handleCostUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const nextCost = Number(formData.get("current_cost_per_base_uom") ?? 0);

    await onUpdate(item.id, {
      current_cost_per_base_uom: Number.isFinite(nextCost) ? nextCost : 0,
    });
  }

  const onHandQty = Number(item.on_hand_qty ?? 0);
  const daysRemaining =
    onHandQty <= 0 ? 0 : Math.max(1, Math.round(onHandQty * 3));
  const stockStatus =
    onHandQty <= 0
      ? "Reorder now"
      : onHandQty <= 1
        ? "Running low"
        : onHandQty > 30
          ? "Overstocked"
          : "Stable";
  const assignedLocation = locations.find(
    (location) => extractUuid(location.id) === extractUuid(item.location_id),
  );
  const normalizedLocationName = assignedLocation?.name.trim().toLowerCase() ?? "";
  const isDepartmentBalance =
    ["department", "bar", "local_kitchen", "kitchen_line", "production_kitchen", "sales_outlet"].includes(
      assignedLocation?.location_type ?? "",
    ) ||
    (
      /(^|[^a-z])(kitchen|kicthen|kitchn|bar)([^a-z]|$)/.test(
        normalizedLocationName,
      ) &&
      !/(store|warehouse|main|central)/.test(normalizedLocationName)
    );
  const stockScopeLabel = isDepartmentBalance
    ? "department balance"
    : "store SKU";
  const statusClass =
    stockStatus === "Reorder now"
      ? "border-status-critical-border bg-status-critical-bg text-status-critical-text shadow-[0_10px_24px_rgba(189,59,44,0.12)]"
      : stockStatus === "Running low"
        ? "border-status-attention-border bg-status-attention-bg text-status-attention-text shadow-[0_10px_24px_rgba(154,101,0,0.1)]"
        : stockStatus === "Overstocked"
          ? "border-status-info-border bg-status-info-bg text-status-info-text shadow-[0_10px_24px_rgba(53,107,120,0.08)]"
          : "border-accent-muted-border bg-accent-muted-bg text-accent shadow-[0_10px_24px_rgba(18,107,70,0.08)]";
  const stockNumberClass =
    stockStatus === "Reorder now"
      ? "text-status-critical-text"
      : stockStatus === "Running low"
        ? "text-status-attention-text"
        : "text-foreground";

  return (
    <div className="grid gap-4 border-t border-border-system px-4 py-4 text-sm text-text-muted transition hover:bg-background/70 sm:px-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(180px,0.8fr)_minmax(220px,0.95fr)_130px] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2 lg:block">
          <p className="min-w-0 text-base font-extrabold text-foreground lg:truncate">
            {item.name ?? "Unnamed item"}
          </p>
          <span
            className={`inline-flex rounded-full border px-2 py-1 font-mono text-[9px] font-black uppercase tracking-widest lg:hidden ${statusClass}`}
          >
            {item.is_active ? stockStatus : "Inactive"}
          </span>
        </div>
        <p className="text-xs text-text-ghost lg:truncate">
          {item.sku || "No SKU"}
          {` / ${stockScopeLabel}`}
          {item.department ? ` / ${item.department}` : ""}
          {item.is_high_value ? " / High value" : ""}
        </p>
        <p className="mt-1 text-xs text-text-ghost">
          {assignedLocation?.name ?? "Unassigned"} /{" "}
          {item.cost_type.replace("_", " ")} /{" "}
          {item.base_uom ?? item.on_hand_uom ?? "unit"}
        </p>
      </div>
      <div className="rounded-sm border border-border-system bg-card px-3 py-3 lg:border-0 lg:bg-transparent lg:p-0">
        <p className="mb-1 font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost lg:hidden">
          Stock posture
        </p>
        <p className={`font-mono text-xl font-black leading-none tracking-tight ${stockNumberClass}`}>
          {onHandQty.toLocaleString(undefined, {
            maximumFractionDigits: 3,
          })}{" "}
          <span className="text-xs uppercase tracking-normal">
            {item.on_hand_uom ?? item.base_uom ?? "unit"}
          </span>
        </p>
        <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
          Flat trend / {daysRemaining}d left / yield{" "}
          {Math.round(item.yield_pct * 100)}% / shrink{" "}
          {Math.round(item.shrinkage_factor_pct * 100)}%
        </p>
      </div>
      <form
        onSubmit={handleCostUpdate}
        className="grid grid-cols-[minmax(0,1fr)_76px] items-center gap-2 rounded-sm border border-border-system bg-card p-3 lg:border-0 lg:bg-transparent lg:p-0"
      >
        <label className="grid gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
            Unit cost ({currency})
          </span>
          <input
            key={`${item.id}-${item.current_cost_per_base_uom}`}
            name="current_cost_per_base_uom"
            type="number"
            min="0"
            step="0.01"
            defaultValue={item.current_cost_per_base_uom}
            disabled={disabled || item.cost_type === "manufactured"}
            aria-label={`Cost for ${item.name ?? "item"} in ${currency}`}
            className="h-9 w-full min-w-0 rounded-sm border border-border-system bg-white px-3 font-mono text-sm font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
          />
        </label>
        <button
          type="submit"
          disabled={disabled || item.cost_type === "manufactured"}
          className="mt-5 h-9 rounded-sm border border-border-system bg-card px-3 text-xs font-bold text-foreground transition hover:border-border-system-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save
        </button>
      </form>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onUpdate(item.id, { is_active: !item.is_active })}
        className={`hidden min-h-11 w-full rounded-sm border px-3 font-mono text-[11px] font-black uppercase tracking-[0.18em] transition hover:border-border-system-hover disabled:cursor-not-allowed disabled:opacity-60 lg:block ${statusClass}`}
      >
        {item.is_active ? stockStatus : "Inactive"}
      </button>
    </div>
  );
}
