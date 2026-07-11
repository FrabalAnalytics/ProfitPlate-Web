import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { getLocalDateInputValue } from "@/lib/dashboard/formatting";
import { isMenuSaleHistoryRow, isProductionHistoryRow, isStockVarianceHistoryRow, isWasteHistoryRow, normalizeMenuSaleHistoryRow, normalizeProductionHistoryRow, normalizeStockVarianceHistoryRow, normalizeWasteHistoryRow } from "@/lib/dashboard/history-normalizers";
import type { InventoryItem } from "@/lib/dashboard/inventory-utils";
import { isRecipe, isRecipeComponent, normalizeRecipeComponentRow, normalizeRecipeRow } from "@/lib/dashboard/recipe-normalizers";
import { normalizeRole, type AppRole } from "@/lib/dashboard/roles";

export type PurchaseOrderStatus = "draft" | "pending" | "accepted" | "completed" | "cancelled";
type OperationRegisterStatus = "completed" | "clear" | "exception";
type OperationRegisterActivityState =
  | "activity_recorded"
  | "no_activity"
  | "reviewed"
  | "exception";

export type Profile = {
  id: string;
  organization_id: string | null;
  full_name: string | null;
  role: AppRole;
};

export type Location = {
  id: string;
  tenant_id: string | null;
  organization_id: string | null;
  name: string;
  location_type:
    | "main_store"
    | "central_warehouse"
    | "local_kitchen"
    | "kitchen_line"
    | "branch_store"
    | "production_kitchen"
    | "sales_outlet"
    | "bar"
    | "department";
  routing_model:
    | "model_1_single_location"
    | "model_2_central_warehouse"
    | "model_2_central_kitchen"
    | "model_3_commissary";
  inventory_domain: "food" | "beverage" | "shared";
  supplying_location_id: string | null;
  is_active: boolean;
  created_at: string;
};

export type Supplier = {
  id: string;
  organization_id: string | null;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
};

export type CostRecalculationEvent = {
  id: string;
  organization_id: string | null;
  inventory_item_id: string | null;
  recipe_id: string | null;
  old_cost: number;
  new_cost: number;
  reason: string;
  created_at: string;
};

export type PosSalesItemMapping = {
  id: string;
  organization_id: string;
  pos_item_key: string;
  pos_item_label: string;
  pos_item_code: string | null;
  recipe_id: string;
  created_at: string;
  updated_at: string;
};

export type SalesCaptureMode = "pos_import" | "manual_sales" | "test_mode";

export type SystemSettings = {
  organization_id: string;
  system_status: "implementation_mode" | "live_operations";
  sales_capture_mode: SalesCaptureMode;
  created_at: string;
  updated_at: string;
};

export type ApprovalRequest = {
  id: string;
  organization_id: string;
  request_type: string;
  status: "pending" | "accepted" | "completed" | "cancelled";
  payload: Record<string, unknown>;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
};

export type PurchaseOrder = {
  id: string;
  po_number?: string | null;
  grn_number?: string | null;
  organization_id: string | null;
  supplier_id?: string | null;
  supplier_name: string | null;
  receiving_location_id?: string | null;
  status: PurchaseOrderStatus;
  receipt_status?: "open" | "partially_received" | "completed" | "closed_short";
  short_supply_reason?: string | null;
  created_by: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
};

export type PurchaseOrderLine = {
  id: string;
  purchase_order_id: string;
  inventory_item_id: string;
  qty: number;
  received_qty?: number;
  landed_unit_cost: number;
  created_at: string;
};

export type OperationRegisterEntry = {
  id: string;
  organization_id: string;
  operating_date: string;
  register_key: string;
  department: string;
  status: OperationRegisterStatus;
  activity_state: OperationRegisterActivityState;
  notes: string | null;
  submitted_by: string | null;
  submitted_at: string;
  created_at: string;
};

export type DayCloseBlocker = {
  type: string;
  key: string;
  label: string;
  department: string;
  message: string;
  count?: number;
};

