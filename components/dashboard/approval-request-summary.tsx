import { MetricPill } from "@/components/dashboard/display";

export type ApprovalRequestSummaryData = {
  request_type: string;
  payload: Record<string, unknown>;
};

export type ApprovalRequestSummaryInventoryItem = {
  id: string;
  current_cost_per_base_uom?: number | null;
};

export function ApprovalRequestSummary({
  request,
  inventoryItems = [],
}: {
  request: ApprovalRequestSummaryData;
  inventoryItems?: ApprovalRequestSummaryInventoryItem[];
}) {
  const payload = request.payload ?? {};
  const lines = Array.isArray(payload.lines)
    ? (payload.lines as Array<Record<string, unknown>>)
    : [];
  const inventoryItemCostById = new Map(
    inventoryItems.map((item) => [
      item.id,
      Number(item.current_cost_per_base_uom ?? 0),
    ]),
  );
  const requestedByName =
    typeof payload.requested_by_name === "string"
      ? payload.requested_by_name
      : "Requester";
  const requestedByRole =
    typeof payload.requested_by_role === "string" ? payload.requested_by_role : "";
  const requestedFrom =
    typeof payload.requested_from === "string"
      ? payload.requested_from
      : "Issuing store";
  const requestedTo =
    typeof payload.requested_to === "string"
      ? payload.requested_to
      : "Requesting department";
  const approverRole =
    typeof payload.approver_role === "string" ? payload.approver_role : "Manager";
  const approverName =
    typeof payload.approver_name === "string" && payload.approver_name.trim()
      ? payload.approver_name
      : approverRole;
  const firstLines =
    request.request_type === "inventory_requisition" ? lines : lines.slice(0, 3);
  const remainingLineCount = Math.max(lines.length - firstLines.length, 0);
  const escalation =
    payload._escalation &&
    typeof payload._escalation === "object" &&
    !Array.isArray(payload._escalation)
      ? (payload._escalation as Record<string, unknown>)
      : null;
  const calculatedValueInTransit = lines.reduce((total, line) => {
    const sourceInventoryItemId =
      typeof line.source_inventory_item_id === "string"
        ? line.source_inventory_item_id
        : typeof line.inventory_item_id === "string"
          ? line.inventory_item_id
          : "";
    const quantity = Number(
      line.issued_quantity ?? line.transferred_quantity ?? line.quantity ?? 0,
    );
    const unitCost =
      Number(line.source_unit_cost ?? line.unit_cost ?? 0) ||
      inventoryItemCostById.get(sourceInventoryItemId) ||
      0;

    return total + Math.max(quantity, 0) * Math.max(unitCost, 0);
  }, 0);
  const valueInTransit = Math.max(
    Number(escalation?.value_at_risk ?? 0),
    calculatedValueInTransit,
  );

  if (request.request_type === "stock_count_approval") {
    const totalImpact = lines.reduce(
      (total, line) => total + (Number(line.estimated_margin_impact) || 0),
      0,
    );

    return (
      <div className="mt-3 grid gap-3 text-sm text-text-muted">
        <div className="grid gap-2 sm:grid-cols-3">
          <MetricPill
            label="Submitted by"
            value={`${requestedByName}${requestedByRole ? ` / ${requestedByRole}` : ""}`}
          />
          <MetricPill label="Lines" value={lines.length.toLocaleString()} />
          <MetricPill
            label="Estimated impact"
            value={totalImpact.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          />
        </div>
        <div className="rounded-sm border border-border-system bg-card px-3 py-2">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            Counted items
          </p>
          <div className="mt-2 grid gap-1">
            {firstLines.length > 0 ? (
              firstLines.map((line, index) => {
                const itemName =
                  typeof line.item_name === "string"
                    ? line.item_name
                    : "Inventory item";
                const countedQuantity = Number(line.counted_quantity) || 0;
                const systemQuantity = Number(line.system_quantity) || 0;
                const uom = typeof line.uom === "string" ? line.uom : "unit";

                return (
                  <p key={`${itemName}-${index}`} className="text-sm text-text-muted">
                    <span className="font-semibold text-foreground">
                      {itemName}
                    </span>{" "}
                    - counted {countedQuantity.toLocaleString(undefined, {
                      maximumFractionDigits: 3,
                    })}{" "}
                    {uom} vs system {systemQuantity.toLocaleString(undefined, {
                      maximumFractionDigits: 3,
                    })}{" "}
                    {uom}
                  </p>
                );
              })
            ) : (
              <p>No count lines attached.</p>
            )}
            {remainingLineCount > 0 ? (
              <p className="text-xs font-semibold text-text-ghost">
                +{remainingLineCount.toLocaleString()} more line
                {remainingLineCount === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (request.request_type === "vendor_creation_approval") {
    const supplierName =
      typeof payload.supplier_name === "string"
        ? payload.supplier_name
        : "New vendor";
    const contactName =
      typeof payload.contact_name === "string" ? payload.contact_name : "";
    const phone = typeof payload.phone === "string" ? payload.phone : "";
    const email = typeof payload.email === "string" ? payload.email : "";

    return (
      <div className="mt-3 grid gap-3 text-sm text-text-muted">
        <div className="grid gap-2 sm:grid-cols-3">
          <MetricPill
            label="Submitted by"
            value={`${requestedByName}${requestedByRole ? ` / ${requestedByRole}` : ""}`}
          />
          <MetricPill label="Vendor" value={supplierName} />
          <MetricPill label="Approver" value={approverName} />
        </div>
        <p className="rounded-sm border border-border-system bg-card px-3 py-2 text-sm text-text-muted">
          {contactName || "No contact person"} / {phone || email || "No contact"}
        </p>
      </div>
    );
  }

  if (request.request_type === "sku_creation_approval") {
    const itemName =
      typeof payload.name === "string" ? payload.name : "New SKU";
    const sku = typeof payload.sku === "string" && payload.sku ? payload.sku : "No SKU";
    const department =
      typeof payload.department === "string" && payload.department
        ? payload.department
        : "Unassigned";
    const baseUom =
      typeof payload.base_uom === "string" && payload.base_uom
        ? payload.base_uom
        : "unit";
    const unitCost = Number(payload.current_cost_per_base_uom ?? 0);

    return (
      <div className="mt-3 grid gap-3 text-sm text-text-muted">
        <div className="grid gap-2 sm:grid-cols-4">
          <MetricPill
            label="Submitted by"
            value={`${requestedByName}${requestedByRole ? ` / ${requestedByRole}` : ""}`}
          />
          <MetricPill label="SKU" value={sku} />
          <MetricPill label="Department" value={department} />
          <MetricPill label="Approver" value={approverName} />
        </div>
        <div className="rounded-sm border border-border-system bg-card px-3 py-2">
          <p className="font-semibold text-foreground">{itemName}</p>
          <p className="mt-1 text-sm text-text-muted">
            Base UOM {baseUom} / Proposed unit cost{" "}
            {unitCost.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </p>
        </div>
      </div>
    );
  }

  if (request.request_type !== "inventory_requisition") {
    return (
      <p className="mt-2 line-clamp-2 text-sm text-text-muted">
        {JSON.stringify(request.payload)}
      </p>
    );
  }

  return (
    <div className="mt-3 grid gap-3 text-sm text-text-muted">
      <div className="grid gap-2 sm:grid-cols-4">
        <MetricPill
          label="Requester"
          value={`${requestedByName}${requestedByRole ? ` / ${requestedByRole}` : ""}`}
        />
        <MetricPill label="Issuing store" value={requestedFrom} />
        <MetricPill label="Requesting dept" value={requestedTo} />
        <MetricPill label="Approver" value={approverName} />
      </div>
      {escalation ? (
        <div className="grid gap-2 rounded-sm border border-status-attention-border bg-status-attention-bg p-3 sm:grid-cols-4">
          <MetricPill
            label="Current owner"
            value={String(escalation.current_owner_role ?? "receiver").replaceAll(
              "_",
              " ",
            )}
          />
          <MetricPill
            label="Active waiting time"
            value={`${Number(escalation.active_elapsed_minutes ?? 0).toLocaleString()} min`}
          />
          <MetricPill
            label="Value in transit"
            value={`NGN ${valueInTransit.toLocaleString(
              undefined,
              { maximumFractionDigits: 2 },
            )}`}
          />
          <MetricPill
            label="Next escalation"
            value={
              escalation.next_escalation_active_minute == null
                ? "Final level"
                : `${Math.max(
                    Number(escalation.next_escalation_active_minute) -
                      Number(escalation.active_elapsed_minutes ?? 0),
                    0,
                  ).toLocaleString()} active min`
            }
          />
        </div>
      ) : null}
      <div className="rounded-sm border border-border-system bg-card px-3 py-2">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
          Requested items
        </p>
        <div className="mt-2 grid gap-1">
          {firstLines.length > 0 ? (
            firstLines.map((line, index) => {
              const itemName =
                typeof line.item_name === "string"
                  ? line.item_name
                  : "Inventory item";
              const quantity = Number(line.quantity) || 0;
              const issuedQuantity = Number(line.issued_quantity ?? 0);
              const receivedQuantity = Number(line.received_quantity ?? 0);
              const uom = typeof line.uom === "string" ? line.uom : "unit";
              const note = typeof line.note === "string" ? line.note : "";
              const hasIssuedQuantity = line.issued_quantity != null;
              const hasReceivedQuantity = line.received_quantity != null;

              return (
                <p key={`${itemName}-${index}`} className="text-sm text-text-muted">
                  <span className="font-semibold text-foreground">
                    {itemName}
                  </span>{" "}
                  - {quantity.toLocaleString(undefined, {
                    maximumFractionDigits: 3,
                  })}{" "}
                  {uom}
                  {hasIssuedQuantity
                    ? ` / issued ${issuedQuantity.toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })} ${uom}`
                    : ""}
                  {hasReceivedQuantity
                    ? ` / received ${receivedQuantity.toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })} ${uom}`
                    : ""}
                  {note ? ` / ${note}` : ""}
                </p>
              );
            })
          ) : (
            <p>No item lines attached.</p>
          )}
          {remainingLineCount > 0 ? (
            <p className="text-xs font-semibold text-text-ghost">
              +{remainingLineCount.toLocaleString()} more line
              {remainingLineCount === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