export type OperatingDay = {
  id: string;
  organization_id: string;
  operating_date: string;
  status: "open" | "closing_review" | "closed" | "locked";
  reconciliation_status:
    | "awaiting_data"
    | "provisional"
    | "reconciled"
    | "exception"
    | "not_required";
  reconciliation_note: string | null;
  reconciled_by: string | null;
  reconciled_at: string | null;
  blockers: DayCloseBlocker[];
  close_note: string | null;
  closed_by: string | null;
  closed_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AvtReadinessFlag = {
  key: string;
  label: string;
  message: string;
};

export type AvtSummaryRow = {
  operating_date: string;
  location_id: string | null;
  location_name: string;
  status:
    | "ready"
    | "provisional"
    | "missing_pos"
    | "missing_depletion"
    | "exception";
  sales_count: number;
  revenue: number;
  theoretical_food_cost: number;
  production_variance_cost: number;
  waste_cost: number;
  stock_variance_cost: number;
  total_variance_cost: number;
  gross_profit: number;
  gross_margin_pct: number | null;
  food_cost_pct: number | null;
  readiness_flags: AvtReadinessFlag[];
  confidence_score: number;
  confidence_status: "high" | "usable" | "weak" | "unreliable";
};

export type YieldTestEntry = {
  id: string;
  organization_id: string;
  inventory_item_id: string;
  test_date: string;
  starting_weight: number;
  usable_weight: number;
  trim_waste_weight: number;
  measured_yield_pct: number;
  three_test_average_yield_pct: number | null;
  master_yield_updated: boolean;
  notes: string | null;
  submitted_by: string | null;
  submitted_at: string;
  created_at: string;
};

export type YieldTestNotification = {
  id: string;
  organization_id: string;
  inventory_item_id: string;
  notification_type: "overdue_yield_test" | "yield_master_updated";
  title: string;
  detail: string;
  recipients: string[];
  status: "open" | "acknowledged";
  triggered_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
};

export async function ensureProfile(currentUser: User) {
  const { data: existingProfile, error: loadError } = await supabase
    .from("profiles")
    .select("id, organization_id, full_name, role")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (loadError) {
    throw loadError;
  }

  if (existingProfile) {
    return {
      ...(existingProfile as Omit<Profile, "role"> & { role: unknown }),
      role: normalizeRole((existingProfile as { role: unknown }).role),
    };
  }

  const { data: createdProfile, error: createError } = await supabase
    .from("profiles")
    .upsert(
      {
      id: currentUser.id,
      full_name: currentUser.email?.split("@")[0] ?? "Owner",
      role: "owner",
      },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id, organization_id, full_name, role")
    .maybeSingle();

  if (createError) {
    throw createError;
  }

  if (!createdProfile) {
    const { data: reloadedProfile, error: reloadError } = await supabase
      .from("profiles")
      .select("id, organization_id, full_name, role")
      .eq("id", currentUser.id)
      .single();

    if (reloadError) {
      throw reloadError;
    }

    return {
      ...(reloadedProfile as Omit<Profile, "role"> & { role: unknown }),
      role: normalizeRole((reloadedProfile as { role: unknown }).role),
    };
  }

  return {
    ...(createdProfile as Omit<Profile, "role"> & { role: unknown }),
    role: normalizeRole((createdProfile as { role: unknown }).role),
  };
}

export async function loadInventoryItems(organizationId: string) {
  const { data, error } = await supabase
    .from("inventory_items")
    .select(
      "id, organization_id, tenant_id, location_id, origin_inventory_item_id, recipe_id, name, sku, department, item_type, cost_type, base_uom, recipe_uom, on_hand_qty, on_hand_uom, current_cost_per_base_uom, yield_pct, shrinkage_factor_pct, is_high_value, is_active, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as InventoryItem[];
}

export async function loadLocations(organizationId: string) {
  const { data, error } = await supabase
    .from("locations")
    .select(
      "id, tenant_id, organization_id, name, location_type, routing_model, inventory_domain, supplying_location_id, is_active, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (!error) {
    return (data ?? []) as Location[];
  }

  const fallback = await supabase
    .from("locations")
    .select(
      "id, tenant_id, organization_id, name, location_type, routing_model, is_active, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (fallback.error) {
    return [];
  }

  return (fallback.data ?? []).map((location) => {
    const normalizedName = location.name.trim().toLowerCase();

    return {
      ...location,
      inventory_domain:
        normalizedName.includes("drink") ||
        normalizedName.includes("beverage") ||
        normalizedName === "bar"
          ? "beverage"
          : normalizedName.includes("food") || normalizedName.includes("kitchen")
            ? "food"
            : "shared",
      supplying_location_id: null,
    } as Location;
  });
}

export async function loadSuppliers(organizationId: string) {
  const { data, error } = await supabase
    .from("suppliers")
    .select(
      "id, organization_id, name, contact_name, phone, email, is_active, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data ?? []) as Supplier[];
}

export async function loadCostRecalculationEvents(organizationId: string) {
  const { data, error } = await supabase
    .from("cost_recalculation_events")
    .select(
      "id, organization_id, inventory_item_id, recipe_id, old_cost, new_cost, reason, created_at",
    )
    .eq("organization_id", organizationId)
    .not("inventory_item_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    return [];
  }

  return (data ?? []).map((event) => ({
    ...(event as CostRecalculationEvent),
    old_cost: Number((event as CostRecalculationEvent).old_cost) || 0,
    new_cost: Number((event as CostRecalculationEvent).new_cost) || 0,
  }));
}

export async function loadProductionHistory() {
  const { data, error } = await supabase.rpc("get_dashboard_production_history");

  if (error) {
    return [];
  }

  return (data ?? [])
    .map(normalizeProductionHistoryRow)
    .filter(isProductionHistoryRow);
}

export async function loadStockVarianceHistory() {
  const { data, error } = await supabase.rpc(
    "get_dashboard_stock_variance_history",
  );

  if (error) {
    return [];
  }

  return (data ?? [])
    .map(normalizeStockVarianceHistoryRow)
    .filter(isStockVarianceHistoryRow);
}

export async function loadWasteHistory() {
  const { data, error } = await supabase.rpc("get_dashboard_waste_history");

  if (error) {
    return [];
  }

  return (data ?? []).map(normalizeWasteHistoryRow).filter(isWasteHistoryRow);
}

export async function loadMenuSaleHistory() {
  const { data, error } = await supabase.rpc("get_dashboard_menu_sales_history");

  if (error) {
    return [];
  }

  return (data ?? [])
    .map(normalizeMenuSaleHistoryRow)
    .filter(isMenuSaleHistoryRow);
}

export async function loadAvtSummary(organizationId: string) {
  const { data, error } = await supabase.rpc("get_dashboard_avt_summary_with_confidence", {
    target_organization_id: organizationId,
    start_date_value: null,
    end_date_value: null,
  });

  if (error) {
    return [];
  }

  return ((data ?? []) as unknown[]).map((row: unknown) => {
    const summaryRow = row as Partial<AvtSummaryRow>;
    const readinessFlags = Array.isArray(summaryRow.readiness_flags)
      ? summaryRow.readiness_flags
      : [];

    return {
      operating_date:
        typeof summaryRow.operating_date === "string"
          ? summaryRow.operating_date
          : "",
      location_id:
        typeof summaryRow.location_id === "string"
          ? summaryRow.location_id
          : null,
      location_name:
        typeof summaryRow.location_name === "string"
          ? summaryRow.location_name
          : "Unassigned",
      status:
        summaryRow.status === "ready" ||
        summaryRow.status === "provisional" ||
        summaryRow.status === "missing_pos" ||
        summaryRow.status === "missing_depletion" ||
        summaryRow.status === "exception"
          ? summaryRow.status
          : "provisional",
      sales_count: Number(summaryRow.sales_count) || 0,
      revenue: Number(summaryRow.revenue) || 0,
      theoretical_food_cost: Number(summaryRow.theoretical_food_cost) || 0,
      production_variance_cost:
        Number(summaryRow.production_variance_cost) || 0,
      waste_cost: Number(summaryRow.waste_cost) || 0,
      stock_variance_cost: Number(summaryRow.stock_variance_cost) || 0,
      total_variance_cost: Number(summaryRow.total_variance_cost) || 0,
      gross_profit: Number(summaryRow.gross_profit) || 0,
      gross_margin_pct:
        summaryRow.gross_margin_pct === null ||
        summaryRow.gross_margin_pct === undefined
          ? null
          : Number(summaryRow.gross_margin_pct) || 0,
      food_cost_pct:
        summaryRow.food_cost_pct === null ||
        summaryRow.food_cost_pct === undefined
          ? null
          : Number(summaryRow.food_cost_pct) || 0,
      readiness_flags: readinessFlags.filter(
        (flag): flag is AvtReadinessFlag =>
          Boolean(flag) &&
          typeof flag === "object" &&
          typeof (flag as AvtReadinessFlag).key === "string",
      ),
      confidence_score:
        summaryRow.confidence_score === null ||
        summaryRow.confidence_score === undefined
          ? 0
          : Number(summaryRow.confidence_score) || 0,
      confidence_status:
        summaryRow.confidence_status === "high" ||
        summaryRow.confidence_status === "usable" ||
        summaryRow.confidence_status === "weak" ||
        summaryRow.confidence_status === "unreliable"
          ? summaryRow.confidence_status
          : "unreliable",
    } satisfies AvtSummaryRow;
  });
}

export async function loadApprovalRequests(organizationId: string) {
  await supabase.rpc("refresh_dashboard_requisition_escalations", {
    target_organization_id: organizationId,
  });

  const { data, error } = await supabase
    .from("approval_requests")
    .select(
      "id, organization_id, request_type, status, payload, requested_by, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return [];
  }

  const requests = (data ?? []) as ApprovalRequest[];
  const requestIds = requests
    .filter((request) => request.request_type === "inventory_requisition")
    .map((request) => request.id);

  if (requestIds.length === 0) {
    return requests;
  }

  const { data: escalationData } = await supabase
    .from("requisition_escalation_states")
    .select(
      "request_id, status, receiving_department, dispatched_at, active_elapsed_minutes, current_level, current_owner_role, next_escalation_active_minute, value_at_risk",
    )
    .in("request_id", requestIds);
  const escalationByRequestId = new Map(
    (escalationData ?? []).map((state) => [state.request_id, state]),
  );

  return requests.map((request) => ({
    ...request,
    payload: {
      ...request.payload,
      _escalation: escalationByRequestId.get(request.id) ?? null,
    },
  }));
}

export async function loadOperationRegisterEntries(organizationId: string) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  const { data, error } = await supabase
    .from("operation_register_entries")
    .select(
      "id, organization_id, operating_date, register_key, department, status, activity_state, notes, submitted_by, submitted_at, created_at",
    )
    .eq("organization_id", organizationId)
    .gte("operating_date", getLocalDateInputValue(startDate))
    .order("operating_date", { ascending: false })
    .order("submitted_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data ?? []) as OperationRegisterEntry[];
}

export async function loadOperatingDays(organizationId: string) {
  const { data, error } = await supabase
    .from("operating_days")
    .select(
      "id, organization_id, operating_date, status, reconciliation_status, reconciliation_note, reconciled_by, reconciled_at, blockers, close_note, closed_by, closed_at, locked_by, locked_at, reopened_by, reopened_at, reopen_reason, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .order("operating_date", { ascending: false })
    .limit(31);

  if (error) {
    return [];
  }

  return (data ?? []) as OperatingDay[];
}

export async function loadPosSalesItemMappings(organizationId: string) {
  const { data, error } = await supabase
    .from("pos_sales_item_mappings")
    .select(
      "id, organization_id, pos_item_key, pos_item_label, pos_item_code, recipe_id, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data ?? []) as PosSalesItemMapping[];
}

export async function loadSystemSettings(organizationId: string) {
  const { data, error } = await supabase
    .from("system_settings")
    .select(
      "organization_id, system_status, sales_capture_mode, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return {
      organization_id: organizationId,
      system_status: "implementation_mode",
      sales_capture_mode: "pos_import",
      created_at: "",
      updated_at: "",
    } satisfies SystemSettings;
  }

  return (
    (data as SystemSettings | null) ?? {
      organization_id: organizationId,
      system_status: "implementation_mode",
      sales_capture_mode: "pos_import",
      created_at: "",
      updated_at: "",
    }
  );
}

export async function refreshYieldTestOverdueNotifications(organizationId: string) {
  const { data, error } = await supabase.rpc(
    "refresh_dashboard_yield_test_overdue_notifications",
    {
      target_organization_id: organizationId,
    },
  );

  if (error) {
    return 0;
  }

  return Number(data ?? 0);
}

export async function loadYieldTestEntries(organizationId: string) {
  const { data, error } = await supabase
    .from("yield_test_entries")
    .select(
      "id, organization_id, inventory_item_id, test_date, starting_weight, usable_weight, trim_waste_weight, measured_yield_pct, three_test_average_yield_pct, master_yield_updated, notes, submitted_by, submitted_at, created_at",
    )
    .eq("organization_id", organizationId)
    .order("test_date", { ascending: false })
    .order("submitted_at", { ascending: false })
    .limit(60);

  if (error) {
    return [];
  }

  return (data ?? []).map((entry) => ({
    ...(entry as YieldTestEntry),
    starting_weight: Number((entry as YieldTestEntry).starting_weight) || 0,
    usable_weight: Number((entry as YieldTestEntry).usable_weight) || 0,
    trim_waste_weight: Number((entry as YieldTestEntry).trim_waste_weight) || 0,
    measured_yield_pct: Number((entry as YieldTestEntry).measured_yield_pct) || 0,
    three_test_average_yield_pct:
      (entry as YieldTestEntry).three_test_average_yield_pct === null
        ? null
        : Number((entry as YieldTestEntry).three_test_average_yield_pct) || 0,
  }));
}

export async function loadYieldTestNotifications(organizationId: string) {
  const { data, error } = await supabase
    .from("yield_test_notifications")
    .select(
      "id, organization_id, inventory_item_id, notification_type, title, detail, recipients, status, triggered_at, acknowledged_by, acknowledged_at, created_at",
    )
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .order("triggered_at", { ascending: false })
    .limit(30);

  if (error) {
    return [];
  }

  return (data ?? []) as YieldTestNotification[];
}

export async function loadPurchaseOrders(organizationId: string) {
  const detailed = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, grn_number, organization_id, supplier_id, supplier_name, receiving_location_id, status, receipt_status, short_supply_reason, created_by, accepted_by, accepted_at, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!detailed.error) {
    return (detailed.data ?? []) as PurchaseOrder[];
  }

  const fallback = await supabase
    .from("purchase_orders")
    .select(
      "id, organization_id, supplier_name, status, created_by, accepted_by, accepted_at, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (fallback.error) {
    return [];
  }

  return (fallback.data ?? []) as PurchaseOrder[];
}

export async function loadPurchaseOrderLines(orderIds: string[]) {
  if (orderIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("purchase_order_lines")
    .select("id, purchase_order_id, inventory_item_id, qty, received_qty, landed_unit_cost, created_at")
    .in("purchase_order_id", orderIds);

  if (error) {
    return [];
  }

  return (data ?? []).map((line) => ({
    ...(line as PurchaseOrderLine),
    qty: Number((line as PurchaseOrderLine).qty) || 0,
    received_qty: Number((line as PurchaseOrderLine).received_qty) || 0,
    landed_unit_cost: Number((line as PurchaseOrderLine).landed_unit_cost) || 0,
  }));
}

export async function loadRecipes(organizationId: string) {
  const recipeDetails = await supabase.rpc("get_dashboard_recipe_details");

  if (!recipeDetails.error) {
    return (recipeDetails.data ?? [])
      .map(normalizeRecipeRow)
      .filter(isRecipe);
  }

  const direct = await supabase
    .from("recipes")
    .select(
      "id, tenant_id, organization_id, name, recipe_type, output_uom, standard_batch_output_qty, standard_yield_pct, resolved_unit_cost, selling_price, is_active, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (!direct.error) {
    return (direct.data ?? [])
      .map(normalizeRecipeRow)
      .filter(isRecipe);
  }

  const { data, error } = await supabase.rpc("get_dashboard_recipes");

  if (error) {
    throw direct.error;
  }

  return (data ?? [])
    .map(normalizeRecipeRow)
    .filter(isRecipe);
}

export async function loadRecipeComponents(organizationId: string) {
  const componentDetails = await supabase.rpc(
    "get_dashboard_recipe_component_details",
  );

  if (!componentDetails.error) {
    return (componentDetails.data ?? [])
      .map(normalizeRecipeComponentRow)
      .filter(isRecipeComponent);
  }

  const direct = await supabase
    .from("recipe_components")
    .select(
      "id, organization_id, recipe_id, component_inventory_item_id, component_recipe_id, qty_in_recipe_uom, recipe_uom, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (!direct.error) {
    return (direct.data ?? [])
      .map(normalizeRecipeComponentRow)
      .filter(isRecipeComponent);
  }

  const { data, error } = await supabase.rpc(
    "get_dashboard_recipe_components",
  );

  if (error) {
    throw direct.error;
  }

  return (data ?? [])
    .map(normalizeRecipeComponentRow)
    .filter(isRecipeComponent);
}
