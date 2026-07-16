"use client";

import type { User } from "@supabase/supabase-js";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CircleDollarSign,
  ClipboardCheck,
  LineChart,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActionCard,
  Cell,
  ExecutiveKpiCard,
  FinancialTrendChart,
  MetricPill,
  type FinancialTrendPoint,
  type SemanticTone,
} from "@/components/dashboard/display";
import { ApprovalRequestSummary } from "@/components/dashboard/approval-request-summary";
import {
  ensureProfile,
  loadAvtSummary,
  loadApprovalRequests,
  loadCostRecalculationEvents,
  loadInventoryItems,
  loadLocations,
  loadMenuSaleHistory,
  loadOperationRegisterEntries,
  loadOperatingDays,
  loadPosSalesItemMappings,
  loadProductionHistory,
  loadPurchaseOrderLines,
  loadPurchaseOrders,
  loadRecipeComponents,
  loadRecipes,
  loadStockMovementLedger,
  loadStockVarianceHistory,
  loadSystemSettings,
  loadSuppliers,
  loadWasteHistory,
  loadYieldTestEntries,
  loadYieldTestNotifications,
  refreshYieldTestOverdueNotifications,
  type ApprovalRequest,
  type AvtSummaryRow,
  type CostRecalculationEvent,
  type Location,
  type OperationRegisterEntry,
  type OperatingDay,
  type DayCloseBlocker,
  type PosSalesItemMapping,
  type Profile,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type SalesCaptureMode,
  type StockMovementLedgerRow,
  type Supplier,
  type SystemSettings,
  type YieldTestEntry,
  type YieldTestNotification,
} from "@/lib/dashboard/data-service";
import { InventoryItemRow } from "@/components/dashboard/inventory-item-row";
import { RecipeRow } from "@/components/dashboard/recipe-row";
import {
  WorkspaceAssignmentPending,
  WorkspaceOnboarding,
} from "@/components/dashboard/workspace-screens";
import {
  buildPosItemMasterPreview,
  buildPosItemKey,
  buildSalesImportPreview,
  type PosItemMasterPreviewRow,
  type SalesImportPreviewRow,
} from "@/lib/dashboard/pos-import";
import {
  escapeCsvValue,
  extractUuid,
  formatCurrencyAmount,
  formatShortDate,
  formatSignedCurrencyAmount,
  getDateKey,
  getDateFilterStart,
  getDateMs,
  getLocalDateInputValue,
  isWithinDateFilter,
} from "@/lib/dashboard/formatting";
import {
  type MenuSaleHistoryRow,
  type ProductionHistoryRow,
  type StockVarianceHistoryRow,
  type WasteHistoryRow,
} from "@/lib/dashboard/history-normalizers";
import {
  dedupeActiveInventoryItems,
  dedupeActiveRecipes,
  dedupeRecipeComponentsByIngredient,
  recipesFromManufacturedInventory,
  type InventoryItem,
} from "@/lib/dashboard/inventory-utils";
import {
  getRecipeId,
  type Recipe,
  type RecipeComponent,
} from "@/lib/dashboard/recipe-normalizers";
import {
  activeDashboardRoles,
  approvalRoles,
  costingRoles,
  normalizeRole,
  operationsRoles,
  roleDescriptions,
  roleLabels,
  workspaceRoles,
  type AppRole,
} from "@/lib/dashboard/roles";
import { supabase } from "@/lib/supabaseClient";


type Organization = {
  id: string;
  name: string;
  subscription_tier: "solo" | "multi_unit" | "enterprise_grid";
  system_status: "implementation_mode" | "live_operations";
  local_currency: string;
};

type WorkspaceStats = {
  locations: number;
  inventoryItems: number;
  recipes: number;
  costEvents: number;
};



type RecipeComponentInputRow = {
  id: string;
  inventoryItemId: string;
  quantity: string;
};

type PurchaseReceiptInputRow = {
  id: string;
  inventoryItemId: string;
  searchText: string;
  stockOnHandQty: string;
  quantity: string;
  landedUnitCost: string;
  taxRatePct: string;
};

type RequisitionInputRow = {
  id: string;
  inventoryItemId: string;
  quantity: string;
  note: string;
};

type StockCountInputRow = {
  id: string;
  inventoryItemId: string;
  countedQuantity: string;
};

type ProductionPlanInputRow = {
  id: string;
  recipeId: string;
  targetOutputQty: string;
};

type ProductionPlanRequisitionMode = "required" | "shortage";

type ProductionRunLineInputRow = {
  id: string;
  recipeId: string;
  targetOutputQty: string;
};

type ProcurementPriceMovement = CostRecalculationEvent & {
  supplierName?: string | null;
  purchaseOrderId?: string | null;
  purchaseOrderLineId?: string | null;
};

type ProductionPlanRequirement = {
  id: string;
  inventoryItemId: string;
  ingredientName: string;
  uom: string;
  requiredQty: number;
  onHandQty: number;
  shortageQty: number;
  unitCost: number;
  estimatedCost: number;
  sourceRecipes: string[];
};


type ExceptionItem = {
  id: string;
  severity: "Critical" | "Watch" | "Review";
  tone: "critical" | "warning" | "review";
  category: string;
  title: string;
  detail: string;
  impact?: string;
  sortImpact: number;
};

type MenuSaleImportInput = {
  recipe_id: string;
  location_id: string;
  sold_quantity: number;
  gross_sales: number;
  discount_amount: number;
  promo_amount: number;
  void_amount: number;
  net_sales: number;
  pos_item_label: string;
  pos_item_code: string;
  business_date: string;
  transaction_timestamp: string;
  source_transaction_id: string;
  source_check_id: string;
  source_location_name: string;
  row_fingerprint: string;
  date_status: "verified" | "missing_date" | "unverified";
};

const stockLocationTypeLabels: Record<Location["location_type"], string> = {
  main_store: "main store stock",
  central_warehouse: "warehouse stock",
  local_kitchen: "kitchen stock",
  kitchen_line: "kitchen line stock",
  branch_store: "branch store stock",
  production_kitchen: "production kitchen stock",
  sales_outlet: "sales outlet stock",
  bar: "bar stock",
  department: "department stock",
};

function formatStockLocationOption(location: Location) {
  return `${location.name} - ${
    stockLocationTypeLabels[location.location_type] ??
    location.location_type.replaceAll("_", " ")
  }`;
}





type PurchaseOrderReceipt = {
  id: string;
  purchase_order_id: string;
  grn_number: string;
  receipt_status: "partial" | "complete";
  short_supply_reason: string | null;
  received_at: string;
  purchase_order_receipt_lines: Array<{
    purchase_order_line_id: string;
    inventory_item_id: string;
    received_qty: number;
    unit_cost: number;
  }>;
};

type OperationRegisterStatus = "completed" | "clear" | "exception";
type OperationRegisterActivityState =
  | "activity_recorded"
  | "no_activity"
  | "reviewed"
  | "exception";




type NoticeTone = "success" | "error" | "info";
type PresetDateFilter = "today" | "7d" | "30d" | "all";
type DateFilter = PresetDateFilter | "custom";
type PurchaseOrderQueueFilter = "open" | "partial" | "completed" | "all";
type MenuProfitabilityFilter =
  | "all"
  | "margin_risk"
  | "protected"
  | "missing_price"
  | "incomplete_costing";

const planLabels = {
  solo: "Solo Operator",
  multi_unit: "Multi-Unit Group",
  enterprise_grid: "Enterprise Grid",
};

const emptyStats: WorkspaceStats = {
  locations: 0,
  inventoryItems: 0,
  recipes: 0,
  costEvents: 0,
};

const noticeToneStyles: Record<NoticeTone, string> = {
  success: "border-accent-muted-border bg-accent-muted-bg text-accent",
  error:
    "border-status-critical-border bg-status-critical-bg text-status-critical-text",
  info: "border-status-info-border bg-status-info-bg text-status-info-text",
};

const formControlClass =
  "h-11 min-w-0 w-full rounded-sm border border-border-system bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-text-ghost focus:border-accent focus:ring-2 focus:ring-accent/20";

const primaryButtonClass =
  "h-11 rounded-sm bg-accent px-4 text-sm font-semibold text-background transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70";

const secondaryButtonClass =
  "h-11 rounded-sm border border-border-system bg-card px-4 text-sm font-semibold text-foreground transition hover:border-border-system-hover disabled:cursor-not-allowed disabled:opacity-50";

const ledgerFrameClass =
  "overflow-hidden rounded-md border border-border-system bg-card shadow-sm";

const ledgerHeaderClass =
  "flex flex-wrap items-center justify-between gap-3 border-b border-border-system bg-card px-4 py-4 sm:px-5";

const ledgerColumnHeaderClass =
  "hidden border-b border-border-system bg-card px-5 py-3.5 font-mono text-[10px] font-bold uppercase leading-5 tracking-widest text-text-ghost lg:grid";

const compactActionButtonClass =
  "h-9 rounded-sm border border-border-system bg-card px-3 text-xs font-bold uppercase tracking-wider text-text-muted transition hover:border-border-system-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

const compactPrimaryActionButtonClass =
  "h-9 rounded-sm border border-accent-muted-border bg-accent-muted-bg px-3 text-xs font-bold uppercase tracking-wider text-accent transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-50";

const receivingQuantityInputClass =
  "h-14 min-w-0 w-full rounded-sm border border-border-system bg-background px-3 text-lg font-black text-foreground outline-none transition placeholder:text-text-ghost focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60";

function getNoticeTone(message: string): NoticeTone {
  const normalizedMessage = message.trim().toLowerCase();

  if (!normalizedMessage) {
    return "info";
  }

  if (
    /\b(recorded|updated|cleaned|created|depleted|received|issued|submitted|complete|completed|dispatched)\b/.test(
      normalizedMessage,
    )
  ) {
    return "success";
  }

  return "error";
}

function normalizeMasterDataKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function downloadCsvReport(
  filename: string,
  rows: Array<Record<string, unknown>>,
) {
  if (typeof document === "undefined") {
    return;
  }

  const exportRows =
    rows.length > 0
      ? rows
      : [{ message: "No rows available for the selected filters." }];
  const headers = Array.from(
    exportRows.reduce((headerSet, row) => {
      Object.keys(row).forEach((key) => headerSet.add(key));
      return headerSet;
    }, new Set<string>()),
  );
  const csvRows = [
    headers.map(escapeCsvValue).join(","),
    ...exportRows.map((row) =>
      headers.map((header) => escapeCsvValue(row[header])).join(","),
    ),
  ];
  const blob = new Blob([csvRows.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const dateFilterLabels: Record<DateFilter, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  all: "All",
  custom: "Custom",
};

function formatDateInputDisplay(value: string) {
  if (!value) {
    return "";
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const inlineSignalClass =
  "inline-flex max-w-full align-baseline rounded-sm border px-2 py-0.5 font-mono text-sm font-bold leading-6 whitespace-normal break-words";

const inlineSignalToneStyles: Record<SemanticTone, string> = {
  healthy: "border-accent-muted-border bg-accent-muted-bg text-accent",
  attention:
    "border-status-attention-border bg-status-attention-bg text-status-attention-text",
  critical:
    "border-status-critical-border bg-status-critical-bg text-status-critical-text",
  info: "border-status-info-border bg-status-info-bg text-status-info-text",
};

function getSemanticTone(value: number, limits: { attention: number; critical: number }) {
  if (value >= limits.critical) {
    return "critical";
  }

  if (value >= limits.attention) {
    return "attention";
  }

  return "healthy";
}

function getTrend(current: number, previous: number, inverse = false) {
  if (!previous && !current) {
    return { symbol: "Flat", label: "No movement", tone: "info" as SemanticTone };
  }

  const delta = current - previous;
  const absDelta = Math.abs(delta);

  if (absDelta < 0.01) {
    return { symbol: "Flat", label: "Flat", tone: "info" as SemanticTone };
  }

  const improved = inverse ? delta < 0 : delta > 0;

  return {
    symbol: delta > 0 ? "UP" : "DOWN",
    label: `${delta > 0 ? "+" : ""}${delta.toLocaleString(undefined, {
      maximumFractionDigits: 1,
    })}`,
    tone: improved
      ? ("healthy" as const)
      : inverse && delta > 0
        ? ("critical" as const)
        : ("attention" as const),
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return fallback;
}

function ControlScoreRing({ score }: { score: number }) {
  const normalizedScore = Math.min(Math.max(score, 0), 100);
  const toneClass =
    normalizedScore >= 80
      ? "text-accent"
      : normalizedScore >= 55
        ? "text-status-attention-text"
        : "text-status-critical-text";

  return (
    <div
      className={`relative grid h-24 w-24 shrink-0 place-items-center rounded-full bg-card shadow-[var(--finance-shadow)] ${toneClass}`}
      title="The control score summarizes completed operating registers, data readiness, and unresolved control exceptions."
      aria-label={`Control score ${normalizedScore.toFixed(0)} percent`}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(currentColor ${normalizedScore * 3.6}deg, #e2e8f0 0deg)`,
        }}
      />
      <div className="absolute inset-2 rounded-full bg-card" />
      <div className={`relative text-center ${toneClass}`}>
        <p className="font-mono text-2xl font-black leading-none">
          {normalizedScore.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest">
          score
        </p>
      </div>
    </div>
  );
}

function isQuietMetricValue(value: string) {
  const normalizedValue = value.trim().toLowerCase();

  return (
    normalizedValue === "n/a" ||
    normalizedValue === "0" ||
    normalizedValue === "0%" ||
    normalizedValue.endsWith(" 0") ||
    normalizedValue.endsWith(" 0.00")
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [stats, setStats] = useState<WorkspaceStats>(emptyStats);
  const [locations, setLocations] = useState<Location[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeComponents, setRecipeComponents] = useState<RecipeComponent[]>(
    [],
  );
  const [costEvents, setCostEvents] = useState<CostRecalculationEvent[]>([]);
  const [productionHistory, setProductionHistory] = useState<
    ProductionHistoryRow[]
  >([]);
  const [stockVarianceHistory, setStockVarianceHistory] = useState<
    StockVarianceHistoryRow[]
  >([]);
  const [stockMovementLedger, setStockMovementLedger] = useState<
    StockMovementLedgerRow[]
  >([]);
  const [wasteHistory, setWasteHistory] = useState<WasteHistoryRow[]>([]);
  const [menuSaleHistory, setMenuSaleHistory] = useState<MenuSaleHistoryRow[]>(
    [],
  );
  const [avtSummary, setAvtSummary] = useState<AvtSummaryRow[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequest[]>(
    [],
  );
  const [operationRegisterEntries, setOperationRegisterEntries] = useState<
    OperationRegisterEntry[]
  >([]);
  const [operatingDays, setOperatingDays] = useState<OperatingDay[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(
    null,
  );
  const [posSalesItemMappings, setPosSalesItemMappings] = useState<
    PosSalesItemMapping[]
  >([]);
  const [yieldTestEntries, setYieldTestEntries] = useState<YieldTestEntry[]>(
    [],
  );
  const [yieldTestNotifications, setYieldTestNotifications] = useState<
    YieldTestNotification[]
  >([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrderLines, setPurchaseOrderLines] = useState<
    PurchaseOrderLine[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [setupSaving, setSetupSaving] = useState(false);
  const [inventorySaving, setInventorySaving] = useState(false);
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [productionSaving, setProductionSaving] = useState(false);
  const [saleSaving, setSaleSaving] = useState(false);
  const [stockSaving, setStockSaving] = useState(false);
  const [purchaseOrderSaving, setPurchaseOrderSaving] = useState(false);
  const [receivingPurchaseOrderId, setReceivingPurchaseOrderId] = useState("");
  const [requisitionSaving, setRequisitionSaving] = useState(false);
  const [stockCountSaving, setStockCountSaving] = useState(false);
  const [wasteSaving, setWasteSaving] = useState(false);
  const [yieldTestSaving, setYieldTestSaving] = useState(false);
  const [message, setMessage] = useState("");

  const refreshWorkspace = useCallback(async (currentUser: User) => {
    setLoading(true);
    setMessage("");

    try {
      const loadedProfile = await ensureProfile(currentUser);
      setProfile(loadedProfile);

      if (!loadedProfile.organization_id) {
        const { data: isPlatformAdmin } = await supabase.rpc(
          "current_user_is_platform_admin",
        );

        if (isPlatformAdmin) {
          router.replace("/admin");
          return;
        }

        setOrganization(null);
        setStats(emptyStats);
        setLocations([]);
        setSuppliers([]);
        setInventoryItems([]);
        setRecipes([]);
        setRecipeComponents([]);
        setCostEvents([]);
        setProductionHistory([]);
        setStockVarianceHistory([]);
        setStockMovementLedger([]);
        setWasteHistory([]);
        setMenuSaleHistory([]);
        setAvtSummary([]);
        setApprovalRequests([]);
        setOperationRegisterEntries([]);
        setOperatingDays([]);
        setSystemSettings(null);
        setPosSalesItemMappings([]);
        setYieldTestEntries([]);
        setYieldTestNotifications([]);
        setPurchaseOrders([]);
        setPurchaseOrderLines([]);
        setLoading(false);
        return;
      }

      const { data: orgData, error: orgError } = await supabase
        .from("organizations")
        .select("id, name, subscription_tier, system_status, local_currency")
        .eq("id", loadedProfile.organization_id)
        .maybeSingle();

      if (orgError) {
        setMessage(orgError.message);
        setLoading(false);
        return;
      }

      setOrganization((orgData as Organization | null) ?? null);
      await refreshYieldTestOverdueNotifications(loadedProfile.organization_id);
      const [
        loadedLocations,
        loadedSuppliers,
        loadedInventoryItems,
        loadedRecipes,
        loadedRecipeComponents,
        loadedCostEvents,
        loadedApprovalRequests,
        loadedOperationRegisterEntries,
        loadedOperatingDays,
        loadedSystemSettings,
        loadedPosSalesItemMappings,
        loadedYieldTestEntries,
        loadedYieldTestNotifications,
      ] = await Promise.all([
        loadLocations(loadedProfile.organization_id),
        loadSuppliers(loadedProfile.organization_id),
        loadInventoryItems(loadedProfile.organization_id),
        loadRecipes(loadedProfile.organization_id),
        loadRecipeComponents(loadedProfile.organization_id),
        loadCostRecalculationEvents(loadedProfile.organization_id),
        loadApprovalRequests(loadedProfile.organization_id),
        loadOperationRegisterEntries(loadedProfile.organization_id),
        loadOperatingDays(loadedProfile.organization_id),
        loadSystemSettings(loadedProfile.organization_id),
        loadPosSalesItemMappings(loadedProfile.organization_id),
        loadYieldTestEntries(loadedProfile.organization_id),
        loadYieldTestNotifications(loadedProfile.organization_id),
      ]);
      const visibleInventoryItems =
        dedupeActiveInventoryItems(loadedInventoryItems);
      const visibleRecipes =
        loadedRecipes.length > 0
          ? dedupeActiveRecipes(loadedRecipes, loadedRecipeComponents)
          : recipesFromManufacturedInventory(visibleInventoryItems);

      setStats({
        locations: loadedLocations.length,
        inventoryItems: visibleInventoryItems.filter(
          (item) => item.cost_type === "purchased",
        ).length,
        recipes: visibleRecipes.length,
        costEvents: loadedCostEvents.length,
      });
      setLocations(loadedLocations);
      setSuppliers(loadedSuppliers);
      setInventoryItems(visibleInventoryItems);
      setRecipes(visibleRecipes);
      setRecipeComponents(loadedRecipeComponents);
      setCostEvents(loadedCostEvents);
      setApprovalRequests(loadedApprovalRequests);
      setOperationRegisterEntries(loadedOperationRegisterEntries);
      setOperatingDays(loadedOperatingDays);
      setSystemSettings(loadedSystemSettings);
      setPosSalesItemMappings(loadedPosSalesItemMappings);
      setYieldTestEntries(loadedYieldTestEntries);
      setYieldTestNotifications(loadedYieldTestNotifications);
      setLoading(false);

      Promise.all([
        loadProductionHistory(),
        loadStockVarianceHistory(),
        loadStockMovementLedger(loadedProfile.organization_id),
        loadWasteHistory(),
        loadMenuSaleHistory(),
        loadAvtSummary(loadedProfile.organization_id),
        loadPurchaseOrders(loadedProfile.organization_id),
      ])
        .then(
          ([
            nextProductionHistory,
            nextStockVarianceHistory,
            nextStockMovementLedger,
            nextWasteHistory,
            nextMenuSaleHistory,
            nextAvtSummary,
            nextPurchaseOrders,
          ]) =>
            loadPurchaseOrderLines(nextPurchaseOrders.map((order) => order.id))
              .then((nextPurchaseOrderLines) => {
                setProductionHistory(nextProductionHistory);
                setStockVarianceHistory(nextStockVarianceHistory);
                setStockMovementLedger(nextStockMovementLedger);
                setWasteHistory(nextWasteHistory);
                setMenuSaleHistory(nextMenuSaleHistory);
                setAvtSummary(nextAvtSummary);
                setPurchaseOrders(nextPurchaseOrders);
                setPurchaseOrderLines(nextPurchaseOrderLines);
              }),
        )
        .catch((historyError) => {
          setMessage(
            getErrorMessage(
              historyError,
              "Dashboard opened, but some activity history could not be loaded.",
            ),
          );
        });
    } catch (error) {
      setMessage(
        getErrorMessage(error, "Unable to load workspace profile."),
      );
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    async function loadWorkspace() {
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        router.replace("/login");
        return;
      }

      setUser(data.session.user);
      await refreshWorkspace(data.session.user);
    }

    loadWorkspace();
  }, [refreshWorkspace, router]);

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user) {
      router.replace("/login");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const subscriptionTier = String(
      formData.get("subscription_tier") ?? "solo",
    ) as Organization["subscription_tier"];
    const localCurrency = String(formData.get("local_currency") ?? "NGN")
      .trim()
      .toUpperCase();

    if (!name) {
      setMessage("Enter a business name to create your workspace.");
      return;
    }

    setSaving(true);
    setMessage("");

    const { data: orgData, error: orgError } = await supabase
      .rpc("create_workspace", {
        workspace_name: name,
        workspace_subscription_tier: subscriptionTier,
        workspace_local_currency: localCurrency || "NGN",
      })
      .single();

    if (orgError) {
      setMessage(orgError.message);
      setSaving(false);
      return;
    }

    const createdOrg = orgData as Organization;

    const { data: updatedProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, organization_id, full_name, role")
      .eq("id", user.id)
      .single();

    if (profileError) {
      setMessage(profileError.message);
      setSaving(false);
      return;
    }

    setProfile({
      ...(updatedProfile as Omit<Profile, "role"> & { role: unknown }),
      role: normalizeRole((updatedProfile as { role: unknown }).role),
    });
    setOrganization(createdOrg);
    setStats(emptyStats);
    setLocations([]);
    setSuppliers([]);
    setInventoryItems([]);
    setRecipes([]);
    setRecipeComponents([]);
    setCostEvents([]);
    setProductionHistory([]);
    setStockVarianceHistory([]);
    setStockMovementLedger([]);
    setWasteHistory([]);
    setMenuSaleHistory([]);
    setAvtSummary([]);
    setApprovalRequests([]);
    setOperationRegisterEntries([]);
    setOperatingDays([]);
    setPosSalesItemMappings([]);
    setYieldTestEntries([]);
    setYieldTestNotifications([]);
    setPurchaseOrders([]);
    setPurchaseOrderLines([]);
    await reloadOperatingWorkspace(createdOrg.id);
    setSaving(false);
  }

  async function reloadOperatingWorkspace(organizationId: string) {
    await refreshYieldTestOverdueNotifications(organizationId);

    const [
      loadedLocations,
      loadedSuppliers,
      loadedInventoryItems,
      loadedRecipes,
      loadedRecipeComponents,
      loadedCostEvents,
      loadedProductionHistory,
      loadedStockVarianceHistory,
      loadedStockMovementLedger,
      loadedWasteHistory,
      loadedMenuSaleHistory,
      loadedAvtSummary,
      loadedApprovalRequests,
      loadedOperationRegisterEntries,
      loadedOperatingDays,
      loadedSystemSettings,
      loadedPosSalesItemMappings,
      loadedYieldTestEntries,
      loadedYieldTestNotifications,
      loadedPurchaseOrders,
    ] = await Promise.all([
      loadLocations(organizationId),
      loadSuppliers(organizationId),
      loadInventoryItems(organizationId),
      loadRecipes(organizationId),
      loadRecipeComponents(organizationId),
      loadCostRecalculationEvents(organizationId),
      loadProductionHistory(),
      loadStockVarianceHistory(),
      loadStockMovementLedger(organizationId),
      loadWasteHistory(),
      loadMenuSaleHistory(),
      loadAvtSummary(organizationId),
      loadApprovalRequests(organizationId),
      loadOperationRegisterEntries(organizationId),
      loadOperatingDays(organizationId),
      loadSystemSettings(organizationId),
      loadPosSalesItemMappings(organizationId),
      loadYieldTestEntries(organizationId),
      loadYieldTestNotifications(organizationId),
      loadPurchaseOrders(organizationId),
    ]);
    const loadedPurchaseOrderLines = await loadPurchaseOrderLines(
      loadedPurchaseOrders.map((order) => order.id),
    );
    const visibleInventoryItems = dedupeActiveInventoryItems(
      loadedInventoryItems,
    );
    const visibleRecipes =
      loadedRecipes.length > 0
        ? dedupeActiveRecipes(loadedRecipes, loadedRecipeComponents)
        : recipesFromManufacturedInventory(visibleInventoryItems);

    setStats({
      locations: loadedLocations.length,
      inventoryItems: visibleInventoryItems.filter(
        (item) => item.cost_type === "purchased",
      ).length,
      recipes: visibleRecipes.length,
      costEvents: loadedCostEvents.length,
    });
    setLocations(loadedLocations);
    setSuppliers(loadedSuppliers);
    setInventoryItems(visibleInventoryItems);
    setRecipes(visibleRecipes);
    setRecipeComponents(loadedRecipeComponents);
    setCostEvents(loadedCostEvents);
    setProductionHistory(loadedProductionHistory);
    setStockVarianceHistory(loadedStockVarianceHistory);
    setStockMovementLedger(loadedStockMovementLedger);
    setWasteHistory(loadedWasteHistory);
    setMenuSaleHistory(loadedMenuSaleHistory);
    setAvtSummary(loadedAvtSummary);
    setApprovalRequests(loadedApprovalRequests);
    setOperationRegisterEntries(loadedOperationRegisterEntries);
    setOperatingDays(loadedOperatingDays);
    setSystemSettings(loadedSystemSettings);
    setPosSalesItemMappings(loadedPosSalesItemMappings);
    setYieldTestEntries(loadedYieldTestEntries);
    setYieldTestNotifications(loadedYieldTestNotifications);
    setPurchaseOrders(loadedPurchaseOrders);
    setPurchaseOrderLines(loadedPurchaseOrderLines);
  }

  useEffect(() => {
    if (!organization?.id) {
      return;
    }

    let cancelled = false;

    const refreshIfVisible = () => {
      if (
        cancelled ||
        document.visibilityState !== "visible" ||
        saving ||
        saleSaving ||
        stockSaving ||
        purchaseOrderSaving ||
        requisitionSaving ||
        stockCountSaving ||
        wasteSaving ||
        productionSaving ||
        recipeSaving
      ) {
        return;
      }

      void reloadOperatingWorkspace(organization.id);
    };

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    const intervalId = window.setInterval(refreshIfVisible, 30000);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.clearInterval(intervalId);
    };
  }, [
    organization?.id,
    purchaseOrderSaving,
    recipeSaving,
    requisitionSaving,
    saleSaving,
    saving,
    stockCountSaving,
    stockSaving,
    wasteSaving,
    productionSaving,
  ]);

  async function handleCreateLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("location_name") ?? "").trim();
    const locationType = String(
      formData.get("location_type") ?? "main_store",
    ) as Location["location_type"];
    const routingModel = String(
      formData.get("routing_model") ?? "model_1_single_location",
    ) as Location["routing_model"];
    const inventoryDomain = String(
      formData.get("inventory_domain") ?? "shared",
    ) as Location["inventory_domain"];

    if (!name) {
      setMessage("Enter a location name.");
      return;
    }

    setSetupSaving(true);
    setMessage("");

    const { error } = await supabase.from("locations").insert({
      tenant_id: organization.id,
      organization_id: organization.id,
      name,
      location_type: locationType,
      routing_model: routingModel,
      inventory_domain: inventoryDomain,
      is_active: true,
    });

    if (error) {
      setMessage(
        error.message.includes("invalid input value for enum location_type")
          ? "Location type setup is not aligned in Supabase yet. Run migration 026_location_type_routing_model_alignment.sql, then retry."
          : error.message.includes("invalid input value for enum routing_model")
            ? "Routing model setup is not aligned in Supabase yet. Run migration 026_location_type_routing_model_alignment.sql, then retry."
            : error.message.includes("public.suppliers")
              ? "Supplier setup is not installed in Supabase yet. Run migration 003_locations_suppliers_setup.sql, then retry."
              : error.message,
      );
      setSetupSaving(false);
      return;
    }

    form.reset();
    await reloadOperatingWorkspace(organization.id);
    setMessage("Location created.");
    setSetupSaving(false);
  }

  async function handleCreateSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("supplier_name") ?? "").trim();
    const contactName = String(formData.get("contact_name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();

    if (!name) {
      setMessage("Enter a supplier name.");
      return;
    }

    const supplierAlreadyExists = suppliers.some(
      (supplier) =>
        supplier.is_active &&
        normalizeMasterDataKey(supplier.name) === normalizeMasterDataKey(name),
    );

    if (supplierAlreadyExists) {
      setMessage("That supplier already exists. Update the existing supplier record instead.");
      return;
    }

    setSetupSaving(true);
    setMessage("");

    const currentUserRole = normalizeRole(profile?.role);

    if (currentUserRole === "procurement_manager") {
      const { error } = await supabase.from("approval_requests").insert({
        organization_id: organization.id,
        request_type: "vendor_creation_approval",
        payload: {
          supplier_name: name,
          contact_name: contactName || null,
          phone: phone || null,
          email: email || null,
          requested_by_name: profile?.full_name || "Procurement manager",
          requested_by_role: roleLabels[currentUserRole],
          approver_role: "Finance manager",
        },
        requested_by: user?.id,
      });

      if (error) {
        setMessage(error.message);
        setSetupSaving(false);
        return;
      }

      form.reset();
      await reloadOperatingWorkspace(organization.id);
      setMessage("Vendor submitted to Finance for approval.");
      setSetupSaving(false);
      return;
    }

    if (
      !["owner", "admin", "operations_manager", "finance_manager"].includes(
        currentUserRole,
      )
    ) {
      setMessage("Only Procurement can submit vendor requests. Active supplier records require Finance or workspace leadership.");
      setSetupSaving(false);
      return;
    }

    const { error } = await supabase.from("suppliers").insert({
      organization_id: organization.id,
      name,
      contact_name: contactName || null,
      phone: phone || null,
      email: email || null,
      is_active: true,
    });

    if (error) {
      setMessage(error.message);
      setSetupSaving(false);
      return;
    }

    form.reset();
    await reloadOperatingWorkspace(organization.id);
    setMessage("Supplier created.");
    setSetupSaving(false);
  }

  async function handleUpdateLocation(
    locationId: string,
    patch: Partial<
      Pick<Location, "name" | "location_type" | "routing_model" | "inventory_domain">
    >,
  ) {
    if (!organization) {
      return;
    }

    const name = patch.name?.trim();

    if (patch.name !== undefined && !name) {
      setMessage("Enter a location name.");
      return;
    }

    setSetupSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("locations")
      .update({
        ...patch,
        ...(patch.name !== undefined ? { name } : {}),
      })
      .eq("id", locationId)
      .eq("organization_id", organization.id);

    if (error) {
      setMessage(error.message);
      setSetupSaving(false);
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage("Location updated.");
    setSetupSaving(false);
  }

  async function handleUpdateSupplier(
    supplierId: string,
    patch: Partial<
      Pick<Supplier, "name" | "contact_name" | "phone" | "email">
    >,
  ) {
    if (!organization) {
      return;
    }

    const name = patch.name?.trim();

    if (patch.name !== undefined && !name) {
      setMessage("Enter a supplier name.");
      return;
    }

    if (
      patch.name !== undefined &&
      suppliers.some(
        (supplier) =>
          supplier.id !== supplierId &&
          supplier.is_active &&
          normalizeMasterDataKey(supplier.name) ===
            normalizeMasterDataKey(name),
      )
    ) {
      setMessage("That supplier name already exists. Update the existing supplier instead.");
      return;
    }

    setSetupSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("suppliers")
      .update({
        ...patch,
        ...(patch.name !== undefined ? { name } : {}),
        ...(patch.contact_name !== undefined
          ? { contact_name: patch.contact_name?.trim() || null }
          : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone?.trim() || null } : {}),
        ...(patch.email !== undefined ? { email: patch.email?.trim() || null } : {}),
      })
      .eq("id", supplierId)
      .eq("organization_id", organization.id);

    if (error) {
      setMessage(error.message);
      setSetupSaving(false);
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage("Supplier updated.");
    setSetupSaving(false);
  }

  async function handleCreateInventoryItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization) {
      setMessage("Create a workspace before adding inventory items.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "").trim();
    const sku = String(formData.get("sku") ?? "").trim();
    const department = String(formData.get("department") ?? "").trim();
    const locationId = extractUuid(formData.get("location_id"));
    const baseUom = String(formData.get("base_uom") ?? "").trim();
    const cost = Number(formData.get("current_cost_per_base_uom") ?? 0);
    const yieldPct = Number(formData.get("yield_pct") ?? 1);
    const shrinkagePct = Number(formData.get("shrinkage_factor_pct") ?? 0);
    const isHighValue = formData.get("is_high_value") === "on";

    if (!name || !baseUom) {
      setMessage("Add an item name and base unit before saving.");
      return;
    }

    const skuAlreadyExists =
      sku &&
      inventoryItems.some(
        (item) =>
          item.is_active &&
          normalizeMasterDataKey(item.sku) === normalizeMasterDataKey(sku) &&
          extractUuid(item.location_id) === locationId,
      );

    if (skuAlreadyExists) {
      setMessage("That SKU already exists in this location. Update the existing item instead.");
      return;
    }

    const itemNameAlreadyExists = inventoryItems.some(
      (item) =>
        item.is_active &&
        item.cost_type === "purchased" &&
        normalizeMasterDataKey(item.name) === normalizeMasterDataKey(name) &&
        extractUuid(item.location_id) === locationId,
    );

    if (itemNameAlreadyExists) {
      setMessage("That item name already exists in this location. Update the existing item instead.");
      return;
    }

    setInventorySaving(true);
    setMessage("");

    const currentUserRole = normalizeRole(profile?.role);

    if (currentUserRole === "inventory_manager" || currentUserRole === "storekeeper") {
      setMessage("Inventory cannot create new SKUs. Procurement submits SKU intake for Finance approval.");
      setInventorySaving(false);
      return;
    }

    if (currentUserRole === "procurement_manager") {
      const { error } = await supabase.from("approval_requests").insert({
        organization_id: organization.id,
        request_type: "sku_creation_approval",
        payload: {
          name,
          sku: sku || null,
          department: department || null,
          location_id: locationId || null,
          base_uom: baseUom,
          current_cost_per_base_uom: Number.isFinite(cost) ? cost : 0,
          yield_pct: Number.isFinite(yieldPct) ? yieldPct : 1,
          shrinkage_factor_pct: Number.isFinite(shrinkagePct) ? shrinkagePct : 0,
          is_high_value: isHighValue,
          item_type: "raw_material",
          cost_type: "purchased",
          requested_by_name: profile?.full_name || "Procurement manager",
          requested_by_role: roleLabels[currentUserRole],
          approver_role: "Finance manager",
        },
        requested_by: user?.id,
      });

      if (error) {
        setMessage(error.message);
        setInventorySaving(false);
        return;
      }

      form.reset();
      await reloadOperatingWorkspace(organization.id);
      setMessage("New SKU submitted to Finance for approval.");
      setInventorySaving(false);
      return;
    }

    const { error } = await supabase.from("inventory_items").insert({
      tenant_id: organization.id,
      organization_id: organization.id,
      location_id: locationId || null,
      name,
      sku: sku || null,
      department: department || null,
      item_type: "raw_material",
      cost_type: "purchased",
      base_uom: baseUom,
      recipe_uom: baseUom,
      on_hand_uom: baseUom,
      current_cost_per_base_uom: Number.isFinite(cost) ? cost : 0,
      yield_pct: Number.isFinite(yieldPct) ? yieldPct : 1,
      shrinkage_factor_pct: Number.isFinite(shrinkagePct) ? shrinkagePct : 0,
      is_high_value: isHighValue,
      is_active: true,
    });

    if (error) {
      setMessage(error.message);
      setInventorySaving(false);
      return;
    }

    form.reset();
    await reloadOperatingWorkspace(organization.id);
    setMessage("Inventory item created.");
    setInventorySaving(false);
  }

  async function handleUpdateInventoryItem(
    itemId: string,
    patch: Partial<
      Pick<InventoryItem, "current_cost_per_base_uom" | "is_active">
    >,
  ) {
    if (!organization) {
      return;
    }

    setInventorySaving(true);
    setMessage("");

    const { error } = await supabase
      .from("inventory_items")
      .update(patch)
      .eq("id", itemId)
      .eq("organization_id", organization.id);

    if (error) {
      setMessage(error.message);
      setInventorySaving(false);
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    setInventorySaving(false);
  }

  async function handleAdjustStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization) {
      return false;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const targetLocationId = extractUuid(formData.get("target_location_id"));
    const inventoryItemId = extractUuid(formData.get("inventory_item_id"));
    const adjustmentMode = String(formData.get("adjustment_mode") ?? "set");
    const quantity = Number(formData.get("quantity") ?? 0);

    const selectedItem = inventoryItems.find(
      (item) => extractUuid(item.id) === inventoryItemId,
    );

    if (!targetLocationId) {
      setMessage("Select the storage location for this adjustment.");
      return;
    }

    if (
      !selectedItem ||
      extractUuid(selectedItem.location_id) !== targetLocationId ||
      !Number.isFinite(quantity)
    ) {
      setMessage("Choose an item in the selected storage location and enter a valid stock quantity.");
      return;
    }

    const nextOnHandQty =
      adjustmentMode === "adjust"
        ? Number(selectedItem.on_hand_qty ?? 0) + quantity
        : quantity;
    const currentOnHandQty = Number(selectedItem.on_hand_qty ?? 0);
    const adjustmentQuantity = nextOnHandQty - currentOnHandQty;

    if (nextOnHandQty < 0) {
      setMessage(
        "Stock adjustment cannot push the final balance below zero. Enter a smaller negative adjustment or use a stock count exception.",
      );
      return;
    }

    const varianceQuantity = currentOnHandQty - nextOnHandQty;
    const unitCost = Number(selectedItem.current_cost_per_base_uom ?? 0);

    setStockSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("submit_dashboard_approval_request", {
      request_type_value: "stock_count_approval",
      request_payload: {
        requested_by_name: profile?.full_name || roleLabels[normalizeRole(profile?.role)],
        requested_by_role: roleLabels[normalizeRole(profile?.role)],
        approver_role: "Finance manager",
        target_location_id: targetLocationId,
        adjustment_type: "stock_adjustment",
        adjustment_mode: adjustmentMode,
        adjustment_quantity: adjustmentQuantity,
        lines: [
          {
            inventory_item_id: inventoryItemId,
            item_name: selectedItem.name ?? "Inventory item",
            adjustment_quantity: adjustmentQuantity,
            counted_quantity: nextOnHandQty,
            system_quantity: currentOnHandQty,
            variance_quantity: varianceQuantity,
            unit_cost: unitCost,
            estimated_margin_impact: varianceQuantity * unitCost,
            uom: selectedItem.on_hand_uom ?? selectedItem.base_uom ?? "unit",
          },
        ],
        status: "pending",
        submitted_at: new Date().toISOString(),
      },
    });

    if (error) {
      setMessage(error.message);
      setStockSaving(false);
      return;
    }

    form.reset();
    await reloadOperatingWorkspace(organization.id);
    setMessage("Stock adjustment submitted to Finance for approval. Stock will update only after approval.");
    setStockSaving(false);
  }

  async function handleCreatePurchaseOrder(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();

    if (!organization) {
      return false;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const purchaseOrderId = extractUuid(formData.get("purchase_order_id"));
    const supplierId = extractUuid(formData.get("supplier_id"));
    const receivingLocationId = extractUuid(formData.get("receiving_location_id"));
    const supplierNameInput = String(formData.get("supplier_name") ?? "").trim();
    const selectedSupplier = suppliers.find(
      (supplier) => extractUuid(supplier.id) === supplierId,
    );
    const supplierName = selectedSupplier?.name ?? supplierNameInput;
    const rawPurchaseLines = String(formData.get("purchase_lines") ?? "[]");
    let purchaseLines: Array<{
      inventory_item_id: string;
      stock_on_hand_qty?: number | null;
      quantity: number;
      landed_unit_cost: number;
      tax_rate_pct?: number;
      tax_amount?: number;
    }> = [];

    try {
      purchaseLines = JSON.parse(rawPurchaseLines);
    } catch {
      setMessage("Purchase order lines could not be read.");
      return false;
    }

    const validPurchaseLines = purchaseLines.filter(
      (line) =>
        extractUuid(line.inventory_item_id) &&
        Number.isFinite(line.quantity) &&
        line.quantity > 0 &&
        Number.isFinite(line.landed_unit_cost) &&
        line.landed_unit_cost >= 0,
    );

    if (validPurchaseLines.length === 0) {
      setMessage("Add at least one item, quantity, and expected unit cost.");
      return false;
    }

    const receivingLocation = locations.find(
      (location) => extractUuid(location.id) === receivingLocationId,
    );

    if (
      !receivingLocation ||
      !["main_store", "central_warehouse", "branch_store"].includes(
        receivingLocation.location_type,
      )
    ) {
      setMessage("Select a main storage location or warehouse as the receiving location.");
      return false;
    }

    if (
      validPurchaseLines.some((line) => {
        const item = inventoryItems.find(
          (inventoryItem) =>
            extractUuid(inventoryItem.id) === extractUuid(line.inventory_item_id),
        );

        return extractUuid(item?.location_id) !== receivingLocationId;
      })
    ) {
      setMessage("Every purchase order item must belong to the selected receiving store.");
      return false;
    }

    setPurchaseOrderSaving(true);
    setMessage("");

    const currentUser = await supabase.auth.getUser();
    const createdBy = currentUser.data.user?.id ?? null;
    let createdOrderId = "";
    let createdPurchaseOrderNumber = "";

    if (purchaseOrderId) {
      const existingOrder = purchaseOrders.find(
        (order) =>
          extractUuid(order.id) === purchaseOrderId &&
          extractUuid(order.organization_id) === extractUuid(organization.id),
      );

      if (!existingOrder) {
        setMessage("Purchase order not found for this workspace.");
        setPurchaseOrderSaving(false);
        return false;
      }

      if (!["draft", "pending", "accepted"].includes(existingOrder.status)) {
        setMessage("Only open purchase orders can be edited before receipt.");
        setPurchaseOrderSaving(false);
        return false;
      }

      const { error: updateError } = await supabase.rpc(
        "update_dashboard_purchase_order",
        {
          target_purchase_order_id: purchaseOrderId,
          target_supplier_id: supplierId || null,
          target_supplier_name: supplierName || null,
          target_receiving_location_id: receivingLocationId || null,
          target_purchase_lines: validPurchaseLines.map((line) => ({
            inventory_item_id: extractUuid(line.inventory_item_id),
            quantity: line.quantity,
            landed_unit_cost: line.landed_unit_cost,
            tax_rate_pct: Number(line.tax_rate_pct ?? 0),
            tax_amount: Number(line.tax_amount ?? 0),
          })),
        },
      );

      if (updateError) {
        setMessage(updateError.message);
        setPurchaseOrderSaving(false);
        return false;
      }

      const [latestOrderResult, latestLines] = await Promise.all([
        supabase
          .from("purchase_orders")
          .select(
            "id, po_number, grn_number, organization_id, supplier_id, supplier_name, receiving_location_id, status, receipt_status, short_supply_reason, created_by, accepted_by, accepted_at, created_at",
          )
          .eq("id", purchaseOrderId)
          .eq("organization_id", organization.id)
          .maybeSingle(),
        loadPurchaseOrderLines([purchaseOrderId]),
      ]);

      if (latestOrderResult.error) {
        setMessage(latestOrderResult.error.message);
        setPurchaseOrderSaving(false);
        return false;
      }

      if (latestOrderResult.data) {
        setPurchaseOrders((currentOrders) =>
          currentOrders.map((order) =>
            extractUuid(order.id) === purchaseOrderId
              ? (latestOrderResult.data as PurchaseOrder)
              : order,
          ),
        );
      }

      setPurchaseOrderLines((currentLines) => [
        ...currentLines.filter(
          (line) => extractUuid(line.purchase_order_id) !== purchaseOrderId,
        ),
        ...latestLines,
      ]);

      form.reset();
      setMessage("Purchase order updated. It is still awaiting receipt confirmation.");
      setPurchaseOrderSaving(false);
      return true;
    }

    const detailedOrder = await supabase
      .from("purchase_orders")
      .insert({
        organization_id: organization.id,
        supplier_id: supplierId || null,
        supplier_name: supplierName || null,
        receiving_location_id: receivingLocationId || null,
        status: "draft",
        created_by: createdBy,
      })
      .select("id, po_number")
      .single();

    if (detailedOrder.error || !detailedOrder.data) {
      const fallbackOrder = await supabase
        .from("purchase_orders")
        .insert({
          organization_id: organization.id,
          supplier_name: supplierName || null,
          status: "draft",
          created_by: createdBy,
        })
        .select("id")
        .single();

      if (fallbackOrder.error || !fallbackOrder.data) {
        setMessage(
          fallbackOrder.error?.message ??
            detailedOrder.error?.message ??
            "Purchase order could not be created.",
        );
        setPurchaseOrderSaving(false);
        return false;
      }

      createdOrderId = (fallbackOrder.data as { id: string }).id;
    } else {
      createdOrderId = (detailedOrder.data as { id: string }).id;
      createdPurchaseOrderNumber =
        (detailedOrder.data as { po_number?: string | null }).po_number ?? "";
    }

    const linePayloads = validPurchaseLines.map((line) => ({
        purchase_order_id: createdOrderId,
        inventory_item_id: extractUuid(line.inventory_item_id),
        qty: line.quantity,
        landed_unit_cost: line.landed_unit_cost,
        tax_rate_pct: Number(line.tax_rate_pct ?? 0),
        tax_amount: Number(line.tax_amount ?? 0),
        tax_inclusive: false,
      }));
    const { error: lineError } = await supabase
      .from("purchase_order_lines")
      .insert(linePayloads);
    const taxColumnUnavailable =
      lineError?.message.toLowerCase().includes("tax_rate_pct") ||
      lineError?.message.toLowerCase().includes("tax_amount") ||
      lineError?.message.toLowerCase().includes("tax_inclusive");
    const fallbackLineInsert = taxColumnUnavailable
      ? await supabase.from("purchase_order_lines").insert(
          validPurchaseLines.map((line) => ({
            purchase_order_id: createdOrderId,
            inventory_item_id: extractUuid(line.inventory_item_id),
            qty: line.quantity,
            landed_unit_cost: line.landed_unit_cost,
          })),
        )
      : null;
    const fallbackLineError = fallbackLineInsert?.error ?? null;

    if (fallbackLineError || (lineError && !taxColumnUnavailable)) {
      setMessage(fallbackLineError?.message ?? lineError?.message ?? "");
      setPurchaseOrderSaving(false);
      return false;
    }

    form.reset();
    await reloadOperatingWorkspace(organization.id);
    setMessage(
      `${createdPurchaseOrderNumber || "Purchase order"} drafted. Inventory manager must confirm receipt before stock updates.`,
    );
    setPurchaseOrderSaving(false);
    return true;
  }

  async function handleReceivePurchaseOrder(
    orderId: string,
    receivedLines: Array<{
      purchase_order_line_id: string;
      received_qty: number;
    }>,
    shortSupplyReason: string,
  ) {
    if (!organization) {
      return;
    }

    const latestUserResult = await supabase.auth.getUser();
    const latestUser = latestUserResult.data.user;

    if (!latestUser) {
      router.replace("/login");
      return;
    }

    let latestProfile = profile;

    if (extractUuid(profile?.id) !== extractUuid(latestUser.id)) {
      const { data: refreshedProfile } = await supabase
        .from("profiles")
        .select("id, organization_id, full_name, role")
        .eq("id", latestUser.id)
        .maybeSingle();

      if (refreshedProfile) {
        latestProfile = {
          ...(refreshedProfile as Omit<Profile, "role"> & { role: unknown }),
          role: normalizeRole((refreshedProfile as { role: unknown }).role),
        };
        setProfile(latestProfile);
      }
    }

    const receivingUserRole = normalizeRole(latestProfile?.role);

    if (
      ![
        "owner",
        "admin",
        "operations_manager",
        "inventory_manager",
        "storekeeper",
      ].includes(receivingUserRole)
    ) {
      setMessage(
        "Only Inventory, Store, Operations, Admin, or Owner users can confirm supplier receipts. Procurement can draft and follow up, but Inventory must receive.",
      );
      return;
    }

    setReceivingPurchaseOrderId(orderId);
    setMessage("");

    const { data: receivedOrder, error } = await supabase.rpc(
      "receive_dashboard_purchase_order_quantities",
      {
        target_purchase_order_id: orderId,
        received_lines: receivedLines,
        short_supply_reason_value: shortSupplyReason || null,
      },
    );

    if (error) {
      setMessage(
        error.message.includes("invalid input value for enum location_type") ||
          error.message.includes("invalid input value for enum routing_model")
          ? "Location setup is not aligned in Supabase yet. Run migration 026_location_type_routing_model_alignment.sql, then retry the receipt."
          : error.message,
      );
      setReceivingPurchaseOrderId("");
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    const receivedReference = receivedOrder as {
      po_number?: string | null;
      grn_number?: string | null;
    } | null;
    setMessage(
      `${receivedReference?.grn_number ?? "Goods receipt"} confirmed. Stock balances updated; any outstanding purchase order quantity remains open.`,
    );
    setReceivingPurchaseOrderId("");
  }

  async function handleCreateRequisition(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();

    if (!organization) {
      return false;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const requisitionRequestId = extractUuid(formData.get("requisition_request_id"));
    const requestedByName = String(
      formData.get("requested_by_name") ?? "",
    ).trim();
    const fromLocationId = extractUuid(formData.get("from_location_id"));
    const toLocationId = extractUuid(formData.get("to_location_id"));
    const requestedFromInput = String(formData.get("requested_from") ?? "").trim();
    const fromLocation = locations.find(
      (location) => extractUuid(location.id) === fromLocationId,
    );
    const toLocation = locations.find(
      (location) => extractUuid(location.id) === toLocationId,
    );
    const requestedFrom = fromLocation?.name ?? requestedFromInput;
    const requesterRole = normalizeRole(profile?.role);
    const approverName = String(formData.get("approver_name") ?? "").trim();
    const approverRole = normalizeRole(formData.get("approver_role"));
    const rawLines = String(formData.get("requisition_lines") ?? "[]");
    let requisitionLines: Array<{
      inventory_item_id: string;
      quantity: number;
      note: string;
    }> = [];

    try {
      requisitionLines = JSON.parse(rawLines);
    } catch {
      setMessage("Requisition lines could not be read.");
      return false;
    }

    const validLines = requisitionLines.filter(
      (line) =>
        extractUuid(line.inventory_item_id) &&
        Number.isFinite(line.quantity) &&
        line.quantity > 0,
    );

    if (validLines.length === 0) {
      setMessage("Add at least one requested item and quantity.");
      return false;
    }

    if (!approverName) {
      setMessage("Enter the approver name or approval details for this transfer.");
      return false;
    }

    const payloadLines = validLines.map((line) => {
      const item = inventoryItems.find(
        (inventoryItem) =>
          extractUuid(inventoryItem.id) === extractUuid(line.inventory_item_id),
      );

      return {
        inventory_item_id: extractUuid(line.inventory_item_id),
        item_name: item?.name ?? "Inventory item",
        quantity: line.quantity,
        uom: item?.on_hand_uom ?? item?.base_uom ?? "unit",
        note: line.note || null,
      };
    });

    setRequisitionSaving(true);
    setMessage("");

    try {
      const requestPayload = {
        requested_by_name:
          requestedByName || profile?.full_name || roleLabels[requesterRole],
        requested_by_role: roleLabels[requesterRole],
        requested_from: requestedFrom || "Issuing store",
        from_location_id: fromLocationId || null,
        to_location_id: toLocationId || null,
        requested_to: toLocation?.name ?? "Requesting department",
        approver_name: approverName,
        approver_role: roleLabels[approverRole],
        lines: payloadLines,
        status: "pending",
        submitted_at: new Date().toISOString(),
      };
      const { error } = requisitionRequestId
        ? await supabase.rpc("update_dashboard_requisition_request", {
            target_request_id: requisitionRequestId,
            request_payload: requestPayload,
          })
        : await supabase.rpc("submit_dashboard_approval_request", {
            request_type_value: "inventory_requisition",
            request_payload: requestPayload,
          });

      if (error) {
        setMessage(error.message);
        return false;
      }

      form.reset();
      await reloadOperatingWorkspace(organization.id);
      setMessage(
        requisitionRequestId
          ? "Requisition updated. Store confirmation is still pending."
          : "Requisition submitted for store confirmation.",
      );
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Requisition could not be submitted. Check your connection and try again.",
      );
      return false;
    } finally {
      setRequisitionSaving(false);
    }
  }

  async function handleCreateStockCount(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();

    if (!organization) {
      return false;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const targetLocationId = extractUuid(formData.get("target_location_id"));
    const rawStockCountLines = String(formData.get("stock_count_lines") ?? "[]");
    let stockCountLines: Array<{
      inventory_item_id: string;
      counted_quantity: number;
    }> = [];

    try {
      stockCountLines = JSON.parse(rawStockCountLines);
    } catch {
      setMessage("Stock count lines could not be read.");
      return false;
    }

    if (!targetLocationId) {
      setMessage("Select the storage location being counted.");
      return false;
    }

    const validStockCountLines = stockCountLines.filter(
      (line) =>
        extractUuid(line.inventory_item_id) &&
        Number.isFinite(line.counted_quantity) &&
        line.counted_quantity >= 0,
    );

    if (validStockCountLines.length === 0) {
      setMessage("Add at least one item and counted quantity.");
      return false;
    }

    const payloadLines = validStockCountLines.map((line) => {
      const item = inventoryItems.find(
        (inventoryItem) =>
          extractUuid(inventoryItem.id) === extractUuid(line.inventory_item_id),
      );
      const systemQuantity = Number(item?.on_hand_qty ?? 0);
      const countedQuantity = Number(line.counted_quantity);
      const unitCost = Number(item?.current_cost_per_base_uom ?? 0);
      const varianceQuantity = systemQuantity - countedQuantity;

      return {
        inventory_item_id: extractUuid(line.inventory_item_id),
        item_name: item?.name ?? "Inventory item",
        counted_quantity: countedQuantity,
        system_quantity: systemQuantity,
        variance_quantity: varianceQuantity,
        unit_cost: unitCost,
        estimated_margin_impact: varianceQuantity * unitCost,
        uom: item?.on_hand_uom ?? item?.base_uom ?? "unit",
      };
    });

    if (
      payloadLines.some((line) => {
        const item = inventoryItems.find(
          (inventoryItem) =>
            extractUuid(inventoryItem.id) === extractUuid(line.inventory_item_id),
        );

        return extractUuid(item?.location_id) !== targetLocationId;
      })
    ) {
      setMessage("Every stock count line must belong to the selected storage location.");
      return false;
    }

    setStockCountSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("submit_dashboard_approval_request", {
      request_type_value: "stock_count_approval",
      request_payload: {
        requested_by_name: profile?.full_name || roleLabels[normalizeRole(profile?.role)],
        requested_by_role: roleLabels[normalizeRole(profile?.role)],
        approver_role: "Finance manager",
        target_location_id: targetLocationId,
        adjustment_type: "physical_stock_count",
        lines: payloadLines,
        status: "pending",
        submitted_at: new Date().toISOString(),
      },
    });

    if (error) {
      setMessage(error.message);
      setStockCountSaving(false);
      return false;
    }

    form.reset();
    await reloadOperatingWorkspace(organization.id);
    setMessage("Stock count submitted to Finance for approval. Margin will update after approval.");
    setStockCountSaving(false);
    return true;
  }

  async function recordMenuSale(sale: MenuSaleImportInput, batchId?: string) {
    const hasRevenueData =
      sale.gross_sales > 0 ||
      sale.discount_amount > 0 ||
      sale.promo_amount > 0 ||
      sale.void_amount > 0 ||
      sale.net_sales > 0 ||
      Boolean(batchId);

    if (!hasRevenueData) {
      return supabase.rpc("create_dashboard_menu_sale", {
        target_recipe_id: sale.recipe_id,
        sold_quantity: sale.sold_quantity,
        location_id_value: sale.location_id || null,
      });
    }

    return supabase.rpc("create_dashboard_menu_sale_with_revenue", {
      target_recipe_id: sale.recipe_id,
      sold_quantity: sale.sold_quantity,
      gross_sales_value: sale.gross_sales || null,
      discount_amount_value: sale.discount_amount,
      promo_amount_value: sale.promo_amount,
      void_amount_value: sale.void_amount,
      pos_import_batch_id_value: batchId ?? null,
      pos_source_label_value: sale.pos_item_label || null,
      pos_source_code_value: sale.pos_item_code || null,
      operating_date_value: sale.business_date || null,
      location_id_value: sale.location_id || null,
      pos_business_date_value: sale.business_date || null,
      pos_transaction_timestamp_value: sale.transaction_timestamp || null,
      pos_source_transaction_id_value: sale.source_transaction_id || null,
      pos_source_check_id_value: sale.source_check_id || null,
      pos_row_fingerprint_value: sale.row_fingerprint || null,
    });
  }

  async function handleCreateMenuSale(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();

    if (!organization) {
      return false;
    }

    if (!manualSalesAllowed) {
      setMessage(
        "This workspace is in POS import mode. Manual sales are disabled to prevent double depletion.",
      );
      return false;
    }

    const formData = new FormData(event.currentTarget);
    const recipeId = extractUuid(formData.get("sale_recipe_id"));
    const locationId = extractUuid(formData.get("sale_location_id"));
    const soldQuantity = Number(formData.get("sold_quantity") ?? 0);

    if (!recipeId || !Number.isFinite(soldQuantity) || soldQuantity <= 0) {
      setMessage("Choose a final menu item and quantity sold.");
      return false;
    }

    setSaleSaving(true);
    setMessage("");

    const { error } = await recordMenuSale({
      recipe_id: recipeId,
      location_id: locationId,
      sold_quantity: soldQuantity,
      gross_sales: 0,
      discount_amount: 0,
      promo_amount: 0,
      void_amount: 0,
      net_sales: 0,
      pos_item_label: "",
      pos_item_code: "",
      business_date: "",
      transaction_timestamp: "",
      source_transaction_id: "",
      source_check_id: "",
      source_location_name: "",
      row_fingerprint: "",
      date_status: "unverified",
    });

    if (error) {
      setMessage(error.message);
      setSaleSaving(false);
      return false;
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage("Menu sale recorded. Component stock was depleted.");
    setSaleSaving(false);
    return true;
  }

  async function handleBulkCreateMenuSales(
    salesRows: MenuSaleImportInput[],
  ): Promise<boolean> {
    if (!organization) {
      return false;
    }

    if (!posImportAllowed) {
      setMessage(
        "This workspace is in manual sales mode. POS import posting is disabled to prevent duplicate depletion.",
      );
      return false;
    }

    const validRows = salesRows.filter(
      (row) =>
        extractUuid(row.recipe_id) &&
        Number.isFinite(row.sold_quantity) &&
        row.sold_quantity > 0,
    );

    if (validRows.length === 0) {
      setMessage("Add at least one matched menu sale row before importing.");
      return false;
    }

    setSaleSaving(true);
    setMessage("");

    const batchTotals = validRows.reduce(
      (totals, row) => ({
        gross_sales: totals.gross_sales + row.gross_sales,
        discount_amount: totals.discount_amount + row.discount_amount,
        promo_amount: totals.promo_amount + row.promo_amount,
        void_amount: totals.void_amount + row.void_amount,
        net_sales: totals.net_sales + row.net_sales,
      }),
      {
        gross_sales: 0,
        discount_amount: 0,
        promo_amount: 0,
        void_amount: 0,
        net_sales: 0,
      },
    );
    const businessDates = Array.from(
      new Set(validRows.map((row) => row.business_date).filter(Boolean)),
    ).sort();
    const importLocationIds = Array.from(
      new Set(validRows.map((row) => row.location_id).filter(Boolean)),
    );
    const missingDateCount = validRows.filter(
      (row) => row.date_status === "missing_date",
    ).length;
    const hasUnverifiedDates = validRows.some(
      (row) => row.date_status === "unverified",
    );
    const periodStartDate = businessDates[0] ?? null;
    const periodEndDate = businessDates[businessDates.length - 1] ?? null;
    const importScope =
      businessDates.length > 1
        ? businessDates.length >= 5
          ? "weekly"
          : "multi_day"
        : "single_day";
    const dateStatus =
      missingDateCount > 0
        ? "missing_dates"
        : businessDates.length > 1
          ? "mixed_dates"
          : businessDates.length === 1 && !hasUnverifiedDates
            ? "verified"
            : "unverified";
    let batchId = "";

    const { data: batchData, error: batchError } = await supabase
      .from("pos_sales_import_batches")
      .insert({
        organization_id: organization.id,
        source_name: "Dashboard POS sales import",
        status: "posted",
        location_id: importLocationIds.length === 1 ? importLocationIds[0] : null,
        row_count: salesRows.length,
        matched_row_count: validRows.length,
        unmatched_row_count: Math.max(salesRows.length - validRows.length, 0),
        operating_date: businessDates.length === 1 ? businessDates[0] : null,
        period_start_date: periodStartDate,
        period_end_date: periodEndDate,
        import_scope: importScope,
        date_status: dateStatus,
        gross_sales: batchTotals.gross_sales,
        discount_amount: batchTotals.discount_amount,
        promo_amount: batchTotals.promo_amount,
        void_amount: batchTotals.void_amount,
        net_sales: batchTotals.net_sales,
        posted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (batchError) {
      setMessage(batchError.message);
      setSaleSaving(false);
      return false;
    }

    batchId = extractUuid(batchData?.id);

    if (batchId) {
      const { error: rowsError } = await supabase
        .from("pos_sales_import_rows")
        .insert(
          validRows.map((row, index) => ({
            batch_id: batchId,
            organization_id: organization.id,
            location_id: row.location_id || null,
            row_number: index + 1,
            pos_item_key: buildPosItemKey(row.pos_item_label, row.pos_item_code),
            pos_item_label: row.pos_item_label || row.pos_item_code || "POS item",
            pos_item_code: row.pos_item_code || null,
            recipe_id: row.recipe_id,
            business_date: row.business_date || null,
            transaction_timestamp: row.transaction_timestamp || null,
            source_transaction_id: row.source_transaction_id || null,
            source_check_id: row.source_check_id || null,
            row_fingerprint: row.row_fingerprint || null,
            date_status: row.date_status,
            sold_quantity: row.sold_quantity,
            gross_sales: row.gross_sales,
            discount_amount: row.discount_amount,
            promo_amount: row.promo_amount,
            void_amount: row.void_amount,
            net_sales: row.net_sales,
            status: "posted",
            raw_row: {
              source: "dashboard_import",
              aggregated: true,
              source_location_name: row.source_location_name || null,
            },
          })),
        );

      if (rowsError) {
        setMessage(rowsError.message);
        setSaleSaving(false);
        return false;
      }
    }

    if (batchId) {
      await supabase.rpc("reconcile_dashboard_pos_import_batch", {
        target_batch_id: batchId,
        reconciliation_note_value:
          businessDates.length > 0
            ? "POS import posted with business-date evidence."
            : "POS import posted without business dates; reconciliation remains provisional.",
      });
    }

    for (const [index, row] of validRows.entries()) {
      const { error } = await recordMenuSale(row, batchId || undefined);

      if (error) {
        setMessage(`Sales import stopped on row ${index + 1}: ${error.message}`);
        setSaleSaving(false);
        return false;
      }
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage(
      `${validRows.length.toLocaleString()} sales row${
        validRows.length === 1 ? "" : "s"
      } imported. Standard usage, margin impact, and POS date reconciliation were updated.`,
    );
    setSaleSaving(false);
    return true;
  }

  async function handleUpsertPosSalesItemMapping({
    posItemKey,
    posItemLabel,
    posItemCode,
    recipeId,
  }: {
    posItemKey: string;
    posItemLabel: string;
    posItemCode: string;
    recipeId: string;
  }): Promise<boolean> {
    if (!organization) {
      return false;
    }

    const cleanPosItemKey = posItemKey.trim();
    const cleanRecipeId = extractUuid(recipeId);

    if (!cleanPosItemKey || !cleanRecipeId) {
      setMessage("Choose a final menu item for this POS row.");
      return false;
    }

    setSaleSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("pos_sales_item_mappings")
      .upsert(
        {
          organization_id: organization.id,
          pos_item_key: cleanPosItemKey,
          pos_item_label: posItemLabel.trim() || posItemCode.trim(),
          pos_item_code: posItemCode.trim() || null,
          recipe_id: cleanRecipeId,
        },
        { onConflict: "organization_id,pos_item_key" },
      );

    if (error) {
      setMessage(error.message);
      setSaleSaving(false);
      return false;
    }

    setPosSalesItemMappings(await loadPosSalesItemMappings(organization.id));
    setMessage("POS sales mapping saved.");
    setSaleSaving(false);
    return true;
  }

  async function handleCreateRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization) {
      setMessage("Create a workspace before adding recipes.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "").trim();
    const selectedRecipeType = String(formData.get("recipe_type") ?? "sub_recipe");
    const canCurrentUserManageCosting = costingRoles.has(
      normalizeRole(profile?.role),
    );
    const recipeType = canCurrentUserManageCosting
      ? selectedRecipeType
      : "sub_recipe";
    const outputUom = String(formData.get("output_uom") ?? "").trim() || "kg";
    const standardBatchOutputQty = Number(
      formData.get("standard_batch_output_qty") ?? 1,
    );
    const standardYieldPct = Number(formData.get("standard_yield_pct") ?? 1);
    const sellingPrice = Number(formData.get("selling_price") ?? 0);

    if (!name) {
      setMessage("Add a recipe name before saving.");
      return;
    }

    const recipeAlreadyExists = recipes.some(
      (recipe) =>
        recipe.is_active &&
        recipe.recipe_type === recipeType &&
        normalizeMasterDataKey(recipe.name) === normalizeMasterDataKey(name),
    );

    if (recipeAlreadyExists) {
      setMessage("That recipe name already exists for this recipe type. Update the existing recipe instead.");
      return;
    }

    setRecipeSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("create_recipe_from_dashboard", {
      recipe_name: name,
      recipe_type_value: recipeType,
      recipe_output_uom: outputUom,
      recipe_standard_batch_output_qty:
        Number.isFinite(standardBatchOutputQty) && standardBatchOutputQty > 0
          ? standardBatchOutputQty
          : 1,
      recipe_standard_yield_pct: Number.isFinite(standardYieldPct) && standardYieldPct > 0
        ? standardYieldPct
        : 1,
      recipe_selling_price:
        recipeType === "sub_recipe"
          ? 0
          : Number.isFinite(sellingPrice) && sellingPrice >= 0
            ? sellingPrice
            : 0,
    });

    if (error) {
      setMessage(error.message);
      setRecipeSaving(false);
      return;
    }

    form.reset();
    await reloadOperatingWorkspace(organization.id);
    setRecipeSaving(false);
  }

  async function recalculateRecipeCost(recipeId: string) {
    if (!organization) {
      return;
    }

    const targetRecipeId = extractUuid(recipeId);
    const { data: recalculatedCost, error: recalculationError } =
      await supabase.rpc("calculate_recipe_unit_cost", {
        target_recipe_id: targetRecipeId,
      });

    if (recalculationError) {
      throw recalculationError;
    }

    const { error: costError } = await supabase.rpc("set_recipe_cost_from_engine", {
      target_recipe_id: targetRecipeId,
      new_cost: Number(recalculatedCost) || 0,
      reason: "dashboard_recipe_edit",
    });

    if (costError) {
      throw costError;
    }
  }

  async function handleUpdateRecipeDetails(
    recipeId: string,
    patch: Partial<
      Pick<
        Recipe,
        | "name"
        | "recipe_type"
        | "output_uom"
        | "standard_batch_output_qty"
        | "standard_yield_pct"
        | "selling_price"
        | "is_active"
      >
    >,
  ) {
    if (!organization) {
      return;
    }

    if (
      patch.name !== undefined &&
      recipes.some((recipe) => {
        const nextRecipeType = patch.recipe_type ?? recipes.find(
          (candidate) => extractUuid(candidate.id) === extractUuid(recipeId),
        )?.recipe_type;

        return (
          extractUuid(recipe.id) !== extractUuid(recipeId) &&
          recipe.is_active &&
          recipe.recipe_type === nextRecipeType &&
          normalizeMasterDataKey(recipe.name) ===
            normalizeMasterDataKey(patch.name)
        );
      })
    ) {
      setMessage("That recipe name already exists for this recipe type. Update the existing recipe instead.");
      return;
    }

    setRecipeSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("recipes")
      .update(patch)
      .eq("id", extractUuid(recipeId))
      .eq("organization_id", organization.id);

    if (error) {
      setMessage(error.message);
      setRecipeSaving(false);
      return;
    }

    try {
      await recalculateRecipeCost(recipeId);
    } catch (error) {
      setMessage(getErrorMessage(error, "Recipe saved, but cost recalculation failed."));
      setRecipeSaving(false);
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage("Recipe updated.");
    setRecipeSaving(false);
  }

  async function handleUpdateRecipeComponentQuantity(
    component: RecipeComponent,
    quantity: number,
  ) {
    if (!organization) {
      return;
    }

    const targetRecipeId = extractUuid(component.recipe_id);
    const targetInventoryItemId = extractUuid(
      component.component_inventory_item_id,
    );

    if (!targetRecipeId || !targetInventoryItemId || quantity <= 0) {
      setMessage("Choose a valid ingredient quantity.");
      return;
    }

    setRecipeSaving(true);
    setMessage("");

    const { error: deleteError } = await supabase
      .from("recipe_components")
      .delete()
      .eq("id", component.id)
      .eq("organization_id", organization.id);

    if (deleteError) {
      setMessage(deleteError.message);
      setRecipeSaving(false);
      return;
    }

    const { error: addError } = await supabase.rpc(
      "add_recipe_inventory_component",
      {
        target_recipe_id: targetRecipeId,
        target_inventory_item_id: targetInventoryItemId,
        component_quantity: quantity,
      },
    );

    if (addError) {
      setMessage(addError.message);
      setRecipeSaving(false);
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage("Ingredient quantity updated.");
    setRecipeSaving(false);
  }

  async function handleAddRecipeComponent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const recipeId = extractUuid(formData.get("recipe_id"));
    const rawComponentLines = String(formData.get("component_lines") ?? "[]");
    let componentLines: Array<{
      inventory_item_id: string;
      quantity: number;
    }> = [];

    try {
      componentLines = JSON.parse(rawComponentLines);
    } catch {
      setMessage("Ingredient lines could not be read.");
      return;
    }

    const validComponentLines = componentLines.filter(
      (line) =>
        line.inventory_item_id &&
        Number.isFinite(line.quantity) &&
        line.quantity > 0,
    );

    if (!recipeId || validComponentLines.length === 0) {
      setMessage("Choose a recipe and at least one ingredient quantity before adding.");
      return;
    }

    setRecipeSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("add_recipe_inventory_components", {
      target_recipe_id: recipeId,
      component_lines: validComponentLines,
    });

    if (error) {
      setMessage(error.message);
      setRecipeSaving(false);
      return;
    }

    form.reset();
    await reloadOperatingWorkspace(organization.id);
    setRecipeSaving(false);
  }

  async function handleCreateProductionRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization) {
      return false;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const recipeId = extractUuid(formData.get("production_recipe_id"));
    const targetOutputQty = Number(formData.get("target_output_qty") ?? 0);
    const actualOutputQty = Number(formData.get("actual_output_qty") ?? 0);
    const origin = String(formData.get("origin") ?? "kitchen_prep_line");
    const outputLocationId = extractUuid(
      formData.get("output_location_id_value"),
    );
    const rawActualComponentUsages = String(
      formData.get("actual_component_usages") ?? "[]",
    );
    const rawProductionRunLines = String(
      formData.get("production_run_lines") ?? "",
    );

    if (!recipeId || !Number.isFinite(targetOutputQty) || targetOutputQty <= 0) {
      setMessage("Choose a production item and actual output before recording production.");
      return false;
    }

    setProductionSaving(true);
    setMessage("");

    let actualComponentUsages: Array<{
      component_inventory_item_id: string;
      actual_qty_used: number | null;
    }> = [];

    try {
      actualComponentUsages = JSON.parse(rawActualComponentUsages);
    } catch {
      setMessage("Ingredient usage values could not be read.");
      setProductionSaving(false);
      return false;
    }

    type ProductionRunRpcLine = {
      target_recipe_id: string;
      target_output_quantity: number;
      actual_output_quantity: number;
      production_origin: string;
      actual_component_usages: Array<{
        component_inventory_item_id: string;
        actual_qty_used: number | null;
      }>;
      output_location_id_value: string | null;
    };

    let productionRunLines: ProductionRunRpcLine[] = [
      {
        target_recipe_id: recipeId,
        target_output_quantity: targetOutputQty,
        actual_output_quantity:
          Number.isFinite(actualOutputQty) && actualOutputQty > 0
            ? actualOutputQty
            : targetOutputQty,
        production_origin: origin,
        actual_component_usages: actualComponentUsages,
        output_location_id_value: outputLocationId || null,
      },
    ];

    if (rawProductionRunLines) {
      try {
        const parsedProductionRunLines = JSON.parse(rawProductionRunLines);

        if (Array.isArray(parsedProductionRunLines)) {
          productionRunLines = parsedProductionRunLines.map((line) => ({
            target_recipe_id: extractUuid(line.target_recipe_id),
            target_output_quantity: Number(line.target_output_quantity ?? 0),
            actual_output_quantity: Number(line.actual_output_quantity ?? 0),
            production_origin: String(
              line.production_origin ?? "kitchen_prep_line",
            ),
            actual_component_usages: Array.isArray(
              line.actual_component_usages,
            )
              ? line.actual_component_usages
              : [],
            output_location_id_value:
              extractUuid(line.output_location_id_value) || null,
          }));
        }
      } catch {
        setMessage("Production lines could not be read.");
        setProductionSaving(false);
        return false;
      }
    }

    const invalidProductionLine = productionRunLines.some((line) => {
      const invalidActualUsage = line.actual_component_usages.some(
        (usage) =>
          !extractUuid(usage.component_inventory_item_id) ||
          usage.actual_qty_used === null ||
          !Number.isFinite(usage.actual_qty_used) ||
          usage.actual_qty_used < 0,
      );

      return (
        !extractUuid(line.target_recipe_id) ||
        !Number.isFinite(line.target_output_quantity) ||
        line.target_output_quantity <= 0 ||
        !Number.isFinite(line.actual_output_quantity) ||
        line.actual_output_quantity <= 0 ||
        line.actual_component_usages.length === 0 ||
        invalidActualUsage
      );
    });

    if (invalidProductionLine) {
      setMessage(
        "Enter a valid production item, output quantity, and raw material usage for every production line.",
      );
      setProductionSaving(false);
      return false;
    }

    for (const line of productionRunLines) {
      const { error } = await supabase.rpc("create_dashboard_production_run", {
        target_recipe_id: line.target_recipe_id,
        target_output_quantity: line.target_output_quantity,
        actual_output_quantity: line.actual_output_quantity,
        production_origin: line.production_origin,
        actual_component_usages: line.actual_component_usages,
        output_location_id_value: line.output_location_id_value,
      });

      if (error) {
        setMessage(error.message);
        setProductionSaving(false);
        return false;
      }
    }

    form.reset();
    await reloadOperatingWorkspace(organization.id);
    setMessage(
      productionRunLines.length > 1
        ? `${productionRunLines.length.toLocaleString()} production lines recorded. Inventory and transformation events updated.`
        : "Production run recorded. Inventory and transformation events updated.",
    );
    setProductionSaving(false);
    return true;
  }

  async function handleCreateWasteEvent(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();

    if (!organization) {
      return false;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const inventoryItemId = extractUuid(formData.get("waste_inventory_item_id"));
    const quantity = Number(formData.get("waste_quantity") ?? 0);
    const reason = String(formData.get("waste_reason") ?? "spoilage").trim();
    const stage = String(formData.get("waste_stage") ?? "prep").trim();
    const notes = String(formData.get("waste_notes") ?? "").trim();

    if (!inventoryItemId || !Number.isFinite(quantity) || quantity <= 0) {
      setMessage("Choose an item and enter a valid waste quantity.");
      return false;
    }

    setWasteSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("create_dashboard_waste_event", {
      target_inventory_item_id: inventoryItemId,
      waste_quantity: quantity,
      waste_reason_value: reason || "spoilage",
      waste_stage_value: stage || "prep",
      waste_notes_value: notes || null,
    });

    if (error) {
      setMessage(error.message);
      setWasteSaving(false);
      return false;
    }

    form.reset();
    await reloadOperatingWorkspace(organization.id);
    setMessage("Waste event recorded. Inventory and variance updated.");
    setWasteSaving(false);
    return true;
  }

  async function handleDeclareOperationRegister({
    registerKey,
    department,
    status,
    activityState,
    notes,
  }: {
    registerKey: string;
    department: string;
    status: OperationRegisterStatus;
    activityState: OperationRegisterActivityState;
    notes?: string;
  }) {
    if (!organization) {
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("upsert_dashboard_operation_register", {
      target_organization_id: organization.id,
      register_key_value: registerKey,
      department_value: department,
      operating_date_value: getLocalDateInputValue(),
      status_value: status,
      activity_state_value: activityState,
      notes_value: notes ?? null,
    });

    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage("Daily register updated.");
    setSaving(false);
  }

  async function handleReviewOperatingDay(operatingDate: string) {
    if (!organization) {
      return;
    }

    setSaving(true);
    setMessage("");

    const { data, error } = await supabase.rpc(
      "review_dashboard_operating_day",
      {
        target_organization_id: organization.id,
        target_operating_date: operatingDate,
      },
    );

    await reloadOperatingWorkspace(organization.id);
    setMessage(
      error
        ? error.message
        : (data as OperatingDay | null)?.blockers.length
          ? "Close review complete. Resolve the listed blockers before closing."
          : "Close review complete. This operating day is ready to close.",
    );
    setSaving(false);
  }

  async function handleCloseOperatingDay(operatingDate: string) {
    if (!organization) {
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("close_dashboard_operating_day", {
      target_organization_id: organization.id,
      target_operating_date: operatingDate,
      close_note_value: "All blocking daily controls reviewed and completed.",
    });

    await reloadOperatingWorkspace(organization.id);
    setMessage(
      error
        ? error.message
        : `Operating day ${operatingDate} closed with an audit record.`,
    );
    setSaving(false);
  }

  async function handleReopenOperatingDay(
    operatingDate: string,
    reason: string,
  ) {
    if (!organization) {
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("reopen_dashboard_operating_day", {
      target_organization_id: organization.id,
      target_operating_date: operatingDate,
      reopen_reason_value: reason,
    });

    await reloadOperatingWorkspace(organization.id);
    setMessage(
      error
        ? error.message
        : `Operating day ${operatingDate} reopened. The reason is in the audit trail.`,
    );
    setSaving(false);
  }

  async function handleCreateYieldTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization) {
      return false;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const inventoryItemId = extractUuid(formData.get("yield_inventory_item_id"));
    const startingWeight = Number(formData.get("starting_weight") ?? 0);
    const usableWeight = Number(formData.get("usable_weight") ?? 0);
    const testDate = String(formData.get("test_date") ?? "").trim();
    const notes = String(formData.get("yield_test_notes") ?? "").trim();

    if (
      !inventoryItemId ||
      !Number.isFinite(startingWeight) ||
      startingWeight <= 0 ||
      !Number.isFinite(usableWeight) ||
      usableWeight <= 0 ||
      usableWeight > startingWeight
    ) {
      setMessage(
        "Choose a high-value SKU, then enter starting and usable weights from the same test.",
      );
      return false;
    }

    setYieldTestSaving(true);
    setMessage("");

    const { data, error } = await supabase
      .rpc("submit_dashboard_yield_test", {
        target_inventory_item_id: inventoryItemId,
        starting_weight_value: startingWeight,
        usable_weight_value: usableWeight,
        notes_value: notes || null,
        test_date_value: testDate || getLocalDateInputValue(),
      })
      .single();

    if (error) {
      setMessage(error.message);
      setYieldTestSaving(false);
      return false;
    }

    form.reset();
    await reloadOperatingWorkspace(organization.id);
    const savedYieldTest = data as YieldTestEntry | null;
    setMessage(
      savedYieldTest?.is_below_master
        ? "Yield test saved and flagged because it came in below the current master yield."
        : savedYieldTest?.master_yield_updated
          ? "Yield test saved. The SKU master yield was updated from the latest three-test average."
          : "Yield test saved. Three tests are required before the SKU master yield updates.",
    );
    setYieldTestSaving(false);
    return true;
  }

  async function handleRefreshYieldTestNotifications() {
    if (!organization) {
      return;
    }

    setYieldTestSaving(true);
    setMessage("");

    const insertedCount = await refreshYieldTestOverdueNotifications(
      organization.id,
    );

    setYieldTestNotifications(await loadYieldTestNotifications(organization.id));
    setMessage(
      insertedCount > 0
        ? `${insertedCount.toLocaleString()} overdue yield test alert${
            insertedCount === 1 ? "" : "s"
          } created.`
        : "Yield test reminders are up to date.",
    );
    setYieldTestSaving(false);
  }

  async function handleApproveRequest(requestId: string) {
    if (!organization) {
      return;
    }

    const activeProfile = await refreshActiveProfileForOperationalAction();
    if (!activeProfile) {
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("approve_dashboard_request", {
      target_request_id: requestId,
    });

    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage("Approval request accepted.");
    setSaving(false);
  }

  async function refreshActiveProfileForOperationalAction() {
    const latestUserResult = await supabase.auth.getUser();
    const latestUser = latestUserResult.data.user;

    if (!latestUser) {
      router.replace("/login");
      return null;
    }

    setUser(latestUser);

    const { data: refreshedProfile } = await supabase
      .from("profiles")
      .select("id, organization_id, full_name, role")
      .eq("id", latestUser.id)
      .maybeSingle();

    if (!refreshedProfile) {
      return profile;
    }

    const normalizedProfile = {
      ...(refreshedProfile as Omit<Profile, "role"> & { role: unknown }),
      role: normalizeRole((refreshedProfile as { role: unknown }).role),
    };

    setProfile(normalizedProfile);
    return normalizedProfile;
  }

  async function handleConfirmRequisitionIssue(
    requestId: string,
    issuedLines: Array<{ inventory_item_id: string; issued_quantity: number }>,
  ) {
    if (!organization) {
      return;
    }

    const activeProfile = await refreshActiveProfileForOperationalAction();
    if (!activeProfile) {
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("confirm_dashboard_requisition_issue", {
      target_request_id: requestId,
      issued_lines: issuedLines,
    });

    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage(
      "Transfer issued. Stock has left the source store and is waiting for destination receipt.",
    );
    setSaving(false);
  }

  async function handleAcknowledgeRequisitionReceipt(requestId: string) {
    if (!organization) {
      return;
    }

    const activeProfile = await refreshActiveProfileForOperationalAction();
    if (!activeProfile) {
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase.rpc(
      "acknowledge_dashboard_requisition_receipt",
      {
        target_request_id: requestId,
      },
    );

    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage("Transfer received. Destination stock has been updated.");
    setSaving(false);
  }

  async function handleRejectRequisitionReceipt(requestId: string) {
    if (!organization) {
      return;
    }

    const activeProfile = await refreshActiveProfileForOperationalAction();
    if (!activeProfile) {
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase.rpc(
      "reject_dashboard_requisition_receipt",
      {
        target_request_id: requestId,
        rejection_reason_value: "Receipt rejected by receiving department.",
      },
    );

    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage("Receipt rejected. Requisition was closed without receiving stock.");
    setSaving(false);
  }

  async function handleRejectRequest(requestId: string) {
    if (!organization) {
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase.rpc("reject_dashboard_request", {
      target_request_id: requestId,
      rejection_reason_value: "Rejected from dashboard",
    });

    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }

    await reloadOperatingWorkspace(organization.id);
    setMessage("Approval request rejected.");
    setSaving(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <main className="dashboard-readable flex min-h-screen items-center justify-center bg-background font-sans antialiased text-foreground">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-text-ghost">
          Loading your margin dashboard...
        </p>
      </main>
    );
  }

  const currentRole = normalizeRole(profile?.role);
  const currentEmail = user?.email?.trim().toLowerCase() ?? "";
  const assignmentPendingRole =
    currentEmail === "suzzyqgemini@gmail.com" ? "kitchen_manager" : currentRole;
  const canInitializeWorkspace =
    !profile ||
    (currentEmail !== "suzzyqgemini@gmail.com" &&
      (currentRole === "owner" ||
        currentRole === "admin" ||
        currentRole === "manager"));
  const salesCaptureMode: SalesCaptureMode =
    systemSettings?.sales_capture_mode ?? "pos_import";
  const manualSalesAllowed =
    salesCaptureMode === "manual_sales" || salesCaptureMode === "test_mode";
  const posImportAllowed =
    salesCaptureMode === "pos_import" || salesCaptureMode === "test_mode";

  return (
    <main className="dashboard-readable min-h-screen overflow-x-hidden bg-background font-sans antialiased text-foreground">
      <header className="sticky top-0 z-40 border-b border-border-system/80 bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-[1320px] items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              aria-label="ProfitPlate home"
              className="flex shrink-0 items-center gap-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-accent/15 bg-card shadow-sm">
              <Image
                src="/ProfitPlate logo.png.png"
                alt=""
                width={72}
                height={72}
                priority
                className="h-16 w-16 max-w-none object-cover object-left"
              />
              </span>
              <span>
                <span className="block text-sm font-extrabold leading-none">
                  ProfitPlate
                </span>
                <span className="mt-1 hidden font-mono text-[9px] uppercase tracking-widest text-text-ghost sm:block">
                  Live margin tracking for restaurants
                </span>
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`hidden rounded-sm border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider sm:inline-flex ${
                organization?.system_status === "live_operations"
                  ? "border-accent/30 bg-accent-muted-bg text-accent"
                  : "border-status-attention-border bg-status-attention-bg text-status-attention-text"
              }`}
            >
              {organization?.system_status === "live_operations"
                ? "Live"
                : "Setting Up"}
            </span>
            <span className="hidden text-right md:block">
              <span className="block max-w-[220px] truncate text-xs font-bold">
                {profile?.full_name || "ProfitPlate user"}
              </span>
              <span className="mt-0.5 block max-w-[220px] truncate text-[10px] text-text-ghost">
                {user?.email}
              </span>
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-sm border border-border-system bg-card px-3 py-2 text-xs font-bold text-foreground transition hover:border-border-system-hover"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {organization ? (
        <WorkspaceDashboard
          organization={organization}
          profile={profile}
          stats={stats}
          locations={locations}
          suppliers={suppliers}
          inventoryItems={inventoryItems}
          recipes={recipes}
          recipeComponents={recipeComponents}
          costEvents={costEvents}
          productionHistory={productionHistory}
          stockVarianceHistory={stockVarianceHistory}
          stockMovementLedger={stockMovementLedger}
          wasteHistory={wasteHistory}
          menuSaleHistory={menuSaleHistory}
          avtSummary={avtSummary}
          approvalRequests={approvalRequests}
          operationRegisterEntries={operationRegisterEntries}
          operatingDays={operatingDays}
          systemSettings={systemSettings}
          salesCaptureMode={salesCaptureMode}
          posSalesItemMappings={posSalesItemMappings}
          yieldTestEntries={yieldTestEntries}
          yieldTestNotifications={yieldTestNotifications}
          purchaseOrders={purchaseOrders}
          purchaseOrderLines={purchaseOrderLines}
          inventorySaving={inventorySaving}
          setupSaving={setupSaving}
          recipeSaving={recipeSaving}
          productionSaving={productionSaving}
          saleSaving={saleSaving}
          stockSaving={stockSaving}
          purchaseOrderSaving={purchaseOrderSaving}
          receivingPurchaseOrderId={receivingPurchaseOrderId}
          requisitionSaving={requisitionSaving}
          stockCountSaving={stockCountSaving}
          wasteSaving={wasteSaving}
          yieldTestSaving={yieldTestSaving}
          dayCloseSaving={saving}
          message={message}
          onCreateLocation={handleCreateLocation}
          onCreateSupplier={handleCreateSupplier}
          onUpdateLocation={handleUpdateLocation}
          onUpdateSupplier={handleUpdateSupplier}
          onCreateInventoryItem={handleCreateInventoryItem}
          onUpdateInventoryItem={handleUpdateInventoryItem}
          onAdjustStock={handleAdjustStock}
          onCreatePurchaseOrder={handleCreatePurchaseOrder}
          onReceivePurchaseOrder={handleReceivePurchaseOrder}
          onCreateRequisition={handleCreateRequisition}
          onCreateStockCount={handleCreateStockCount}
          onCreateMenuSale={handleCreateMenuSale}
          onBulkCreateMenuSales={handleBulkCreateMenuSales}
          onUpsertPosSalesItemMapping={handleUpsertPosSalesItemMapping}
          onCreateYieldTest={handleCreateYieldTest}
          onRefreshYieldTestNotifications={handleRefreshYieldTestNotifications}
          onCreateWasteEvent={handleCreateWasteEvent}
          onCreateRecipe={handleCreateRecipe}
          onDeclareOperationRegister={handleDeclareOperationRegister}
          onReviewOperatingDay={handleReviewOperatingDay}
          onCloseOperatingDay={handleCloseOperatingDay}
          onReopenOperatingDay={handleReopenOperatingDay}
          onUpdateRecipeDetails={handleUpdateRecipeDetails}
          onUpdateRecipeComponentQuantity={handleUpdateRecipeComponentQuantity}
          onAddRecipeComponent={handleAddRecipeComponent}
          onCreateProductionRun={handleCreateProductionRun}
          onApproveRequest={handleApproveRequest}
          onConfirmRequisitionIssue={handleConfirmRequisitionIssue}
          onAcknowledgeRequisitionReceipt={handleAcknowledgeRequisitionReceipt}
          onRejectRequisitionReceipt={handleRejectRequisitionReceipt}
          onRejectRequest={handleRejectRequest}
        />
      ) : profile && !canInitializeWorkspace ? (
        <WorkspaceAssignmentPending
          email={user?.email ?? ""}
          role={assignmentPendingRole}
          message={message}
        />
      ) : (
        <WorkspaceOnboarding
          email={user?.email ?? ""}
          message={message}
          saving={saving}
          onSubmit={handleCreateOrganization}
        />
      )}
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="fixed bottom-5 right-5 z-50 rounded-sm border border-accent-muted-border bg-card/95 px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-accent shadow-2xl shadow-black/30 backdrop-blur transition hover:bg-accent-muted-bg"
        aria-label="Back to top"
      >
        ↑ Top
      </button>
    </main>
  );
}

function WorkspaceDashboard({
  organization,
  profile,
  stats,
  locations,
  suppliers,
  inventoryItems,
  recipes,
  recipeComponents,
  costEvents: allCostEvents,
  productionHistory: allProductionHistory,
  stockVarianceHistory: allStockVarianceHistory,
  stockMovementLedger: allStockMovementLedger,
  wasteHistory: allWasteHistory,
  menuSaleHistory: allMenuSaleHistory,
  avtSummary,
  approvalRequests,
  operationRegisterEntries,
  operatingDays,
  systemSettings,
  salesCaptureMode,
  posSalesItemMappings,
  yieldTestEntries,
  yieldTestNotifications,
  purchaseOrders: allPurchaseOrders,
  purchaseOrderLines,
  inventorySaving,
  setupSaving,
  recipeSaving,
  productionSaving,
  saleSaving,
  stockSaving,
  purchaseOrderSaving,
  receivingPurchaseOrderId,
  requisitionSaving,
  stockCountSaving,
  wasteSaving,
  yieldTestSaving,
  dayCloseSaving,
  message,
  onCreateLocation,
  onCreateSupplier,
  onUpdateLocation,
  onUpdateSupplier,
  onCreateInventoryItem,
  onUpdateInventoryItem,
  onAdjustStock,
  onCreatePurchaseOrder,
  onReceivePurchaseOrder,
  onCreateRequisition,
  onCreateStockCount,
  onCreateMenuSale,
  onBulkCreateMenuSales,
  onUpsertPosSalesItemMapping,
  onCreateYieldTest,
  onRefreshYieldTestNotifications,
  onCreateWasteEvent,
  onCreateRecipe,
  onDeclareOperationRegister,
  onReviewOperatingDay,
  onCloseOperatingDay,
  onReopenOperatingDay,
  onUpdateRecipeDetails,
  onUpdateRecipeComponentQuantity,
  onAddRecipeComponent,
  onCreateProductionRun,
  onApproveRequest,
  onConfirmRequisitionIssue,
  onAcknowledgeRequisitionReceipt,
  onRejectRequisitionReceipt,
  onRejectRequest,
}: {
  organization: Organization;
  profile: Profile | null;
  stats: WorkspaceStats;
  locations: Location[];
  suppliers: Supplier[];
  inventoryItems: InventoryItem[];
  recipes: Recipe[];
  recipeComponents: RecipeComponent[];
  costEvents: CostRecalculationEvent[];
  productionHistory: ProductionHistoryRow[];
  stockVarianceHistory: StockVarianceHistoryRow[];
  stockMovementLedger: StockMovementLedgerRow[];
  wasteHistory: WasteHistoryRow[];
  menuSaleHistory: MenuSaleHistoryRow[];
  avtSummary: AvtSummaryRow[];
  approvalRequests: ApprovalRequest[];
  operationRegisterEntries: OperationRegisterEntry[];
  operatingDays: OperatingDay[];
  systemSettings: SystemSettings | null;
  salesCaptureMode: SalesCaptureMode;
  posSalesItemMappings: PosSalesItemMapping[];
  yieldTestEntries: YieldTestEntry[];
  yieldTestNotifications: YieldTestNotification[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[];
  inventorySaving: boolean;
  setupSaving: boolean;
  recipeSaving: boolean;
  productionSaving: boolean;
  saleSaving: boolean;
  stockSaving: boolean;
  purchaseOrderSaving: boolean;
  receivingPurchaseOrderId: string;
  requisitionSaving: boolean;
  stockCountSaving: boolean;
  wasteSaving: boolean;
  yieldTestSaving: boolean;
  dayCloseSaving: boolean;
  message: string;
  onCreateLocation: (event: FormEvent<HTMLFormElement>) => void;
  onCreateSupplier: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateLocation: (
    locationId: string,
    patch: Partial<
      Pick<Location, "name" | "location_type" | "routing_model" | "inventory_domain">
    >,
  ) => Promise<void>;
  onUpdateSupplier: (
    supplierId: string,
    patch: Partial<
      Pick<Supplier, "name" | "contact_name" | "phone" | "email">
    >,
  ) => Promise<void>;
  onCreateInventoryItem: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateInventoryItem: (
    itemId: string,
    patch: Partial<
      Pick<InventoryItem, "current_cost_per_base_uom" | "is_active">
    >,
  ) => Promise<void>;
  onAdjustStock: (event: FormEvent<HTMLFormElement>) => void;
  onCreatePurchaseOrder: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onReceivePurchaseOrder: (
    orderId: string,
    receivedLines: Array<{
      purchase_order_line_id: string;
      received_qty: number;
    }>,
    shortSupplyReason: string,
  ) => Promise<void>;
  onCreateRequisition: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onCreateStockCount: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onCreateMenuSale: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onBulkCreateMenuSales: (salesRows: MenuSaleImportInput[]) => Promise<boolean>;
  onUpsertPosSalesItemMapping: (mapping: {
    posItemKey: string;
    posItemLabel: string;
    posItemCode: string;
    recipeId: string;
  }) => Promise<boolean>;
  onCreateYieldTest: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onRefreshYieldTestNotifications: () => Promise<void>;
  onCreateWasteEvent: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onCreateRecipe: (event: FormEvent<HTMLFormElement>) => void;
  onDeclareOperationRegister: (entry: {
    registerKey: string;
    department: string;
    status: OperationRegisterStatus;
    activityState: OperationRegisterActivityState;
    notes?: string;
  }) => Promise<void>;
  onReviewOperatingDay: (operatingDate: string) => Promise<void>;
  onCloseOperatingDay: (operatingDate: string) => Promise<void>;
  onReopenOperatingDay: (
    operatingDate: string,
    reason: string,
  ) => Promise<void>;
  onUpdateRecipeDetails: (
    recipeId: string,
    patch: Partial<
      Pick<
        Recipe,
        | "name"
        | "recipe_type"
        | "output_uom"
        | "standard_batch_output_qty"
        | "standard_yield_pct"
        | "selling_price"
        | "is_active"
      >
    >,
  ) => Promise<void>;
  onUpdateRecipeComponentQuantity: (
    component: RecipeComponent,
    quantity: number,
  ) => Promise<void>;
  onAddRecipeComponent: (event: FormEvent<HTMLFormElement>) => void;
  onCreateProductionRun: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onApproveRequest: (requestId: string) => Promise<void>;
  onConfirmRequisitionIssue: (
    requestId: string,
    issuedLines: Array<{ inventory_item_id: string; issued_quantity: number }>,
  ) => Promise<void>;
  onAcknowledgeRequisitionReceipt: (requestId: string) => Promise<void>;
  onRejectRequisitionReceipt: (requestId: string) => Promise<void>;
  onRejectRequest: (requestId: string) => Promise<void>;
}) {
  const [selectedProductionRecipeId, setSelectedProductionRecipeId] =
    useState("");
  const [targetProductionOutput, setTargetProductionOutput] = useState("");
  const [additionalProductionRunRows, setAdditionalProductionRunRows] =
    useState<ProductionRunLineInputRow[]>([]);
  const [actualProductionInputs, setActualProductionInputs] = useState<
    Record<string, string>
  >({});
  const [selectedSaleRecipeId, setSelectedSaleRecipeId] = useState("");
  const [selectedSaleLocationId, setSelectedSaleLocationId] = useState("");
  const [saleQuantity, setSaleQuantity] = useState("");
  const [posMappingText, setPosMappingText] = useState("");
  const [salesImportText, setSalesImportText] = useState("");
  const [showSalesTable, setShowSalesTable] = useState(true);
  const [showDepletionTable, setShowDepletionTable] = useState(false);
  const [showWasteTable, setShowWasteTable] = useState(true);
  const [priceSimulationPct, setPriceSimulationPct] = useState("5");
  const [selectedPricingSimulationRecipeId, setSelectedPricingSimulationRecipeId] =
    useState("");
  const [selectedPriceMovementId, setSelectedPriceMovementId] = useState("");
  const [menuProfitabilitySearch, setMenuProfitabilitySearch] = useState("");
  const [menuProfitabilityFilter, setMenuProfitabilityFilter] =
    useState<MenuProfitabilityFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("30d");
  const [dashboardStartDate, setDashboardStartDate] = useState("");
  const [dashboardEndDate, setDashboardEndDate] = useState("");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryLocationFilter, setInventoryLocationFilter] = useState("");
  const [inventoryDepartmentFilter, setInventoryDepartmentFilter] = useState("");
  const [inventoryHighValueOnly, setInventoryHighValueOnly] = useState(false);
  const [selectedMovementInventoryItemId, setSelectedMovementInventoryItemId] =
    useState("");
  const [selectedFocusRole, setSelectedFocusRole] = useState<AppRole | "">("");
  const [selectedDashboardSection, setSelectedDashboardSection] = useState("");
  const [selectedDashboardTargetId, setSelectedDashboardTargetId] = useState("");
  const [mobileDashboardMenuOpen, setMobileDashboardMenuOpen] = useState(false);
  const [ownerDetailExpanded, setOwnerDetailExpanded] = useState(false);
  const [ownerSalesTrendProductFilter, setOwnerSalesTrendProductFilter] =
    useState("");
  const [ownerLeakTrendLocationFilter, setOwnerLeakTrendLocationFilter] =
    useState("");
  const [ownerProcurementTrendFilter, setOwnerProcurementTrendFilter] =
    useState("");
  const [ownerComplianceTrendDepartmentFilter, setOwnerComplianceTrendDepartmentFilter] =
    useState("");
  const [ownerMarginTrendProductFilter, setOwnerMarginTrendProductFilter] =
    useState("");
  const [openNavGroups, setOpenNavGroups] = useState<Record<string, boolean>>(
    {},
  );
  const resetDashboardDateFilter = () => {
    setDateFilter("30d");
    setDashboardStartDate("");
    setDashboardEndDate("");
  };
  const updateDashboardStartDate = (value: string) => {
    setDashboardStartDate(value);
    setDateFilter(value || dashboardEndDate ? "custom" : "30d");
  };
  const updateDashboardEndDate = (value: string) => {
    setDashboardEndDate(value);
    setDateFilter(dashboardStartDate || value ? "custom" : "30d");
  };
  const [editingLocationId, setEditingLocationId] = useState("");
  const [editingSupplierId, setEditingSupplierId] = useState("");
  const [componentInputRows, setComponentInputRows] = useState<
    RecipeComponentInputRow[]
  >([{ id: "component-line-1", inventoryItemId: "", quantity: "" }]);
  const [purchaseReceiptRows, setPurchaseReceiptRows] = useState<
    PurchaseReceiptInputRow[]
  >([
    {
      id: "purchase-line-1",
      inventoryItemId: "",
      searchText: "",
      stockOnHandQty: "",
      quantity: "",
      landedUnitCost: "",
      taxRatePct: "",
    },
  ]);
  const [editingPurchaseOrderId, setEditingPurchaseOrderId] = useState("");
  const [purchaseSupplierId, setPurchaseSupplierId] = useState("");
  const [purchaseSupplierName, setPurchaseSupplierName] = useState("");
  const [purchaseReceivingLocationId, setPurchaseReceivingLocationId] =
    useState("");
  const [expandedPurchaseOrderId, setExpandedPurchaseOrderId] = useState("");
  const [purchaseOrderQueueFilter, setPurchaseOrderQueueFilter] =
    useState<PurchaseOrderQueueFilter>("open");
  const [purchaseReceipts, setPurchaseReceipts] = useState<PurchaseOrderReceipt[]>(
    [],
  );
  const [purchaseReceiptQuantities, setPurchaseReceiptQuantities] = useState<
    Record<string, string>
  >({});
  const [purchaseShortSupplyReason, setPurchaseShortSupplyReason] = useState("");
  const [requisitionRows, setRequisitionRows] = useState<
    RequisitionInputRow[]
  >([
    {
      id: "requisition-line-1",
      inventoryItemId: "",
      quantity: "",
      note: "",
    },
  ]);
  const [editingRequisitionRequestId, setEditingRequisitionRequestId] =
    useState("");
  const [requisitionRequesterName, setRequisitionRequesterName] = useState("");
  const [requisitionFromLocationId, setRequisitionFromLocationId] = useState("");
  const [requisitionToLocationId, setRequisitionToLocationId] = useState("");
  const [requisitionApproverName, setRequisitionApproverName] = useState("");
  const [requisitionApproverRole, setRequisitionApproverRole] =
    useState<AppRole>("operations_manager");
  const [requisitionIssueQtyByKey, setRequisitionIssueQtyByKey] = useState<
    Record<string, string>
  >({});
  const [stockCountRows, setStockCountRows] = useState<StockCountInputRow[]>([
    {
      id: "stock-count-line-1",
      inventoryItemId: "",
      countedQuantity: "",
    },
  ]);
  const [fullStockCountQuantities, setFullStockCountQuantities] = useState<
    Record<string, string>
  >({});
  const [stockControlLocationId, setStockControlLocationId] = useState("");
  const [selectedYieldTestItemId, setSelectedYieldTestItemId] = useState("");
  const [productionPlanRows, setProductionPlanRows] = useState<
    ProductionPlanInputRow[]
  >([{ id: "production-plan-line-1", recipeId: "", targetOutputQty: "" }]);
  const [
    productionPlanRequisitionFromLocationId,
    setProductionPlanRequisitionFromLocationId,
  ] = useState("");
  const [
    productionPlanRequisitionToLocationId,
    setProductionPlanRequisitionToLocationId,
  ] = useState("");
  const [productionPlanRequisitionMode, setProductionPlanRequisitionMode] =
    useState<ProductionPlanRequisitionMode>("required");
  const [productionPlanRequisitionNotice, setProductionPlanRequisitionNotice] =
    useState("");
  const currentRole = normalizeRole(profile?.role);
  const canManageWorkspace = workspaceRoles.has(currentRole);
  const focusRoleOptions = canManageWorkspace
    ? activeDashboardRoles.includes(currentRole)
      ? activeDashboardRoles
      : [currentRole, ...activeDashboardRoles]
    : [currentRole];
  const focusRole = focusRoleOptions.includes(selectedFocusRole as AppRole)
    ? (selectedFocusRole as AppRole)
    : currentRole;
  const isInventoryFocus = focusRole === "inventory_manager";
  const canManageCosting = costingRoles.has(currentRole);
  const canRecordOperations = operationsRoles.has(currentRole);
  const canAuthorSubRecipes = canManageCosting || canRecordOperations;
  const canApproveOperations = approvalRoles.has(currentRole);
  const canManageOperatingDayClose = [
    "owner",
    "admin",
    "manager",
    "operations_manager",
  ].includes(currentRole);
  const canSubmitInventoryMasterData = [
    "owner",
    "admin",
    "operations_manager",
    "finance_manager",
    "procurement_manager",
  ].includes(currentRole);
  const canMaintainLiveInventoryCost = [
    "owner",
    "admin",
    "operations_manager",
    "finance_manager",
  ].includes(currentRole);
  const canSubmitSupplierMasterData = [
    "owner",
    "admin",
    "operations_manager",
    "finance_manager",
    "procurement_manager",
  ].includes(currentRole);
  const canDirectMaintainSuppliers = [
    "owner",
    "admin",
    "operations_manager",
    "finance_manager",
  ].includes(currentRole);
  const canReceivePurchaseOrders =
    focusRole !== "procurement_manager" &&
    [
      "owner",
      "admin",
      "operations_manager",
      "inventory_manager",
      "storekeeper",
    ].includes(currentRole);
  const canDraftPurchaseOrders = [
    "owner",
    "admin",
    "manager",
    "operations_manager",
    "procurement_manager",
  ].includes(currentRole);

  useEffect(() => {
    let cancelled = false;

    async function loadPurchaseReceipts() {
      const { data, error } = await supabase
        .from("purchase_order_receipts")
        .select(
          "id, purchase_order_id, grn_number, receipt_status, short_supply_reason, received_at, purchase_order_receipt_lines(purchase_order_line_id, inventory_item_id, received_qty, unit_cost)",
        )
        .eq("organization_id", organization.id)
        .order("received_at", { ascending: false });

      if (!cancelled) {
        setPurchaseReceipts(
          error ? [] : ((data ?? []) as unknown as PurchaseOrderReceipt[]),
        );
      }
    }

    void loadPurchaseReceipts();
    return () => {
      cancelled = true;
    };
  }, [organization.id, allPurchaseOrders]);
  const dashboardCustomRangeActive =
    dateFilter === "custom" && Boolean(dashboardStartDate || dashboardEndDate);
  const effectiveDateFilter: DateFilter = dashboardCustomRangeActive
    ? "custom"
    : dateFilter === "custom"
      ? "30d"
      : dateFilter;
  const dashboardPeriodStartMs =
    effectiveDateFilter === "custom"
      ? dashboardStartDate
        ? new Date(`${dashboardStartDate}T00:00:00`).getTime()
        : Number.NEGATIVE_INFINITY
      : effectiveDateFilter === "all"
        ? Number.NEGATIVE_INFINITY
        : getDateFilterStart(effectiveDateFilter);
  const dashboardPeriodEndMs =
    effectiveDateFilter === "custom" && dashboardEndDate
      ? new Date(`${dashboardEndDate}T23:59:59.999`).getTime()
      : Number.POSITIVE_INFINITY;
  const isWithinSelectedDatePeriod = (value: string) => {
    if (effectiveDateFilter !== "custom") {
      return isWithinDateFilter(value, effectiveDateFilter);
    }

    const dateMs = getDateMs(value);

    return (
      dateMs > 0 &&
      dateMs >= dashboardPeriodStartMs &&
      dateMs <= dashboardPeriodEndMs
    );
  };
  const selectedPeriodLabel =
    effectiveDateFilter === "custom"
      ? dashboardStartDate && dashboardEndDate
        ? dashboardStartDate === dashboardEndDate
          ? formatDateInputDisplay(dashboardStartDate)
          : `${formatDateInputDisplay(dashboardStartDate)} - ${formatDateInputDisplay(
              dashboardEndDate,
            )}`
        : dashboardStartDate
          ? `From ${formatDateInputDisplay(dashboardStartDate)}`
          : dashboardEndDate
            ? `Until ${formatDateInputDisplay(dashboardEndDate)}`
            : "Custom period"
      : effectiveDateFilter === "today"
        ? "today"
        : effectiveDateFilter === "7d"
          ? "last 7 days"
          : effectiveDateFilter === "30d"
            ? "last 30 days"
            : "all time";
  const costEvents = allCostEvents.filter((event) =>
    isWithinSelectedDatePeriod(event.created_at),
  );
  const productionHistory = allProductionHistory.filter((row) =>
    isWithinSelectedDatePeriod(row.created_at),
  );
  const stockVarianceHistory = allStockVarianceHistory.filter((row) =>
    isWithinSelectedDatePeriod(row.created_at),
  );
  const wasteHistory = allWasteHistory.filter((row) =>
    isWithinSelectedDatePeriod(row.created_at),
  );
  const menuSaleHistory = allMenuSaleHistory.filter((row) =>
    isWithinSelectedDatePeriod(row.operating_date || row.created_at),
  );
  const purchaseOrders = allPurchaseOrders.filter((order) =>
    isWithinSelectedDatePeriod(order.created_at),
  );
  const pendingApprovalRequests = approvalRequests.filter(
    (request) =>
      request.status === "pending" ||
      (request.request_type === "inventory_requisition" &&
        request.status === "accepted" &&
        request.payload?.awaiting_receipt === true),
  );
  const pendingStockCountApprovalCount = pendingApprovalRequests.filter(
    (request) => request.request_type === "stock_count_approval",
  ).length;
  const activeRecipes = useMemo(
    () => recipes.filter((recipe) => recipe.is_active),
    [recipes],
  );
  const activeSubRecipes = useMemo(
    () => activeRecipes.filter((recipe) => recipe.recipe_type === "sub_recipe"),
    [activeRecipes],
  );
  const activeFinalMenuItems = useMemo(
    () =>
      activeRecipes.filter((recipe) => recipe.recipe_type !== "sub_recipe"),
    [activeRecipes],
  );
  const authorableRecipeComponentTargets = canManageCosting
    ? activeRecipes
    : activeSubRecipes;
  const activeLocations = locations.filter((location) => location.is_active);
  const salesOutletLocations = activeLocations.filter(
    (location) => location.location_type === "sales_outlet",
  );
  const defaultSalesOutletLocation =
    salesOutletLocations.find(
      (location) => location.name.trim().toLowerCase() === "front counter",
    ) ?? salesOutletLocations[0];
  const isDepartmentStockLocation = (location: Location) => {
    const normalizedName = location.name.trim().toLowerCase();

    return (
      ["department", "bar", "local_kitchen", "kitchen_line", "production_kitchen", "sales_outlet"].includes(
        location.location_type,
      ) ||
      (
        /(^|[^a-z])(kitchen|kicthen|kitchn|bar)([^a-z]|$)/.test(normalizedName) &&
        !/(store|warehouse|main|central)/.test(normalizedName)
      )
    );
  };
  const departmentStockLocations = activeLocations.filter(isDepartmentStockLocation);
  const salesImportPreview = useMemo(
    () =>
      buildSalesImportPreview(
        salesImportText,
        activeFinalMenuItems,
        posSalesItemMappings,
      ),
    [salesImportText, activeFinalMenuItems, posSalesItemMappings],
  );
  const posMappingPreview = useMemo(
    () =>
      buildPosItemMasterPreview(
        posMappingText,
        activeFinalMenuItems,
        posSalesItemMappings,
      ),
    [posMappingText, activeFinalMenuItems, posSalesItemMappings],
  );
  const posMappingRowsNeedingWork = posMappingPreview.filter(
    (row) => row.status === "needs_mapping" || row.status === "invalid",
  );
  const mappedPosMappingRows = posMappingPreview.filter(
    (row) => row.status === "mapped",
  );
  const savedPosMappingCount = posSalesItemMappings.length;
  const validSalesImportRows = salesImportPreview.filter((row) => !row.error);
  const invalidSalesImportRows = salesImportPreview.length - validSalesImportRows.length;
  const verifiedSalesImportDates = Array.from(
    new Set(validSalesImportRows.map((row) => row.businessDate).filter(Boolean)),
  ).sort();
  const missingSalesImportDateCount = validSalesImportRows.filter(
    (row) => row.dateStatus === "missing_date",
  ).length;
  const unverifiedSalesImportDateCount = validSalesImportRows.filter(
    (row) => row.dateStatus === "unverified",
  ).length;
  const salesImportPeriodLabel =
    verifiedSalesImportDates.length === 0
      ? "No business date detected"
      : verifiedSalesImportDates.length === 1
        ? verifiedSalesImportDates[0]
        : `${verifiedSalesImportDates[0]} to ${
            verifiedSalesImportDates[verifiedSalesImportDates.length - 1]
          }`;
  const salesImportDateContext =
    missingSalesImportDateCount > 0
      ? `${missingSalesImportDateCount.toLocaleString()} row${
          missingSalesImportDateCount === 1 ? "" : "s"
        } had an unreadable date`
      : unverifiedSalesImportDateCount > 0
        ? "No date column found; revenue will be provisional"
        : verifiedSalesImportDates.length > 1
          ? "Multi-day POS period detected"
          : verifiedSalesImportDates.length === 1
            ? "Business date verified"
            : "Add Business Date or Transaction Time for AvT";
  const aggregatedSalesImportRows = Array.from(
    validSalesImportRows
      .reduce((rowsByRecipe, row) => {
        const matchedSourceLocation = departmentStockLocations.find(
          (location) =>
            row.sourceLocationName &&
            location.name.trim().toLowerCase() ===
              row.sourceLocationName.trim().toLowerCase(),
        );
        const rowLocationId =
          extractUuid(matchedSourceLocation?.id) || selectedSaleLocationId;
        const aggregationKey = `${row.recipeId}|${row.businessDate || "undated"}|${
          rowLocationId || "unassigned"
        }`;
        const existingRow = rowsByRecipe.get(aggregationKey);

        if (existingRow) {
          existingRow.sold_quantity += row.soldQuantity;
          existingRow.gross_sales += row.grossSales;
          existingRow.discount_amount += row.discountAmount;
          existingRow.promo_amount += row.promoAmount;
          existingRow.void_amount += row.voidAmount;
          existingRow.net_sales += row.netSales;
          existingRow.pos_item_label = `${existingRow.pos_item_label}, ${
            row.menuItem || row.posItemCode || "POS item"
          }`;
          existingRow.source_transaction_id = [
            existingRow.source_transaction_id,
            row.sourceTransactionId,
          ]
            .filter(Boolean)
            .join(", ");
        } else {
          rowsByRecipe.set(aggregationKey, {
            recipe_id: row.recipeId,
            location_id: rowLocationId,
            sold_quantity: row.soldQuantity,
            gross_sales: row.grossSales,
            discount_amount: row.discountAmount,
            promo_amount: row.promoAmount,
            void_amount: row.voidAmount,
            net_sales: row.netSales,
            pos_item_label: row.menuItem || row.posItemCode || "POS item",
            pos_item_code: row.posItemCode,
            business_date: row.businessDate,
            transaction_timestamp: row.transactionTimestamp,
            source_transaction_id: row.sourceTransactionId,
            source_check_id: row.sourceCheckId,
            source_location_name: row.sourceLocationName,
            row_fingerprint: row.rowFingerprint,
            date_status: row.dateStatus,
          });
        }

        return rowsByRecipe;
      }, new Map<string, MenuSaleImportInput>())
      .values(),
  );
  const stockHoldingLocations = activeLocations.filter((location) =>
    ["main_store", "central_warehouse", "branch_store"].includes(
      location.location_type,
    ) && !isDepartmentStockLocation(location),
  );
  const uniqueLocationsById = (locationsToDedupe: Location[]) =>
    Array.from(
      locationsToDedupe
        .reduce((locationsById, location) => {
          locationsById.set(extractUuid(location.id), location);
          return locationsById;
        }, new Map<string, Location>())
        .values(),
    );
  const requisitionSourceLocations = uniqueLocationsById([
    ...stockHoldingLocations,
    ...departmentStockLocations.filter(
      (location) => location.location_type !== "sales_outlet",
    ),
  ]);
  const requisitionDestinationLocations = uniqueLocationsById([
    ...departmentStockLocations,
    ...salesOutletLocations,
  ]);
  const stockHoldingLocationIds = new Set(
    stockHoldingLocations.map((location) => extractUuid(location.id)),
  );
  const isKitchenFocus = focusRole === "kitchen_manager";
  const isProcurementFocus = focusRole === "procurement_manager";
  const isStorekeeperFocus = focusRole === "storekeeper";
  const isStoreControlFocus = isInventoryFocus || isStorekeeperFocus;
  const isOperationsFocus = ["operations_manager", "manager"].includes(focusRole);
  const isFinanceFocus = ["finance_manager", "auditor"].includes(focusRole);
  const isChefFocus = focusRole === "chef";
  const isQualityFocus = focusRole === "quality_assurance";
  const isBarFocus = ["bar_manager", "bartender"].includes(focusRole);
  const isAuditFocus = ["auditor", "viewer"].includes(focusRole);
  const isAdminFocus = focusRole === "admin";
  const kitchenLocationIds = new Set(
    activeLocations
      .filter((location) => {
        const normalizedName = location.name.trim().toLowerCase();

        return (
          isDepartmentStockLocation(location) ||
          location.location_type === "production_kitchen" ||
          normalizedName.includes("kitchen") ||
          normalizedName.includes("kicthen") ||
          normalizedName.includes("kitchn")
        );
      })
      .map((location) => extractUuid(location.id)),
  );
  const barLocationIds = new Set(
    activeLocations
      .filter((location) => {
        const normalizedName = location.name.trim().toLowerCase();

        return (
          location.location_type === "bar" ||
          /(^|[^a-z])bar([^a-z]|$)/.test(normalizedName)
        );
      })
      .map((location) => extractUuid(location.id)),
  );
  const stockControlLocations = uniqueLocationsById([
    ...stockHoldingLocations,
    ...departmentStockLocations,
    ...salesOutletLocations,
  ]);
  const scopedStockControlLocations = stockControlLocations.filter((location) => {
    const locationId = extractUuid(location.id);

    if (isKitchenFocus || isChefFocus) {
      return kitchenLocationIds.has(locationId);
    }

    if (isBarFocus) {
      return barLocationIds.has(locationId);
    }

    return true;
  });
  const scopedStockControlLocationIds = new Set(
    scopedStockControlLocations.map((location) => extractUuid(location.id)),
  );
  const allActiveInventoryItems = inventoryItems.filter((item) => item.is_active);
  const requisitionSelectableInventoryItems = allActiveInventoryItems.filter(
    (item) => {
      const itemLocationId = extractUuid(item.location_id);

      if (requisitionFromLocationId) {
        return itemLocationId === extractUuid(requisitionFromLocationId);
      }

      return stockHoldingLocationIds.has(itemLocationId);
    },
  );
  const activeInventoryItems = isKitchenFocus
    ? allActiveInventoryItems.filter((item) =>
        kitchenLocationIds.has(extractUuid(item.location_id)),
      )
    : allActiveInventoryItems;
  const isOwnerFocus = focusRole === "owner";
  const activePurchasedIngredients = activeInventoryItems.filter(
    (item) => item.cost_type === "purchased",
  );
  const activeInventoryDisplayItems = activeInventoryItems.filter(
    (item) => item.cost_type === "purchased" || item.cost_type === "manufactured",
  );
  const canonicalStorePurchasedIngredients = allActiveInventoryItems.filter(
    (item) =>
      item.cost_type === "purchased" &&
      stockHoldingLocationIds.has(extractUuid(item.location_id)),
  );
  const purchaseReceivingIngredients = canonicalStorePurchasedIngredients.filter(
    (item) =>
      !purchaseReceivingLocationId ||
      extractUuid(item.location_id) === extractUuid(purchaseReceivingLocationId),
  );
  const stockControlInventoryItems = allActiveInventoryItems.filter((item) => {
    const itemLocationId = extractUuid(item.location_id);

    if (stockControlLocationId) {
      return itemLocationId === extractUuid(stockControlLocationId);
    }

    if (isKitchenFocus || isChefFocus || isBarFocus) {
      return scopedStockControlLocationIds.has(itemLocationId);
    }

    return stockControlLocations.some(
      (location) => extractUuid(location.id) === itemLocationId,
    );
  });
  const selectedStockControlLocation = activeLocations.find(
    (location) => extractUuid(location.id) === extractUuid(stockControlLocationId),
  );
  const highValueStockControlItemCount = stockControlInventoryItems.filter(
    (item) => item.is_high_value,
  ).length;
  const countedStockCountLineCount = stockCountRows.filter(
    (row) => extractUuid(row.inventoryItemId) && row.countedQuantity.trim() !== "",
  ).length;
  const fullStockCountRows = stockControlLocationId
    ? [...stockControlInventoryItems].sort((leftItem, rightItem) =>
        String(leftItem.name ?? leftItem.sku ?? "").localeCompare(
          String(rightItem.name ?? rightItem.sku ?? ""),
        ),
      )
    : [];
  const fullStockCountLinesPayload = fullStockCountRows
    .map((item) => ({
      inventory_item_id: extractUuid(item.id),
      counted_quantity: Number(fullStockCountQuantities[extractUuid(item.id)]),
    }))
    .filter(
      (line) =>
        extractUuid(line.inventory_item_id) &&
        Number.isFinite(line.counted_quantity) &&
        line.counted_quantity >= 0,
    );
  const fullStockCountCompletedLineCount = fullStockCountRows.filter(
    (item) => fullStockCountQuantities[extractUuid(item.id)]?.trim() !== "",
  ).length;
  const fullStockCountReady =
    fullStockCountRows.length > 0 &&
    fullStockCountLinesPayload.length === fullStockCountRows.length;
  const estimatedStockCountVariance = stockCountRows.reduce((total, row) => {
    const item = allActiveInventoryItems.find(
      (inventoryItem) =>
        extractUuid(inventoryItem.id) === extractUuid(row.inventoryItemId),
    );
    const countedQuantity = Number(row.countedQuantity);

    if (!item || !Number.isFinite(countedQuantity)) {
      return total;
    }

    return total + (Number(item.on_hand_qty ?? 0) - countedQuantity) *
      Number(item.current_cost_per_base_uom ?? 0);
  }, 0);
  const highValueYieldItems = activePurchasedIngredients.filter(
    (item) => item.is_high_value,
  );
  const inventoryFilterLocations = isKitchenFocus
    ? activeLocations.filter((location) =>
        kitchenLocationIds.has(extractUuid(location.id)),
      )
    : activeLocations;
  const activeSuppliers = suppliers.filter((supplier) => supplier.is_active);
  const filteredInventoryDisplayItems = activeInventoryDisplayItems.filter((item) => {
    const assignedLocation = activeLocations.find(
      (location) => extractUuid(location.id) === extractUuid(item.location_id),
    );
    const searchValue = inventorySearch.trim().toLowerCase();
    const itemText = [
      item.name,
      item.sku,
      item.department,
      assignedLocation?.name,
      item.base_uom,
      item.on_hand_uom,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      (!searchValue || itemText.includes(searchValue)) &&
      (!inventoryLocationFilter ||
        extractUuid(item.location_id) === extractUuid(inventoryLocationFilter)) &&
      (!inventoryDepartmentFilter ||
        item.department === inventoryDepartmentFilter) &&
      (!inventoryHighValueOnly || item.is_high_value)
    );
  }).sort((leftItem, rightItem) => {
    const leftLocation = activeLocations.find(
      (location) => extractUuid(location.id) === extractUuid(leftItem.location_id),
    );
    const rightLocation = activeLocations.find(
      (location) => extractUuid(location.id) === extractUuid(rightItem.location_id),
    );
    const leftIsStockHolding =
      leftLocation &&
      stockHoldingLocationIds.has(extractUuid(leftLocation.id)) &&
      !isDepartmentStockLocation(leftLocation);
    const rightIsStockHolding =
      rightLocation &&
      stockHoldingLocationIds.has(extractUuid(rightLocation.id)) &&
      !isDepartmentStockLocation(rightLocation);
    const leftIdentity = `${leftItem.sku || leftItem.name || ""}`.toLowerCase();
    const rightIdentity = `${rightItem.sku || rightItem.name || ""}`.toLowerCase();

    if (leftIdentity !== rightIdentity) {
      return leftIdentity.localeCompare(rightIdentity);
    }

    if (leftIsStockHolding !== rightIsStockHolding) {
      return leftIsStockHolding ? -1 : 1;
    }

    return (leftLocation?.name ?? "").localeCompare(rightLocation?.name ?? "");
  });
  const recipeComponentInventoryItems = activeInventoryDisplayItems;
  const activeInventoryItemsById = new Map(
    activeInventoryItems.map((item) => [extractUuid(item.id), item]),
  );
  const stockMovementPeriodStartMs =
    effectiveDateFilter === "all" ? 0 : Math.max(0, dashboardPeriodStartMs);
  const stockMovementLedger = allStockMovementLedger.filter((movement) => {
    const movementDateMs = getDateMs(movement.created_at);

    return (
      movement.inventory_item_id &&
      activeInventoryItemsById.has(extractUuid(movement.inventory_item_id)) &&
      isWithinSelectedDatePeriod(movement.created_at)
    );
  });
  const allStockMovementByItemId = allStockMovementLedger.reduce(
    (movementMap, movement) => {
      const itemId = extractUuid(movement.inventory_item_id);

      if (!itemId) {
        return movementMap;
      }

      const existingMovements = movementMap.get(itemId) ?? [];
      existingMovements.push(movement);
      movementMap.set(itemId, existingMovements);

      return movementMap;
    },
    new Map<string, StockMovementLedgerRow[]>(),
  );
  const periodStockMovementByItemId = stockMovementLedger.reduce(
    (movementMap, movement) => {
      const itemId = extractUuid(movement.inventory_item_id);

      if (!itemId) {
        return movementMap;
      }

      const existingMovements = movementMap.get(itemId) ?? [];
      existingMovements.push(movement);
      movementMap.set(itemId, existingMovements);

      return movementMap;
    },
    new Map<string, StockMovementLedgerRow[]>(),
  );
  const getMovementBucket = (movement: StockMovementLedgerRow) => {
    const normalizedType = movement.event_type.toLowerCase();

    if (normalizedType.includes("production")) {
      return "production" as const;
    }

    if (normalizedType.includes("waste")) {
      return "waste" as const;
    }

    if (normalizedType.includes("sales_depletion")) {
      return "sales" as const;
    }

    if (
      normalizedType.includes("stock_count_adjustment") ||
      normalizedType.includes("adjustment")
    ) {
      return "adjustment" as const;
    }

    return "other" as const;
  };
  const stockMovementSummaryRows = filteredInventoryDisplayItems
    .map((item) => {
      const itemId = extractUuid(item.id);
      const allItemMovements = allStockMovementByItemId.get(itemId) ?? [];
      const periodItemMovements = periodStockMovementByItemId.get(itemId) ?? [];
      const movementAfterPeriodStart = allItemMovements
        .filter(
          (movement) =>
            effectiveDateFilter === "all" ||
            getDateMs(movement.created_at) >= stockMovementPeriodStartMs,
        )
        .reduce((total, movement) => total + movement.movement_qty, 0);
      const openingQty =
        effectiveDateFilter === "all"
          ? Number(item.on_hand_qty ?? 0) -
            allItemMovements.reduce(
              (total, movement) => total + movement.movement_qty,
              0,
            )
          : Number(item.on_hand_qty ?? 0) - movementAfterPeriodStart;
      const inflowQty = periodItemMovements.reduce(
        (total, movement) =>
          movement.movement_qty > 0 ? total + movement.movement_qty : total,
        0,
      );
      const outflowQty = periodItemMovements.reduce(
        (total, movement) =>
          movement.movement_qty < 0
            ? total + Math.abs(movement.movement_qty)
            : total,
        0,
      );
      const closingQty = openingQty + inflowQty - outflowQty;
      const unitCost = Number(item.current_cost_per_base_uom ?? 0);
      const closingStockValue = closingQty * unitCost;
      const movementBuckets = periodItemMovements.reduce(
        (buckets, movement) => {
          const bucket = getMovementBucket(movement);
          const movementQty = Number(movement.movement_qty ?? 0);

          if (bucket === "waste" || bucket === "sales") {
            buckets[bucket] += Math.abs(movementQty);
          } else {
            buckets[bucket] += movementQty;
          }

          return buckets;
        },
        {
          production: 0,
          waste: 0,
          sales: 0,
          adjustment: 0,
          other: 0,
        },
      );

      return {
        item,
        itemId,
        openingQty,
        inflowQty,
        outflowQty,
        closingQty,
        movementCount: periodItemMovements.length,
        movementBuckets,
        unitCost,
        closingStockValue,
      };
    })
    .filter(
      (row) =>
        row.movementCount > 0 ||
        Math.abs(Number(row.item.on_hand_qty ?? 0)) > 0.0001,
    );
  const selectedMovementItem =
    selectedMovementInventoryItemId &&
    activeInventoryItemsById.get(extractUuid(selectedMovementInventoryItemId));
  const selectedMovementAuditRows = selectedMovementItem
    ? (periodStockMovementByItemId.get(extractUuid(selectedMovementItem.id)) ?? [])
        .slice()
        .sort(
          (leftMovement, rightMovement) =>
            getDateMs(rightMovement.created_at) -
            getDateMs(leftMovement.created_at),
        )
    : [];
  const formatMovementType = (eventType: string) =>
    eventType.replaceAll("_", " ").replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    );
  const getMovementToneClass = (eventType: string) => {
    const normalizedType = eventType.toLowerCase();

    if (
      normalizedType.includes("waste") ||
      normalizedType.includes("sales_depletion") ||
      normalizedType.includes("stock_count_adjustment")
    ) {
      return "border-status-critical-border bg-status-critical-bg text-status-critical-text";
    }

    if (
      normalizedType.includes("production") ||
      normalizedType.includes("receipt") ||
      normalizedType.includes("receive")
    ) {
      return "border-accent-muted-border bg-accent-muted-bg text-accent";
    }

    return "border-status-info-border bg-status-info-bg text-status-info-text";
  };
  const allInventoryItemsById = new Map(
    inventoryItems.map((item) => [extractUuid(item.id), item]),
  );
  const resolveInventoryItemForLocation = (
    inventoryItemId: string | null | undefined,
    locationId: string | null | undefined,
    options: {
      componentRecipeId?: string | null;
      ingredientName?: string | null;
    } = {},
  ) => {
    const sourceItem = allInventoryItemsById.get(extractUuid(inventoryItemId));
    const targetLocationId = extractUuid(locationId);
    const fallbackRecipeId = extractUuid(options.componentRecipeId);
    const fallbackIngredientName = String(options.ingredientName ?? "")
      .trim()
      .toLowerCase();

    if (!targetLocationId) {
      return sourceItem;
    }

    const sourceOriginId =
      extractUuid(sourceItem?.origin_inventory_item_id) ||
      extractUuid(sourceItem?.id);
    const sourceSku = sourceItem?.sku?.trim().toLowerCase() ?? "";
    const sourceRecipeId = extractUuid(sourceItem?.recipe_id) || fallbackRecipeId;

    return (
      inventoryItems.find((item) => {
        if (
          !item.is_active ||
          extractUuid(item.location_id) !== targetLocationId
        ) {
          return false;
        }

        return Boolean(sourceRecipeId && extractUuid(item.recipe_id) === sourceRecipeId);
      }) ??
      inventoryItems.find((item) => {
        if (
          !item.is_active ||
          extractUuid(item.location_id) !== targetLocationId
        ) {
          return false;
        }

        const itemOriginId =
          extractUuid(item.origin_inventory_item_id) || extractUuid(item.id);
        const itemSku = item.sku?.trim().toLowerCase() ?? "";

        return (
          itemOriginId === sourceOriginId ||
          extractUuid(item.id) === sourceOriginId ||
          (sourceSku && itemSku === sourceSku)
        );
      }) ??
      inventoryItems.find((item) => {
        if (
          !item.is_active ||
          extractUuid(item.location_id) !== targetLocationId ||
          !fallbackIngredientName
        ) {
          return false;
        }

        return (
          item.cost_type === "manufactured" &&
          String(item.name ?? "").trim().toLowerCase() === fallbackIngredientName
        );
      }) ?? sourceItem
    );
  };
  const resolveSalesImportRowLocation = (row: SalesImportPreviewRow) => {
    const matchedSourceLocation = departmentStockLocations.find(
      (location) =>
        row.sourceLocationName &&
        location.name.trim().toLowerCase() ===
          row.sourceLocationName.trim().toLowerCase(),
    );
    const rowLocationId =
      extractUuid(matchedSourceLocation?.id) || selectedSaleLocationId;

    return activeLocations.find(
      (location) => extractUuid(location.id) === extractUuid(rowLocationId),
    );
  };
  const getSalesImportDepletionMode = (row: SalesImportPreviewRow) => {
    if (row.error || !row.recipeId) {
      return {
        label: "Needs mapping",
        detail: "Map before import",
        badgeClass:
          "border-status-critical-border bg-status-critical-bg text-status-critical-text",
      };
    }

    const rowLocation = resolveSalesImportRowLocation(row);
    const rowLocationId = extractUuid(rowLocation?.id);
    const finishedGood = inventoryItems.find(
      (item) =>
        item.is_active &&
        item.item_type === "final_product" &&
        item.cost_type === "manufactured" &&
        extractUuid(item.recipe_id) === extractUuid(row.recipeId) &&
        extractUuid(item.location_id) === rowLocationId,
    );

    if (rowLocation?.location_type === "sales_outlet" && finishedGood) {
      return {
        label: "Finished goods",
        detail: `1-to-1 from ${rowLocation.name}`,
        badgeClass:
          "border-accent-muted-border bg-accent-muted-bg text-accent",
      };
    }

    return {
      label: "Recipe explosion",
      detail: rowLocation
        ? `Components from ${rowLocation.name}`
        : "Default depletion routing",
      badgeClass:
        "border-status-info-border bg-status-info-bg text-status-info-text",
    };
  };
  const openYieldTestNotifications = yieldTestNotifications.filter(
    (notification) => notification.status === "open",
  );
  const overdueYieldTestNotifications = openYieldTestNotifications.filter(
    (notification) => notification.notification_type === "overdue_yield_test",
  );
  const latestYieldMasterUpdateNotification = openYieldTestNotifications.find(
    (notification) => notification.notification_type === "yield_master_updated",
  );
  const selectedYieldTestItem = highValueYieldItems.find(
    (item) => extractUuid(item.id) === extractUuid(selectedYieldTestItemId),
  );
  const selectedYieldTestCount = selectedYieldTestItem
    ? yieldTestEntries.filter(
        (entry) =>
          extractUuid(entry.inventory_item_id) ===
          extractUuid(selectedYieldTestItem.id),
      ).length
    : 0;
  const manufacturedInventoryRecipes = recipesFromManufacturedInventory(
    activeInventoryItems.filter(
      (item) =>
        item.cost_type === "manufactured" &&
        (item.item_type === "semi_finished" || item.item_type === "final_product"),
    ),
  ).map((recipe) => {
    const outputItem = activeInventoryItems.find(
      (item) => extractUuid(item.recipe_id) === getRecipeId(recipe),
    );

    return {
      ...recipe,
      name:
        outputItem?.sku && outputItem.name
          ? `${outputItem.name} / ${outputItem.sku}`
          : outputItem?.sku || outputItem?.name || recipe.name,
      recipe_type:
        outputItem?.item_type === "final_product"
          ? ("final_menu_item" as const)
          : recipe.recipe_type,
    };
  });
  const productionRecipeCatalog = dedupeActiveRecipes(
    [...activeRecipes, ...manufacturedInventoryRecipes],
    recipeComponents,
  );
  const activeRecipesById = new Map(
    productionRecipeCatalog.map((recipe) => [getRecipeId(recipe), recipe]),
  );
  const productionPlanRecipeOptions = productionRecipeCatalog;
  const productionRunRecipeOptions = productionRecipeCatalog;
  const validProductionPlanRows = productionPlanRows
    .map((row) => {
      const recipe = activeRecipesById.get(extractUuid(row.recipeId));
      const targetOutputQty = Number(row.targetOutputQty);

      return {
        ...row,
        recipe,
        targetOutputQty:
          Number.isFinite(targetOutputQty) && targetOutputQty > 0
            ? targetOutputQty
            : 0,
      };
    })
    .filter((row) => row.recipe && row.targetOutputQty > 0);
  const getProductionRecipeFamily = (targetRecipe: Recipe) =>
    productionRecipeCatalog.filter(
      (recipe) =>
        recipe.recipe_type === targetRecipe.recipe_type &&
        recipe.name.trim().toLowerCase() ===
          targetRecipe.name.trim().toLowerCase(),
    );
  const getProductionRecipeBatchOutput = (recipeFamily: Recipe[]) =>
    Math.max(
      1,
      ...recipeFamily.map((recipe) =>
        Number(recipe.standard_batch_output_qty ?? 1),
      ),
    );
  const collectProductionPlanRequirements = (
    targetRecipe: Recipe,
    targetOutputQty: number,
    visitedRecipeIds = new Set<string>(),
  ): ProductionPlanRequirement[] => {
    const recipeId = getRecipeId(targetRecipe);

    if (visitedRecipeIds.has(recipeId)) {
      return [];
    }

    const nextVisitedRecipeIds = new Set(visitedRecipeIds);
    nextVisitedRecipeIds.add(recipeId);

    const recipeFamily = getProductionRecipeFamily(targetRecipe);
    const recipeIds = recipeFamily.map(getRecipeId);
    const batchOutput = getProductionRecipeBatchOutput(recipeFamily);
    const outputRatio = targetOutputQty / batchOutput;

    return dedupeRecipeComponentsByIngredient(
      recipeComponents.filter((component) =>
        recipeIds.includes(extractUuid(component.recipe_id)),
      ),
    ).flatMap((component) => {
      const inventoryItemId = extractUuid(component.component_inventory_item_id);
      const inventoryItem = activeInventoryItemsById.get(inventoryItemId);
      const linkedRecipe =
        activeRecipesById.get(extractUuid(component.component_recipe_id)) ??
        activeRecipesById.get(extractUuid(inventoryItem?.recipe_id));
      const requiredQty = Number(component.qty_in_recipe_uom ?? 0) * outputRatio;

      if (linkedRecipe && requiredQty > 0) {
        return collectProductionPlanRequirements(
          linkedRecipe,
          requiredQty,
          nextVisitedRecipeIds,
        );
      }

      if (!inventoryItemId || requiredQty <= 0) {
        return [];
      }

      const unitCost = Number(
        inventoryItem?.current_cost_per_base_uom ??
          component.ingredient_unit_cost ??
          0,
      );
      const onHandQty = Number(inventoryItem?.on_hand_qty ?? 0);

      return [
        {
          id: `${recipeId}-${component.id}-${inventoryItemId}`,
          inventoryItemId,
          ingredientName:
            inventoryItem?.name ?? component.ingredient_name ?? "Ingredient",
          uom:
            inventoryItem?.on_hand_uom ??
            inventoryItem?.base_uom ??
            component.recipe_uom ??
            "unit",
          requiredQty,
          onHandQty,
          shortageQty: Math.max(requiredQty - onHandQty, 0),
          unitCost,
          estimatedCost: requiredQty * unitCost,
          sourceRecipes: [targetRecipe.name],
        },
      ];
    });
  };
  const productionPlanRequirements = Array.from(
    validProductionPlanRows
      .flatMap((row) =>
        row.recipe
          ? collectProductionPlanRequirements(row.recipe, row.targetOutputQty)
          : [],
      )
      .reduce((requirementsByItem, requirement) => {
        const existingRequirement = requirementsByItem.get(
          requirement.inventoryItemId,
        );

        if (existingRequirement) {
          existingRequirement.requiredQty += requirement.requiredQty;
          existingRequirement.shortageQty = Math.max(
            existingRequirement.requiredQty - existingRequirement.onHandQty,
            0,
          );
          existingRequirement.estimatedCost += requirement.estimatedCost;
          existingRequirement.sourceRecipes = Array.from(
            new Set([
              ...existingRequirement.sourceRecipes,
              ...requirement.sourceRecipes,
            ]),
          );
        } else {
          requirementsByItem.set(requirement.inventoryItemId, {
            ...requirement,
          });
        }

        return requirementsByItem;
      }, new Map<string, ProductionPlanRequirement>())
      .values(),
  ).sort((leftRequirement, rightRequirement) => {
    if (rightRequirement.shortageQty !== leftRequirement.shortageQty) {
      return rightRequirement.shortageQty - leftRequirement.shortageQty;
    }

    return rightRequirement.estimatedCost - leftRequirement.estimatedCost;
  });
  const productionPlanEstimatedCost = productionPlanRequirements.reduce(
    (total, requirement) => total + requirement.estimatedCost,
    0,
  );
  const productionPlanShortageCount = productionPlanRequirements.filter(
    (requirement) => requirement.shortageQty > 0,
  ).length;
  const productionPlanShortageValue = productionPlanRequirements.reduce(
    (total, requirement) =>
      total + requirement.shortageQty * requirement.unitCost,
    0,
  );
  const productionPlanRequisitionDraftLines = productionPlanRequirements
    .map((requirement) => {
      const requestedQty =
        productionPlanRequisitionMode === "shortage"
          ? requirement.shortageQty
          : requirement.requiredQty;
      const sourceItem = resolveInventoryItemForLocation(
        requirement.inventoryItemId,
        productionPlanRequisitionFromLocationId,
        { ingredientName: requirement.ingredientName },
      );
      const sourceItemLocationId = extractUuid(sourceItem?.location_id);
      const selectedSourceLocationId = extractUuid(
        productionPlanRequisitionFromLocationId,
      );
      const sourceMatches =
        !selectedSourceLocationId ||
        sourceItemLocationId === selectedSourceLocationId;

      return {
        requirement,
        sourceItem,
        requestedQty,
        sourceMatches,
      };
    })
    .filter(
      (line) =>
        line.requestedQty > 0 &&
        line.sourceItem &&
        line.sourceMatches,
    );
  const productionPlanUnmatchedRequisitionCount =
    productionPlanRequirements.length - productionPlanRequisitionDraftLines.length;
  const canConvertProductionPlanToRequisition =
    productionPlanRequisitionDraftLines.length > 0 &&
    Boolean(productionPlanRequisitionFromLocationId) &&
    Boolean(productionPlanRequisitionToLocationId);
  const selectedProductionRecipe = productionRunRecipeOptions.find(
    (recipe) => getRecipeId(recipe) === selectedProductionRecipeId,
  );
  const selectedProductionIsFinalMenu =
    Boolean(selectedProductionRecipe) &&
    selectedProductionRecipe?.recipe_type !== "sub_recipe";
  const defaultProductionOutputLocationId =
    selectedProductionIsFinalMenu
      ? extractUuid(defaultSalesOutletLocation?.id)
      : "";
  const resolvedProductionOutputLocationId = defaultProductionOutputLocationId;
  const selectedProductionOutputLocation = activeLocations.find(
    (location) =>
      extractUuid(location.id) === extractUuid(resolvedProductionOutputLocationId),
  );
  const selectedProductionFinishedGood = selectedProductionIsFinalMenu
    ? inventoryItems.find(
        (item) =>
          item.is_active &&
          item.item_type === "final_product" &&
          item.cost_type === "manufactured" &&
          extractUuid(item.recipe_id) === extractUuid(selectedProductionRecipeId) &&
          extractUuid(item.location_id) ===
            extractUuid(resolvedProductionOutputLocationId),
      )
    : null;
  const targetOutputQty = Number(targetProductionOutput);
  const hasValidTargetOutput =
    Number.isFinite(targetOutputQty) && targetOutputQty > 0;
  const selectedProductionRecipeIds = selectedProductionRecipe
    ? productionRecipeCatalog
        .filter(
          (recipe) =>
            recipe.recipe_type === selectedProductionRecipe.recipe_type &&
            recipe.name.trim().toLowerCase() ===
              selectedProductionRecipe.name.trim().toLowerCase(),
        )
        .map(getRecipeId)
    : [];
  const selectedProductionRecipeFamily = selectedProductionRecipe
    ? productionRecipeCatalog.filter(
        (recipe) =>
          recipe.recipe_type === selectedProductionRecipe.recipe_type &&
          recipe.name.trim().toLowerCase() ===
            selectedProductionRecipe.name.trim().toLowerCase(),
      )
    : [];
  const productionComponents = selectedProductionRecipe
    ? dedupeRecipeComponentsByIngredient(
        recipeComponents.filter(
          (component) =>
            selectedProductionRecipeIds.includes(
              extractUuid(component.recipe_id),
            ) && component.component_inventory_item_id,
        ),
      )
    : [];
  const selectedRecipeBatchOutput = Math.max(
    1,
    ...selectedProductionRecipeFamily.map((recipe) =>
      Number(recipe.standard_batch_output_qty ?? 1),
    ),
  );
  const actualComponentUsages = productionComponents.map((component) => {
    const enteredQty = Number(actualProductionInputs[component.id]);

    return {
      component_inventory_item_id: extractUuid(
        component.component_inventory_item_id,
      ),
      actual_qty_used:
        Number.isFinite(enteredQty) && enteredQty >= 0 ? enteredQty : null,
    };
  });
  const hasActualProductionUsageInputs =
    productionComponents.length > 0 &&
    productionComponents.every((component) => {
      const enteredQty = Number(actualProductionInputs[component.id]);

      return Number.isFinite(enteredQty) && enteredQty >= 0;
    });
  const additionalProductionRunLinePayloads = additionalProductionRunRows
    .filter((row) => row.recipeId || row.targetOutputQty)
    .map((row) => {
      const rowRecipe = productionRunRecipeOptions.find(
        (recipe) => getRecipeId(recipe) === row.recipeId,
      );
      const rowOutputQty = Number(row.targetOutputQty);
      const rowIsFinalMenu =
        Boolean(rowRecipe) && rowRecipe?.recipe_type !== "sub_recipe";
      const rowRecipeFamily = rowRecipe
        ? productionRecipeCatalog.filter(
            (recipe) =>
              recipe.recipe_type === rowRecipe.recipe_type &&
              recipe.name.trim().toLowerCase() ===
                rowRecipe.name.trim().toLowerCase(),
          )
        : [];
      const rowRecipeIds = rowRecipeFamily.map(getRecipeId);
      const rowBatchOutput = Math.max(
        1,
        ...rowRecipeFamily.map((recipe) =>
          Number(recipe.standard_batch_output_qty ?? 1),
        ),
      );
      const rowComponents = rowRecipe
        ? dedupeRecipeComponentsByIngredient(
            recipeComponents.filter(
              (component) =>
                rowRecipeIds.includes(extractUuid(component.recipe_id)) &&
                component.component_inventory_item_id,
            ),
          )
        : [];

      return {
        id: row.id,
        target_recipe_id: extractUuid(row.recipeId),
        target_output_quantity: rowOutputQty,
        actual_output_quantity: rowOutputQty,
        production_origin: "kitchen_prep_line",
        output_location_id_value: rowIsFinalMenu
          ? extractUuid(defaultSalesOutletLocation?.id)
          : null,
        actual_component_usages: rowComponents.map((component) => ({
          component_inventory_item_id: extractUuid(
            component.component_inventory_item_id,
          ),
          actual_qty_used:
            Number.isFinite(rowOutputQty) && rowOutputQty > 0
              ? (component.qty_in_recipe_uom / rowBatchOutput) * rowOutputQty
              : null,
        })),
      };
    });
  const productionRunLinePayloads =
    selectedProductionRecipe && hasValidTargetOutput
      ? [
          {
            target_recipe_id: extractUuid(selectedProductionRecipeId),
            target_output_quantity: targetOutputQty,
            actual_output_quantity: targetOutputQty,
            production_origin: "kitchen_prep_line",
            output_location_id_value: selectedProductionIsFinalMenu
              ? resolvedProductionOutputLocationId
              : null,
            actual_component_usages: actualComponentUsages,
          },
          ...additionalProductionRunLinePayloads.map((line) => ({
            target_recipe_id: line.target_recipe_id,
            target_output_quantity: line.target_output_quantity,
            actual_output_quantity: line.actual_output_quantity,
            production_origin: line.production_origin,
            output_location_id_value: line.output_location_id_value,
            actual_component_usages: line.actual_component_usages,
          })),
        ]
      : [];
  const hasInvalidAdditionalProductionRunLine =
    additionalProductionRunLinePayloads.some(
      (line) =>
        !line.target_recipe_id ||
        !Number.isFinite(line.target_output_quantity) ||
        line.target_output_quantity <= 0 ||
        line.actual_component_usages.length === 0 ||
        line.actual_component_usages.some(
          (usage) =>
            !usage.component_inventory_item_id ||
            usage.actual_qty_used === null ||
            !Number.isFinite(usage.actual_qty_used) ||
            usage.actual_qty_used < 0,
        ) ||
        (productionRunRecipeOptions.find(
          (recipe) => getRecipeId(recipe) === line.target_recipe_id,
        )?.recipe_type !== "sub_recipe" &&
          !line.output_location_id_value),
    );
  const canRecordProduction =
    !productionSaving &&
    canRecordOperations &&
    Boolean(selectedProductionRecipe) &&
    hasValidTargetOutput &&
    productionComponents.length > 0 &&
    hasActualProductionUsageInputs &&
    !hasInvalidAdditionalProductionRunLine &&
    (!selectedProductionIsFinalMenu ||
      Boolean(resolvedProductionOutputLocationId));
  const selectedSaleRecipe = activeFinalMenuItems.find(
    (recipe) => getRecipeId(recipe) === selectedSaleRecipeId,
  );
  const saleQty = Number(saleQuantity);
  const hasValidSaleQty = Number.isFinite(saleQty) && saleQty > 0;
  const selectedSaleRecipeIds = selectedSaleRecipe
    ? activeRecipes
        .filter(
          (recipe) =>
            recipe.recipe_type === selectedSaleRecipe.recipe_type &&
            recipe.name.trim().toLowerCase() ===
              selectedSaleRecipe.name.trim().toLowerCase(),
        )
        .map(getRecipeId)
    : [];
  const selectedSaleRecipeFamily = selectedSaleRecipe
    ? activeRecipes.filter(
        (recipe) =>
          recipe.recipe_type === selectedSaleRecipe.recipe_type &&
          recipe.name.trim().toLowerCase() ===
            selectedSaleRecipe.name.trim().toLowerCase(),
      )
    : [];
  const saleComponents = selectedSaleRecipe
    ? dedupeRecipeComponentsByIngredient(
        recipeComponents.filter(
          (component) =>
            selectedSaleRecipeIds.includes(extractUuid(component.recipe_id)) &&
            (component.component_inventory_item_id || component.component_recipe_id),
        ),
      )
    : [];
  const selectedSaleBatchOutput = Math.max(
    1,
    ...selectedSaleRecipeFamily.map((recipe) =>
      Number(recipe.standard_batch_output_qty ?? 1),
    ),
  );
  const salesCaptureModeLabel =
    salesCaptureMode === "manual_sales"
      ? "Manual sales mode"
      : salesCaptureMode === "test_mode"
        ? "Test mode"
        : "POS import mode";
  const manualSalesAllowed =
    salesCaptureMode === "manual_sales" || salesCaptureMode === "test_mode";
  const posImportAllowed =
    salesCaptureMode === "pos_import" || salesCaptureMode === "test_mode";
  const canRecordSale =
    !saleSaving &&
    canRecordOperations &&
    manualSalesAllowed &&
    Boolean(selectedSaleRecipe) &&
    hasValidSaleQty &&
    saleComponents.length > 0;
  const saleFoodCost = saleComponents.reduce((totalCost, component) => {
    const item = resolveInventoryItemForLocation(
      component.component_inventory_item_id,
      selectedSaleLocationId,
      {
        componentRecipeId: component.component_recipe_id,
        ingredientName: component.ingredient_name,
      },
    );
    const requiredQty = hasValidSaleQty
      ? (component.qty_in_recipe_uom / selectedSaleBatchOutput) * saleQty
      : 0;
    const unitCost = Number(
      item?.current_cost_per_base_uom ?? component.ingredient_unit_cost ?? 0,
    );

    return totalCost + requiredQty * unitCost;
  }, 0);
  const saleRevenue =
    hasValidSaleQty && selectedSaleRecipe
      ? saleQty * Number(selectedSaleRecipe.selling_price ?? 0)
      : 0;
  const saleGrossProfit = saleRevenue - saleFoodCost;
  const saleGrossMarginPct =
    saleRevenue > 0 ? (saleGrossProfit / saleRevenue) * 100 : null;
  const menuSaleSummaries = Array.from(
    menuSaleHistory
      .slice(0, 60)
      .reduce(
        (salesById, row) => {
          const existingSale = salesById.get(row.menu_sale_id);

          if (existingSale) {
            existingSale.rows.push(row);
            existingSale.foodCost += row.cost_impact;
          } else {
            salesById.set(row.menu_sale_id, {
              ...row,
              rows: [row],
              foodCost: row.cost_impact,
            });
          }

          return salesById;
        },
        new Map<
          string,
          MenuSaleHistoryRow & {
            rows: MenuSaleHistoryRow[];
            foodCost: number;
          }
        >(),
      )
      .values(),
  );
  const totalSalesRevenue = menuSaleSummaries.reduce(
    (total, sale) => total + sale.total_revenue,
    0,
  );
  const totalSalesFoodCost = menuSaleSummaries.reduce(
    (total, sale) => total + sale.foodCost,
    0,
  );
  const totalSalesGrossProfit = totalSalesRevenue - totalSalesFoodCost;
  const totalSalesMarginPct =
    totalSalesRevenue > 0
      ? (totalSalesGrossProfit / totalSalesRevenue) * 100
      : null;
  const visibleAvtSummary = avtSummary.filter((row) =>
    isWithinSelectedDatePeriod(row.operating_date),
  );
  const avtReadyCount = visibleAvtSummary.filter(
    (row) => row.status === "ready",
  ).length;
  const avtNeedsReviewCount = visibleAvtSummary.filter(
    (row) => row.status !== "ready",
  ).length;
  const avtRevenue = visibleAvtSummary.reduce(
    (total, row) => total + row.revenue,
    0,
  );
  const avtTheoreticalCost = visibleAvtSummary.reduce(
    (total, row) => total + row.theoretical_food_cost,
    0,
  );
  const avtVarianceExposure = visibleAvtSummary.reduce(
    (total, row) => total + row.total_variance_cost,
    0,
  );
  const avtFoodCostPct =
    avtRevenue > 0
      ? ((avtTheoreticalCost + avtVarianceExposure) / avtRevenue) * 100
      : null;
  const avtConfidenceScore =
    visibleAvtSummary.length > 0
      ? visibleAvtSummary.reduce(
          (total, row) => total + Number(row.confidence_score ?? 0),
          0,
        ) / visibleAvtSummary.length
      : 0;
  const avtConfidenceStatus =
    avtConfidenceScore >= 85
      ? "high"
      : avtConfidenceScore >= 65
        ? "usable"
        : avtConfidenceScore >= 40
          ? "weak"
          : "unreliable";
  const avtConfidenceDetail =
    avtConfidenceStatus === "high"
      ? "Evidence strong"
      : avtConfidenceStatus === "usable"
        ? "Usable with review"
        : avtConfidenceStatus === "weak"
          ? "Weak evidence"
          : "Not reliable";
  const latestAvtRow = [...visibleAvtSummary].sort(
    (leftRow, rightRow) =>
      new Date(rightRow.operating_date).getTime() -
      new Date(leftRow.operating_date).getTime(),
  )[0];
  const avtReadinessLabel =
    visibleAvtSummary.length === 0
      ? "Awaiting sales evidence"
      : avtNeedsReviewCount > 0
        ? `${avtNeedsReviewCount.toLocaleString()} period${
            avtNeedsReviewCount === 1 ? "" : "s"
          } provisional`
        : "Ready for review";
  const productionLossImpact = productionHistory.reduce(
    (total, row) => total + Math.max(row.naira_loss, 0),
    0,
  );
  const stockLossImpact = stockVarianceHistory.reduce(
    (total, row) => total + Math.max(row.hard_currency_impact, 0),
    0,
  );
  const productionGapWasteRows: WasteHistoryRow[] = productionHistory
    .filter((row) => Number(row.output_variance_qty ?? 0) > 0)
    .map((row) => {
      const wasteCost = Math.max(Number(row.naira_loss ?? 0), 0);

      return {
        waste_event_id: `production-gap-${row.production_run_id}-${row.ingredient_name}`,
        created_at: row.created_at,
        ingredient_name: row.recipe_name,
        quantity: Number(row.output_variance_qty ?? 0),
        uom: row.output_uom,
        unit_cost:
          Number(row.output_variance_qty ?? 0) > 0
            ? wasteCost / Number(row.output_variance_qty ?? 1)
            : 0,
        waste_cost: wasteCost,
        waste_reason: "production_gap",
        waste_stage: "production",
        notes: `${row.ingredient_name} usage should have produced ${Number(
          row.expected_output_from_actual_qty ?? 0,
        ).toLocaleString(undefined, {
          maximumFractionDigits: 3,
        })} ${row.output_uom ?? "unit"}.`,
      };
    });
  const wasteExposureRows = [...wasteHistory, ...productionGapWasteRows];
  const directWasteImpact = wasteExposureRows.reduce(
    (total, row) => total + Math.max(row.waste_cost, 0),
    0,
  );
  const wasteByReason = Array.from(
    wasteExposureRows
      .reduce(
        (reasons, row) => {
          const key = row.waste_reason || "other";
          const existingReason = reasons.get(key);

          if (existingReason) {
            existingReason.quantity += row.quantity;
            existingReason.cost += row.waste_cost;
            existingReason.count += 1;
          } else {
            reasons.set(key, {
              name: key,
              quantity: row.quantity,
              cost: row.waste_cost,
              count: 1,
            });
          }

          return reasons;
        },
        new Map<
          string,
          { name: string; quantity: number; cost: number; count: number }
        >(),
      )
      .values(),
  ).sort((leftReason, rightReason) => rightReason.cost - leftReason.cost);
  const wasteByStage = Array.from(
    wasteExposureRows
      .reduce(
        (stages, row) => {
          const key = row.waste_stage || "unknown";
          const existingStage = stages.get(key);

          if (existingStage) {
            existingStage.quantity += row.quantity;
            existingStage.cost += row.waste_cost;
            existingStage.count += 1;
          } else {
            stages.set(key, {
              name: key,
              quantity: row.quantity,
              cost: row.waste_cost,
              count: 1,
            });
          }

          return stages;
        },
        new Map<
          string,
          { name: string; quantity: number; cost: number; count: number }
        >(),
      )
      .values(),
  ).sort((leftStage, rightStage) => rightStage.cost - leftStage.cost);
  const costEventPriceMovements = costEvents
    .map((event) => {
      const inventoryItemId = extractUuid(event.inventory_item_id);
      const item = activeInventoryItemsById.get(inventoryItemId);
      const oldCost = Number(event.old_cost ?? 0);
      const newCost = Number(event.new_cost ?? 0);
      const costDelta = newCost - oldCost;
      const changePct = oldCost > 0 ? (costDelta / oldCost) * 100 : null;
      const correctionFactor =
        oldCost > 0 && newCost > 0
          ? Math.max(oldCost, newCost) / Math.min(oldCost, newCost)
          : 1;
      const isLikelyUnitCostCorrection = correctionFactor >= 10;
      const onHandQty = Number(item?.on_hand_qty ?? 0);
      const onHandImpact = costDelta * onHandQty;

      return {
        ...event,
        item,
        inventoryItemId,
        oldCost,
        newCost,
        costDelta,
        changePct,
        isLikelyUnitCostCorrection,
        onHandQty,
        onHandImpact,
      };
    })
    .filter(
      (event) =>
        event.item &&
        event.item.cost_type === "purchased" &&
        event.reason === "ingredient_price_change" &&
        !extractUuid(event.recipe_id) &&
        !event.isLikelyUnitCostCorrection &&
        event.oldCost !== event.newCost,
    );
  const getInventoryPriceIdentity = (inventoryItemId: string | null | undefined) => {
    const itemId = extractUuid(inventoryItemId);
    const item =
      allInventoryItemsById.get(itemId) ?? activeInventoryItemsById.get(itemId);
    const originId = extractUuid(item?.origin_inventory_item_id);
    const recipeId = extractUuid(item?.recipe_id);
    const sku = String(item?.sku ?? "").trim().toLowerCase();
    const name = String(item?.name ?? "").trim().toLowerCase();

    if (sku) {
      return `sku:${sku}`;
    }

    if (originId) {
      return `origin:${originId}`;
    }

    if (recipeId) {
      return `recipe:${recipeId}`;
    }

    if (name) {
      return `name:${String(item?.cost_type ?? "unknown")}:${name}`;
    }

    return `id:${itemId}`;
  };
  const purchaseOrderPriceMovementEvents = Array.from(
    purchaseOrderLines
      .filter((line) => extractUuid(line.inventory_item_id))
      .reduce((linesByItem, line) => {
        const itemKey = getInventoryPriceIdentity(line.inventory_item_id);
        const currentLines = linesByItem.get(itemKey) ?? [];
        currentLines.push(line);
        linesByItem.set(itemKey, currentLines);
        return linesByItem;
      }, new Map<string, PurchaseOrderLine[]>())
      .entries(),
  ).flatMap(([, lines]) => {
    const sortedLines = [...lines].sort(
      (leftLine, rightLine) =>
        getDateMs(leftLine.created_at) - getDateMs(rightLine.created_at),
    );

    return sortedLines.slice(1).flatMap((line, index) => {
      const previousLine = sortedLines[index];
      const oldCost = Number(previousLine?.landed_unit_cost ?? 0);
      const newCost = Number(line.landed_unit_cost ?? 0);

      if (oldCost <= 0 || newCost <= 0 || oldCost === newCost) {
        return [];
      }

      const order = allPurchaseOrders.find(
        (purchaseOrder) => purchaseOrder.id === line.purchase_order_id,
      );
      const inventoryItemId = extractUuid(line.inventory_item_id);

      return [
        {
          id: `po-price-${line.id}`,
          organization_id: organization.id,
          inventory_item_id: inventoryItemId,
          recipe_id: null,
          old_cost: oldCost,
          new_cost: newCost,
          reason: "purchase_order_price_change",
          created_at: line.created_at,
          supplierName: order?.supplier_name ?? null,
          purchaseOrderId: line.purchase_order_id,
          purchaseOrderLineId: line.id,
        } satisfies ProcurementPriceMovement,
      ];
    });
  });
  const ingredientPriceMovements = [
    ...costEventPriceMovements,
    ...purchaseOrderPriceMovementEvents.map((event) => {
      const inventoryItemId = extractUuid(event.inventory_item_id);
      const item =
        activeInventoryItemsById.get(inventoryItemId) ??
        allInventoryItemsById.get(inventoryItemId);
      const oldCost = Number(event.old_cost ?? 0);
      const newCost = Number(event.new_cost ?? 0);
      const costDelta = newCost - oldCost;
      const changePct = oldCost > 0 ? (costDelta / oldCost) * 100 : null;
      const onHandQty = Number(item?.on_hand_qty ?? 0);

      return {
        ...event,
        item,
        inventoryItemId,
        oldCost,
        newCost,
        costDelta,
        changePct,
        isLikelyUnitCostCorrection: false,
        onHandQty,
        onHandImpact: costDelta * onHandQty,
      };
    }).filter((event) => event.item && event.item.cost_type === "purchased"),
  ].sort((leftEvent, rightEvent) => getDateMs(rightEvent.created_at) - getDateMs(leftEvent.created_at));
  const priceIncreaseMovements = ingredientPriceMovements.filter(
    (event) => event.costDelta > 0,
  );
  const priceDecreaseMovements = ingredientPriceMovements.filter(
    (event) => event.costDelta < 0,
  );
  const totalPriceMovementImpact = ingredientPriceMovements.reduce(
    (total, event) => total + event.onHandImpact,
    0,
  );
  const priceIncreaseImpact = priceIncreaseMovements.reduce(
    (total, event) => total + Math.max(event.onHandImpact, 0),
    0,
  );
  const priceDecreaseRelief = Math.abs(
    priceDecreaseMovements.reduce(
      (total, event) => total + Math.min(event.onHandImpact, 0),
      0,
    ),
  );
  const largestPriceMover = [...ingredientPriceMovements].sort(
    (leftEvent, rightEvent) =>
      Math.abs(rightEvent.changePct ?? rightEvent.costDelta) -
      Math.abs(leftEvent.changePct ?? leftEvent.costDelta),
  )[0];
  const largestPriceIncreaseMover = [...priceIncreaseMovements].sort(
    (leftEvent, rightEvent) =>
      Math.abs(rightEvent.changePct ?? rightEvent.costDelta) -
      Math.abs(leftEvent.changePct ?? leftEvent.costDelta),
  )[0];
  const menuPerformance = Array.from(
    menuSaleSummaries
      .reduce(
        (itemsByName, sale) => {
          const existingItem = itemsByName.get(sale.recipe_name);

          if (existingItem) {
            existingItem.quantity += sale.sold_quantity;
            existingItem.revenue += sale.total_revenue;
            existingItem.foodCost += sale.foodCost;
          } else {
            itemsByName.set(sale.recipe_name, {
              name: sale.recipe_name,
              quantity: sale.sold_quantity,
              revenue: sale.total_revenue,
              foodCost: sale.foodCost,
            });
          }

          return itemsByName;
        },
        new Map<
          string,
          {
            name: string;
            quantity: number;
            revenue: number;
            foodCost: number;
          }
        >(),
      )
      .values(),
  )
    .map((item) => {
      const grossProfit = item.revenue - item.foodCost;

      return {
        ...item,
        grossProfit,
        marginPct: item.revenue > 0 ? (grossProfit / item.revenue) * 100 : null,
        foodCostPct:
          item.revenue > 0 ? (item.foodCost / item.revenue) * 100 : null,
      };
    })
    .sort((leftItem, rightItem) => rightItem.grossProfit - leftItem.grossProfit);
  const targetMenuMarginPct = Math.min(
    Math.max(Number(systemSettings?.target_menu_margin_pct ?? 65), 0),
    100,
  );
  const targetMenuFoodCostPct = 100 - targetMenuMarginPct;
  const menuProfitabilityRows = activeFinalMenuItems
    .map((recipe) => {
      const recipeFamily = activeRecipes.filter(
        (familyRecipe) =>
          familyRecipe.recipe_type === recipe.recipe_type &&
          familyRecipe.name.trim().toLowerCase() ===
            recipe.name.trim().toLowerCase(),
      );
      const recipeIds = recipeFamily.map(getRecipeId);
      const components = dedupeRecipeComponentsByIngredient(
        recipeComponents.filter(
          (component) =>
            recipeIds.includes(extractUuid(component.recipe_id)) &&
            component.component_inventory_item_id,
        ),
      );
      const batchOutput = Math.max(
        1,
        ...recipeFamily.map((familyRecipe) =>
          Number(familyRecipe.standard_batch_output_qty ?? 1),
        ),
      );
      const unitFoodCost = components.reduce((totalCost, component) => {
        const item = activeInventoryItemsById.get(
          extractUuid(component.component_inventory_item_id),
        );
        const unitCost = Number(
          item?.current_cost_per_base_uom ?? component.ingredient_unit_cost ?? 0,
        );

        return totalCost + (component.qty_in_recipe_uom / batchOutput) * unitCost;
      }, 0);
      const sellingPrice = Number(recipe.selling_price ?? 0);
      const costPerBatch = unitFoodCost * batchOutput;
      const grossProfit = sellingPrice - unitFoodCost;
      const marginPct =
        sellingPrice > 0 ? (grossProfit / sellingPrice) * 100 : null;
      const foodCostPct =
        sellingPrice > 0 ? (unitFoodCost / sellingPrice) * 100 : null;
      const recommendedPrice =
        unitFoodCost > 0
          ? unitFoodCost / (targetMenuFoodCostPct / 100)
          : sellingPrice;
      const priceGap = recommendedPrice - sellingPrice;
      const salesPerformance = menuPerformance.find(
        (item) => item.name.trim().toLowerCase() === recipe.name.trim().toLowerCase(),
      );

      return {
        recipe,
        components,
        unitFoodCost,
        costPerBatch,
        sellingPrice,
        grossProfit,
        marginPct,
        foodCostPct,
        recommendedPrice,
        priceGap,
        soldQuantity: salesPerformance?.quantity ?? 0,
        outputUom: recipe.output_uom ?? "unit",
        batchOutput,
        status:
          sellingPrice <= 0
            ? "missing_price"
            : components.length === 0
              ? "incomplete_costing"
              : priceGap > 0.01 ||
                  (marginPct !== null && marginPct < targetMenuMarginPct)
                ? "margin_risk"
                : "protected",
      };
    })
    .sort(
      (leftItem, rightItem) =>
        Math.max(rightItem.priceGap, 0) - Math.max(leftItem.priceGap, 0),
    );
  const menuPricingGuardrails = menuProfitabilityRows.filter(
    (item) => item.components.length > 0,
  );
  const normalizedMenuProfitabilitySearch = menuProfitabilitySearch
    .trim()
    .toLowerCase();
  const filteredMenuProfitabilityRows = menuProfitabilityRows.filter((item) => {
    const matchesSearch =
      normalizedMenuProfitabilitySearch.length === 0 ||
      item.recipe.name.toLowerCase().includes(normalizedMenuProfitabilitySearch);
    const matchesFilter =
      menuProfitabilityFilter === "all" ||
      item.status === menuProfitabilityFilter;

    return matchesSearch && matchesFilter;
  });
  const menuProfitabilityTotals = menuProfitabilityRows.reduce(
    (totals, item) => ({
      total: totals.total + 1,
      marginRisk:
        totals.marginRisk + (item.status === "margin_risk" ? 1 : 0),
      protected:
        totals.protected + (item.status === "protected" ? 1 : 0),
      missingSetup:
        totals.missingSetup +
        (item.status === "missing_price" ||
        item.status === "incomplete_costing"
          ? 1
          : 0),
    }),
    { total: 0, marginRisk: 0, protected: 0, missingSetup: 0 },
  );
  const menuProfitabilityStatusLabels: Record<string, string> = {
    margin_risk: "Margin risk",
    protected: "Protected",
    missing_price: "Missing price",
    incomplete_costing: "Incomplete costing",
  };
  const menuProfitabilityStatusStyles: Record<string, string> = {
    margin_risk:
      "border-status-attention-border bg-status-attention-bg text-status-attention-text",
    protected: "border-accent-muted-border bg-accent-muted-bg text-accent",
    missing_price:
      "border-status-critical-border bg-status-critical-bg text-status-critical-text",
    incomplete_costing:
      "border-status-info-border bg-status-info-bg text-status-info-text",
  };
  const menuProfitabilityFilterOptions: Array<{
    value: MenuProfitabilityFilter;
    label: string;
  }> = [
    { value: "all", label: "All items" },
    { value: "margin_risk", label: "Margin risk" },
    { value: "protected", label: "Protected" },
    { value: "missing_price", label: "Missing price" },
    { value: "incomplete_costing", label: "Incomplete costing" },
  ];
  const underpricedMenuItems = menuPricingGuardrails.filter(
    (item) => item.priceGap > 0.01,
  );
  const protectedMenuItems = menuPricingGuardrails.filter(
    (item) => item.priceGap <= 0.01,
  );
  const menuMarginRecovery = underpricedMenuItems.reduce(
    (total, item) => total + Math.max(item.priceGap, 0) * item.soldQuantity,
    0,
  );
  const marginRecoveryActions = costEvents
    .filter(
      (event) =>
        extractUuid(event.recipe_id) &&
        event.reason === "purchase_receipt_margin_recovery",
    )
    .map((event) => {
      const recipe = activeRecipesById.get(extractUuid(event.recipe_id));
      const item = activeInventoryItemsById.get(extractUuid(event.inventory_item_id));
      const oldCost = Number(event.old_cost ?? 0);
      const newCost = Number(event.new_cost ?? 0);
      const costDelta = newCost - oldCost;
      const sellingPrice = Number(recipe?.selling_price ?? 0);
      const currentMarginPct =
        sellingPrice > 0 ? ((sellingPrice - newCost) / sellingPrice) * 100 : null;
      const targetPrice =
        newCost > 0 ? newCost / (targetMenuFoodCostPct / 100) : sellingPrice;
      const priceGap = Math.max(targetPrice - sellingPrice, 0);
      const isFinalMenu =
        recipe?.recipe_type === "final_menu_item" ||
        recipe?.recipe_type === "final_dish";
      const needsPriceRecovery =
        isFinalMenu &&
        priceGap > 0.01 &&
        (currentMarginPct === null || currentMarginPct < targetMenuMarginPct);
      const responsibleRole = needsPriceRecovery
        ? "Owner / Finance"
        : costDelta > 0
          ? "Procurement"
          : "Operations";
      const recommendedAction = needsPriceRecovery
        ? `Approve menu price to ${organization.local_currency} ${targetPrice.toLocaleString(
            undefined,
            { maximumFractionDigits: 2 },
          )}`
        : costDelta > 0
          ? "Negotiate supplier price or compare alternate vendor"
          : "Watch cost relief and protect current menu price";

      return {
        id: event.id,
        createdAt: event.created_at,
        recipe,
        item,
        oldCost,
        newCost,
        costDelta,
        sellingPrice,
        currentMarginPct,
        targetPrice,
        priceGap,
        responsibleRole,
        recommendedAction,
        impact: isFinalMenu
          ? priceGap * Math.max(
              menuPerformance.find(
                (performance) =>
                  recipe &&
                  performance.name.trim().toLowerCase() ===
                    recipe.name.trim().toLowerCase(),
              )?.quantity ?? 30,
              1,
            )
          : Math.max(costDelta, 0),
      };
    })
    .sort((leftAction, rightAction) => rightAction.impact - leftAction.impact);
  const selectedPricingSimulationItem =
    selectedPricingSimulationRecipeId.length > 0
      ? menuPricingGuardrails.find(
          (item) =>
            getRecipeId(item.recipe) ===
            extractUuid(selectedPricingSimulationRecipeId),
        )
      : undefined;
  const simulatedPricingItem =
    selectedPricingSimulationItem ??
    underpricedMenuItems[0] ??
    menuPricingGuardrails[0];
  const simulationPct = Number(priceSimulationPct);
  const normalizedSimulationPct =
    Number.isFinite(simulationPct) && simulationPct > -95 ? simulationPct : 0;
  const simulatedPrice = simulatedPricingItem
    ? simulatedPricingItem.sellingPrice * (1 + normalizedSimulationPct / 100)
    : 0;
  const simulatedPriceDelta = simulatedPricingItem
    ? simulatedPrice - simulatedPricingItem.sellingPrice
    : 0;
  const simulatedMarginPct =
    simulatedPricingItem && simulatedPrice > 0
      ? ((simulatedPrice - simulatedPricingItem.unitFoodCost) / simulatedPrice) *
        100
      : null;
  const simulatedSelectedPeriodImpact = simulatedPricingItem
    ? simulatedPriceDelta * simulatedPricingItem.soldQuantity
    : 0;
  const selectedPriceMovement = ingredientPriceMovements.find(
    (event) => event.id === selectedPriceMovementId,
  );
  const macroCascadePriceMover =
    selectedPriceMovement ?? largestPriceIncreaseMover ?? largestPriceMover;
  const activePriceMovementId = macroCascadePriceMover?.id ?? "";
  const normalizeRecipeLinkName = (value: string | null | undefined) =>
    (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const getRecipeFamily = (targetRecipe: Recipe) =>
    activeRecipes.filter(
      (familyRecipe) =>
        familyRecipe.recipe_type === targetRecipe.recipe_type &&
        familyRecipe.name.trim().toLowerCase() ===
          targetRecipe.name.trim().toLowerCase(),
    );
  const getRecipeFamilyBatchOutput = (recipeFamily: Recipe[]) =>
    Math.max(
      1,
      ...recipeFamily.map((familyRecipe) =>
        Number(familyRecipe.standard_batch_output_qty ?? 1),
      ),
    );
  const calculateRecipeUnitFoodCost = (targetRecipe: Recipe) => {
    const recipeFamily = getRecipeFamily(targetRecipe);
    const recipeIds = recipeFamily.map(getRecipeId);
    const batchOutput = getRecipeFamilyBatchOutput(recipeFamily);

    return recipeComponents
      .filter((component) => recipeIds.includes(extractUuid(component.recipe_id)))
      .reduce((totalCost, component) => {
        const inventoryItem = activeInventoryItemsById.get(
          extractUuid(component.component_inventory_item_id),
        );
        const linkedRecipe = activeRecipesById.get(
          extractUuid(component.component_recipe_id),
        );
        const unitCost = Number(
          inventoryItem?.current_cost_per_base_uom ??
            component.ingredient_unit_cost ??
            linkedRecipe?.resolved_unit_cost ??
            0,
        );

        return totalCost + (component.qty_in_recipe_uom / batchOutput) * unitCost;
      }, 0);
  };
  const macroCascadeMenuImpact = macroCascadePriceMover
    ? activeFinalMenuItems
        .map((recipe) => {
          const recipeFamily = getRecipeFamily(recipe);
          const recipeIds = recipeFamily.map(getRecipeId);
          const batchOutput = getRecipeFamilyBatchOutput(recipeFamily);
          const finalRecipeComponents = recipeComponents.filter((component) =>
            recipeIds.includes(extractUuid(component.recipe_id)),
          );
          const directImpactedComponents = finalRecipeComponents.filter(
            (component) =>
              extractUuid(component.component_inventory_item_id) ===
              macroCascadePriceMover.inventoryItemId,
          );
          const subRecipeImpacts = finalRecipeComponents.flatMap((component) => {
            const componentInventoryItem = activeInventoryItemsById.get(
              extractUuid(component.component_inventory_item_id),
            );
            const componentLinkName = normalizeRecipeLinkName(
              component.ingredient_name ??
                componentInventoryItem?.name ??
                componentInventoryItem?.sku,
            );
            const linkedRecipe =
              activeRecipesById.get(extractUuid(component.component_recipe_id)) ??
              activeRecipesById.get(extractUuid(componentInventoryItem?.recipe_id)) ??
              activeSubRecipes.find((subRecipe) => {
                const subRecipeName = normalizeRecipeLinkName(subRecipe.name);

                return subRecipeName === componentLinkName;
              });

            if (!linkedRecipe) {
              return [];
            }

            const linkedRecipeFamily = getRecipeFamily(linkedRecipe);
            const linkedRecipeIds = linkedRecipeFamily.map(getRecipeId);
            const linkedBatchOutput =
              getRecipeFamilyBatchOutput(linkedRecipeFamily);
            const rawComponents = recipeComponents.filter(
              (linkedComponent) =>
                linkedRecipeIds.includes(
                  extractUuid(linkedComponent.recipe_id),
                ) &&
                extractUuid(linkedComponent.component_inventory_item_id) ===
                  macroCascadePriceMover.inventoryItemId,
            );

            if (rawComponents.length === 0) {
              return [];
            }

            const unitCostImpact = rawComponents.reduce(
              (totalCost, rawComponent) =>
                totalCost +
                (rawComponent.qty_in_recipe_uom / linkedBatchOutput) *
                  macroCascadePriceMover.costDelta,
              0,
            );
            const ingredientQtyPerOutput = rawComponents.reduce(
              (totalQty, rawComponent) =>
                totalQty + rawComponent.qty_in_recipe_uom / linkedBatchOutput,
              0,
            );

            return [
              {
                component,
                linkedRecipe,
                rawComponents,
                finalUnitImpact:
                  (component.qty_in_recipe_uom / batchOutput) * unitCostImpact,
                ingredientQtyPerDish:
                  (component.qty_in_recipe_uom / batchOutput) *
                  ingredientQtyPerOutput,
              },
            ];
          });
          const directProfitImpact = directImpactedComponents.reduce(
            (total, component) =>
              total +
              (component.qty_in_recipe_uom / batchOutput) *
                macroCascadePriceMover.costDelta,
            0,
          );
          const compressedProfitPerDish =
            directProfitImpact +
            subRecipeImpacts.reduce(
              (total, impact) => total + impact.finalUnitImpact,
              0,
            );
          const directQtyPerDish = directImpactedComponents.reduce(
            (totalQty, component) =>
              totalQty + component.qty_in_recipe_uom / batchOutput,
            0,
          );
          const impactedQtyPerDish =
            directQtyPerDish +
            subRecipeImpacts.reduce(
              (totalQty, impact) => totalQty + impact.ingredientQtyPerDish,
              0,
            );
          const guardrailItem = menuPricingGuardrails.find(
            (item) => getRecipeId(item.recipe) === getRecipeId(recipe),
          );
          const unitFoodCost =
            guardrailItem?.unitFoodCost ?? calculateRecipeUnitFoodCost(recipe);
          const sellingPrice = Number(recipe.selling_price ?? 0);
          const recommendedPrice =
            guardrailItem?.recommendedPrice ??
            (unitFoodCost > 0
              ? unitFoodCost / (targetMenuFoodCostPct / 100)
              : sellingPrice);
          const salesPerformance = menuPerformance.find(
            (item) =>
              item.name.trim().toLowerCase() === recipe.name.trim().toLowerCase(),
          );

          return {
            recipe,
            components: finalRecipeComponents,
            impactedComponents: [
              ...directImpactedComponents,
              ...subRecipeImpacts.flatMap((impact) => impact.rawComponents),
            ],
            subRecipeImpacts,
            unitFoodCost,
            sellingPrice,
            recommendedPrice,
            soldQuantity: salesPerformance?.quantity ?? 0,
            batchOutput,
            compressedProfitPerDish,
            impactedQtyPerDish,
          };
        })
        .filter((item) => item.impactedComponents.length > 0)
        .sort(
          (leftItem, rightItem) =>
            Math.abs(rightItem.compressedProfitPerDish) -
            Math.abs(leftItem.compressedProfitPerDish),
        )[0]
    : null;
  const macroCascadeSubRecipeImpact = macroCascadePriceMover
    ? activeSubRecipes
        .map((recipe) => {
        const recipeIds = activeRecipes
          .filter(
            (familyRecipe) =>
              familyRecipe.recipe_type === recipe.recipe_type &&
              familyRecipe.name.trim().toLowerCase() ===
                recipe.name.trim().toLowerCase(),
          )
          .map(getRecipeId);
          const recipeFamily = activeRecipes.filter(
            (familyRecipe) =>
              familyRecipe.recipe_type === recipe.recipe_type &&
              familyRecipe.name.trim().toLowerCase() ===
                recipe.name.trim().toLowerCase(),
          );
          const batchOutput = Math.max(
            1,
            ...recipeFamily.map((familyRecipe) =>
              Number(familyRecipe.standard_batch_output_qty ?? 1),
            ),
          );
          const impactedComponents = recipeComponents.filter(
            (component) =>
              recipeIds.includes(extractUuid(component.recipe_id)) &&
              extractUuid(component.component_inventory_item_id) ===
                macroCascadePriceMover.inventoryItemId,
          );
          const unitCostImpact = impactedComponents.reduce(
            (totalCost, component) =>
              totalCost +
              (component.qty_in_recipe_uom / batchOutput) *
                macroCascadePriceMover.costDelta,
            0,
          );
          const ingredientQtyPerOutput = impactedComponents.reduce(
            (totalQty, component) =>
              totalQty + component.qty_in_recipe_uom / batchOutput,
            0,
          );

          return {
            recipe,
            impactedComponents,
            unitCostImpact,
            ingredientQtyPerOutput,
            outputUom: recipe.output_uom,
          };
        })
        .filter((item) => item.impactedComponents.length > 0)
        .sort(
          (leftItem, rightItem) =>
            Math.abs(rightItem.unitCostImpact) -
            Math.abs(leftItem.unitCostImpact),
        )[0]
    : null;
  const negativeStockExceptions = activeInventoryItems
    .filter((item) => Number(item.on_hand_qty ?? 0) < 0)
    .map<ExceptionItem>((item) => ({
      id: `negative-stock-${item.id}`,
      severity: "Critical",
      tone: "critical",
      category: "Negative stock",
      title: item.name ?? "Unnamed item",
      detail: `${Math.abs(Number(item.on_hand_qty ?? 0)).toLocaleString(
        undefined,
        { maximumFractionDigits: 3 },
      )} ${item.on_hand_uom ?? item.base_uom ?? "unit"} below zero`,
      impact: `${organization.local_currency} ${Math.abs(
        Number(item.on_hand_qty ?? 0) *
          Number(item.current_cost_per_base_uom ?? 0),
      ).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      sortImpact: Math.abs(
        Number(item.on_hand_qty ?? 0) *
          Number(item.current_cost_per_base_uom ?? 0),
      ),
    }));
  const lowStockExceptions = activePurchasedIngredients
    .filter((item) => {
      const stockQty = Number(item.on_hand_qty ?? 0);

      return stockQty >= 0 && stockQty <= 1;
    })
    .map<ExceptionItem>((item) => ({
      id: `low-stock-${item.id}`,
      severity: "Watch",
      tone: "warning",
      category: "Low stock",
      title: item.name ?? "Unnamed ingredient",
      detail: `${Number(item.on_hand_qty ?? 0).toLocaleString(undefined, {
        maximumFractionDigits: 3,
      })} ${item.on_hand_uom ?? item.base_uom ?? "unit"} on hand`,
      sortImpact: Number(item.current_cost_per_base_uom ?? 0),
    }));
  const highFoodCostExceptions = menuPerformance
    .filter((item) => item.foodCostPct !== null && item.foodCostPct >= 40)
    .map<ExceptionItem>((item) => ({
      id: `high-food-cost-${item.name}`,
      severity: "Review",
      tone: "review",
      category: "Food cost",
      title: item.name,
      detail: `${item.foodCostPct?.toLocaleString(undefined, {
        maximumFractionDigits: 1,
      })}% food cost`,
      impact: `${organization.local_currency} ${item.foodCost.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )}`,
      sortImpact: item.foodCost,
    }));
  const weakMarginExceptions = menuPerformance
    .filter((item) => item.marginPct !== null && item.marginPct < 55)
    .map<ExceptionItem>((item) => ({
      id: `weak-margin-${item.name}`,
      severity: "Review",
      tone: "review",
      category: "Margin",
      title: item.name,
      detail: `${item.marginPct?.toLocaleString(undefined, {
        maximumFractionDigits: 1,
      })}% gross margin`,
      impact: `${organization.local_currency} ${item.grossProfit.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )}`,
      sortImpact: Math.max(item.revenue - item.grossProfit, 0),
    }));
  const pricingGuardrailExceptions = underpricedMenuItems
    .slice(0, 8)
    .map<ExceptionItem>((item) => ({
      id: `pricing-guardrail-${item.recipe.id}`,
      severity: "Review",
      tone: "review",
      category: "Menu pricing",
      title: item.recipe.name,
      detail: `${targetMenuMarginPct}% target margin needs ${organization.local_currency} ${item.recommendedPrice.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )}`,
      impact: `${organization.local_currency} ${item.priceGap.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )} price gap`,
      sortImpact: Math.max(item.priceGap, 0) * Math.max(item.soldQuantity, 1),
    }));
  const productionVarianceExceptions = productionHistory
    .filter((row) => Number(row.naira_loss ?? 0) > 0)
    .slice(0, 8)
    .map<ExceptionItem>((row) => ({
      id: `production-variance-${row.production_run_id}-${row.ingredient_name}`,
      severity: "Watch",
      tone: "warning",
      category: "Production waste",
      title: `${row.recipe_name} / ${row.ingredient_name}`,
      detail: `${Number(row.output_variance_qty ?? 0).toLocaleString(
        undefined,
        { maximumFractionDigits: 3 },
      )} ${row.output_uom ?? "unit"} output gap from material used`,
      impact: `${organization.local_currency} ${Number(row.naira_loss).toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )}`,
      sortImpact: Number(row.naira_loss ?? 0),
    }));
  const stockVarianceExceptions = stockVarianceHistory
    .filter((row) => Number(row.hard_currency_impact ?? 0) > 0)
    .slice(0, 8)
    .map<ExceptionItem>((row) => ({
      id: `stock-variance-${row.stock_count_id}-${row.ingredient_name}`,
      severity: "Watch",
      tone: "warning",
      category: "Stock count loss",
      title: row.ingredient_name,
      detail: `${Number(row.variance_qty ?? 0).toLocaleString(undefined, {
        maximumFractionDigits: 3,
      })} ${row.uom ?? "unit"} variance`,
      impact: `${organization.local_currency} ${Number(
        row.hard_currency_impact,
      ).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      sortImpact: Number(row.hard_currency_impact ?? 0),
    }));
  const wasteEventExceptions = wasteExposureRows
    .filter((row) => Number(row.waste_cost ?? 0) > 0)
    .slice(0, 8)
    .map<ExceptionItem>((row) => ({
      id: `waste-event-${row.waste_event_id}`,
      severity: "Watch",
      tone: "warning",
      category: "Waste event",
      title: row.ingredient_name,
      detail: `${Number(row.quantity ?? 0).toLocaleString(undefined, {
        maximumFractionDigits: 3,
      })} ${row.uom ?? "unit"} lost at ${row.waste_stage.replaceAll("_", " ")}`,
      impact: `${organization.local_currency} ${Number(
        row.waste_cost,
      ).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      sortImpact: Number(row.waste_cost ?? 0),
    }));
  const priceSpikeExceptions = ingredientPriceMovements
    .filter(
      (event) =>
        event.costDelta > 0 &&
        (event.changePct === null || event.changePct >= 10),
    )
    .slice(0, 8)
    .map<ExceptionItem>((event) => ({
      id: `price-spike-${event.id}`,
      severity: "Review",
      tone: "review",
      category: "Price movement",
      title: event.item?.name ?? "Ingredient cost",
      detail:
        event.changePct === null
          ? `${organization.local_currency} ${event.oldCost.toLocaleString(
              undefined,
              { maximumFractionDigits: 2 },
            )} to ${organization.local_currency} ${event.newCost.toLocaleString(
              undefined,
              { maximumFractionDigits: 2 },
            )}`
          : `${event.changePct.toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}% unit cost increase`,
      impact: `${organization.local_currency} ${event.onHandImpact.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )} on hand`,
      sortImpact: Math.abs(event.onHandImpact),
    }));
  const exceptionSeverityRank: Record<ExceptionItem["severity"], number> = {
    Critical: 0,
    Watch: 1,
    Review: 2,
  };
  const exceptionItems = [
    ...negativeStockExceptions,
    ...lowStockExceptions,
    ...productionVarianceExceptions,
    ...stockVarianceExceptions,
    ...wasteEventExceptions,
    ...priceSpikeExceptions,
    ...pricingGuardrailExceptions,
    ...highFoodCostExceptions,
    ...weakMarginExceptions,
  ]
    .sort(
      (leftItem, rightItem) =>
        exceptionSeverityRank[leftItem.severity] -
          exceptionSeverityRank[rightItem.severity] ||
        rightItem.sortImpact - leftItem.sortImpact,
    )
    .slice(0, 12);
  const criticalExceptionCount = exceptionItems.filter(
    (item) => item.severity === "Critical",
  ).length;
  const watchExceptionCount = exceptionItems.filter(
    (item) => item.severity === "Watch",
  ).length;
  const latestActivityMs = Math.max(
    0,
    ...menuSaleSummaries.map((sale) =>
      getDateMs(sale.operating_date || sale.created_at),
    ),
    ...ingredientPriceMovements.map((event) => getDateMs(event.created_at)),
    ...productionHistory.map((row) => getDateMs(row.created_at)),
    ...stockVarianceHistory.map((row) => getDateMs(row.created_at)),
    ...wasteExposureRows.map((row) => getDateMs(row.created_at)),
  );
  const latestActivityKey = latestActivityMs
    ? getDateKey(new Date(latestActivityMs).toISOString())
    : "";
  const activityDateKeys = Array.from(
    new Set(
      [
        ...menuSaleSummaries.map((sale) =>
          getDateKey(sale.operating_date || sale.created_at),
        ),
        ...ingredientPriceMovements.map((event) => getDateKey(event.created_at)),
        ...productionHistory.map((row) => getDateKey(row.created_at)),
        ...stockVarianceHistory.map((row) => getDateKey(row.created_at)),
        ...wasteExposureRows.map((row) => getDateKey(row.created_at)),
      ].filter(Boolean),
    ),
  ).sort((leftKey, rightKey) => {
    const leftMs = new Date(leftKey).getTime();
    const rightMs = new Date(rightKey).getTime();

    return rightMs - leftMs;
  });
  const previousActivityKey =
    activityDateKeys.find((dateKey) => dateKey !== latestActivityKey) ?? "";
  const latestDaySales = menuSaleSummaries.filter(
    (sale) =>
      getDateKey(sale.operating_date || sale.created_at) === latestActivityKey,
  );
  const latestDayProductionRows = productionHistory.filter(
    (row) => getDateKey(row.created_at) === latestActivityKey,
  );
  const latestDayStockVarianceRows = stockVarianceHistory.filter(
    (row) => getDateKey(row.created_at) === latestActivityKey,
  );
  const latestDayWasteRows = wasteExposureRows.filter(
    (row) => getDateKey(row.created_at) === latestActivityKey,
  );
  const latestDayPriceMovements = ingredientPriceMovements.filter(
    (event) => getDateKey(event.created_at) === latestActivityKey,
  );
  const previousDaySales = menuSaleSummaries.filter(
    (sale) =>
      getDateKey(sale.operating_date || sale.created_at) === previousActivityKey,
  );
  const previousDayWasteRows = wasteExposureRows.filter(
    (row) => getDateKey(row.created_at) === previousActivityKey,
  );
  const latestDayProductionRunCount = new Set(
    latestDayProductionRows.map((row) => row.production_run_id),
  ).size;
  const latestDayStockCountCount = new Set(
    latestDayStockVarianceRows.map((row) => row.stock_count_id),
  ).size;
  const latestDayRevenue = latestDaySales.reduce(
    (total, sale) => total + sale.total_revenue,
    0,
  );
  const latestDayFoodCost = latestDaySales.reduce(
    (total, sale) => total + sale.foodCost,
    0,
  );
  const latestDayGrossProfit = latestDayRevenue - latestDayFoodCost;
  const latestDayMarginPct =
    latestDayRevenue > 0
      ? (latestDayGrossProfit / latestDayRevenue) * 100
      : null;
  const latestDayFoodCostPct =
    latestDayRevenue > 0 ? (latestDayFoodCost / latestDayRevenue) * 100 : null;
  const previousDayRevenue = previousDaySales.reduce(
    (total, sale) => total + sale.total_revenue,
    0,
  );
  const previousDayFoodCost = previousDaySales.reduce(
    (total, sale) => total + sale.foodCost,
    0,
  );
  const previousDayGrossProfit = previousDayRevenue - previousDayFoodCost;
  const previousDayMarginPct =
    previousDayRevenue > 0
      ? (previousDayGrossProfit / previousDayRevenue) * 100
      : null;
  const previousDayFoodCostPct =
    previousDayRevenue > 0
      ? (previousDayFoodCost / previousDayRevenue) * 100
      : null;
  const latestDayProductionLoss = latestDayProductionRows.reduce(
    (total, row) => total + Math.max(row.naira_loss, 0),
    0,
  );
  const latestDayStockLoss = latestDayStockVarianceRows.reduce(
    (total, row) => total + Math.max(row.hard_currency_impact, 0),
    0,
  );
  const latestDayWasteImpact = latestDayWasteRows.reduce(
    (total, row) => total + Math.max(row.waste_cost, 0),
    0,
  );
  const previousDayWasteImpact = previousDayWasteRows.reduce(
    (total, row) => total + Math.max(row.waste_cost, 0),
    0,
  );
  const latestDayPriceImpact = latestDayPriceMovements.reduce(
    (total, event) => total + event.onHandImpact,
    0,
  );
  const financialTrendPoints: FinancialTrendPoint[] = activityDateKeys
    .slice(0, 14)
    .reverse()
    .map((dateKey) => {
      const daySales = menuSaleSummaries.filter(
        (sale) =>
          getDateKey(sale.operating_date || sale.created_at) === dateKey,
      );
      const dayWasteRows = wasteExposureRows.filter(
        (row) => getDateKey(row.created_at) === dateKey,
      );
      const dayPriceMovements = ingredientPriceMovements.filter(
        (event) => getDateKey(event.created_at) === dateKey,
      );
      const dayStockVarianceRows = stockVarianceHistory.filter(
        (row) => getDateKey(row.created_at) === dateKey,
      );
      const revenue = daySales.reduce(
        (total, sale) => total + sale.total_revenue,
        0,
      );
      const foodCost = daySales.reduce(
        (total, sale) => total + sale.foodCost,
        0,
      );
      const grossProfit = revenue - foodCost;
      const targetGrossProfit = revenue * (targetMenuMarginPct / 100);
      const marginGap = grossProfit - targetGrossProfit;

      return {
        dateKey,
        label: new Date(dateKey).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        revenue,
        grossProfit,
        waste: dayWasteRows.reduce(
          (total, row) => total + Math.max(row.waste_cost, 0),
          0,
        ),
        priceImpact: dayPriceMovements.reduce(
          (total, event) => total + event.onHandImpact,
          0,
        ),
        stockVariance: dayStockVarianceRows.reduce(
          (total, row) => total + Math.max(row.hard_currency_impact, 0),
          0,
        ),
        marginLoss: Math.max(-marginGap, 0),
        marginRecovery: Math.max(marginGap, 0),
      };
    });
  const operatingScopeLabel =
    effectiveDateFilter === "today"
      ? "today's operating activity"
      : effectiveDateFilter === "7d"
        ? "the selected 7-day operating window"
        : effectiveDateFilter === "30d"
          ? "the selected 30-day operating window"
          : effectiveDateFilter === "custom"
            ? `the selected ${selectedPeriodLabel} operating window`
          : "all recorded operating activity";
  const primaryCostCascadeAlert = largestPriceIncreaseMover
    ? (() => {
        const itemId = largestPriceIncreaseMover.inventoryItemId;
        const impactedSubRecipe = activeSubRecipes.find((recipe) =>
          recipeComponents.some(
            (component) =>
              extractUuid(component.recipe_id) === getRecipeId(recipe) &&
              extractUuid(component.component_inventory_item_id) === itemId,
          ),
        );
        const impactedMenuGuardrail = menuPricingGuardrails.find((guardrail) =>
          guardrail.components.some(
            (component) => extractUuid(component.component_inventory_item_id) === itemId,
          ),
        );
        const impactedMenu = impactedMenuGuardrail?.recipe ?? activeFinalMenuItems[0];

        return {
          skuName:
            largestPriceIncreaseMover.item?.name ||
            largestPriceIncreaseMover.item?.sku ||
            "Purchased SKU",
          changePct: largestPriceIncreaseMover.changePct,
          impact: largestPriceIncreaseMover.onHandImpact,
          subRecipeName: impactedSubRecipe?.name ?? "Sub-recipe costing layer",
          menuName: impactedMenu?.name ?? "Final menu item",
          marginPct: impactedMenuGuardrail?.marginPct ?? null,
        };
      })()
    : null;
  const profitMovementRows = [
    {
      label: "Purchased SKU cost increases",
      owner: "Procurement",
      value: -priceIncreaseImpact,
      detail:
        priceIncreaseMovements.length > 0
          ? `${priceIncreaseMovements.length.toLocaleString()} ingredient cost movement${
              priceIncreaseMovements.length === 1 ? "" : "s"
            } in ${operatingScopeLabel}`
          : "No purchased SKU cost increase captured",
      href: "#costing",
    },
    {
      label: "Waste events",
      owner: "Operations",
      value: -directWasteImpact,
      detail:
        wasteExposureRows.length > 0
          ? `${wasteExposureRows.length.toLocaleString()} waste event${
              wasteExposureRows.length === 1 ? "" : "s"
            } logged in ${operatingScopeLabel}`
          : "No direct waste loss captured",
      href: "#waste",
    },
    {
      label: "Production yield variance",
      owner: "Chef",
      value: -productionLossImpact,
      detail:
        productionHistory.length > 0
          ? `${productionHistory.length.toLocaleString()} production run${
              productionHistory.length === 1 ? "" : "s"
            } analyzed in ${operatingScopeLabel}`
          : "No production variance captured",
      href: "#ledger",
    },
    {
      label: "Stock count variance",
      owner: "Inventory manager",
      value: -stockLossImpact,
      detail:
        stockVarianceHistory.length > 0
          ? `${stockVarianceHistory.length.toLocaleString()} approved variance row${
              stockVarianceHistory.length === 1 ? "" : "s"
            } in ${operatingScopeLabel}`
          : "No approved stock count impact",
      href: "#inventory",
    },
    {
      label: "Menu price recovery opportunity",
      owner: "Finance",
      value: menuMarginRecovery,
      detail:
        menuMarginRecovery > 0
          ? `${underpricedMenuItems.length.toLocaleString()} menu price action${
              underpricedMenuItems.length === 1 ? "" : "s"
            } linked to sales in ${operatingScopeLabel}`
          : underpricedMenuItems.length > 0
            ? `${underpricedMenuItems.length.toLocaleString()} menu price action${
                underpricedMenuItems.length === 1 ? "" : "s"
              } available but no selected-period sales impact`
          : "Menu pricing is protected",
      href: "#pricing",
    },
  ];
  const profitMovementNet = profitMovementRows.reduce(
    (total, row) => total + row.value,
    0,
  );
  const largestProfitMovement = [...profitMovementRows].sort(
    (leftRow, rightRow) => Math.abs(rightRow.value) - Math.abs(leftRow.value),
  )[0];
  const formatCurrency = (value: number, maximumFractionDigits = 2) =>
    formatCurrencyAmount(
      organization.local_currency,
      value,
      maximumFractionDigits,
    );
  const formatSignedCurrency = (value: number, maximumFractionDigits = 2) =>
    formatSignedCurrencyAmount(
      organization.local_currency,
      value,
      maximumFractionDigits,
    );
  const reportDateLabel =
    reportStartDate || reportEndDate
      ? `${reportStartDate || "start"}-to-${reportEndDate || "today"}`
      : selectedPeriodLabel.toLowerCase().replaceAll(" ", "-");
  const reportRangeActive = Boolean(reportStartDate || reportEndDate);
  const getReportRowDateMs = (row: Record<string, unknown>) => {
    const candidate =
      row.recorded_at ??
      row.created_at ??
      row.operating_date ??
      row.received_at ??
      row.period ??
      "";
    const timestamp = getDateMs(String(candidate));

    return Number.isFinite(timestamp) ? timestamp : null;
  };
  const isWithinReportDateRange = (row: Record<string, unknown>) => {
    if (!reportRangeActive) {
      return true;
    }

    const rowDateMs = getReportRowDateMs(row);

    if (rowDateMs === null) {
      return false;
    }

    const startMs = reportStartDate
      ? new Date(`${reportStartDate}T00:00:00`).getTime()
      : Number.NEGATIVE_INFINITY;
    const endMs = reportEndDate
      ? new Date(`${reportEndDate}T23:59:59.999`).getTime()
      : Number.POSITIVE_INFINITY;

    return rowDateMs >= startMs && rowDateMs <= endMs;
  };
  const filterRowsForReportRange = (rows: Array<Record<string, unknown>>) =>
    reportRangeActive ? rows.filter(isWithinReportDateRange) : rows;
  const hasTopManagementLocationVisibility = [
    "owner",
    "admin",
    "manager",
    "operations_manager",
    "finance_manager",
    "auditor",
  ].includes(profile?.role ?? "viewer");
  const inventoryValuationItems = hasTopManagementLocationVisibility
    ? allActiveInventoryItems
    : activeInventoryItems;
  const inventoryReportRows = inventoryValuationItems.map((item) => {
    const assignedLocation = activeLocations.find(
      (location) => extractUuid(location.id) === extractUuid(item.location_id),
    );
    const quantity = Number(item.on_hand_qty ?? 0);
    const unitCost = Number(item.current_cost_per_base_uom ?? 0);

    return {
      location: assignedLocation?.name ?? "Unassigned",
      item: item.name ?? "Unnamed item",
      sku: item.sku ?? "",
      department: item.department ?? "",
      type: item.cost_type,
      quantity,
      uom: item.on_hand_uom ?? item.base_uom ?? "",
      unit_cost: unitCost,
      stock_value: quantity * unitCost,
      high_value: item.is_high_value ? "yes" : "no",
      active: item.is_active ? "yes" : "no",
    };
  });
  const locationStockSummaries = Array.from(
    inventoryReportRows
      .reduce(
        (locationsByName, row) => {
          const key = row.location || "Unassigned";
          const existingLocation = locationsByName.get(key);
          const stockValue = Number(row.stock_value) || 0;
          const quantity = Number(row.quantity) || 0;

          if (existingLocation) {
            existingLocation.stockValue += stockValue;
            existingLocation.quantity += quantity;
            existingLocation.itemCount += 1;
            existingLocation.highValueCount += row.high_value === "yes" ? 1 : 0;
          } else {
            locationsByName.set(key, {
              location: key,
              stockValue,
              quantity,
              itemCount: 1,
              highValueCount: row.high_value === "yes" ? 1 : 0,
            });
          }

          return locationsByName;
        },
        new Map<
          string,
          {
            location: string;
            stockValue: number;
            quantity: number;
            itemCount: number;
            highValueCount: number;
          }
        >(),
      )
      .values(),
  )
    .filter(
      (location) =>
        location.location !== "Unassigned" || Math.abs(location.stockValue) > 0,
    )
    .sort(
      (leftLocation, rightLocation) =>
        rightLocation.stockValue - leftLocation.stockValue,
    );
  const unassignedZeroStockSkuCount = activeInventoryItems.filter(
    (item) => !extractUuid(item.location_id) && Number(item.on_hand_qty ?? 0) === 0,
  ).length;
  const profitMovementReportRows = profitMovementRows.map((row) => ({
    period: formatShortDate(latestActivityMs),
    connection: row.label,
    owner: row.owner,
    movement: row.value,
    detail: row.detail,
  }));
  const menuProfitabilityReportRows = menuProfitabilityRows.map((item) => ({
    menu_item: item.recipe.name,
    batch_uom: item.outputUom,
    batch_qty: item.batchOutput,
    cost_per_batch: item.costPerBatch,
    selling_price: item.sellingPrice,
    unit_food_cost: item.unitFoodCost,
    food_cost_pct: item.foodCostPct ?? "",
    gross_margin_pct: item.marginPct ?? "",
    suggested_selling_price: item.recommendedPrice,
    price_gap: Math.max(item.priceGap, 0),
    status: item.status,
  }));
  const posMappingReportRows = posSalesItemMappings.map((mapping) => {
    const mappedRecipe = activeRecipesById.get(extractUuid(mapping.recipe_id));

    return {
      pos_item_label: mapping.pos_item_label,
      pos_item_code: mapping.pos_item_code ?? "",
      pos_item_key: mapping.pos_item_key,
      mapped_menu_item: mappedRecipe?.name ?? "Missing menu item",
      mapping_status: mappedRecipe ? "active" : "needs review",
      created_at: mapping.created_at,
      updated_at: mapping.updated_at,
    };
  });
  const productionReportSource = reportRangeActive
    ? allProductionHistory
    : productionHistory;
  const stockVarianceReportSource = reportRangeActive
    ? allStockVarianceHistory
    : stockVarianceHistory;
  const reportRangeProductionGapWasteRows = filterRowsForReportRange(
    productionReportSource as unknown as Array<Record<string, unknown>>,
  )
    .map((row) => row as unknown as ProductionHistoryRow)
    .filter((row) => Number(row.output_variance_qty ?? 0) > 0)
    .map((row) => {
      const wasteCost = Math.max(Number(row.naira_loss ?? 0), 0);

      return {
        waste_event_id: `production-gap-${row.production_run_id}-${row.ingredient_name}`,
        created_at: row.created_at,
        ingredient_name: row.recipe_name,
        quantity: Number(row.output_variance_qty ?? 0),
        uom: row.output_uom,
        unit_cost:
          Number(row.output_variance_qty ?? 0) > 0
            ? wasteCost / Number(row.output_variance_qty ?? 1)
            : 0,
        waste_cost: wasteCost,
        waste_reason: "production_gap",
        waste_stage: "production",
        notes: `${row.ingredient_name} production gap`,
      } satisfies WasteHistoryRow;
    });
  const wasteReportSource = reportRangeActive
    ? [
        ...filterRowsForReportRange(
          allWasteHistory as unknown as Array<Record<string, unknown>>,
        ).map((row) => row as unknown as WasteHistoryRow),
        ...reportRangeProductionGapWasteRows,
      ]
    : wasteExposureRows;
  const menuSaleReportSource = reportRangeActive
    ? allMenuSaleHistory
    : menuSaleHistory;
  const menuSaleReportSummaries = Array.from(
    menuSaleReportSource
      .reduce(
        (salesById, row) => {
          const existingSale = salesById.get(row.menu_sale_id);

          if (existingSale) {
            existingSale.rows.push(row);
            existingSale.foodCost += row.cost_impact;
          } else {
            salesById.set(row.menu_sale_id, {
              ...row,
              rows: [row],
              foodCost: row.cost_impact,
            });
          }

          return salesById;
        },
        new Map<
          string,
          MenuSaleHistoryRow & {
            rows: MenuSaleHistoryRow[];
            foodCost: number;
          }
        >(),
      )
      .values(),
  );
  const productionVarianceReportRows = productionReportSource.map((row) => ({
    recorded_at: row.created_at,
    recipe: row.recipe_name,
    ingredient: row.ingredient_name,
    actual_output_qty: row.actual_output_qty ?? row.target_output_qty,
    expected_output_from_material_used: row.expected_output_from_actual_qty,
    output_variance_qty: row.output_variance_qty,
    standard_required_qty_for_actual_output: row.target_qty_required,
    actual_used_qty: row.actual_qty_used,
    material_variance_qty: row.waste_variance_qty,
    unit_cost: row.unit_cost,
    financial_impact: row.naira_loss,
    origin: row.origin,
  }));
  const stockVarianceReportRows = stockVarianceReportSource.map((row) => ({
    recorded_at: row.created_at,
    item: row.ingredient_name,
    system_qty: row.system_qty,
    counted_qty: row.counted_qty,
    variance_qty: row.variance_qty,
    unit_cost: row.unit_cost,
    financial_impact: row.hard_currency_impact,
    uom: row.uom ?? "",
  }));
  const stockMovementReportSource = reportRangeActive
    ? allStockMovementLedger
    : stockMovementLedger;
  const stockMovementReportRows = stockMovementReportSource
    .filter((movement) =>
      activeInventoryItemsById.has(extractUuid(movement.inventory_item_id)),
    )
    .map((movement) => ({
      recorded_at: movement.created_at,
      item: movement.item_name,
      sku: movement.sku ?? "",
      location: movement.location_name,
      event_type: formatMovementType(movement.event_type),
      movement_qty: movement.movement_qty,
      unit_cost: movement.unit_cost,
      movement_value: movement.movement_value,
      source_table: movement.source_table ?? "",
      source_id: movement.source_id ?? "",
    }));
  const stockMovementSummaryReportRows = stockMovementSummaryRows.map((row) => {
    const location = activeLocations.find(
      (candidate) =>
        extractUuid(candidate.id) === extractUuid(row.item.location_id),
    );

    return {
      period: reportDateLabel,
      item: row.item.name ?? "Unnamed item",
      sku: row.item.sku ?? "",
      location: location?.name ?? "Unassigned",
      opening_qty: row.openingQty,
      inflow_qty: row.inflowQty,
      outflow_qty: row.outflowQty,
      closing_qty: row.closingQty,
      production_qty: row.movementBuckets.production,
      waste_qty: row.movementBuckets.waste,
      sales_depletion_qty: row.movementBuckets.sales,
      adjustment_qty: row.movementBuckets.adjustment,
      other_movement_qty: row.movementBuckets.other,
      movement_count: row.movementCount,
      unit_cost: row.unitCost,
      closing_stock_value: row.closingStockValue,
      uom: row.item.on_hand_uom ?? row.item.base_uom ?? "",
    };
  });
  const wasteReportRows = wasteReportSource.map((row) => ({
    recorded_at: row.created_at,
    item: row.ingredient_name,
    quantity: row.quantity,
    uom: row.uom ?? "",
    reason: row.waste_reason,
    stage: row.waste_stage,
    waste_cost: row.waste_cost,
    notes: row.notes ?? "",
  }));
  const salesReportRows = menuSaleReportSummaries.map((sale) => ({
    recorded_at: sale.created_at,
    menu_item: sale.recipe_name,
    quantity_sold: sale.sold_quantity,
    output_uom: sale.output_uom ?? "",
    revenue: sale.total_revenue,
    food_cost: sale.foodCost,
    gross_profit: sale.gross_profit,
    gross_margin_pct: sale.gross_margin_pct ?? "",
  }));
  const approvalReportRows = approvalRequests.map((request) => {
    const payload = request.payload ?? {};
    const lines = Array.isArray(payload.lines) ? payload.lines : [];

    return {
      created_at: request.created_at,
      request_type: request.request_type,
      status: request.status,
      requested_by: request.requested_by ?? "",
      approved_by: request.approved_by ?? "",
      approved_at: request.approved_at ?? "",
      rejected_at: request.rejected_at ?? "",
      target_location_id: String(payload.target_location_id ?? ""),
      adjustment_type: String(payload.adjustment_type ?? ""),
      line_count: lines.length,
      estimated_impact: lines.reduce(
        (total, line) =>
          total +
          Number(
            line && typeof line === "object"
              ? (line as Record<string, unknown>).estimated_margin_impact
              : 0,
          ),
        0,
      ),
      payload: JSON.stringify(payload),
    };
  });
  const marginTrendReportRows = financialTrendPoints.map((point) => ({
    period: point.dateKey,
    revenue: point.revenue,
    gross_profit: point.grossProfit,
    target_margin_pct: targetMenuMarginPct,
    margin_loss: point.marginLoss,
    margin_recovery: point.marginRecovery,
    waste: point.waste,
    price_impact: point.priceImpact,
    stock_variance: point.stockVariance,
  }));
  const openPurchaseOrderCount = purchaseOrders.filter(
    (order) => order.status !== "completed",
  ).length;
  const partialPurchaseOrders = purchaseOrders.filter(
    (order) => order.receipt_status === "partially_received",
  );
  const openOrPendingPurchaseOrders = purchaseOrders.filter(
    (order) =>
      order.status !== "completed" &&
      order.receipt_status !== "partially_received",
  );
  const pendingRequisitionRequests = approvalRequests.filter(
    (request) =>
      request.request_type === "inventory_requisition" &&
      (request.status === "pending" ||
        (request.status === "accepted" &&
          request.payload?.awaiting_receipt === true)),
  );
  const openRequisitionRequestCount = pendingRequisitionRequests.length;
  const pendingRequisitionIssueCount = pendingRequisitionRequests.filter(
    (request) => request.status === "pending",
  ).length;
  const awaitingRequisitionReceiptCount = pendingRequisitionRequests.filter(
    (request) =>
      request.status === "accepted" &&
      request.payload?.awaiting_receipt === true,
  ).length;
  const currentOperatingDate = getLocalDateInputValue();
  const currentOperatingDateKey = getDateKey(new Date().toISOString());
  const todaySalesCount = new Set(
    allMenuSaleHistory
      .filter((row) => getDateKey(row.created_at) === currentOperatingDateKey)
      .map((row) => row.menu_sale_id),
  ).size;
  const todayProductionRunCount = new Set(
    allProductionHistory
      .filter((row) => getDateKey(row.created_at) === currentOperatingDateKey)
      .map((row) => row.production_run_id),
  ).size;
  const todayStockCountCount = new Set(
    allStockVarianceHistory
      .filter((row) => getDateKey(row.created_at) === currentOperatingDateKey)
      .map((row) => row.stock_count_id),
  ).size;
  const todayWasteEventCount = allWasteHistory.filter(
    (row) => getDateKey(row.created_at) === currentOperatingDateKey,
  ).length;
  const todayPurchaseOrderCount = allPurchaseOrders.filter(
    (order) => getDateKey(order.created_at) === currentOperatingDateKey,
  ).length;
  const todayPriceMovementCount = allCostEvents.filter(
    (event) => getDateKey(event.created_at) === currentOperatingDateKey,
  ).length;
  const todayRequisitionCount = approvalRequests.filter(
    (request) =>
      request.request_type === "inventory_requisition" &&
      getDateKey(request.created_at) === currentOperatingDateKey,
  ).length;
  const pendingProcurementMasterDataCount = approvalRequests.filter(
    (request) =>
      request.status === "pending" &&
      ["sku_creation_approval", "vendor_creation_approval"].includes(
        request.request_type,
      ),
  ).length;
  const todayProcurementMasterDataCount = approvalRequests.filter(
    (request) =>
      ["sku_creation_approval", "vendor_creation_approval"].includes(
        request.request_type,
      ) && getDateKey(request.created_at) === currentOperatingDateKey,
  ).length;
  const currentRegisterEntries = operationRegisterEntries.filter(
    (entry) => entry.operating_date === currentOperatingDate,
  );
  const currentRegisterByKey = new Map(
    currentRegisterEntries.map((entry) => [entry.register_key, entry]),
  );
  const registerStatusStyles: Record<
    OperationRegisterStatus | "pending",
    string
  > = {
    completed: "border-accent-muted-border bg-accent-muted-bg text-accent",
    clear: "border-accent-muted-border bg-accent-muted-bg text-accent",
    exception:
      "border-status-critical-border bg-status-critical-bg text-status-critical-text",
    pending:
      "border-status-attention-border bg-status-attention-bg text-status-attention-text",
  };
  const registerStatusLabels: Record<
    OperationRegisterStatus | "pending",
    string
  > = {
    completed: "Recorded",
    clear: "Clear",
    exception: "Exception",
    pending: "Open",
  };
  const canOwnEveryRegister = [
    "owner",
    "admin",
    "manager",
    "operations_manager",
  ].includes(currentRole);
  const registerActionDepartmentsByRole: Record<AppRole, string[]> = {
    owner: ["Operations", "Finance", "Procurement", "Inventory", "Kitchen", "Bar"],
    admin: ["Operations", "Finance", "Procurement", "Inventory", "Kitchen", "Bar"],
    manager: ["Operations", "Finance", "Procurement", "Inventory", "Kitchen", "Bar"],
    operations_manager: [
      "Operations",
      "Finance",
      "Procurement",
      "Inventory",
      "Kitchen",
      "Bar",
    ],
    procurement_manager: ["Procurement"],
    finance_manager: ["Finance"],
    inventory_manager: ["Inventory", "Operations"],
    storekeeper: ["Inventory"],
    kitchen_manager: ["Kitchen", "Operations"],
    chef: ["Kitchen"],
    quality_assurance: ["Operations", "Inventory", "Kitchen"],
    bar_manager: ["Bar"],
    bartender: ["Bar"],
    auditor: [],
    viewer: [],
  };
  const canActOnRegister = (register: {
    department: string;
    ownerRole: AppRole;
  }) =>
    canRecordOperations &&
    (canOwnEveryRegister ||
      register.ownerRole === currentRole ||
      registerActionDepartmentsByRole[currentRole].includes(register.department));
  const getRegisterActionLabel = (register: {
    activityCount: number;
    key: string;
  }) =>
    register.activityCount > 0 || register.key.includes("readiness")
      ? "Confirm clear"
      : "Declare zero";
  const baseComplianceRegisters = [
    {
      key: "opening_readiness",
      label: "Opening readiness",
      department: "Operations",
      ownerRole: "owner" as AppRole,
      href: "#day",
      activityCount: 0,
      activityDetail: "Opening checklist confirmed",
      noActivityDetail: "Opening readiness has not been registered",
    },
    {
      key: "sales_register",
      label: "Sales register",
      department: "Finance",
      ownerRole: "finance_manager" as AppRole,
      href: "#overview",
      activityCount: todaySalesCount,
      activityDetail: `${todaySalesCount.toLocaleString()} sale${
        todaySalesCount === 1 ? "" : "s"
      } captured today`,
      noActivityDetail: "No sales activity declared for today",
    },
    {
      key: "finance_pos_import_check",
      label: "POS import completed or no-sales declared",
      department: "Finance",
      ownerRole: "finance_manager" as AppRole,
      href: "#overview",
      activityCount: todaySalesCount,
      activityDetail: `${todaySalesCount.toLocaleString()} sale${
        todaySalesCount === 1 ? "" : "s"
      } available for theoretical depletion review`,
      noActivityDetail:
        "POS import has not been confirmed; declare no sales only after checking the POS/ERP export",
    },
    {
      key: "finance_unmapped_pos_review",
      label: "Unmapped POS items reviewed",
      department: "Finance",
      ownerRole: "finance_manager" as AppRole,
      href: "#overview",
      activityCount: invalidSalesImportRows,
      activityDetail:
        invalidSalesImportRows > 0
          ? `${invalidSalesImportRows.toLocaleString()} import row${
              invalidSalesImportRows === 1 ? "" : "s"
            } need mapping or correction`
          : "No unmapped POS rows currently visible in the import preview",
      noActivityDetail:
        "Unmapped POS review has not been declared; blank means unknown, not zero",
    },
    {
      key: "finance_stock_variance_reconciliation",
      label: "Physical count variance reconciled",
      department: "Finance",
      ownerRole: "finance_manager" as AppRole,
      href: "#approvals",
      activityCount: pendingStockCountApprovalCount + todayStockCountCount,
      activityDetail:
        pendingStockCountApprovalCount > 0
          ? `${pendingStockCountApprovalCount.toLocaleString()} stock count or adjustment request${
              pendingStockCountApprovalCount === 1 ? "" : "s"
            } awaiting Finance approval before AvT can be trusted`
          : todayStockCountCount > 0
            ? `${todayStockCountCount.toLocaleString()} approved stock count batch${
                todayStockCountCount === 1 ? "" : "es"
              } available for AvT variance review`
            : "No physical stock count variance is currently visible",
      noActivityDetail:
        "Physical count variance reconciliation has not been confirmed for today's close",
    },
    {
      key: "procurement_register",
      label: "Procurement register",
      department: "Procurement",
      ownerRole: "procurement_manager" as AppRole,
      href: "#purchase-orders",
      activityCount: todayPurchaseOrderCount + todayPriceMovementCount,
      activityDetail: `${todayPurchaseOrderCount.toLocaleString()} purchase order${
        todayPurchaseOrderCount === 1 ? "" : "s"
      }, ${todayPriceMovementCount.toLocaleString()} cost movement${
        todayPriceMovementCount === 1 ? "" : "s"
      } today`,
      noActivityDetail: "No purchasing or supplier price activity declared",
    },
    {
      key: "procurement_invoice_price_check",
      label: "Supplier invoice price check",
      department: "Procurement",
      ownerRole: "procurement_manager" as AppRole,
      href: "#purchase-orders",
      activityCount: todayPurchaseOrderCount + todayPriceMovementCount,
      activityDetail: `${todayPurchaseOrderCount.toLocaleString()} purchase order${
        todayPurchaseOrderCount === 1 ? "" : "s"
      } and ${todayPriceMovementCount.toLocaleString()} price movement${
        todayPriceMovementCount === 1 ? "" : "s"
      } available for supplier price review`,
      noActivityDetail:
        "Supplier invoice prices have not been checked or zero-declared",
    },
    {
      key: "procurement_purchase_order_follow_up",
      label: "Purchase order follow-up reviewed",
      department: "Procurement",
      ownerRole: "procurement_manager" as AppRole,
      href: "#purchase-orders",
      activityCount: openPurchaseOrderCount + partialPurchaseOrders.length,
      activityDetail:
        openPurchaseOrderCount + partialPurchaseOrders.length > 0
          ? `${openPurchaseOrderCount.toLocaleString()} open and ${partialPurchaseOrders.length.toLocaleString()} partially delivered purchase order${
              openPurchaseOrderCount + partialPurchaseOrders.length === 1
                ? ""
                : "s"
            } need follow-up`
          : "No supplier purchase order follow-up currently required",
      noActivityDetail:
        "Purchase order follow-up has not been checked or zero-declared",
    },
    {
      key: "procurement_vendor_sku_intake_check",
      label: "Vendor and SKU intake reviewed",
      department: "Procurement",
      ownerRole: "procurement_manager" as AppRole,
      href: "#setup",
      activityCount: todayProcurementMasterDataCount,
      activityDetail:
        todayProcurementMasterDataCount > 0
          ? `${todayProcurementMasterDataCount.toLocaleString()} vendor/SKU request${
              todayProcurementMasterDataCount === 1 ? "" : "s"
            } submitted for Finance approval`
          : "No vendor or SKU master-data changes submitted today",
      noActivityDetail:
        "Vendor/SKU intake has not been checked or zero-declared",
    },
    {
      key: "purchase_order_register",
      label: "Open purchase order review",
      department: "Inventory",
      ownerRole: "inventory_manager" as AppRole,
      href: "#purchase-orders",
      activityCount: 0,
      activityDetail:
        openOrPendingPurchaseOrders.length > 0
          ? `${openOrPendingPurchaseOrders.length.toLocaleString()} purchase order${
              openOrPendingPurchaseOrders.length === 1 ? "" : "s"
            } awaiting receipt or closure`
          : "No open purchase orders awaiting store action",
      noActivityDetail:
        openOrPendingPurchaseOrders.length > 0
          ? `${openOrPendingPurchaseOrders.length.toLocaleString()} purchase order${
              openOrPendingPurchaseOrders.length === 1 ? "" : "s"
            } still open for inventory review`
          : "No open purchase orders awaiting store action",
    },
    {
      key: "store_issue_receipt_check",
      label: "Store issues and department receipts checked",
      department: "Inventory",
      ownerRole: "inventory_manager" as AppRole,
      href: "#requisitions",
      activityCount: todayRequisitionCount + openRequisitionRequestCount,
      activityDetail: `${todayRequisitionCount.toLocaleString()} requisition${
        todayRequisitionCount === 1 ? "" : "s"
      } today / ${openRequisitionRequestCount.toLocaleString()} open or awaiting receipt`,
      noActivityDetail:
        "Store issue and department receipt review has not been declared",
    },
    {
      key: "requisition_register",
      label: "Requisition register",
      department: "Operations",
      ownerRole: "inventory_manager" as AppRole,
      href: "#requisitions",
      activityCount: todayRequisitionCount,
      activityDetail: `${todayRequisitionCount.toLocaleString()} requisition${
        todayRequisitionCount === 1 ? "" : "s"
      } submitted today`,
      noActivityDetail: "No requisition or transfer activity declared",
    },
    {
      key: "kitchen_requisition_receipt_check",
      label: "Kitchen requisitions received or escalated",
      department: "Kitchen",
      ownerRole: "kitchen_manager" as AppRole,
      href: "#requisitions",
      activityCount: todayRequisitionCount + openRequisitionRequestCount,
      activityDetail: `${openRequisitionRequestCount.toLocaleString()} requisition${
        openRequisitionRequestCount === 1 ? "" : "s"
      } still open or awaiting receipt`,
      noActivityDetail:
        "Kitchen has not confirmed received requisitions or declared no pending receipts",
    },
    {
      key: "production_register",
      label: "Production register",
      department: "Kitchen",
      ownerRole: "kitchen_manager" as AppRole,
      href: "#ledger",
      activityCount: todayProductionRunCount,
      activityDetail: `${todayProductionRunCount.toLocaleString()} production run${
        todayProductionRunCount === 1 ? "" : "s"
      } recorded today`,
      noActivityDetail: "No production activity declared",
    },
    {
      key: "kitchen_production_check",
      label: "Kitchen production logged or zero declared",
      department: "Kitchen",
      ownerRole: "kitchen_manager" as AppRole,
      href: "#ledger",
      activityCount: todayProductionRunCount,
      activityDetail: `${todayProductionRunCount.toLocaleString()} production run${
        todayProductionRunCount === 1 ? "" : "s"
      } available for batch/yield review`,
      noActivityDetail:
        "Kitchen production has not been logged or explicitly zero-declared",
    },
    {
      key: "waste_register",
      label: "Waste register",
      department: "Operations",
      ownerRole: "inventory_manager" as AppRole,
      href: "#waste",
      activityCount: todayWasteEventCount,
      activityDetail: `${todayWasteEventCount.toLocaleString()} waste event${
        todayWasteEventCount === 1 ? "" : "s"
      } recorded today`,
      noActivityDetail: "No waste declaration has been submitted",
    },
    {
      key: "kitchen_waste_declaration",
      label: "Kitchen waste recorded or zero declared",
      department: "Kitchen",
      ownerRole: "kitchen_manager" as AppRole,
      href: "#waste",
      activityCount: todayWasteEventCount,
      activityDetail: `${todayWasteEventCount.toLocaleString()} waste event${
        todayWasteEventCount === 1 ? "" : "s"
      } recorded today for operations review`,
      noActivityDetail:
        "Kitchen waste has not been recorded or explicitly zero-declared",
    },
    {
      key: "bar_waste_declaration",
      label: "Bar waste recorded or zero declared",
      department: "Bar",
      ownerRole: "bar_manager" as AppRole,
      href: "#waste",
      activityCount: todayWasteEventCount,
      activityDetail: `${todayWasteEventCount.toLocaleString()} waste event${
        todayWasteEventCount === 1 ? "" : "s"
      } recorded today for operations review`,
      noActivityDetail:
        "Bar waste has not been recorded or explicitly zero-declared",
    },
    {
      key: "stock_count_register",
      label: "Stock count register",
      department: "Inventory",
      ownerRole: "inventory_manager" as AppRole,
      href: "#stock-counts",
      activityCount: todayStockCountCount,
      activityDetail: `${todayStockCountCount.toLocaleString()} count batch${
        todayStockCountCount === 1 ? "" : "es"
      } recorded today`,
      noActivityDetail: "No stock count activity declared",
    },
    {
      key: "store_stock_count_variance_check",
      label: "Store stock count and variance reviewed",
      department: "Inventory",
      ownerRole: "inventory_manager" as AppRole,
      href: "#stock-counts",
      activityCount: todayStockCountCount,
      activityDetail: `${todayStockCountCount.toLocaleString()} stock count batch${
        todayStockCountCount === 1 ? "" : "es"
      } available for variance review`,
      noActivityDetail:
        "Store count variance has not been reviewed or deferred with a reason",
    },
    {
      key: "finance_avt_exception_review",
      label: "AvT exceptions reviewed",
      department: "Finance",
      ownerRole: "finance_manager" as AppRole,
      href: "#overview",
      activityCount: avtNeedsReviewCount,
      activityDetail:
        avtNeedsReviewCount > 0
          ? `${avtNeedsReviewCount.toLocaleString()} AvT period${
              avtNeedsReviewCount === 1 ? "" : "s"
            } need confidence or variance review`
          : "No AvT exception currently visible for the selected period",
      noActivityDetail:
        "AvT exception review has not been declared for today's close",
    },
    {
      key: "closing_readiness",
      label: "Closing readiness",
      department: "Operations",
      ownerRole: "owner" as AppRole,
      href: "#day",
      activityCount: 0,
      activityDetail: "Closing checklist confirmed",
      noActivityDetail: "Closing readiness has not been registered",
    },
  ];
  const complianceRegisters = baseComplianceRegisters.map((register) => {
    const entry = currentRegisterByKey.get(register.key);
    const hasActivity = register.activityCount > 0;
    const hasExplicitChecklistDecision =
      entry?.activity_state === "reviewed" ||
      entry?.activity_state === "no_activity" ||
      entry?.activity_state === "exception" ||
      entry?.status === "clear";
    const status: OperationRegisterStatus | "pending" =
      entry?.status === "exception"
        ? "exception"
        : hasExplicitChecklistDecision
          ? entry?.status ?? "clear"
          : "pending";
    const passed = status === "completed" || status === "clear";
    const detail = entry
      ? entry.activity_state === "activity_recorded"
        ? register.activityDetail
        : entry.activity_state === "no_activity"
        ? register.noActivityDetail
        : entry.activity_state === "exception"
          ? entry.notes || "Exception declared for this register"
          : register.activityDetail
      : hasActivity
        ? register.activityDetail
        : register.noActivityDetail;

    return {
      ...register,
      entry,
      status,
      passed,
      detail,
      submittedAt: hasExplicitChecklistDecision ? entry?.submitted_at ?? "" : "",
    };
  });
  const visibleComplianceRegisters = complianceRegisters.filter(
    (register) => {
      if (isAuditFocus) {
        return true;
      }

      if (isOperationsFocus || isAdminFocus || focusRole === "owner") {
        return true;
      }

      if (isInventoryFocus) {
        return ["Inventory", "Operations"].includes(register.department);
      }

      if (isStorekeeperFocus) {
        return register.department === "Inventory";
      }

      if (isKitchenFocus || isChefFocus) {
        return ["Kitchen", "Operations"].includes(register.department);
      }

      if (isProcurementFocus) {
        return register.department === "Procurement";
      }

      if (isFinanceFocus) {
        return ["Finance", "Operations"].includes(register.department);
      }

      if (isBarFocus) {
        return register.department === "Bar";
      }

      if (isQualityFocus) {
        return ["Operations", "Inventory", "Kitchen"].includes(
          register.department,
        );
      }

      return false;
    },
  );
  const compliancePassedCount = visibleComplianceRegisters.filter(
    (register) => register.passed,
  ).length;
  const complianceExceptionCount = visibleComplianceRegisters.filter(
    (register) => register.status === "exception",
  ).length;
  const compliancePendingCount =
    visibleComplianceRegisters.length - compliancePassedCount;
  const readinessScore = Math.round(
    (compliancePassedCount / Math.max(visibleComplianceRegisters.length, 1)) *
      100,
  );
  const departmentPerformanceRows = Array.from(
    visibleComplianceRegisters
      .reduce(
        (departments, register) => {
          const currentDepartment =
            departments.get(register.department) ?? {
              department: register.department,
              total: 0,
              passed: 0,
              exceptions: 0,
            };

          currentDepartment.total += 1;
          currentDepartment.passed += register.passed ? 1 : 0;
          currentDepartment.exceptions += register.status === "exception" ? 1 : 0;
          departments.set(register.department, currentDepartment);

          return departments;
        },
        new Map<
          string,
          {
            department: string;
            total: number;
            passed: number;
            exceptions: number;
          }
        >(),
      )
      .values(),
  ).map((department) => ({
    ...department,
    score: Math.round((department.passed / Math.max(department.total, 1)) * 100),
  }));
  const registerReportRows = complianceRegisters.map((register) => ({
    operating_date: currentOperatingDate,
    department: register.department,
    register: register.label,
    status: register.status,
    detail: register.detail,
    submitted_at: register.submittedAt,
    notes: register.entry?.notes ?? "",
  }));
  const currentStockValue = inventoryValuationItems.reduce(
    (total, item) =>
      total +
      Math.max(Number(item.on_hand_qty ?? 0), 0) *
        Number(item.current_cost_per_base_uom ?? 0),
    0,
  );
  const ownerInventorySkuKeys = new Set(
    inventoryValuationItems.map((item) => {
      const stableIdentity =
        String(item.sku ?? "").trim().toLowerCase() ||
        extractUuid(item.recipe_id) ||
        String(item.name ?? "").trim().toLowerCase() ||
        extractUuid(item.origin_inventory_item_id) ||
        extractUuid(item.id);

      return `${String(item.cost_type ?? "unknown")}:${stableIdentity}`;
    }),
  );
  const ownerUniqueSkuCount = ownerInventorySkuKeys.size;
  const reorderTodayCount =
    negativeStockExceptions.length + lowStockExceptions.length;
  const potentialLossExposure =
    productionLossImpact +
    stockLossImpact +
    directWasteImpact +
    priceIncreaseImpact +
    menuMarginRecovery;
  const visibleMarginLeakage = Math.max(potentialLossExposure, 0);
  const ownerOverallLeakValue =
    Math.max(directWasteImpact, 0) + Math.max(priceIncreaseImpact, 0);
  const visibleLeakageRate =
    totalSalesRevenue > 0 ? (visibleMarginLeakage / totalSalesRevenue) * 100 : null;
  const marginBaseScore =
    totalSalesMarginPct === null
      ? targetMenuMarginPct
      : Math.max(0, Math.min(100, totalSalesMarginPct));
  const marginHealthScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        marginBaseScore -
          underpricedMenuItems.length * 4 -
          priceSpikeExceptions.length * 5 -
          criticalExceptionCount * 8 -
          (latestDayWasteImpact > 0 ? 5 : 0),
      ),
    ),
  );
  const inventoryAccuracyScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          negativeStockExceptions.length * 20 -
          lowStockExceptions.length * 4 -
          (latestDayStockCountCount === 0 ? 8 : 0) -
          (latestDayStockLoss > 0 ? 10 : 0),
      ),
    ),
  );
  const latestOperatingDayLabel =
    effectiveDateFilter === "today"
      ? "Current operating day"
      : "Latest operating day in selected period";
  const strategicIndexes = [
    {
      label: "Margin Health Score",
      value: `${marginHealthScore}%`,
      detail:
        underpricedMenuItems.length > 0
          ? `${underpricedMenuItems.length.toLocaleString()} menu price action${
              underpricedMenuItems.length === 1 ? "" : "s"
            }`
          : "Menu margin is inside target range",
      tone:
        marginHealthScore >= 80
          ? ("healthy" as const)
          : marginHealthScore >= 60
            ? ("attention" as const)
            : ("critical" as const),
    },
    {
      label: "Inventory Accuracy",
      value: `${inventoryAccuracyScore}%`,
      detail:
        reorderTodayCount > 0
          ? `${reorderTodayCount.toLocaleString()} reorder or stock exception${
              reorderTodayCount === 1 ? "" : "s"
            }`
          : "Stock posture is stable",
      tone:
        inventoryAccuracyScore >= 85
          ? ("healthy" as const)
          : inventoryAccuracyScore >= 65
            ? ("attention" as const)
            : ("critical" as const),
    },
    {
      label: "Operational Discipline",
      value: `${readinessScore.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })}%`,
      detail: `${compliancePassedCount}/${visibleComplianceRegisters.length} daily registers complete`,
      tone:
        readinessScore >= 80
          ? ("healthy" as const)
          : readinessScore >= 55
            ? ("attention" as const)
            : ("critical" as const),
    },
  ];
  const executiveKpis: Array<{
    label: string;
    value: string;
    detail: string;
    priority: "hero" | "large" | "medium";
    tone: SemanticTone;
    trend: { symbol: string; label: string; tone: SemanticTone };
  }> = [
    {
      label: "Revenue",
      value: `${organization.local_currency} ${latestDayRevenue.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )}`,
      detail: latestOperatingDayLabel,
      priority: "large" as const,
      tone: "info" as SemanticTone,
      trend: getTrend(latestDayRevenue, previousDayRevenue),
    },
    {
      label: "Gross Profit",
      value: `${organization.local_currency} ${latestDayGrossProfit.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )}`,
      detail: "Revenue retained after food cost",
      priority: "large" as const,
      tone: latestDayGrossProfit >= 0 ? ("healthy" as const) : ("critical" as const),
      trend: getTrend(latestDayGrossProfit, previousDayGrossProfit),
    },
    {
      label: "Food Cost %",
      value:
        latestDayFoodCostPct !== null
          ? `${latestDayFoodCostPct.toLocaleString(
              undefined,
              { maximumFractionDigits: 1 },
            )}%`
          : "N/A",
      detail: "Lower is better",
      priority: "medium" as const,
      tone:
        latestDayFoodCostPct === null
          ? ("info" as const)
          : getSemanticTone(latestDayFoodCostPct, {
              attention: 35,
              critical: 45,
            }),
      trend: getTrend(latestDayFoodCostPct ?? 0, previousDayFoodCostPct ?? 0, true),
    },
    {
      label: "Margin",
      value:
        latestDayMarginPct === null
          ? `${marginHealthScore}%`
          : `${latestDayMarginPct.toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}%`,
      detail: "Gross margin",
      priority: "hero" as const,
      tone:
        latestDayMarginPct === null
          ? marginHealthScore >= 75
            ? ("healthy" as const)
            : ("attention" as const)
          : latestDayMarginPct >= targetMenuMarginPct
            ? ("healthy" as const)
            : latestDayMarginPct >= 50
              ? ("attention" as const)
              : ("critical" as const),
      trend: getTrend(latestDayMarginPct ?? 0, previousDayMarginPct ?? 0),
    },
    {
      label: "Critical Alerts",
      value: criticalExceptionCount.toLocaleString(),
      detail: "Open critical issues",
      priority: "medium" as const,
      tone: criticalExceptionCount > 0 ? ("critical" as const) : ("healthy" as const),
      trend: { symbol: "Flat", label: "Live", tone: "info" as SemanticTone },
    },
    {
      label: "Variance Exposure",
      value: `${organization.local_currency} ${potentialLossExposure.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )}`,
      detail: "Loss and recovery exposure",
      priority: "medium" as const,
      tone: getSemanticTone(potentialLossExposure, {
        attention: 1,
        critical: Math.max(1000, latestDayRevenue * 0.08),
      }),
      trend: getTrend(latestDayWasteImpact, previousDayWasteImpact, true),
    },
  ];
  const operatingDayMetrics = [
    {
      label: "Sales",
      value: latestDaySales.length.toLocaleString(),
      detail: `${organization.local_currency} ${latestDayRevenue.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )}`,
    },
    {
      label: "Gross margin",
      value:
        latestDayMarginPct === null
          ? "N/A"
          : `${latestDayMarginPct.toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}%`,
      detail: `${formatCurrency(latestDayGrossProfit)} profit`,
    },
    {
      label: "Production runs",
      value: latestDayProductionRunCount.toLocaleString(),
      detail: `${formatCurrency(latestDayProductionLoss)} waste`,
    },
    {
      label: "Waste",
      value: formatCurrency(latestDayWasteImpact),
      detail: `${latestDayWasteRows.length.toLocaleString()} event${
        latestDayWasteRows.length === 1 ? "" : "s"
      }`,
    },
    {
      label: "Stock counts",
      value: latestDayStockCountCount.toLocaleString(),
      detail: `${formatCurrency(latestDayStockLoss)} variance`,
    },
    {
      label: "Price impact",
      value: formatCurrency(latestDayPriceImpact),
      detail: `${latestDayPriceMovements.length.toLocaleString()} price move${
        latestDayPriceMovements.length === 1 ? "" : "s"
      }`,
    },
    {
      label: "Readiness",
      value: `${readinessScore.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })}%`,
      detail:
        compliancePendingCount > 0
          ? `${compliancePendingCount} register${
              compliancePendingCount === 1 ? "" : "s"
            } open`
          : "Daily register complete",
    },
  ];
  const inventoryOperatingDayMetrics = [
    {
      label: "Production runs",
      value: latestDayProductionRunCount.toLocaleString(),
      detail: "Logged on latest operating day",
    },
    {
      label: "Waste",
      value: latestDayWasteRows.length.toLocaleString(),
      detail: `${latestDayWasteRows.length.toLocaleString()} event${
        latestDayWasteRows.length === 1 ? "" : "s"
      } recorded`,
    },
    {
      label: "Stock counts",
      value: latestDayStockCountCount.toLocaleString(),
      detail: "Submitted for control review",
    },
    {
      label: "Readiness",
      value: `${readinessScore.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })}%`,
      detail:
        compliancePendingCount > 0
          ? `${compliancePendingCount} register${
              compliancePendingCount === 1 ? "" : "s"
            } open`
          : "Daily register complete",
    },
  ];
  const kitchenOperatingDayMetrics = [
    {
      label: "Production runs",
      value: latestDayProductionRunCount.toLocaleString(),
      detail: "Logged on latest operating day",
    },
    {
      label: "Waste",
      value: latestDayWasteRows.length.toLocaleString(),
      detail: `${latestDayWasteRows.length.toLocaleString()} kitchen waste event${
        latestDayWasteRows.length === 1 ? "" : "s"
      }`,
    },
    {
      label: "Requisitions",
      value: openRequisitionRequestCount.toLocaleString(),
      detail: "Open or awaiting receipt",
    },
    {
      label: "Readiness",
      value: `${readinessScore.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })}%`,
      detail:
        compliancePendingCount > 0
          ? `${compliancePendingCount} register${
              compliancePendingCount === 1 ? "" : "s"
            } open`
          : "Daily register complete",
    },
  ];
  const procurementOperatingDayMetrics = [
    {
      label: "Purchase orders",
      value: openPurchaseOrderCount.toLocaleString(),
      detail: "Open supplier queue",
    },
    {
      label: "Partial deliveries",
      value: partialPurchaseOrders.length.toLocaleString(),
      detail: "Follow-up required",
    },
    {
      label: "Supplier price changes",
      value: latestDayPriceMovements.length.toLocaleString(),
      detail: `${latestDayPriceMovements.length.toLocaleString()} price move${
        latestDayPriceMovements.length === 1 ? "" : "s"
      } logged`,
    },
    {
      label: "Readiness",
      value: `${readinessScore.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })}%`,
      detail:
        compliancePendingCount > 0
          ? `${compliancePendingCount} register${
              compliancePendingCount === 1 ? "" : "s"
            } open`
          : "Daily register complete",
    },
  ];
  const inventoryExecutiveKpis: typeof executiveKpis = [
    {
      label: "Inventory Accuracy",
      value: `${inventoryAccuracyScore}%`,
      detail: "Stock control score",
      priority: "hero",
      tone:
        inventoryAccuracyScore >= 85
          ? "healthy"
          : inventoryAccuracyScore >= 65
            ? "attention"
            : "critical",
      trend: { symbol: "Flat", label: "Live", tone: "info" },
    },
    {
      label: "Active SKUs",
      value: activeInventoryItems.length.toLocaleString(),
      detail: "Available inventory items",
      priority: "large",
      tone: "info",
      trend: { symbol: "Flat", label: "Live", tone: "info" },
    },
    {
      label: "Reorder Flags",
      value: reorderTodayCount.toLocaleString(),
      detail: "Items needing replenishment",
      priority: "medium",
      tone: reorderTodayCount > 0 ? "attention" : "healthy",
      trend: { symbol: "Flat", label: "Live", tone: "info" },
    },
    {
      label: "Open purchase orders",
      value: openPurchaseOrderCount.toLocaleString(),
      detail: "Awaiting receipt or closure",
      priority: "medium",
      tone: openPurchaseOrderCount > 0 ? "attention" : "healthy",
      trend: { symbol: "Flat", label: "Live", tone: "info" },
    },
    {
      label: "Open Requisitions",
      value: openRequisitionRequestCount.toLocaleString(),
      detail: "Awaiting store confirmation",
      priority: "medium",
      tone: openRequisitionRequestCount > 0 ? "attention" : "healthy",
      trend: { symbol: "Flat", label: "Live", tone: "info" },
    },
    {
      label: "Waste Events",
      value: latestDayWasteRows.length.toLocaleString(),
      detail: latestOperatingDayLabel,
      priority: "medium",
      tone: latestDayWasteRows.length > 0 ? "attention" : "healthy",
      trend: { symbol: "Flat", label: "Live", tone: "info" },
    },
  ];
  const kitchenExecutiveKpis: typeof executiveKpis = [
    {
      label: "Kitchen SKUs",
      value: activeInventoryItems.length.toLocaleString(),
      detail: "Assigned to kitchen storage",
      priority: "hero",
      tone: activeInventoryItems.length > 0 ? "healthy" : "attention",
      trend: { symbol: "Flat", label: "Scoped", tone: "info" },
    },
    {
      label: "Production Plans",
      value: validProductionPlanRows.length.toLocaleString(),
      detail: "Recipe output plans prepared",
      priority: "large",
      tone: validProductionPlanRows.length > 0 ? "healthy" : "info",
      trend: { symbol: "Flat", label: "Live", tone: "info" },
    },
    {
      label: "Ingredient Shortages",
      value: productionPlanShortageCount.toLocaleString(),
      detail: "From current production plan",
      priority: "medium",
      tone: productionPlanShortageCount > 0 ? "attention" : "healthy",
      trend: { symbol: "Flat", label: "Plan", tone: "info" },
    },
    {
      label: "Open Requests",
      value: openRequisitionRequestCount.toLocaleString(),
      detail: "Requisitions or transfers pending",
      priority: "medium",
      tone: openRequisitionRequestCount > 0 ? "attention" : "healthy",
      trend: { symbol: "Flat", label: "Queue", tone: "info" },
    },
    {
      label: "Waste Events",
      value: latestDayWasteRows.length.toLocaleString(),
      detail: "Kitchen waste exposure",
      priority: "medium",
      tone: latestDayWasteRows.length > 0 ? "attention" : "healthy",
      trend: { symbol: "Flat", label: "Period", tone: "info" },
    },
    {
      label: "Production Runs",
      value: latestDayProductionRunCount.toLocaleString(),
      detail: "Logged on latest operating day",
      priority: "medium",
      tone: latestDayProductionRunCount > 0 ? "healthy" : "info",
      trend: { symbol: "Flat", label: "Latest", tone: "info" },
    },
  ];
  const procurementExecutiveKpis: typeof executiveKpis = [
    {
      label: "Purchase Orders",
      value: openPurchaseOrderCount.toLocaleString(),
      detail: "Supplier queue awaiting action",
      priority: "hero",
      tone: openPurchaseOrderCount > 0 ? "attention" : "healthy",
      trend: { symbol: "Flat", label: "Live", tone: "info" },
    },
    {
      label: "Partial Deliveries",
      value: partialPurchaseOrders.length.toLocaleString(),
      detail: "Follow-up required",
      priority: "large",
      tone: partialPurchaseOrders.length > 0 ? "attention" : "healthy",
      trend: { symbol: "Flat", label: "Live", tone: "info" },
    },
    {
      label: "Active Vendors",
      value: activeSuppliers.length.toLocaleString(),
      detail: "Approved supplier master",
      priority: "medium",
      tone: activeSuppliers.length > 0 ? "healthy" : "attention",
      trend: { symbol: "Flat", label: "Master", tone: "info" },
    },
    {
      label: "Master Data Requests",
      value: pendingProcurementMasterDataCount.toLocaleString(),
      detail: "Awaiting Finance approval",
      priority: "medium",
      tone:
        pendingProcurementMasterDataCount > 0 ? "attention" : "healthy",
      trend: { symbol: "Flat", label: "Queue", tone: "info" },
    },
    {
      label: "Supplier Price Changes",
      value: latestDayPriceMovements.length.toLocaleString(),
      detail: latestOperatingDayLabel,
      priority: "medium",
      tone: latestDayPriceMovements.length > 0 ? "attention" : "healthy",
      trend: { symbol: "Flat", label: "Period", tone: "info" },
    },
    {
      label: "Daily Procurement Checks",
      value: `${readinessScore}%`,
      detail: `${compliancePassedCount}/${visibleComplianceRegisters.length} register checks complete`,
      priority: "medium",
      tone:
        readinessScore >= 80
          ? "healthy"
          : readinessScore >= 55
            ? "attention"
            : "critical",
      trend: { symbol: "Flat", label: "Control", tone: "info" },
    },
  ];
  const visibleExecutiveKpis = isKitchenFocus
    ? kitchenExecutiveKpis
    : isStoreControlFocus
      ? inventoryExecutiveKpis
      : isProcurementFocus
        ? procurementExecutiveKpis
        : executiveKpis;
  const visibleOperatingDayMetrics = isKitchenFocus
    ? kitchenOperatingDayMetrics
    : isInventoryFocus
      ? inventoryOperatingDayMetrics
      : isProcurementFocus
        ? procurementOperatingDayMetrics
        : operatingDayMetrics;
  const dayCloseChecks = visibleComplianceRegisters
    .filter((register) => register.key !== "closing_readiness")
    .sort((leftRegister, rightRegister) => {
      const leftCanAct = canActOnRegister(leftRegister);
      const rightCanAct = canActOnRegister(rightRegister);

      if (leftCanAct !== rightCanAct) {
        return leftCanAct ? -1 : 1;
      }

      if (leftRegister.passed !== rightRegister.passed) {
        return leftRegister.passed ? 1 : -1;
      }

      if (leftRegister.status !== rightRegister.status) {
        return leftRegister.status === "exception" ? -1 : 1;
      }

      return leftRegister.department.localeCompare(rightRegister.department);
    });
  const dayCloseCompletedCount = dayCloseChecks.filter(
    (register) => register.passed,
  ).length;
  const dayCloseChecklistReady =
    dayCloseCompletedCount === dayCloseChecks.length &&
    !dayCloseChecks.some((register) => register.status === "exception");
  const currentOperatingDay = operatingDays.find(
    (day) => day.operating_date === currentOperatingDate,
  );
  const dayCloseCheckByKey = new Map(
    dayCloseChecks.map((check) => [check.key, check]),
  );
  const liveRegisterBlockers: DayCloseBlocker[] = dayCloseChecks
    .filter((check) => !check.passed)
    .map((check) => ({
      type:
        check.status === "exception"
          ? "register_exception"
          : "missing_register",
      key: check.key,
      label: check.label,
      department: check.department,
      message:
        check.status === "exception"
          ? check.detail
          : `${check.label} has not been declared.`,
    }));
  const persistedNonRegisterBlockers = (currentOperatingDay?.blockers ?? [])
    .filter((blocker) => !dayCloseCheckByKey.has(blocker.key))
    .filter(
      (blocker, index, blockers) =>
        blockers.findIndex(
          (candidate) =>
            candidate.type === blocker.type && candidate.key === blocker.key,
        ) === index,
    );
  const dayCloseBlockers = [
    ...liveRegisterBlockers,
    ...persistedNonRegisterBlockers,
  ];
  const productionRunSummaries = Array.from(
    productionHistory
      .reduce(
        (runsById, row) => {
          const existingRun = runsById.get(row.production_run_id);
          const lossImpact = Math.max(row.naira_loss, 0);

          if (existingRun) {
            existingRun.ingredientCount += 1;
            existingRun.lossImpact += lossImpact;
          } else {
            runsById.set(row.production_run_id, {
              id: row.production_run_id,
              createdAt: row.created_at,
              recipeName: row.recipe_name,
              ingredientCount: 1,
              lossImpact,
            });
          }

          return runsById;
        },
        new Map<
          string,
          {
            id: string;
            createdAt: string;
            recipeName: string;
            ingredientCount: number;
            lossImpact: number;
          }
        >(),
      )
      .values(),
  );
  const stockCountSummaries = Array.from(
    stockVarianceHistory
      .reduce(
        (countsById, row) => {
          const existingCount = countsById.get(row.stock_count_id);
          const varianceImpact = Number(row.hard_currency_impact ?? 0);

          if (existingCount) {
            existingCount.itemCount += 1;
            existingCount.varianceImpact += varianceImpact;
          } else {
            countsById.set(row.stock_count_id, {
              id: row.stock_count_id,
              createdAt: row.created_at,
              itemCount: 1,
              varianceImpact,
            });
          }

          return countsById;
        },
        new Map<
          string,
          {
            id: string;
            createdAt: string;
            itemCount: number;
            varianceImpact: number;
          }
        >(),
      )
      .values(),
  );
  const allActivityEvents = [
    ...menuSaleSummaries.map((sale) => ({
      id: `sale-${sale.menu_sale_id}`,
      timestamp: sale.created_at,
      type: "Sale",
      title: sale.recipe_name,
      detail: `${sale.sold_quantity.toLocaleString(undefined, {
        maximumFractionDigits: 3,
      })} ${sale.output_uom ?? "unit"} sold`,
      value: `${organization.local_currency} ${sale.total_revenue.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )}`,
      tone: "positive" as const,
    })),
    ...productionRunSummaries.map((run) => ({
      id: `production-${run.id}`,
      timestamp: run.createdAt,
      type: "Production",
      title: run.recipeName,
      detail: `${run.ingredientCount.toLocaleString()} ingredient${
        run.ingredientCount === 1 ? "" : "s"
      } consumed`,
      value: `${organization.local_currency} ${run.lossImpact.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )} waste`,
      tone: run.lossImpact > 0 ? ("warning" as const) : ("neutral" as const),
    })),
    ...stockCountSummaries.map((count) => ({
      id: `stock-count-${count.id}`,
      timestamp: count.createdAt,
      type: "Stock count",
      title: "Physical count recorded",
      detail: `${count.itemCount.toLocaleString()} item${
        count.itemCount === 1 ? "" : "s"
      } counted`,
      value: `${formatSignedCurrency(count.varianceImpact)} variance`,
      tone:
        Math.abs(count.varianceImpact) > 0.01
          ? ("warning" as const)
          : ("neutral" as const),
    })),
    ...wasteExposureRows.map((row) => ({
      id: `waste-${row.waste_event_id}`,
      timestamp: row.created_at,
      type: "Waste",
      title: row.ingredient_name,
      detail: `${row.quantity.toLocaleString(undefined, {
        maximumFractionDigits: 3,
      })} ${row.uom ?? "unit"} at ${row.waste_stage.replaceAll("_", " ")}`,
      value: `${organization.local_currency} ${row.waste_cost.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 },
      )}`,
      tone: row.waste_cost > 0 ? ("warning" as const) : ("neutral" as const),
    })),
    ...ingredientPriceMovements.map((event) => {
      const movedUp = event.costDelta > 0;
      const movedDown = event.costDelta < 0;
      const movementLabel = movedUp ? "up" : movedDown ? "down" : "flat";

      return {
        id: `price-${event.id}`,
        timestamp: event.created_at,
        type: "Price",
        title: event.item?.name ?? "Ingredient cost",
        detail:
          event.changePct === null
            ? `Unit cost ${movementLabel}`
            : `Unit cost ${movementLabel} ${Math.abs(
                event.changePct,
              ).toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })}%`,
        value: formatSignedCurrency(event.onHandImpact),
        tone:
          event.onHandImpact > 0
            ? ("warning" as const)
            : event.onHandImpact < 0
              ? ("positive" as const)
              : ("neutral" as const),
      };
    }),
  ].sort(
      (leftEvent, rightEvent) =>
        getDateMs(rightEvent.timestamp) - getDateMs(leftEvent.timestamp),
    );
  const activityEvents = (
    isInventoryFocus
      ? allActivityEvents.filter((event) =>
          ["Production", "Stock count", "Waste"].includes(event.type),
        )
      : allActivityEvents
  ).slice(0, 12);
  const managementActions = [
    criticalExceptionCount > 0
      ? {
          priority: "Critical",
          action: "Resolve negative stock exceptions",
          detail: `${criticalExceptionCount.toLocaleString()} critical item${
            criticalExceptionCount === 1 ? "" : "s"
          } can distort recipe costing and depletion.`,
          tone: "critical" as const,
        }
      : null,
    underpricedMenuItems[0]
      ? {
          priority: "Revenue",
          action: `Recover margin on ${underpricedMenuItems[0].recipe.name}`,
          detail: `${organization.local_currency} ${underpricedMenuItems[0].priceGap.toLocaleString(
            undefined,
            { maximumFractionDigits: 2 },
          )} gap to hit ${targetMenuMarginPct}% target margin.`,
          tone: "attention" as const,
        }
      : null,
    largestPriceMover && largestPriceMover.costDelta > 0
      ? {
          priority: "Inflation",
          action: `Review supplier price for ${
            largestPriceMover.item?.name ?? "ingredient"
          }`,
          detail:
            largestPriceMover.changePct === null
              ? `${organization.local_currency} ${largestPriceMover.costDelta.toLocaleString(
                  undefined,
                  { maximumFractionDigits: 2 },
                )} unit cost increase.`
              : `${largestPriceMover.changePct.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}% unit cost increase.`,
          tone: "attention" as const,
        }
      : null,
    latestDayStockCountCount === 0
      ? {
          priority: "Control",
          action: "Complete physical count review",
          detail: "Inventory accuracy score improves once a count is recorded.",
          tone: "info" as const,
        }
      : null,
    latestDayWasteImpact > 0
      ? {
          priority: "Waste",
          action: "Isolate direct waste vector",
          detail: `${organization.local_currency} ${latestDayWasteImpact.toLocaleString(
            undefined,
            { maximumFractionDigits: 2 },
          )} logged on the latest operating day.`,
          tone: "attention" as const,
        }
      : null,
  ].filter(
    (
      action,
    ): action is {
      priority: string;
      action: string;
      detail: string;
      tone: "critical" | "attention" | "info";
    } => Boolean(action),
  );
  const visibleManagementActionSource = isKitchenFocus
    ? managementActions.filter((action) =>
        ["Critical", "Waste"].includes(action.priority),
      )
    : isInventoryFocus
      ? managementActions.filter((action) =>
          ["Critical", "Control", "Waste"].includes(action.priority),
        )
      : managementActions;
  const visibleManagementActions =
    visibleManagementActionSource.length > 0
      ? visibleManagementActionSource.slice(0, 4)
      : [
          {
            priority: "Stable",
            action: isInventoryFocus
              ? "Keep inventory movement clean"
              : isKitchenFocus
                ? "Keep kitchen execution clean"
                : "Maintain margin discipline",
            detail: isInventoryFocus
              ? "No urgent stock, receipt, requisition, or waste action is open."
              : isKitchenFocus
                ? "No urgent kitchen waste, stock, or production exception is open."
                : "No urgent margin loss is visible from current data.",
            tone: "info" as const,
          },
        ];
  const roleNextAction = isKitchenFocus
    ? awaitingRequisitionReceiptCount > 0
      ? {
          eyebrow: "Next kitchen action",
          title: "Acknowledge or reject received stock",
          detail:
            "Store has dispatched stock. Confirm only after the physical items are checked.",
          cta: "Open requisitions",
          sectionId: "requisitions",
          tone: "attention" as const,
        }
      : compliancePendingCount > 0
        ? {
            eyebrow: "Next kitchen action",
            title: "Close today's kitchen checklist",
            detail:
              "Confirm activity, declare zero activity, or raise an exception before day close.",
            cta: "Open checklist",
            sectionId: "day-control",
            tone: "attention" as const,
          }
        : {
            eyebrow: "Next kitchen action",
            title: "Kitchen controls are currently clear",
            detail:
              "Keep production, waste, and requisition evidence current as activity happens.",
            cta: "Review dashboard",
            sectionId: "inventory",
            tone: "healthy" as const,
          }
    : isStoreControlFocus
      ? openPurchaseOrderCount > 0
        ? {
            eyebrow: isStorekeeperFocus
              ? "Next storekeeper action"
              : "Next inventory action",
            title: "Review open purchase orders",
            detail:
              "Confirm receipts only after goods are physically checked into the selected storage location.",
            cta: "Open purchase orders",
            sectionId: "purchase-orders",
            tone: "attention" as const,
          }
        : openRequisitionRequestCount > 0
          ? {
              eyebrow: isStorekeeperFocus
                ? "Next storekeeper action"
                : "Next inventory action",
              title: "Dispatch department requisitions",
              detail:
                "Record issued quantities clearly; department stock moves only after receiver acknowledgement.",
              cta: "Open requisitions",
              sectionId: "requisitions",
              tone: "attention" as const,
            }
          : reorderTodayCount > 0
            ? {
                eyebrow: isStorekeeperFocus
                  ? "Next storekeeper action"
                  : "Next inventory action",
                title: "Review SKU reorder flags",
                detail:
                  "Prioritize low, negative, and high-value stock exceptions before they distort AvT.",
                cta: "Open SKU table",
                sectionId: "inventory",
                tone: "attention" as const,
              }
            : {
                eyebrow: isStorekeeperFocus
                  ? "Next storekeeper action"
                  : "Next inventory action",
                title: "Inventory controls are currently clear",
                detail:
                  "Keep purchase order receipts, requisitions, counts, and adjustments clean as activity happens.",
                cta: "Review inventory",
                sectionId: "inventory",
                tone: "healthy" as const,
              }
      : isProcurementFocus
        ? openPurchaseOrderCount > 0
          ? {
              eyebrow: "Next procurement action",
              title: "Review supplier purchase orders",
              detail:
                "Keep supplier orders, expected receipts, and short-supply follow-up visible before Inventory receives.",
              cta: "Open purchase orders",
              sectionId: "purchase-orders",
              tone: "attention" as const,
            }
          : {
              eyebrow: "Next procurement action",
              title: "Supplier ordering is currently clear",
              detail:
                "Monitor supplier pricing, draft purchase orders, and receipt exceptions as they arise.",
              cta: "Open procurement",
              sectionId: "purchase-orders",
              tone: "healthy" as const,
            }
        : isOperationsFocus
          ? openRequisitionRequestCount > 0
            ? {
                eyebrow: "Next operations action",
                title: "Review department stock movement",
                detail:
                  "Requisitions and receiver acknowledgements need clean ownership before the day is closed.",
                cta: "Open requisitions",
                sectionId: "requisitions",
                tone: "attention" as const,
              }
            : compliancePendingCount > 0
              ? {
                  eyebrow: "Next operations action",
                  title: "Close operating controls",
                  detail:
                    "Confirm activity, declare zero activity, or raise exceptions for the required registers.",
                  cta: "Open checklist",
                  sectionId: "day-control",
                  tone: "attention" as const,
                }
              : {
                  eyebrow: "Next operations action",
                  title: "Operations controls are currently clear",
                  detail:
                    "Keep requisitions, production, waste, and daily evidence clean as work happens.",
                  cta: "Review operations",
                  sectionId: "day-control",
                  tone: "healthy" as const,
                }
          : compliancePendingCount > 0
        ? {
            eyebrow: isAdminFocus ? "Next admin action" : "Next finance action",
            title: "Review daily operating controls",
            detail:
              "AvT is strongest when POS, registers, and exceptions are complete before close.",
            cta: "Open checklist",
            sectionId: "day-control",
            tone: "attention" as const,
          }
        : {
            eyebrow: isAdminFocus ? "Next admin action" : "Next finance action",
            title: isAdminFocus ? "Review workspace exposure" : "Review margin exposure",
            detail:
              "Check sales, food cost, waste, and AvT confidence before approving conclusions.",
            cta: "Open margin view",
            sectionId: "overview",
            tone: "healthy" as const,
          };
  const ownedDayCloseActions = dayCloseChecks
    .filter((check) => canActOnRegister(check) && !check.passed)
    .slice(0, 3)
    .map((check) => ({
      id: check.key,
      label: check.label,
      department: check.department,
      ownerRole: check.ownerRole,
      status: check.status,
      detail: check.detail,
      actionLabel:
        check.status === "exception" ? "Fix issue" : getRegisterActionLabel(check),
      sectionId: "day",
      targetElementId: "day-close-checklist",
    }));
  const visibleDayDisciplineActions =
    ownedDayCloseActions.length > 0
      ? ownedDayCloseActions
      : [
          {
            id: "clear",
            label: "No owned checklist blockers",
            department: roleLabels[focusRole],
            ownerRole: focusRole,
            status: "clear" as const,
            detail: isAuditFocus
              ? "Your current view is review-only. Check exceptions and close evidence before approval."
              : "Your required daily registers are clear for the selected operating date.",
            actionLabel: isAuditFocus ? "Review close" : "Review day",
            sectionId: "day",
            targetElementId: "day-close-checklist",
          },
        ];
  const roleDashboardLabel = isKitchenFocus
    ? "Kitchen Dashboard"
    : isInventoryFocus
      ? "Inventory Dashboard"
      : isStorekeeperFocus
        ? "Storekeeper Dashboard"
        : isProcurementFocus
          ? "Procurement Dashboard"
          : isOperationsFocus
            ? "Operations Dashboard"
            : isAdminFocus
              ? "Admin Dashboard"
              : isFinanceFocus
                ? "Finance Dashboard"
                : `${roleLabels[focusRole]} Dashboard`;
  const roleDashboardHeadline = `${organization.name} ${
    isKitchenFocus
      ? "kitchen command."
      : isInventoryFocus
        ? "inventory command."
        : isStorekeeperFocus
          ? "store command."
          : isProcurementFocus
            ? "procurement command."
            : isOperationsFocus
              ? "operations command."
              : isAdminFocus
                ? "workspace command."
                : "margin command."
  }`;
  const roleDashboardDescription = isKitchenFocus
    ? "Kitchen inventory, production readiness, ingredient shortages, and transfer exposure across"
    : isInventoryFocus
      ? "Inventory accuracy, replenishment exposure, supplier receipts, and department stock movement across"
      : isStorekeeperFocus
        ? "Store receipts, stock issues, SKU exceptions, and storage accuracy across"
        : isProcurementFocus
          ? "Supplier ordering, purchase order exposure, delivery follow-up, and supplier price activity across"
          : isOperationsFocus
            ? "Requisitions, production evidence, waste exposure, and day-close accountability across"
            : isAdminFocus
              ? "Workspace controls, role activity, margin exposure, and operating compliance across"
              : "Revenue, margin exceptions, and visible margin exposure across";
  const roleHeroSignals = isKitchenFocus
    ? [
        {
          label: "Kitchen SKUs",
          value: activeInventoryItems.length.toLocaleString(),
          detail: "Assigned stock",
          tone: "info" as const,
        },
        {
          label: "Shortages",
          value: productionPlanShortageCount.toLocaleString(),
          detail: "Production plan",
          tone:
            productionPlanShortageCount > 0
              ? ("attention" as const)
              : ("healthy" as const),
        },
        {
          label: "Open requests",
          value: openRequisitionRequestCount.toLocaleString(),
          detail: "Awaiting store",
          tone:
            openRequisitionRequestCount > 0
              ? ("attention" as const)
              : ("healthy" as const),
        },
      ]
    : isInventoryFocus
      ? [
          {
            label: "Accuracy",
            value: `${inventoryAccuracyScore}%`,
            detail: "Stock control",
            tone:
              inventoryAccuracyScore >= 85
                ? ("healthy" as const)
                : inventoryAccuracyScore >= 65
                  ? ("attention" as const)
                  : ("critical" as const),
          },
          {
            label: "Reorder",
            value: reorderTodayCount.toLocaleString(),
            detail: "SKU flags",
            tone:
              reorderTodayCount > 0
                ? ("attention" as const)
                : ("healthy" as const),
          },
          {
            label: "Open purchase orders",
            value: openPurchaseOrderCount.toLocaleString(),
            detail: "Supplier queue",
            tone:
              openPurchaseOrderCount > 0
                ? ("attention" as const)
                : ("healthy" as const),
          },
          {
            label: "Requisitions",
            value: openRequisitionRequestCount.toLocaleString(),
            detail: "Department queue",
            tone:
              openRequisitionRequestCount > 0
                ? ("attention" as const)
                : ("healthy" as const),
          },
        ]
      : isProcurementFocus
        ? [
            {
              label: "Purchase orders",
              value: openPurchaseOrderCount.toLocaleString(),
              detail: "Supplier queue",
              tone:
                openPurchaseOrderCount > 0
                  ? ("attention" as const)
                  : ("healthy" as const),
            },
            {
              label: "Partial delivery",
              value: partialPurchaseOrders.length.toLocaleString(),
              detail: "Follow-up required",
              tone:
                partialPurchaseOrders.length > 0
                  ? ("attention" as const)
                  : ("healthy" as const),
            },
            {
              label: "Suppliers",
              value: activeSuppliers.length.toLocaleString(),
              detail: "Active vendors",
              tone: "info" as const,
            },
            {
              label: "Price changes",
              value: costEvents.length.toLocaleString(),
              detail: "Supplier price activity",
              tone:
                costEvents.length > 0
                  ? ("attention" as const)
                  : ("healthy" as const),
            },
          ]
        : isOperationsFocus
          ? [
              {
                label: "Requisitions",
                value: openRequisitionRequestCount.toLocaleString(),
                detail: "Open movement",
                tone:
                  openRequisitionRequestCount > 0
                    ? ("attention" as const)
                    : ("healthy" as const),
              },
              {
                label: "Production gaps",
                value: productionPlanShortageCount.toLocaleString(),
                detail: "Plan shortages",
                tone:
                  productionPlanShortageCount > 0
                    ? ("attention" as const)
                    : ("healthy" as const),
              },
              {
                label: "Waste events",
                value: latestDayWasteRows.length.toLocaleString(),
                detail: "Latest day",
                tone:
                  latestDayWasteRows.length > 0
                    ? ("attention" as const)
                    : ("healthy" as const),
              },
              {
                label: "Compliance",
                value: `${readinessScore}%`,
                detail: "Control score",
                tone:
                  readinessScore >= 80
                    ? ("healthy" as const)
                    : readinessScore >= 55
                      ? ("attention" as const)
                      : ("critical" as const),
              },
            ]
          : [
          {
            label: "Margin health",
            value: `${marginHealthScore}%`,
            detail: "Current score",
            tone:
              marginHealthScore >= 80
                ? ("healthy" as const)
                : marginHealthScore >= 60
                  ? ("attention" as const)
                  : ("critical" as const),
          },
          {
            label: "Critical alerts",
            value: criticalExceptionCount.toLocaleString(),
            detail: "Needs review",
            tone:
              criticalExceptionCount > 0
                ? ("critical" as const)
                : ("healthy" as const),
          },
          {
            label: "Margin risk",
            value: formatCurrency(potentialLossExposure, 0),
            detail: "Visible exposure",
            tone:
              potentialLossExposure > 0
                ? ("attention" as const)
                : ("healthy" as const),
          },
        ];
  const ownerMetricCards = [
    {
      label: "Revenue",
      value: formatCurrency(latestDayRevenue),
      detail:
        previousDayRevenue > 0
          ? `${formatSignedCurrency(latestDayRevenue - previousDayRevenue)} vs previous operating day`
          : latestOperatingDayLabel,
      tone: "info" as const,
    },
    {
      label: "Gross margin",
      value:
        latestDayMarginPct === null
          ? `${marginHealthScore}%`
          : `${latestDayMarginPct.toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}%`,
      detail:
        latestDayFoodCostPct === null
          ? `${targetMenuMarginPct}% target margin benchmark`
          : `${latestDayFoodCostPct.toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}% food cost`,
      tone:
        latestDayMarginPct === null
          ? marginHealthScore >= 75
            ? ("healthy" as const)
            : ("attention" as const)
          : latestDayMarginPct >= targetMenuMarginPct
            ? ("healthy" as const)
            : latestDayMarginPct >= 50
              ? ("attention" as const)
              : ("critical" as const),
    },
    {
      label: "Overall leak",
      value: formatCurrency(ownerOverallLeakValue),
      detail:
        ownerOverallLeakValue > 0
          ? "Waste and price inflation exposure"
          : "No waste or price inflation exposure",
      tone:
        ownerOverallLeakValue > Math.max(1000, totalSalesRevenue * 0.08)
          ? ("critical" as const)
          : ownerOverallLeakValue > 0
            ? ("attention" as const)
            : ("healthy" as const),
    },
    {
      label: "Control readiness",
      value: `${readinessScore}%`,
      detail:
        compliancePendingCount > 0
          ? `${compliancePendingCount.toLocaleString()} register${
              compliancePendingCount === 1 ? "" : "s"
            } open`
          : "Required registers complete",
      tone:
        complianceExceptionCount > 0
          ? ("critical" as const)
          : compliancePendingCount > 0
            ? ("attention" as const)
            : ("healthy" as const),
    },
  ];
  const ownerSecondaryMetricCards = [
    {
      label: "Gross profit",
      value: formatCurrency(latestDayGrossProfit),
      detail:
        previousDayGrossProfit !== 0
          ? `${formatSignedCurrency(latestDayGrossProfit - previousDayGrossProfit)} vs previous operating day`
          : "Revenue retained after food cost",
      tone: latestDayGrossProfit >= 0 ? ("healthy" as const) : ("critical" as const),
    },
    {
      label: "Leakage rate",
      value:
        visibleLeakageRate === null
          ? "N/A"
          : `${visibleLeakageRate.toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}%`,
      detail:
        visibleLeakageRate === null
          ? "Record sales to benchmark leakage against revenue"
          : "Visible leakage as a share of latest revenue",
      tone:
        visibleLeakageRate === null
          ? ("info" as const)
          : visibleLeakageRate >= 8
            ? ("critical" as const)
            : visibleLeakageRate > 0
              ? ("attention" as const)
              : ("healthy" as const),
    },
    {
      label: "Food cost",
      value:
        latestDayFoodCostPct === null
          ? "N/A"
          : `${latestDayFoodCostPct.toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}%`,
      detail: `${targetMenuMarginPct}% target margin benchmark`,
      tone:
        latestDayFoodCostPct === null
          ? ("info" as const)
          : latestDayFoodCostPct >= 40
            ? ("attention" as const)
            : ("healthy" as const),
    },
  ];
  const ownerLeakageRows = profitMovementRows
    .map((row) => ({
      ...row,
      leakage: Math.max(-row.value, 0),
      recovery: Math.max(row.value, 0),
    }))
    .sort(
      (leftRow, rightRow) =>
        Math.max(rightRow.leakage, rightRow.recovery) -
        Math.max(leftRow.leakage, leftRow.recovery),
    );
  const ownerAttentionItems: Array<{
    label: string;
    title: string;
    detail: string;
    value: string;
    valueLabel: string;
    status: string;
    tone: SemanticTone;
    targetRole: AppRole;
    sectionId: string;
    targetElementId: string;
  }> = [];

  if (negativeStockExceptions.length > 0) {
    ownerAttentionItems.push({
      label: "Inventory",
      title: `Negative stock on ${negativeStockExceptions.length.toLocaleString()} item${
        negativeStockExceptions.length === 1 ? "" : "s"
      }`,
      detail: "These can distort recipe costs, depletion, and margin reporting.",
      value: negativeStockExceptions[0]?.impact ?? "Review",
      valueLabel: "Largest exposure",
      status: "Unfavorable",
      tone: "critical",
      targetRole: "inventory_manager",
      sectionId: "overview",
      targetElementId: "inventory-location-summary",
    });
  }

  if (partialPurchaseOrders.length > 0) {
    ownerAttentionItems.push({
      label: "Supplier delivery",
      title: `${partialPurchaseOrders.length.toLocaleString()} purchase order${
        partialPurchaseOrders.length === 1 ? "" : "s"
      } partially delivered`,
      detail:
        partialPurchaseOrders[0]?.short_supply_reason ||
        "Ordered quantities remain outstanding after a confirmed GRN.",
      value: partialPurchaseOrders[0]?.po_number ?? "Review",
      valueLabel: "Purchase order",
      status: "Follow up",
      tone: "attention",
      targetRole: "procurement_manager",
      sectionId: "overview",
      targetElementId: "supplier-performance-summary",
    });
  }

  if (underpricedMenuItems[0]) {
    ownerAttentionItems.push({
      label: "Menu price",
      title: `${underpricedMenuItems[0].recipe.name} is below target margin`,
      detail: `The selling price needs adjustment to protect the ${targetMenuMarginPct}% target margin.`,
      value: formatCurrency(underpricedMenuItems[0].priceGap),
      valueLabel: "Price increase needed",
      status: "Margin at risk",
      tone: "attention",
      targetRole: "finance_manager",
      sectionId: "overview",
      targetElementId: "menu-profitability-summary",
    });
  }

  if (latestYieldMasterUpdateNotification) {
    const yieldItem = activeInventoryItemsById.get(
      extractUuid(latestYieldMasterUpdateNotification.inventory_item_id),
    );

    ownerAttentionItems.push({
      label: "Yield",
      title: `${yieldItem?.name ?? "High-value SKU"} master yield updated`,
      detail:
        latestYieldMasterUpdateNotification.detail ||
        "A three-test average changed the SKU master yield used for costing review.",
      value: `${Math.round(Number(yieldItem?.yield_pct ?? 0) * 100)}%`,
      valueLabel: "New usable yield",
      status: "Costing changed",
      tone: "attention",
      targetRole: "kitchen_manager",
      sectionId: "overview",
      targetElementId: "menu-profitability-summary",
    });
  }

  if (largestPriceIncreaseMover) {
    ownerAttentionItems.push({
      label: "Costing",
      title: `${largestPriceIncreaseMover.item?.name ?? "Ingredient"} cost moved up`,
      detail: "The latest ingredient cost increased and may reduce menu margin if the selling price stays unchanged.",
      value:
        largestPriceIncreaseMover.changePct === null
          ? formatCurrency(largestPriceIncreaseMover.costDelta)
          : `${largestPriceIncreaseMover.changePct.toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}%`,
      valueLabel:
        largestPriceIncreaseMover.changePct === null
          ? "Cost increase"
          : "Cost increase rate",
      status: "Unfavorable",
      tone: "attention",
      targetRole: "procurement_manager",
      sectionId: "overview",
      targetElementId: "ingredient-price-summary",
    });
  }

  if (latestDayWasteImpact > 0) {
    ownerAttentionItems.push({
      label: "Waste",
      title: "Waste cost needs review",
      detail: `${latestDayWasteRows.length.toLocaleString()} waste event${
        latestDayWasteRows.length === 1 ? "" : "s"
      } logged on the latest operating day; this amount reduced operating margin.`,
      value: formatCurrency(latestDayWasteImpact),
      valueLabel: "Waste cost",
      status: "Loss recorded",
      tone: "attention",
      targetRole: "inventory_manager",
      sectionId: "overview",
      targetElementId: "waste-analysis-summary",
    });
  }

  const visibleOwnerAttentionItems =
    ownerAttentionItems.length > 0
      ? ownerAttentionItems.slice(0, 4)
      : [
          {
            label: "Stable",
            title: "No material margin exceptions",
            detail: "Sales, inventory, waste, and supplier cost movement remain stable in the selected period.",
            value: "Clear",
            valueLabel: "Current assessment",
            status: "Favorable",
            tone: "healthy" as const,
            targetRole: "finance_manager" as AppRole,
            sectionId: "overview",
            targetElementId: "trend-analysis-summary",
          },
        ];
  const ownerExecutiveAction = visibleOwnerAttentionItems[0];
  const ownerLocationRows =
    locationStockSummaries.length > 0
      ? locationStockSummaries.slice(0, 4).map((location) => {
          const locationRecord = activeLocations.find(
            (activeLocation) => activeLocation.name === location.location,
          );
          const locationItems = activeInventoryItems.filter(
            (item) =>
              extractUuid(item.location_id) ===
              extractUuid(locationRecord?.id),
          );
          const negativeValue = locationItems.reduce((total, item) => {
            const stockQty = Number(item.on_hand_qty ?? 0);

            return stockQty < 0
              ? total +
                  Math.abs(stockQty) *
                    Number(item.current_cost_per_base_uom ?? 0)
              : total;
          }, 0);
          const watchCount = locationItems.filter((item) => {
            const stockQty = Number(item.on_hand_qty ?? 0);

            return stockQty >= 0 && stockQty <= 1;
          }).length;

          return {
            location: location.location,
            stockValue: location.stockValue,
            detail: `${location.itemCount.toLocaleString()} SKU${
              location.itemCount === 1 ? "" : "s"
            } tracked · ${location.highValueCount.toLocaleString()} high-value SKU${
              location.highValueCount === 1 ? "" : "s"
            }`,
            status:
              negativeValue > 0
                ? `Negative stock: ${formatCurrency(negativeValue, 0)} at risk`
                : watchCount > 0
                  ? `${watchCount.toLocaleString()} stock exception${
                      watchCount === 1 ? "" : "s"
                    }`
                  : "Stock levels within range",
            statusDetail:
              negativeValue > 0
                ? "On-hand quantities require correction."
                : watchCount > 0
                  ? "Low-stock items need replenishment review."
                  : "No negative or low-stock flags.",
            tone:
              negativeValue > 0
                ? ("critical" as const)
                : watchCount > 0
                  ? ("attention" as const)
                  : ("healthy" as const),
          };
        })
      : [
          {
            location: "No location stock yet",
            stockValue: 0,
            detail: "Create locations and assign inventory to see this view.",
            status: "Setup required",
            statusDetail: "No inventory valuation is available yet.",
            tone: "info" as const,
          },
        ];
  const ownerInventoryTypeRows = Array.from(
    inventoryValuationItems
      .reduce(
        (typesByName, item) => {
          const key = String(item.item_type ?? item.cost_type ?? "unclassified")
            .replaceAll("_", " ")
            .trim();
          const stableIdentity =
            String(item.sku ?? "").trim().toLowerCase() ||
            extractUuid(item.recipe_id) ||
            String(item.name ?? "").trim().toLowerCase() ||
            extractUuid(item.origin_inventory_item_id) ||
            extractUuid(item.id);
          const skuKey = `${String(item.cost_type ?? "unknown")}:${stableIdentity}`;
          const quantity = Math.max(Number(item.on_hand_qty ?? 0), 0);
          const stockValue =
            quantity * Number(item.current_cost_per_base_uom ?? 0);
          const existingType = typesByName.get(key);

          if (existingType) {
            existingType.skuKeys.add(skuKey);
            if (item.is_high_value) {
              existingType.highValueKeys.add(skuKey);
            }
            existingType.stockValue += stockValue;
          } else {
            typesByName.set(key, {
              type: key || "Unclassified",
              skuKeys: new Set([skuKey]),
              highValueKeys: new Set(item.is_high_value ? [skuKey] : []),
              stockValue,
            });
          }

          return typesByName;
        },
        new Map<
          string,
          {
            type: string;
            skuKeys: Set<string>;
            highValueKeys: Set<string>;
            stockValue: number;
          }
        >(),
      )
      .values(),
  )
    .map((row) => ({
      type: row.type,
      skuCount: row.skuKeys.size,
      highValueCount: row.highValueKeys.size,
      stockValue: row.stockValue,
    }))
    .sort((first, second) => second.stockValue - first.stockValue);
  const ownerRevenuePoints =
    financialTrendPoints.length > 0
      ? financialTrendPoints.slice(-7)
      : [
          {
            dateKey: "",
            label: "Today",
            revenue: latestDayRevenue,
            grossProfit: latestDayGrossProfit,
            waste: 0,
            priceImpact: 0,
            stockVariance: 0,
            marginLoss: Math.max(
              latestDayRevenue * (targetMenuMarginPct / 100) -
                latestDayGrossProfit,
              0,
            ),
            marginRecovery: Math.max(
              latestDayGrossProfit -
                latestDayRevenue * (targetMenuMarginPct / 100),
              0,
            ),
          },
        ];
  const ownerTrendDatePoints = ownerRevenuePoints;
  const ownerSalesTrendProductOptions = menuPerformance
    .map((item) => item.name)
    .filter(Boolean)
    .sort((leftName, rightName) => leftName.localeCompare(rightName));
  const ownerTrendLocationOptions = activeLocations
    .filter((location) => location.is_active)
    .map((location) => ({
      id: extractUuid(location.id),
      name: location.name,
    }))
    .filter((location) => location.id);
  const ownerProcurementTrendOptions = [
    ...Array.from(
      new Set(
        allPurchaseOrders
          .map((order) => order.supplier_name?.trim())
          .filter((supplierName): supplierName is string => Boolean(supplierName)),
      ),
    )
      .sort((leftName, rightName) => leftName.localeCompare(rightName))
      .map((supplierName) => ({
        value: `supplier:${supplierName}`,
        label: `Supplier: ${supplierName}`,
      })),
    ...ownerTrendLocationOptions.map((location) => ({
      value: `location:${location.id}`,
      label: `Receiving: ${location.name}`,
    })),
  ];
  const ownerComplianceDepartmentOptions = Array.from(
    new Set(
      complianceRegisters
        .map((register) => register.department)
        .filter(Boolean),
    ),
  ).sort((leftDepartment, rightDepartment) =>
    leftDepartment.localeCompare(rightDepartment),
  );
  const ownerMarginTrendProductOptions = ownerSalesTrendProductOptions;
  const ownerLeakTrendPoints = ownerTrendDatePoints.map((point) => {
    const movementWasteValue = stockMovementLedger
      .filter((movement) => {
        const isWasteMovement =
          String(movement.event_type ?? "").toLowerCase().includes("waste") ||
          String(movement.source_table ?? "").toLowerCase() === "waste_events";

        if (!isWasteMovement || getDateKey(movement.created_at) !== point.dateKey) {
          return false;
        }

        return ownerLeakTrendLocationFilter
          ? extractUuid(movement.location_id) === ownerLeakTrendLocationFilter
          : true;
      })
      .reduce(
        (total, movement) =>
          total + Math.abs(Number(movement.movement_value ?? 0)),
        0,
      );
    const exposureWasteValue = ownerLeakTrendLocationFilter ? 0 : point.waste;
    const wasteValue =
      movementWasteValue > 0 ? movementWasteValue : exposureWasteValue;

    return {
      dateKey: point.dateKey,
      label: point.label,
      value:
        Math.max(wasteValue, 0) +
        (ownerLeakTrendLocationFilter ? 0 : Math.max(point.priceImpact, 0)),
    };
  });
  const ownerProcurementTrendPoints = ownerTrendDatePoints.map((point) => {
    const daySpend = purchaseOrderLines
      .filter((line) => {
        if (getDateKey(line.created_at) !== point.dateKey) {
          return false;
        }

        const order = allPurchaseOrders.find(
          (purchaseOrder) => purchaseOrder.id === line.purchase_order_id,
        );

        if (ownerProcurementTrendFilter.startsWith("supplier:")) {
          return (
            order?.supplier_name?.trim() ===
            ownerProcurementTrendFilter.replace("supplier:", "")
          );
        }

        if (ownerProcurementTrendFilter.startsWith("location:")) {
          return (
            extractUuid(order?.receiving_location_id) ===
            ownerProcurementTrendFilter.replace("location:", "")
          );
        }

        return true;
      })
      .reduce(
        (total, line) =>
          total +
          Number(line.qty ?? 0) * Number(line.landed_unit_cost ?? 0),
        0,
      );

    return {
      dateKey: point.dateKey,
      label: point.label,
      value: daySpend,
    };
  });
  const ownerComplianceTrendPoints = ownerTrendDatePoints.map((point) => {
    const dayEntries = operationRegisterEntries.filter(
      (entry) =>
        getDateKey(entry.operating_date || entry.submitted_at) === point.dateKey &&
        (!ownerComplianceTrendDepartmentFilter ||
          entry.department === ownerComplianceTrendDepartmentFilter),
    );
    const dayClearEntries = dayEntries.filter(
      (entry) => entry.status === "completed" || entry.status === "clear",
    );

    return {
      dateKey: point.dateKey,
      label: point.label,
      value:
        dayEntries.length > 0
          ? (dayClearEntries.length / dayEntries.length) * 100
          : point.dateKey === currentOperatingDate
            ? readinessScore
            : 0,
    };
  });
  const ownerGrossMarginTrendPoints = ownerTrendDatePoints.map((point) => {
    const daySales = menuSaleSummaries.filter(
      (sale) =>
        getDateKey(sale.operating_date || sale.created_at) === point.dateKey &&
        (!ownerMarginTrendProductFilter ||
          sale.recipe_name === ownerMarginTrendProductFilter),
    );
    const revenue = ownerMarginTrendProductFilter
      ? daySales.reduce((total, sale) => total + sale.total_revenue, 0)
      : point.revenue;
    const grossProfit = ownerMarginTrendProductFilter
      ? daySales.reduce((total, sale) => total + sale.gross_profit, 0)
      : point.grossProfit;

    return {
      dateKey: point.dateKey,
      label: point.label,
      value: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    };
  });
  const ownerTrendCards = [
    {
      label: "Sales",
      detail: ownerSalesTrendProductFilter
        ? `Revenue for ${ownerSalesTrendProductFilter}.`
        : "Revenue captured in the selected period.",
      points: ownerTrendDatePoints.map((point) => ({
        dateKey: point.dateKey,
        label: point.label,
        value: menuSaleSummaries
          .filter(
            (sale) =>
              getDateKey(sale.operating_date || sale.created_at) ===
                point.dateKey &&
              (!ownerSalesTrendProductFilter ||
                sale.recipe_name === ownerSalesTrendProductFilter),
          )
          .reduce((total, sale) => total + sale.total_revenue, 0),
      })),
      tone: "info" as const,
      filterLabel: "Product",
      filterValue: ownerSalesTrendProductFilter,
      onFilterChange: setOwnerSalesTrendProductFilter,
      filterOptions: ownerSalesTrendProductOptions.map((productName) => ({
        value: productName,
        label: productName,
      })),
      valueFormatter: (value: number) => formatCurrency(value, 0),
    },
    {
      label: "Leaks",
      detail: ownerLeakTrendLocationFilter
        ? `Waste exposure at ${
            ownerTrendLocationOptions.find(
              (location) => location.id === ownerLeakTrendLocationFilter,
            )?.name ?? "selected location"
          }.`
        : "Waste and price inflation exposure across all locations.",
      points: ownerLeakTrendPoints,
      tone: "critical" as const,
      filterLabel: "Location",
      filterValue: ownerLeakTrendLocationFilter,
      onFilterChange: setOwnerLeakTrendLocationFilter,
      filterOptions: ownerTrendLocationOptions.map((location) => ({
        value: location.id,
        label: location.name,
      })),
      valueFormatter: (value: number) => formatCurrency(value, 0),
    },
    {
      label: "Procurement",
      detail: ownerProcurementTrendFilter
        ? "Purchase spend for the selected supplier or receiving location."
        : "Purchase order spend posted by date.",
      points: ownerProcurementTrendPoints,
      tone: "attention" as const,
      filterLabel: "Supplier / receiving",
      filterValue: ownerProcurementTrendFilter,
      onFilterChange: setOwnerProcurementTrendFilter,
      filterOptions: ownerProcurementTrendOptions,
      valueFormatter: (value: number) => formatCurrency(value, 0),
    },
    {
      label: "Compliance rate",
      detail: ownerComplianceTrendDepartmentFilter
        ? `${ownerComplianceTrendDepartmentFilter} register completion signal.`
        : "Daily register completion signal.",
      points: ownerComplianceTrendPoints,
      tone: "healthy" as const,
      filterLabel: "Department",
      filterValue: ownerComplianceTrendDepartmentFilter,
      onFilterChange: setOwnerComplianceTrendDepartmentFilter,
      filterOptions: ownerComplianceDepartmentOptions.map((department) => ({
        value: department,
        label: department,
      })),
      valueFormatter: (value: number) =>
        `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}%`,
    },
    {
      label: "Gross margin",
      detail: ownerMarginTrendProductFilter
        ? `Margin trend for ${ownerMarginTrendProductFilter}.`
        : `Target benchmark: ${targetMenuMarginPct}%.`,
      points: ownerGrossMarginTrendPoints,
      tone: "healthy" as const,
      filterLabel: "Product",
      filterValue: ownerMarginTrendProductFilter,
      onFilterChange: setOwnerMarginTrendProductFilter,
      filterOptions: ownerMarginTrendProductOptions.map((productName) => ({
        value: productName,
        label: productName,
      })),
      valueFormatter: (value: number) =>
        `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`,
    },
  ];
  const renderOwnerTrendCard = (card: (typeof ownerTrendCards)[number]) => {
    const values = card.points.map((point) => point.value);
    const maxValue = Math.max(1, ...values);
    const minValue = Math.min(0, ...values);
    const range = Math.max(maxValue - minValue, 1);
    const width = 360;
    const height = 140;
    const xStep = card.points.length > 1 ? width / (card.points.length - 1) : width;
    const linePoints = card.points
      .map((point, index) => {
        const x = card.points.length > 1 ? index * xStep : width / 2;
        const y = height - ((point.value - minValue) / range) * (height - 10) - 5;

        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    const latestPoint = card.points[card.points.length - 1];
    const toneClass =
      card.tone === "critical"
        ? "text-red-800 stroke-red-600"
        : card.tone === "attention"
          ? "text-amber-800 stroke-amber-500"
          : card.tone === "healthy"
            ? "text-emerald-800 stroke-emerald-600"
            : "text-blue-800 stroke-blue-500";

    return (
      <article
        key={card.label}
        className="grid min-h-[360px] content-between rounded-xl border border-slate-100 bg-white p-5 shadow-sm"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
          <span>
            <span className="block text-sm font-black text-slate-950">
              {card.label}
            </span>
            <span className="mt-1 block text-xs font-medium text-slate-500">
              {card.detail}
            </span>
          </span>
          <span className={`font-mono text-lg font-black ${toneClass}`}>
            {latestPoint ? card.valueFormatter(latestPoint.value) : card.valueFormatter(0)}
          </span>
        </div>
        <label className="mt-4 grid gap-1 text-xs font-black uppercase tracking-widest text-slate-400">
          {card.filterLabel}
          <select
            value={card.filterValue}
            onChange={(event) => card.onFilterChange(event.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          >
            <option value="">All</option>
            {card.filterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 h-44 overflow-hidden rounded-lg border border-slate-100 bg-[#faf9f6] p-3">
          {card.points.length > 0 ? (
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              className="h-full w-full"
              aria-hidden="true"
            >
              <line
                x1="0"
                y1={height - 6}
                x2={width}
                y2={height - 6}
                className="stroke-slate-200"
                strokeWidth="1"
              />
              <polyline
                points={linePoints}
                fill="none"
                className={toneClass}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              No trend data yet.
            </div>
          )}
        </div>
        <div className="mt-3 grid gap-2" style={{
          gridTemplateColumns: `repeat(${Math.max(card.points.length, 1)}, minmax(0, 1fr))`,
        }}>
          {card.points.map((point) => (
            <span
              key={`${card.label}-${point.dateKey || point.label}`}
              className="truncate text-center text-[10px] font-black text-slate-400"
              title={point.label}
            >
              {point.label}
            </span>
          ))}
        </div>
      </article>
    );
  };
  const ownerFoodCostRows = [...activeSubRecipes, ...activeFinalMenuItems]
    .map((recipe) => {
      const recipeFamily = activeRecipes.filter(
        (familyRecipe) =>
          familyRecipe.recipe_type === recipe.recipe_type &&
          familyRecipe.name.trim().toLowerCase() ===
            recipe.name.trim().toLowerCase(),
      );
      const recipeIds = recipeFamily.map(getRecipeId);
      const components = dedupeRecipeComponentsByIngredient(
        recipeComponents.filter(
          (component) =>
            recipeIds.includes(extractUuid(component.recipe_id)) &&
            component.component_inventory_item_id,
        ),
      );
      const batchQty = Math.max(
        1,
        ...recipeFamily.map((familyRecipe) =>
          Number(familyRecipe.standard_batch_output_qty ?? 1),
        ),
      );
      const totalCost = components.reduce((totalCostValue, component) => {
        const item = activeInventoryItemsById.get(
          extractUuid(component.component_inventory_item_id),
        );
        const unitCost = Number(
          item?.current_cost_per_base_uom ?? component.ingredient_unit_cost ?? 0,
        );

        return totalCostValue + Number(component.qty_in_recipe_uom ?? 0) * unitCost;
      }, 0);
      const costPerBatch = batchQty > 0 ? totalCost / batchQty : totalCost;
      const sellingPrice = Number(recipe.selling_price ?? 0);
      const isFinalMenu =
        recipe.recipe_type === "final_menu_item" ||
        recipe.recipe_type === "final_dish";
      const foodCostPct =
        isFinalMenu && sellingPrice > 0
          ? (costPerBatch / sellingPrice) * 100
          : null;
      const grossMarginPct =
        isFinalMenu && sellingPrice > 0
          ? ((sellingPrice - costPerBatch) / sellingPrice) * 100
          : null;
      const recommendedPrice =
        isFinalMenu && costPerBatch > 0
          ? costPerBatch / (targetMenuFoodCostPct / 100)
          : sellingPrice;

      return {
        recipe,
        recipeId: getRecipeId(recipe),
        name: recipe.name,
        category: isFinalMenu ? "Final menu item" : "Sub-recipe",
        batchUom: recipe.output_uom ?? "unit",
        batchQty,
        totalCost,
        costPerBatch,
        sellingPrice,
        foodCostPct,
        grossMarginPct,
        recommendedPrice,
        isFinalMenu,
        componentCount: components.length,
      };
    })
    .sort((leftRow, rightRow) => {
      if (leftRow.category !== rightRow.category) {
        return leftRow.category.localeCompare(rightRow.category);
      }

      return leftRow.name.localeCompare(rightRow.name);
    });
  const selectedOwnerFoodCostRow =
    ownerFoodCostRows.find(
      (row) =>
        row.recipeId === extractUuid(selectedPricingSimulationRecipeId),
    ) ?? ownerFoodCostRows.find((row) => row.isFinalMenu) ?? ownerFoodCostRows[0];
  const ownerSimulationPct = Number(priceSimulationPct);
  const normalizedOwnerSimulationPct =
    Number.isFinite(ownerSimulationPct) && ownerSimulationPct > -95
      ? ownerSimulationPct
      : 0;
  const ownerSimulatedSellingPrice =
    selectedOwnerFoodCostRow && selectedOwnerFoodCostRow.sellingPrice > 0
      ? selectedOwnerFoodCostRow.sellingPrice *
        (1 + normalizedOwnerSimulationPct / 100)
      : selectedOwnerFoodCostRow?.recommendedPrice ?? 0;
  const ownerSimulatedGrossMarginPct =
    selectedOwnerFoodCostRow && ownerSimulatedSellingPrice > 0
      ? ((ownerSimulatedSellingPrice - selectedOwnerFoodCostRow.costPerBatch) /
          ownerSimulatedSellingPrice) *
        100
      : null;
  const ownerVisibleFoodCostRows = ownerFoodCostRows.slice(0, 6);
  const ownerExtraFoodCostRows = ownerFoodCostRows.slice(6);
  const ownerPriceRows = ingredientPriceMovements.slice(0, 8).map((event) => {
    const affectedRecipeCount = new Set(
      recipeComponents
        .filter(
          (component) =>
            extractUuid(component.component_inventory_item_id) ===
            event.inventoryItemId,
        )
        .map((component) => extractUuid(component.recipe_id)),
    ).size;

    return {
      id: event.id,
      itemName: event.item?.name ?? "Ingredient cost",
      change:
        event.changePct === null
          ? formatSignedCurrency(event.costDelta)
          : `${event.changePct > 0 ? "+" : ""}${event.changePct.toLocaleString(
              undefined,
              { maximumFractionDigits: 1 },
            )}%`,
      affectedRecipeCount,
      impact: formatSignedCurrency(event.onHandImpact),
      tone:
        event.costDelta > 0
          ? ("attention" as const)
          : event.costDelta < 0
            ? ("healthy" as const)
            : ("info" as const),
    };
  });
  const ownerApprovalRows = pendingApprovalRequests.slice(0, 3).map((request) => {
    const lines = Array.isArray(request.payload?.lines)
      ? (request.payload.lines as Array<Record<string, unknown>>)
      : [];
    const requestedByName =
      typeof request.payload?.requested_by_name === "string"
        ? request.payload.requested_by_name
        : "Requester";

    return {
      id: request.id,
      label:
        request.request_type === "inventory_requisition"
          ? "Requisition"
          : request.request_type === "stock_count_approval"
            ? "Stock count"
            : "Approval",
      title: requestedByName,
      detail: `${lines.length.toLocaleString()} line${
        lines.length === 1 ? "" : "s"
      } waiting`,
      status: request.status,
    };
  });
  const ownerRecentActivity = (
    ownerPriceRows.length > 0
      ? activityEvents.filter((event) => event.type !== "Price")
      : activityEvents
  ).slice(0, 6);
  const isRole = (...roles: AppRole[]) => roles.includes(focusRole);
  const showFinancialDashboardSection = isRole(
    "owner",
    "operations_manager",
    "finance_manager",
  );
  const showDayControlSection = isRole(
    "owner",
    "operations_manager",
    "finance_manager",
    "procurement_manager",
    "inventory_manager",
    "storekeeper",
    "kitchen_manager",
    "chef",
    "quality_assurance",
    "bar_manager",
    "auditor",
  );
  const showOperationsSection = isRole(
    "owner",
    "operations_manager",
    "finance_manager",
    "inventory_manager",
    "storekeeper",
    "kitchen_manager",
    "quality_assurance",
    "bar_manager",
    "bartender",
  );
  const showProductionPlanningSection = isRole(
    "owner",
    "operations_manager",
    "kitchen_manager",
  );
  const showProductionLedgerSection = isRole(
    "owner",
    "operations_manager",
    "kitchen_manager",
    "quality_assurance",
  );
  const showPurchaseOrderDraftSection = isRole(
    "owner",
    "operations_manager",
    "procurement_manager",
  );
  const showInventoryMovementSection = isRole(
    "owner",
    "operations_manager",
    "inventory_manager",
    "storekeeper",
  );
  const showStockCountSection = isRole(
    "owner",
    "operations_manager",
    "inventory_manager",
    "storekeeper",
    "kitchen_manager",
    "chef",
    "bar_manager",
    "bartender",
    "quality_assurance",
  );
  const showRequisitionRequestSection = isRole(
    "owner",
    "operations_manager",
    "kitchen_manager",
    "bar_manager",
    "bartender",
  );
  const showProcurementSection =
    showPurchaseOrderDraftSection ||
    showInventoryMovementSection ||
    showRequisitionRequestSection;
  const showPurchaseOrderQueue =
    showPurchaseOrderDraftSection || showInventoryMovementSection;
  const showFinancialSection = isRole(
    "owner",
    "operations_manager",
    "finance_manager",
  );
  const showMasterDataSection = isRole(
    "owner",
    "operations_manager",
    "finance_manager",
    "kitchen_manager",
    "quality_assurance",
  );
  const showReportsSection = isRole(
    "owner",
    "operations_manager",
    "finance_manager",
    "procurement_manager",
    "inventory_manager",
    "auditor",
  );
  const showSettingsSection = isRole("owner");
  const showApprovalSection =
    isRole(
      "owner",
      "operations_manager",
      "finance_manager",
      "procurement_manager",
      "inventory_manager",
      "storekeeper",
      "kitchen_manager",
      "quality_assurance",
      "bar_manager",
      "auditor",
    ) ||
    pendingApprovalRequests.length > 0;
  const showLocationSetupSection = isRole("owner", "operations_manager", "finance_manager");
  const showSupplierSetupSection = isRole(
    "owner",
    "operations_manager",
    "finance_manager",
    "procurement_manager",
  );
  const showInventorySection =
    showOperationsSection || showProcurementSection || showMasterDataSection;
  const showSetupSection = showLocationSetupSection || showSupplierSetupSection;
  type WorkflowNavItem = {
    href: string;
    label: string;
    badge: string;
    tone: string;
    visible: boolean;
    targetRole?: AppRole;
    targetElementId?: string;
  };
  type WorkflowNavGroup = {
    label: string;
    defaultOpen: boolean;
    items: WorkflowNavItem[];
  };
  const allWorkflowNavGroups: WorkflowNavGroup[] = [
    {
      label: "Daily Overview",
      defaultOpen: true,
      items: [
        {
          href: "#overview",
          label: isOwnerFocus ? "Owner Command" : "Management Overview",
          badge: `${marginHealthScore}%`,
          tone: marginHealthScore >= 75 ? "healthy" : "warning",
          visible: showFinancialDashboardSection,
        },
        {
          href: "#profit-movement",
          label: "Profit Bridge",
          badge: formatSignedCurrency(profitMovementNet),
          tone:
            profitMovementNet >= 0
              ? "healthy"
              : Math.abs(profitMovementNet) > 0
                ? "warning"
                : "setup",
          visible: showFinancialDashboardSection,
        },
        {
          href: "#finance-brief",
          label: "Action Brief",
          badge: visibleManagementActions.length.toLocaleString(),
          tone: visibleManagementActions.some((action) => action.tone === "critical")
            ? "critical"
            : visibleManagementActions.some((action) => action.tone === "attention")
              ? "warning"
              : "healthy",
          visible: showFinancialDashboardSection && !isOwnerFocus,
        },
        {
          href: "#day",
          label: "Day Close",
          badge:
            compliancePendingCount > 0
              ? `${compliancePendingCount.toLocaleString()} open`
              : "Complete",
          tone:
            complianceExceptionCount > 0
              ? "critical"
              : compliancePendingCount > 0
                ? "warning"
                : "healthy",
          visible: showDayControlSection,
        },
      ],
    },
    {
      label: "Operations",
      defaultOpen:
        showOperationsSection ||
        showProductionPlanningSection ||
        showProcurementSection,
      items: [
        {
          href: "#production-plan",
          label: "Production Plan",
          badge:
            productionPlanShortageCount > 0
              ? `${productionPlanShortageCount.toLocaleString()} shortages`
              : `${validProductionPlanRows.length.toLocaleString()} plans`,
          tone: productionPlanShortageCount > 0 ? "warning" : "healthy",
          visible: showProductionPlanningSection,
        },
        {
          href: "#inventory",
          label: "Inventory Items",
          badge:
            reorderTodayCount > 0
              ? `${reorderTodayCount.toLocaleString()} reorder`
              : "Stable",
          tone: reorderTodayCount > 0 ? "warning" : "healthy",
          visible: showInventorySection,
        },
        {
          href: "#stock-movement",
          label: "Stock Movement",
          badge: `${stockMovementLedger.length.toLocaleString()} moves`,
          tone: stockMovementLedger.length > 0 ? "healthy" : "setup",
          visible: showInventorySection,
        },
        {
          href: "#yield-tests",
          label: "Yield Tests",
          badge:
            overdueYieldTestNotifications.length > 0
              ? `${overdueYieldTestNotifications.length.toLocaleString()} overdue`
              : `${highValueYieldItems.length.toLocaleString()} SKUs`,
          tone:
            overdueYieldTestNotifications.length > 0
              ? "warning"
              : highValueYieldItems.length > 0
                ? "healthy"
                : "setup",
          visible:
            showInventorySection && !isInventoryFocus && !isProcurementFocus,
        },
        {
          href: "#ledger",
          label: "Production Ledger",
          badge: `${productionHistory.length.toLocaleString()} runs`,
          tone: productionHistory.length > 0 ? "healthy" : "setup",
          visible: showProductionLedgerSection,
        },
        {
          href: "#requisitions",
          label: "Requisitions",
          badge: `${openRequisitionRequestCount.toLocaleString()} open`,
          tone: openRequisitionRequestCount > 0 ? "warning" : "healthy",
          visible: showInventoryMovementSection || showRequisitionRequestSection,
        },
        {
          href: "#purchase-orders",
          label: showPurchaseOrderDraftSection
            ? "Purchase order drafting"
            : "Purchase order tasks",
          badge: `${openPurchaseOrderCount.toLocaleString()} open`,
          tone: openPurchaseOrderCount > 0 ? "warning" : "healthy",
          visible: showPurchaseOrderDraftSection || showInventoryMovementSection,
        },
        {
          href: "#stock-counts",
          label: "Cycle Counts",
          badge: `${latestDayStockCountCount.toLocaleString()} counts`,
          tone: latestDayStockLoss > 0 ? "warning" : "healthy",
          visible: showStockCountSection,
        },
        {
          href: "#full-stock-counts",
          label: "Full Stock Count",
          badge:
            fullStockCountReady && stockControlLocationId
              ? "Ready"
              : `${fullStockCountCompletedLineCount.toLocaleString()}/${Math.max(
                  fullStockCountRows.length,
                  0,
                ).toLocaleString()}`,
          tone: fullStockCountReady ? "healthy" : "review",
          visible: showStockCountSection && !isRole("procurement_manager"),
          targetElementId: "stock-control-workspace",
        },
        {
          href: "#stock-adjustments",
          label: "Stock Adjustments",
          badge: "Finance approval",
          tone: "review",
          visible: showInventoryMovementSection,
        },
        {
          href: "#waste",
          label: "Waste",
          badge:
            directWasteImpact > 0
              ? `${organization.local_currency} ${directWasteImpact.toLocaleString(
                  undefined,
                  { maximumFractionDigits: 0 },
                )}`
              : "Clear",
          tone: directWasteImpact > 0 ? "critical" : "healthy",
          visible: showOperationsSection,
        },
      ],
    },
    {
      label: "Financial Intelligence",
      defaultOpen: showFinancialSection,
      items: [
        {
          href: "#pricing",
          label: "Price Recovery",
          badge: `${underpricedMenuItems.length.toLocaleString()} actions`,
          tone: underpricedMenuItems.length > 0 ? "warning" : "healthy",
          visible: showFinancialSection && !isRole("procurement_manager"),
        },
        {
          href: "#menu-profitability",
          label: "Food Cost Overview",
          badge: `${menuProfitabilityTotals.total.toLocaleString()} items`,
          tone:
            menuProfitabilityTotals.marginRisk > 0 ||
            menuProfitabilityTotals.missingSetup > 0
              ? "warning"
              : "healthy",
          visible: showFinancialSection && !isRole("procurement_manager"),
        },
        {
          href: "#overview",
          label: "Margin Scorecard",
          badge:
            totalSalesMarginPct === null
              ? "No sales"
              : `${totalSalesMarginPct.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}%`,
          tone:
            totalSalesMarginPct === null
              ? "setup"
              : totalSalesMarginPct >= targetMenuMarginPct
                ? "healthy"
                : "warning",
          visible:
            showFinancialSection &&
            !isOwnerFocus &&
            !isRole("procurement_manager"),
        },
        {
          href: "#pos-mapping",
          label: "POS Mapping",
          badge:
            posMappingRowsNeedingWork.length > 0
              ? `${posMappingRowsNeedingWork.length.toLocaleString()} gaps`
              : savedPosMappingCount > 0
                ? `${savedPosMappingCount.toLocaleString()} mapped`
                : "Setup",
          tone:
            posMappingRowsNeedingWork.length > 0
              ? "warning"
              : savedPosMappingCount > 0
                ? "healthy"
                : "setup",
          visible: showFinancialSection && !isRole("procurement_manager"),
        },
        {
          href: "#procurement-intelligence",
          label: "Procurement Intel",
          badge:
            todayPurchaseOrderCount > 0
              ? `${todayPurchaseOrderCount.toLocaleString()} POs`
              : "Review",
          tone: todayPurchaseOrderCount > 0 ? "warning" : "setup",
          visible: showFinancialSection || isRole("procurement_manager"),
        },
        {
          href: "#sales-pos",
          label: "Sales & POS",
          badge:
            todaySalesCount > 0
              ? `${todaySalesCount.toLocaleString()} sales`
              : "Start here",
          tone: todaySalesCount > 0 ? "healthy" : "setup",
          visible: showFinancialSection && !isRole("procurement_manager"),
        },
        {
          href: "#costing",
          label: "Cost Changes",
          badge: `${priceSpikeExceptions.length.toLocaleString()} spikes`,
          tone: priceSpikeExceptions.length > 0 ? "warning" : "healthy",
          visible: showFinancialSection,
        },
        {
          href: "#exceptions",
          label: "Issues",
          badge: `${criticalExceptionCount.toLocaleString()} critical`,
          tone: criticalExceptionCount > 0 ? "critical" : "healthy",
          visible: showFinancialSection,
        },
      ],
    },
    {
      label: "Master Data",
      defaultOpen: showMasterDataSection || showSupplierSetupSection,
      items: [
        {
          href: "#inventory",
          label: "Ingredients",
          badge: activePurchasedIngredients.length.toLocaleString(),
          tone: activePurchasedIngredients.length > 0 ? "healthy" : "setup",
          visible: showMasterDataSection,
        },
        {
          href: "#recipes",
          label: "Recipes",
          badge: activeRecipes.length.toLocaleString(),
          tone: activeRecipes.length > 0 ? "healthy" : "setup",
          visible: showMasterDataSection,
        },
        {
          href: "#setup",
          label: "Suppliers",
          badge: "Setup",
          tone: "setup",
          visible: showSupplierSetupSection,
        },
      ],
    },
    {
      label: "Reports",
      defaultOpen: showReportsSection,
      items: [
        {
          href: "#day",
          label: "Control Log",
          badge: "Live",
          tone: "review",
          visible: showReportsSection,
        },
      ],
    },
    {
      label: "Settings",
      defaultOpen: showSettingsSection || showApprovalSection,
      items: [
        {
          href: "#overview",
          label: "Workspace Settings",
          badge: roleLabels[currentRole],
          tone: "setup",
          visible: showSettingsSection,
        },
        {
          href: "#approvals",
          label: "Approval Queue",
          badge: pendingApprovalRequests.length.toLocaleString(),
          tone: pendingApprovalRequests.length > 0 ? "warning" : "healthy",
          visible: showApprovalSection,
        },
      ],
    },
  ];
  const workflowNavGroups = allWorkflowNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.visible),
    }))
    .filter((group) => group.items.length > 0);
  const ownerWorkflowNavGroups: WorkflowNavGroup[] = [
    {
      label: "Executive View",
      defaultOpen: true,
      items: [
        {
          href: "#overview",
          label: "Margin & leak",
          badge:
            ownerOverallLeakValue > 0
              ? formatCurrency(ownerOverallLeakValue, 0)
              : totalSalesMarginPct === null
                ? `${marginHealthScore}%`
                : `${totalSalesMarginPct.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}%`,
          tone:
            ownerOverallLeakValue > 0
              ? "warning"
              : totalSalesMarginPct === null ||
                  totalSalesMarginPct >= targetMenuMarginPct
              ? "healthy"
              : "warning",
          visible: true,
        },
        {
          href: "#day",
          label: "Day Close",
          badge:
            compliancePendingCount > 0
              ? `${compliancePendingCount.toLocaleString()} open`
              : "Complete",
          tone:
            complianceExceptionCount > 0
              ? "critical"
              : compliancePendingCount > 0
                ? "warning"
                : "healthy",
          visible: true,
        },
      ],
    },
    {
      label: "Decision Tables",
      defaultOpen: true,
      items: [
        {
          href: "#inventory",
          label: "Inventory position",
          badge: formatCurrency(currentStockValue, 0),
          tone: reorderTodayCount > 0 ? "warning" : "healthy",
          visible: true,
          targetElementId: "inventory-location-summary",
        },
        {
          href: "#procurement-intelligence",
          label: "Procurement intelligence",
          badge:
            priceIncreaseImpact > 0
              ? formatCurrency(priceIncreaseImpact, 0)
              : todayPurchaseOrderCount > 0
                ? `${todayPurchaseOrderCount.toLocaleString()} POs`
                : "Review",
          tone:
            priceIncreaseImpact > 0 ||
            partialPurchaseOrders.length > 0
              ? "warning"
              : "healthy",
          visible: true,
          targetElementId: "procurement-intelligence-summary",
        },
        {
          href: "#waste",
          label: "Waste & leaks",
          badge:
            ownerOverallLeakValue > 0
              ? formatCurrency(ownerOverallLeakValue, 0)
              : "Clear",
          tone: ownerOverallLeakValue > 0 ? "critical" : "healthy",
          visible: true,
          targetElementId: "waste-analysis-summary",
        },
        {
          href: "#overview",
          label: "AvT locations",
          badge:
            visibleAvtSummary.length > 0
              ? formatCurrency(avtVarianceExposure, 0)
              : "Clear",
          tone: avtVarianceExposure > 0 ? "warning" : "healthy",
          visible: true,
          targetElementId: "avt-location-summary",
        },
        {
          href: "#overview",
          label: "Food cost overview",
          badge: `${menuProfitabilityTotals.total.toLocaleString()} items`,
          tone:
            menuProfitabilityTotals.marginRisk > 0 ||
            menuProfitabilityTotals.missingSetup > 0
              ? "warning"
              : "healthy",
          visible: true,
          targetElementId: "menu-profitability-summary",
        },
        {
          href: "#overview",
          label: "Trend analysis",
          badge: `${ownerTrendCards.length.toLocaleString()} KPIs`,
          tone: "healthy",
          visible: true,
          targetElementId: "trend-analysis-summary",
        },
      ],
    },
  ];
  const activeWorkflowNavGroups = isOwnerFocus
    ? ownerWorkflowNavGroups
    : workflowNavGroups;
  const visibleSectionIds = Array.from(
    new Set(
      activeWorkflowNavGroups.flatMap((group) =>
        group.items.map((item) => item.href.replace("#", "")),
      ),
    ),
  );
  const selectedVisibleSection = visibleSectionIds.includes(
    selectedDashboardSection,
  )
    ? selectedDashboardSection
    : visibleSectionIds[0] ?? "";
  const ownerOverviewActive = isOwnerFocus && !selectedDashboardSection;
  const isSectionActive = (sectionId: string) =>
    !ownerOverviewActive && selectedVisibleSection === sectionId;
  const activeNavGroupLabel = ownerOverviewActive
    ? ""
    : activeWorkflowNavGroups.find((group) =>
        group.items.some(
          (item) => item.href.replace("#", "") === selectedVisibleSection,
        ),
      )?.label ?? activeWorkflowNavGroups[0]?.label ?? "";
  const showRequisitionWorkspace =
    showProcurementSection && isSectionActive("requisitions");
  const showPurchaseOrderWorkspace =
    showProcurementSection && isSectionActive("purchase-orders");
  const showStockCountWorkspace =
    showStockCountSection && isSectionActive("stock-counts");
  const showFullStockCountWorkspace =
    showStockCountSection &&
    !isRole("procurement_manager") &&
    isSectionActive("full-stock-counts");
  const showStockAdjustmentWorkspace =
    showInventoryMovementSection && isSectionActive("stock-adjustments");
  const isNavGroupOpen = (groupLabel: string) =>
    Object.prototype.hasOwnProperty.call(openNavGroups, groupLabel)
      ? openNavGroups[groupLabel]
      : groupLabel === activeNavGroupLabel;
  const openDashboardSection = (
    sectionId: string,
    targetRole?: AppRole,
    targetElementId?: string,
  ) => {
    if (targetRole) {
      setSelectedFocusRole(targetRole);
    }

    setSelectedDashboardSection(isOwnerFocus && targetElementId ? "" : sectionId);
    setSelectedDashboardTargetId(targetElementId ?? sectionId);
    const targetNavGroup = activeWorkflowNavGroups.find((group) =>
      group.items.some(
        (item) => item.href.replace("#", "") === sectionId,
      ),
    );

    if (targetNavGroup) {
      setOpenNavGroups({ [targetNavGroup.label]: true });
    }

    const elementId = targetElementId ?? sectionId;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const targetElement = document.getElementById(elementId);

        if (!targetElement) {
          return;
        }

        const stickyHeaderOffset = 88;
        const targetTop =
          window.scrollY +
          targetElement.getBoundingClientRect().top -
          stickyHeaderOffset;

        window.scrollTo({
          left: 0,
          top: Math.max(0, targetTop),
          behavior: "smooth",
        });
      });
    });
  };
  const navBadgeStyles: Record<string, string> = {
    critical:
      "border-status-critical-border bg-status-critical-bg text-status-critical-text",
    warning:
      "border-status-attention-border bg-status-attention-bg text-status-attention-text",
    healthy: "border-accent-muted-border bg-accent-muted-bg text-accent",
    review: "border-status-info-border bg-status-info-bg text-status-info-text",
    setup: "border-border-system bg-card text-text-muted",
  };
  const componentLinesPayload = componentInputRows.map((row) => ({
    inventory_item_id: extractUuid(row.inventoryItemId),
    quantity: Number(row.quantity),
  }));
  const purchaseLinesPayload = purchaseReceiptRows.map((row) => ({
    inventory_item_id: extractUuid(row.inventoryItemId),
    stock_on_hand_qty:
      row.stockOnHandQty.trim() === "" ? null : Number(row.stockOnHandQty),
    quantity: Number(row.quantity),
    landed_unit_cost: Number(row.landedUnitCost),
    tax_rate_pct: Number(row.taxRatePct || 0),
    tax_amount:
      Number(row.quantity || 0) *
      Number(row.landedUnitCost || 0) *
      (Number(row.taxRatePct || 0) / 100),
  }));
  const requisitionLinesPayload = requisitionRows.map((row) => ({
    inventory_item_id: extractUuid(row.inventoryItemId),
    quantity: Number(row.quantity),
    note: row.note.trim(),
  }));
  const stockCountLinesPayload = stockCountRows.map((row) => ({
    inventory_item_id: extractUuid(row.inventoryItemId),
    counted_quantity: Number(row.countedQuantity),
  }));
  const openStockMovementAudit = (itemId: string) => {
    setSelectedMovementInventoryItemId(itemId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById("stock-movement-audit-panel")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
  };
  const currentUserIssuedRequisition = (request: ApprovalRequest) =>
    request.approved_by === profile?.id ||
    extractUuid(request.payload?.issued_by) === profile?.id;
  const canApproveFinanceStockControl =
    currentRole === "finance_manager" ||
    currentRole === "owner" ||
    currentRole === "admin";
  const purchaseOrderSummaries = purchaseOrders.map((order) => {
    const lines = purchaseOrderLines.filter(
      (line) => line.purchase_order_id === order.id,
    );
    const supplier = activeSuppliers.find(
      (activeSupplier) => activeSupplier.id === order.supplier_id,
    );
    const receivingLocation = activeLocations.find(
      (location) => location.id === order.receiving_location_id,
    );
    const totalCost = lines.reduce(
      (total, line) => total + line.qty * line.landed_unit_cost,
      0,
    );
    const outstandingLineCount = lines.filter(
      (line) => Number(line.received_qty ?? 0) < Number(line.qty ?? 0),
    ).length;

    return {
      ...order,
      lines,
      supplierName: supplier?.name ?? order.supplier_name ?? "Unassigned supplier",
      receivingLocationName: receivingLocation?.name ?? "No receiving location",
      totalCost,
      outstandingLineCount,
    };
  });
  const purchaseOrderReportSummaries = (
    reportRangeActive ? allPurchaseOrders : purchaseOrders
  ).map((order) => {
    const lines = purchaseOrderLines.filter(
      (line) => line.purchase_order_id === order.id,
    );
    const supplier = activeSuppliers.find(
      (activeSupplier) => activeSupplier.id === order.supplier_id,
    );
    const receivingLocation = activeLocations.find(
      (location) => location.id === order.receiving_location_id,
    );
    const totalCost = lines.reduce(
      (total, line) => total + line.qty * line.landed_unit_cost,
      0,
    );
    const outstandingLineCount = lines.filter(
      (line) => Number(line.received_qty ?? 0) < Number(line.qty ?? 0),
    ).length;

    return {
      ...order,
      lines,
      supplierName: supplier?.name ?? order.supplier_name ?? "Unassigned supplier",
      receivingLocationName: receivingLocation?.name ?? "No receiving location",
      totalCost,
      outstandingLineCount,
    };
  });
  const purchaseOrderQueueBase = showInventoryMovementSection
    ? purchaseOrderSummaries
    : purchaseOrderSummaries.filter((order) =>
        ["draft", "pending", "accepted"].includes(order.status),
      );
  const purchaseOrderQueueCounts = {
    open: purchaseOrderQueueBase.filter(
      (order) =>
        order.status !== "completed" &&
        order.receipt_status !== "partially_received",
    ).length,
    partial: purchaseOrderQueueBase.filter(
      (order) => order.receipt_status === "partially_received",
    ).length,
    completed: purchaseOrderQueueBase.filter(
      (order) =>
        order.status === "completed" || order.receipt_status === "completed",
    ).length,
    all: purchaseOrderQueueBase.length,
  };
  const visiblePurchaseOrderQueue = purchaseOrderQueueBase.filter((order) => {
    if (purchaseOrderQueueFilter === "all") {
      return true;
    }

    if (purchaseOrderQueueFilter === "partial") {
      return order.receipt_status === "partially_received";
    }

    if (purchaseOrderQueueFilter === "completed") {
      return (
        order.status === "completed" || order.receipt_status === "completed"
      );
    }

    return (
      order.status !== "completed" &&
      order.receipt_status !== "partially_received"
    );
  });
  const purchaseOrderReportRows = purchaseOrderReportSummaries.flatMap((order) =>
    order.lines.map((line) => {
      const item =
        allInventoryItemsById.get(extractUuid(line.inventory_item_id)) ??
        activeInventoryItemsById.get(extractUuid(line.inventory_item_id));
      const receivedQty = Number(line.received_qty ?? 0);

      return {
        po_number: order.po_number ?? order.id,
        created_at: order.created_at,
        supplier: order.supplierName,
        receiving_location: order.receivingLocationName,
        status: order.receipt_status ?? order.status,
        sku: item?.sku ?? "",
        item: item?.name ?? "Unknown SKU",
        ordered_qty: line.qty,
        received_qty: receivedQty,
        outstanding_qty: Math.max(Number(line.qty) - receivedQty, 0),
        uom: item?.on_hand_uom ?? item?.base_uom ?? "",
        unit_cost: line.landed_unit_cost,
        tax_rate_pct: Number(line.tax_rate_pct ?? 0),
        tax_amount: Number(line.tax_amount ?? 0),
        ordered_value: Number(line.qty) * Number(line.landed_unit_cost),
        short_supply_reason: order.short_supply_reason ?? "",
      };
    }),
  );
  const procurementLineEvents = purchaseOrderReportSummaries
    .flatMap((order) =>
      order.lines.map((line) => {
        const item =
          allInventoryItemsById.get(extractUuid(line.inventory_item_id)) ??
          activeInventoryItemsById.get(extractUuid(line.inventory_item_id));
        const orderedQty = Number(line.qty ?? 0);
        const receivedQty = Number(line.received_qty ?? 0);
        const unitCost = Number(line.landed_unit_cost ?? 0);
        const taxAmount = Number(line.tax_amount ?? 0);

        return {
          order,
          line,
          item,
          itemId: extractUuid(line.inventory_item_id),
          itemKey: getInventoryPriceIdentity(line.inventory_item_id),
          supplierKey:
            extractUuid(order.supplier_id) ||
            order.supplierName.trim().toLowerCase() ||
            "unassigned supplier",
          supplierName: order.supplierName,
          orderedQty,
          receivedQty,
          unitCost,
          taxAmount,
          orderedValue: orderedQty * unitCost,
          receivedValue: receivedQty * unitCost,
          createdAt: order.created_at,
        };
      }),
    )
    .sort(
      (first, second) =>
        new Date(first.createdAt).getTime() -
        new Date(second.createdAt).getTime(),
    );
  const previousProcurementCostByItem = new Map<string, number>();
  const procurementPriceVarianceRows = procurementLineEvents.map((event) => {
    const previousUnitCost = previousProcurementCostByItem.get(event.itemKey);
    previousProcurementCostByItem.set(event.itemKey, event.unitCost);

    const unitDelta =
      previousUnitCost === undefined ? 0 : event.unitCost - previousUnitCost;
    const variancePct =
      previousUnitCost && previousUnitCost > 0
        ? (unitDelta / previousUnitCost) * 100
        : null;

    return {
      ...event,
      previousUnitCost: previousUnitCost ?? null,
      unitDelta,
      variancePct,
      varianceValue: unitDelta * event.orderedQty,
    };
  });
  const procurementInflationExposure = procurementPriceVarianceRows.reduce(
    (total, row) => total + Math.max(row.varianceValue, 0),
    0,
  );
  const procurementDeflationRelief = procurementPriceVarianceRows.reduce(
    (total, row) => total + Math.abs(Math.min(row.varianceValue, 0)),
    0,
  );
  const procurementCommittedSpend = procurementLineEvents.reduce(
    (total, row) => total + row.orderedValue,
    0,
  );
  const procurementReceivedValue = procurementLineEvents.reduce(
    (total, row) => total + row.receivedValue,
    0,
  );
  const procurementTaxExposure = procurementLineEvents.reduce(
    (total, row) => total + row.taxAmount,
    0,
  );
  const supplierIntelligenceRows = Array.from(
    procurementLineEvents.reduce((supplierMap, row) => {
      const current = supplierMap.get(row.supplierKey) ?? {
        supplier_key: row.supplierKey,
        supplier: row.supplierName,
        orderIds: new Set<string>(),
        ordered_value: 0,
        received_value: 0,
        tax_amount: 0,
        ordered_qty: 0,
        received_qty: 0,
        short_supply_orders: new Set<string>(),
        partial_orders: new Set<string>(),
        completed_orders: new Set<string>(),
        open_orders: new Set<string>(),
        price_variance_value: 0,
        price_variance_count: 0,
      };
      current.orderIds.add(row.order.id);
      current.ordered_value += row.orderedValue;
      current.received_value += row.receivedValue;
      current.tax_amount += row.taxAmount;
      current.ordered_qty += row.orderedQty;
      current.received_qty += row.receivedQty;

      if (row.order.short_supply_reason) {
        current.short_supply_orders.add(row.order.id);
      }
      if (row.order.receipt_status === "partially_received") {
        current.partial_orders.add(row.order.id);
      }
      if (
        row.order.status === "completed" ||
        row.order.receipt_status === "completed"
      ) {
        current.completed_orders.add(row.order.id);
      }
      if (
        row.order.status !== "completed" &&
        row.order.receipt_status !== "completed"
      ) {
        current.open_orders.add(row.order.id);
      }

      const varianceRow = procurementPriceVarianceRows.find(
        (candidate) => candidate.line.id === row.line.id,
      );
      if (varianceRow && varianceRow.previousUnitCost !== null) {
        current.price_variance_value += varianceRow.varianceValue;
        current.price_variance_count += 1;
      }

      supplierMap.set(row.supplierKey, current);
      return supplierMap;
    }, new Map<string, {
      supplier_key: string;
      supplier: string;
      orderIds: Set<string>;
      ordered_value: number;
      received_value: number;
      tax_amount: number;
      ordered_qty: number;
      received_qty: number;
      short_supply_orders: Set<string>;
      partial_orders: Set<string>;
      completed_orders: Set<string>;
      open_orders: Set<string>;
      price_variance_value: number;
      price_variance_count: number;
    }>()),
  )
    .map(([, row]) => {
      const orderCount = row.orderIds.size;
      const receiptRate =
        row.ordered_qty > 0 ? (row.received_qty / row.ordered_qty) * 100 : 0;
      const shortSupplyRate =
        orderCount > 0 ? (row.short_supply_orders.size / orderCount) * 100 : 0;
      const status =
        receiptRate >= 95 && shortSupplyRate === 0
          ? "Reliable"
          : receiptRate >= 75 && shortSupplyRate <= 25
            ? "Monitor"
            : "At risk";

      return {
        supplier: row.supplier,
        orders: orderCount,
        open_orders: row.open_orders.size,
        completed_orders: row.completed_orders.size,
        partial_orders: row.partial_orders.size,
        short_supply_orders: row.short_supply_orders.size,
        ordered_value: row.ordered_value,
        received_value: row.received_value,
        outstanding_value: Math.max(row.ordered_value - row.received_value, 0),
        tax_amount: row.tax_amount,
        receipt_rate: receiptRate,
        short_supply_rate: shortSupplyRate,
        price_variance_value: row.price_variance_value,
        status,
      };
    })
    .sort((first, second) => second.ordered_value - first.ordered_value);
  const supplierPerformanceRiskCount = supplierIntelligenceRows.filter(
    (row) => row.status !== "Reliable",
  ).length;
  const procurementSupplierReportRows = supplierIntelligenceRows.map((row) => ({
    supplier: row.supplier,
    orders: row.orders,
    open_orders: row.open_orders,
    completed_orders: row.completed_orders,
    partial_orders: row.partial_orders,
    short_supply_orders: row.short_supply_orders,
    ordered_value: row.ordered_value,
    received_value: row.received_value,
    outstanding_value: row.outstanding_value,
    tax_amount: row.tax_amount,
    receipt_rate_pct: row.receipt_rate,
    short_supply_rate_pct: row.short_supply_rate,
    price_variance_value: row.price_variance_value,
    status: row.status,
  }));
  const ownerProcurementProductRows = Array.from(
    procurementLineEvents
      .reduce(
        (productsById, row) => {
          const key = row.itemKey || row.itemId || row.item?.name || "unknown";
          const existingProduct = productsById.get(key);
          const varianceRow = procurementPriceVarianceRows.find(
            (candidate) => candidate.line.id === row.line.id,
          );

          if (existingProduct) {
            existingProduct.qty += row.orderedQty;
            existingProduct.spend += row.orderedValue;
            existingProduct.tax += row.taxAmount;
            existingProduct.priceVariance += varianceRow?.varianceValue ?? 0;
            existingProduct.lastSupplier = row.supplierName;
            existingProduct.lastUnitCost = row.unitCost;
          } else {
            productsById.set(key, {
              item: row.item?.name ?? "Unknown SKU",
              sku: row.item?.sku ?? "",
              qty: row.orderedQty,
              spend: row.orderedValue,
              tax: row.taxAmount,
              priceVariance: varianceRow?.varianceValue ?? 0,
              lastSupplier: row.supplierName,
              lastUnitCost: row.unitCost,
            });
          }

          return productsById;
        },
        new Map<
          string,
          {
            item: string;
            sku: string;
            qty: number;
            spend: number;
            tax: number;
            priceVariance: number;
            lastSupplier: string;
            lastUnitCost: number;
          }
        >(),
      )
      .values(),
  )
    .sort((first, second) => second.spend - first.spend)
    .slice(0, 6);
  const ownerSupplierRows = supplierIntelligenceRows.slice(0, 5);
  const ownerAvtLocationRows = Array.from(
    visibleAvtSummary
      .reduce(
        (locationsByName, row) => {
          const key = row.location_name || "Unassigned";
          const existingLocation = locationsByName.get(key);

          if (existingLocation) {
            existingLocation.revenue += row.revenue;
            existingLocation.variance += row.total_variance_cost;
            existingLocation.confidenceTotal += Number(row.confidence_score ?? 0);
            existingLocation.periodCount += 1;
            existingLocation.reviewCount += row.status === "ready" ? 0 : 1;
          } else {
            locationsByName.set(key, {
              location: key,
              revenue: row.revenue,
              variance: row.total_variance_cost,
              confidenceTotal: Number(row.confidence_score ?? 0),
              periodCount: 1,
              reviewCount: row.status === "ready" ? 0 : 1,
            });
          }

          return locationsByName;
        },
        new Map<
          string,
          {
            location: string;
            revenue: number;
            variance: number;
            confidenceTotal: number;
            periodCount: number;
            reviewCount: number;
          }
        >(),
      )
      .values(),
  )
    .map((row) => ({
      ...row,
      confidence:
        row.periodCount > 0 ? row.confidenceTotal / row.periodCount : 0,
    }))
    .sort((first, second) => second.variance - first.variance);
  const goodsReceiptReportRows = purchaseReceipts.flatMap((receipt) => {
    const order = purchaseOrderReportSummaries.find(
      (candidate) => candidate.id === receipt.purchase_order_id,
    );

    return receipt.purchase_order_receipt_lines.map((line) => {
      const item =
        allInventoryItemsById.get(extractUuid(line.inventory_item_id)) ??
        activeInventoryItemsById.get(extractUuid(line.inventory_item_id));

      return {
        grn_number: receipt.grn_number,
        po_number: order?.po_number ?? receipt.purchase_order_id,
        received_at: receipt.received_at,
        supplier: order?.supplierName ?? "",
        receiving_location: order?.receivingLocationName ?? "",
        receipt_status: receipt.receipt_status,
        sku: item?.sku ?? "",
        item: item?.name ?? "Unknown SKU",
        received_qty: Number(line.received_qty),
        uom: item?.on_hand_uom ?? item?.base_uom ?? "",
        unit_cost: Number(line.unit_cost),
        received_value: Number(line.received_qty) * Number(line.unit_cost),
        short_supply_reason: receipt.short_supply_reason ?? "",
      };
    });
  });
  const stockAdjustmentReportRows = approvalRequests
    .filter(
      (request) =>
        request.request_type === "stock_count_approval" &&
        request.payload?.adjustment_type === "stock_adjustment",
    )
    .flatMap((request) => {
      const payload = request.payload ?? {};
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      const location = activeLocations.find(
        (candidate) =>
          extractUuid(candidate.id) === extractUuid(payload.target_location_id),
      );

      return lines.map((line, index) => {
        const linePayload =
          line && typeof line === "object"
            ? (line as Record<string, unknown>)
            : {};
        const systemQuantity = Number(linePayload.system_quantity ?? 0);
        const countedQuantity = Number(linePayload.counted_quantity ?? 0);
        const adjustmentQuantity = Number(
          linePayload.adjustment_quantity ?? countedQuantity - systemQuantity,
        );
        const unitCost = Number(linePayload.unit_cost ?? 0);

        return {
          request_id: request.id,
          created_at: request.created_at,
          status: request.status,
          approved_at: request.approved_at ?? "",
          location: location?.name ?? "Unassigned",
          adjustment_mode: String(payload.adjustment_mode ?? "set"),
          item: String(linePayload.item_name ?? `Adjustment line ${index + 1}`),
          system_quantity: systemQuantity,
          adjustment_quantity: adjustmentQuantity,
          final_quantity: countedQuantity,
          uom: String(linePayload.uom ?? "unit"),
          unit_cost: unitCost,
          estimated_impact: adjustmentQuantity * unitCost,
        };
      });
    });
  const exportReportOptions = [
    {
      label: "Daily registers",
      filename: `daily-registers-${currentOperatingDate}.csv`,
      rows: registerReportRows,
      dateScoped: true,
    },
    {
      label: "Profit movement",
      filename: `profit-movement-${reportDateLabel}.csv`,
      rows: profitMovementReportRows,
      dateScoped: false,
    },
    {
      label: "Margin trend",
      filename: `margin-trend-${reportDateLabel}.csv`,
      rows: marginTrendReportRows,
      dateScoped: true,
    },
    {
      label: "Menu profitability",
      filename: `menu-profitability-${reportDateLabel}.csv`,
      rows: menuProfitabilityReportRows,
      dateScoped: false,
    },
    {
      label: "POS menu mappings",
      filename: `pos-menu-mappings-${reportDateLabel}.csv`,
      rows: posMappingReportRows,
      dateScoped: false,
    },
    {
      label: "Inventory by location",
      filename: `inventory-by-location-${reportDateLabel}.csv`,
      rows: inventoryReportRows,
      dateScoped: false,
    },
    {
      label: "Production variance",
      filename: `production-variance-${reportDateLabel}.csv`,
      rows: productionVarianceReportRows,
      dateScoped: true,
    },
    {
      label: "Stock variance",
      filename: `stock-variance-${reportDateLabel}.csv`,
      rows: stockVarianceReportRows,
      dateScoped: true,
    },
    {
      label: "Stock movement summary",
      filename: `stock-movement-summary-${reportDateLabel}.csv`,
      rows: stockMovementSummaryReportRows,
      dateScoped: false,
    },
    {
      label: "Stock movement ledger",
      filename: `stock-movement-ledger-${reportDateLabel}.csv`,
      rows: stockMovementReportRows,
      dateScoped: true,
    },
    {
      label: "Stock adjustments",
      filename: `stock-adjustments-${reportDateLabel}.csv`,
      rows: stockAdjustmentReportRows,
      dateScoped: true,
    },
    {
      label: "Waste",
      filename: `waste-${reportDateLabel}.csv`,
      rows: wasteReportRows,
      dateScoped: true,
    },
    {
      label: "Sales",
      filename: `sales-${reportDateLabel}.csv`,
      rows: salesReportRows,
      dateScoped: true,
    },
    {
      label: "Purchase orders",
      filename: `purchase-orders-${reportDateLabel}.csv`,
      rows: purchaseOrderReportRows,
      dateScoped: true,
    },
    {
      label: "Supplier intelligence",
      filename: `supplier-intelligence-${reportDateLabel}.csv`,
      rows: procurementSupplierReportRows,
      dateScoped: true,
    },
    {
      label: "Goods received notes",
      filename: `goods-received-notes-${reportDateLabel}.csv`,
      rows: goodsReceiptReportRows,
      dateScoped: true,
    },
    {
      label: "Approval queue",
      filename: `approval-queue-${reportDateLabel}.csv`,
      rows: approvalReportRows,
      dateScoped: true,
    },
  ];
  const visibleExportReportOptions = isInventoryFocus
    ? exportReportOptions.filter((option) =>
        [
          "Daily registers",
          "Inventory by location",
          "Production variance",
          "Stock variance",
          "Stock movement summary",
          "Stock movement ledger",
          "Stock adjustments",
          "Approval queue",
          "Waste",
          "Purchase orders",
          "Goods received notes",
        ].includes(option.label),
      )
    : exportReportOptions;

  async function handleLocationEditSubmit(
    event: FormEvent<HTMLFormElement>,
    location: Location,
  ) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);

    await onUpdateLocation(location.id, {
      name: String(formData.get("edit_location_name") ?? ""),
      location_type: String(
        formData.get("edit_location_type") ?? location.location_type,
      ) as Location["location_type"],
      routing_model: String(
        formData.get("edit_routing_model") ?? location.routing_model,
      ) as Location["routing_model"],
      inventory_domain: String(
        formData.get("edit_inventory_domain") ?? location.inventory_domain,
      ) as Location["inventory_domain"],
    });
    setEditingLocationId("");
  }

  async function handleSupplierEditSubmit(
    event: FormEvent<HTMLFormElement>,
    supplier: Supplier,
  ) {
    event.preventDefault();

    if (!canDirectMaintainSuppliers) {
      setEditingSupplierId("");
      return;
    }

    const formData = new FormData(event.currentTarget);

    await onUpdateSupplier(supplier.id, {
      name: String(formData.get("edit_supplier_name") ?? ""),
      contact_name: String(formData.get("edit_contact_name") ?? ""),
      phone: String(formData.get("edit_phone") ?? ""),
      email: String(formData.get("edit_email") ?? ""),
    });
    setEditingSupplierId("");
  }

  async function handleProductionFormSubmit(event: FormEvent<HTMLFormElement>) {
    const recorded = await onCreateProductionRun(event);

    if (recorded) {
      setSelectedProductionRecipeId("");
      setTargetProductionOutput("");
      setAdditionalProductionRunRows([]);
      setActualProductionInputs({});
    }
  }

  function resetPurchaseOrderDraftForm() {
    setEditingPurchaseOrderId("");
    setPurchaseSupplierId("");
    setPurchaseSupplierName("");
    setPurchaseReceivingLocationId("");
    setPurchaseReceiptRows([
      {
        id: "purchase-line-1",
        inventoryItemId: "",
        searchText: "",
        stockOnHandQty: "",
        quantity: "",
        landedUnitCost: "",
        taxRatePct: "",
      },
    ]);
  }

  function handleEditPurchaseOrder(order: (typeof purchaseOrderSummaries)[number]) {
    const matchedSupplier = activeSuppliers.find(
      (supplier) =>
        extractUuid(supplier.id) === extractUuid(order.supplier_id) ||
        supplier.name.trim().toLowerCase() ===
          order.supplierName.trim().toLowerCase(),
    );
    const firstLineItem = order.lines
      .map((line) =>
        activeInventoryItemsById.get(extractUuid(line.inventory_item_id)),
      )
      .find(Boolean);

    setEditingPurchaseOrderId(extractUuid(order.id));
    setPurchaseSupplierId(extractUuid(matchedSupplier?.id));
    setPurchaseSupplierName(order.supplierName);
    setPurchaseReceivingLocationId(
      extractUuid(order.receiving_location_id) ||
        extractUuid(firstLineItem?.location_id),
    );
    setPurchaseReceiptRows(
      order.lines.length > 0
        ? order.lines.map((line, index) => {
            const lineItem = activeInventoryItemsById.get(
              extractUuid(line.inventory_item_id),
            );

            return {
              id: `edit-purchase-line-${line.id}-${index}`,
              inventoryItemId: extractUuid(line.inventory_item_id),
              searchText: lineItem?.name ?? lineItem?.sku ?? "",
              stockOnHandQty: Number(lineItem?.on_hand_qty ?? 0).toString(),
              quantity: Number(line.qty ?? 0).toString(),
              landedUnitCost: Number(line.landed_unit_cost ?? 0).toString(),
              taxRatePct: Number(line.tax_rate_pct ?? 0).toString(),
            };
          })
        : [
            {
              id: `edit-purchase-line-${order.id}`,
              inventoryItemId: "",
              searchText: "",
              stockOnHandQty: "",
              quantity: "",
              landedUnitCost: "",
              taxRatePct: "",
            },
          ],
    );
    setExpandedPurchaseOrderId(order.id);
  }

  async function handlePurchaseReceiptFormSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    const recorded = await onCreatePurchaseOrder(event);

    if (recorded) {
      resetPurchaseOrderDraftForm();
    }
  }

  function resetRequisitionForm() {
    setEditingRequisitionRequestId("");
    setRequisitionRequesterName("");
    setRequisitionFromLocationId("");
    setRequisitionToLocationId("");
    setRequisitionApproverName("");
    setRequisitionApproverRole("operations_manager");
    setRequisitionRows([
      {
        id: "requisition-line-1",
        inventoryItemId: "",
        quantity: "",
        note: "",
      },
    ]);
  }

  function handleConvertProductionPlanToRequisition() {
    if (!productionPlanRequisitionFromLocationId) {
      setProductionPlanRequisitionNotice(
        "Choose the issuing store or source location for this requisition.",
      );
      return;
    }

    if (!productionPlanRequisitionToLocationId) {
      setProductionPlanRequisitionNotice(
        "Choose the receiving kitchen or department location.",
      );
      return;
    }

    if (productionPlanRequisitionDraftLines.length === 0) {
      setProductionPlanRequisitionNotice(
        productionPlanRequisitionMode === "shortage"
          ? "No shortage lines are available to convert into a requisition."
          : "No production plan lines are available to convert into a requisition.",
      );
      return;
    }

    setEditingRequisitionRequestId("");
    setRequisitionRequesterName(profile?.full_name ?? roleLabels[currentRole]);
    setRequisitionFromLocationId(productionPlanRequisitionFromLocationId);
    setRequisitionToLocationId(productionPlanRequisitionToLocationId);
    setRequisitionApproverRole("inventory_manager");
    setRequisitionApproverName((currentApproverName) =>
      currentApproverName.trim() ? currentApproverName : "Inventory / Store",
    );
    setRequisitionRows(
      productionPlanRequisitionDraftLines.map((line, index) => ({
        id: `production-plan-requisition-${Date.now()}-${index}`,
        inventoryItemId: extractUuid(line.sourceItem?.id),
        quantity: Number(line.requestedQty.toFixed(6)).toString(),
        note: `Production plan: ${line.requirement.sourceRecipes.join(", ")}`,
      })),
    );
    setProductionPlanRequisitionNotice(
      "Production plan copied into an editable kitchen requisition. Review items, quantities, and locations before submitting.",
    );
    openDashboardSection("requisitions", undefined, "requisitions");
  }

  function handleEditRequisitionRequest(request: ApprovalRequest) {
    const payload = request.payload ?? {};
    const lines = Array.isArray(payload.lines) ? payload.lines : [];

    setEditingRequisitionRequestId(request.id);
    setRequisitionRequesterName(
      typeof payload.requested_by_name === "string"
        ? payload.requested_by_name
        : "",
    );
    setRequisitionFromLocationId(extractUuid(payload.from_location_id));
    setRequisitionToLocationId(extractUuid(payload.to_location_id));
    setRequisitionApproverName(
      typeof payload.approver_name === "string" ? payload.approver_name : "",
    );
    setRequisitionApproverRole(
      normalizeRole(
        typeof payload.approver_role === "string"
          ? payload.approver_role
          : "operations_manager",
      ),
    );
    setRequisitionRows(
      lines.length > 0
        ? lines.map((line, index) => {
            const typedLine = line as Record<string, unknown>;

            return {
              id: `edit-requisition-line-${request.id}-${index}`,
              inventoryItemId: extractUuid(typedLine.inventory_item_id),
              quantity: Number(typedLine.quantity ?? 0).toString(),
              note: typeof typedLine.note === "string" ? typedLine.note : "",
            };
          })
        : [
            {
              id: `edit-requisition-line-${request.id}`,
              inventoryItemId: "",
              quantity: "",
              note: "",
            },
          ],
    );
  }

  async function handleConfirmRequisitionRequest(request: ApprovalRequest) {
    const payload = request.payload ?? {};
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    const issuedLines = lines
      .map((line, index) => {
        const typedLine = line as Record<string, unknown>;
        const inventoryItemId = extractUuid(typedLine.inventory_item_id);
        const inputKey = `${request.id}-${inventoryItemId || index}`;
        const requestedQuantity = Number(typedLine.quantity ?? 0);
        const issuedQuantityInput = requisitionIssueQtyByKey[inputKey];
        const issuedQuantity =
          issuedQuantityInput === undefined || issuedQuantityInput.trim() === ""
            ? requestedQuantity
            : Number(issuedQuantityInput);

        return {
          inventory_item_id: inventoryItemId,
          issued_quantity: issuedQuantity,
        };
      })
      .filter(
        (line) =>
          extractUuid(line.inventory_item_id) &&
          Number.isFinite(line.issued_quantity) &&
          line.issued_quantity >= 0,
      );

    await onConfirmRequisitionIssue(request.id, issuedLines);
  }

  async function handleAcknowledgeRequisitionRequest(request: ApprovalRequest) {
    await onAcknowledgeRequisitionReceipt(request.id);
  }

  async function handleRejectRequisitionReceiptRequest(request: ApprovalRequest) {
    await onRejectRequisitionReceipt(request.id);
  }

  async function handleRequisitionFormSubmit(event: FormEvent<HTMLFormElement>) {
    const recorded = await onCreateRequisition(event);

    if (recorded) {
      resetRequisitionForm();
    }
  }

  async function handleStockCountFormSubmit(event: FormEvent<HTMLFormElement>) {
    const recorded = await onCreateStockCount(event);

    if (recorded) {
      setFullStockCountQuantities({});
      setStockCountRows([
        {
          id: "stock-count-line-1",
          inventoryItemId: "",
          countedQuantity: "",
        },
      ]);
    }
  }

  async function handleMenuSaleFormSubmit(event: FormEvent<HTMLFormElement>) {
    const recorded = await onCreateMenuSale(event);

    if (recorded) {
      setSelectedSaleRecipeId("");
      setSaleQuantity("");
    }
  }

  async function handleSalesImportFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setSalesImportText(await file.text());
    event.target.value = "";
  }

  async function handlePosMappingFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setPosMappingText(await file.text());
    event.target.value = "";
  }

  async function handleSalesImportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const imported = await onBulkCreateMenuSales(aggregatedSalesImportRows);

    if (imported) {
      setSalesImportText("");
    }
  }

  async function handleSalesImportMappingChange(
    row: SalesImportPreviewRow,
    recipeId: string,
  ) {
    await onUpsertPosSalesItemMapping({
      posItemKey: row.posItemKey,
      posItemLabel: row.menuItem,
      posItemCode: row.posItemCode,
      recipeId,
    });
  }

  async function handlePosMasterMappingChange(
    row: PosItemMasterPreviewRow,
    recipeId: string,
  ) {
    await onUpsertPosSalesItemMapping({
      posItemKey: row.posItemKey,
      posItemLabel: row.posItemLabel,
      posItemCode: row.posItemCode,
      recipeId,
    });
  }

  async function handleWasteEventFormSubmit(event: FormEvent<HTMLFormElement>) {
    await onCreateWasteEvent(event);
  }

  return (
    <section className="mx-auto grid max-w-[1320px] gap-4 px-3 py-4 sm:gap-5 sm:px-8 sm:py-5 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className={`rounded-sm border p-3 xl:sticky xl:top-20 xl:self-start ${
        isFinanceFocus
          ? "border-slate-200 bg-[var(--finance-rail)] shadow-[var(--finance-shadow)]"
          : "border-border-system bg-card shadow-2xl shadow-black/30"
      }`}>
        <div className="mb-3 rounded-sm border border-border-system bg-background p-3 xl:hidden">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            Dashboard View
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
            <div className="min-w-0">
              <p className="truncate text-base font-extrabold text-foreground">
                {roleLabels[focusRole]}
              </p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
                {roleDescriptions[focusRole]}
              </p>
            </div>
            {canManageWorkspace ? (
              <select
                value={focusRole}
                onChange={(event) => {
                  setSelectedFocusRole(normalizeRole(event.target.value));
                  setSelectedDashboardSection("");
                  setSelectedDashboardTargetId("");
                  setOpenNavGroups({});
                }}
                className="h-10 rounded-sm border border-border-system bg-card px-2 text-sm font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                aria-label="Preview dashboard role"
              >
                {focusRoleOptions.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
        <div className="hidden border-b border-border-system px-3 pb-4 xl:block">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            Restaurant Workspace
          </p>
          <p className="mt-2 truncate font-serif text-xl font-normal text-foreground">
            {organization.name}
          </p>
          <p className="mt-1 text-xs font-semibold text-text-muted">
            {stats.locations.toLocaleString()} location
            {stats.locations === 1 ? "" : "s"} /{" "}
            {isInventoryFocus
              ? `${activeInventoryItems.length.toLocaleString()} active SKU${
                  activeInventoryItems.length === 1 ? "" : "s"
                }`
              : `${stats.recipes.toLocaleString()} recipe${
                  stats.recipes === 1 ? "" : "s"
                }`}
          </p>
          <div className="mt-4 border-t border-border-system pt-4">
            <div className={isFinanceFocus ? "flex items-center gap-4" : ""}>
              {isFinanceFocus ? <ControlScoreRing score={readinessScore} /> : null}
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Control Score
                </p>
                {isFinanceFocus ? (
                  <>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      Target 85%
                    </p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">
                      {compliancePendingCount > 0
                        ? `${compliancePendingCount} daily control item${
                            compliancePendingCount === 1 ? "" : "s"
                          } still open.`
                        : "Daily controls are clean for Finance review."}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <p
                        className={`font-mono text-2xl font-semibold ${
                        readinessScore >= 80
                          ? "text-accent"
                          : readinessScore >= 55
                            ? "text-status-attention-text"
                            : "text-status-critical-text"
                        }`}
                      >
                        {readinessScore.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                        %
                      </p>
                      <span className="text-[10px] text-text-ghost">Target 85%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.min(Math.max(readinessScore, 0), 100)}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 border-t border-border-system pt-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Dashboard View
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {roleLabels[focusRole]}
            </p>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {roleDescriptions[focusRole]}
            </p>
            {canManageWorkspace ? (
              <label className="mt-3 grid gap-1 text-xs font-semibold text-text-muted">
                Preview dashboard as
                <select
                  value={focusRole}
                  onChange={(event) => {
                    setSelectedFocusRole(normalizeRole(event.target.value));
                    setSelectedDashboardSection("");
                    setSelectedDashboardTargetId("");
                    setMobileDashboardMenuOpen(false);
                    setOpenNavGroups({});
                  }}
                  className="h-9 rounded-sm border border-border-system bg-card px-2 text-xs font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  {focusRoleOptions.map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1">
              {[
                canManageWorkspace ? "Workspace settings" : null,
                canManageCosting ? "Costing" : null,
                canRecordOperations ? "Operations" : null,
                canApproveOperations ? "Approvals" : null,
              ]
                .filter(Boolean)
                .map((permission) => (
                  <span
                    key={permission}
                    className="rounded-full bg-background px-2.5 py-1 text-[10px] font-semibold text-text-muted"
                  >
                    {permission}
                  </span>
                ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setMobileDashboardMenuOpen((currentValue) => !currentValue)
          }
          aria-controls="dashboard-section-menu"
          aria-expanded={mobileDashboardMenuOpen}
          className="mt-3 flex h-11 w-full items-center justify-between rounded-sm border border-border-system bg-card px-3 text-left text-sm font-bold text-foreground shadow-sm transition hover:border-border-system-hover xl:hidden"
        >
          <span>Menu / dashboard sections</span>
          <span className="font-mono text-lg leading-none">
            {mobileDashboardMenuOpen ? "×" : "☰"}
          </span>
        </button>

        <nav
          id="dashboard-section-menu"
          aria-label="Dashboard sections"
          className={`mt-3 gap-3 ${
            mobileDashboardMenuOpen ? "grid" : "hidden"
          } xl:grid xl:gap-4`}
        >
          {isOwnerFocus ? (
            <div className="rounded-sm border border-border-system bg-background p-2 xl:border-0 xl:bg-transparent xl:p-0">
              <button
                type="button"
                onClick={() => {
                  setSelectedDashboardSection("");
                  setSelectedDashboardTargetId("");
                  setMobileDashboardMenuOpen(false);
                  setOpenNavGroups({});
                }}
                aria-current={ownerOverviewActive ? "page" : undefined}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 py-2 text-left text-sm font-semibold transition ${
                  ownerOverviewActive
                    ? "bg-accent-muted-bg text-foreground ring-1 ring-accent/40"
                    : "text-text-muted hover:bg-accent-muted-bg hover:text-foreground"
                }`}
              >
                <span className="truncate">Owner Overview</span>
                <span
                  className={`max-w-[92px] truncate rounded-full border px-2 py-0.5 text-[11px] font-bold leading-5 ${navBadgeStyles.healthy}`}
                >
                  Live
                </span>
              </button>
            </div>
          ) : null}
          {activeWorkflowNavGroups.map((group) => (
            <div
              key={group.label}
              className="rounded-sm border border-border-system bg-background p-2 xl:border-0 xl:bg-transparent xl:p-0"
            >
              <button
                type="button"
                onClick={() =>
                  setOpenNavGroups({
                    [group.label]: !isNavGroupOpen(group.label),
                  })
                }
                aria-expanded={isNavGroupOpen(group.label)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 py-2 text-left font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost transition hover:bg-accent-muted-bg hover:text-foreground"
              >
                <span className="truncate">{group.label}</span>
                <span className="text-sm leading-none">
                  {isNavGroupOpen(group.label) ? "-" : "+"}
                </span>
              </button>
              {isNavGroupOpen(group.label) ? (
                <div className="mt-1 grid gap-1 border-l border-border-system pl-3">
                  {group.items.map((item) => {
                    const targetElementId =
                      item.targetElementId ?? item.href.replace("#", "");
                    const sectionId = item.href.replace("#", "");
                    const isActive =
                      !ownerOverviewActive &&
                      selectedVisibleSection === sectionId &&
                      (selectedDashboardTargetId
                        ? selectedDashboardTargetId === targetElementId
                        : sectionId === targetElementId);

                    return (
                    <button
                      key={`${group.label}-${item.label}`}
                      type="button"
                      onClick={() => {
                        openDashboardSection(
                          sectionId,
                          undefined,
                          targetElementId,
                        );
                        setMobileDashboardMenuOpen(false);
                      }}
                      aria-current={isActive ? "page" : undefined}
                      className={`group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 py-2 text-left text-sm font-semibold transition ${
                        isActive
                          ? "bg-accent-muted-bg text-foreground ring-1 ring-accent/40"
                          : "text-text-muted hover:bg-accent-muted-bg hover:text-foreground"
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      <span
                        className={`max-w-[92px] truncate rounded-full border px-2 py-0.5 text-[11px] font-bold leading-5 ${navBadgeStyles[item.tone]}`}
                      >
                        {item.badge}
                      </span>
                    </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0">
      <div className="mb-5 grid gap-3 border-b border-border-system pb-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
      <div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
          Operating period
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {selectedPeriodLabel} activity
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[auto_auto] sm:items-end xl:grid-cols-[auto_auto_auto]">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {(["today", "7d", "30d", "all"] as PresetDateFilter[]).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => {
                setDateFilter(filter);
                setDashboardStartDate("");
                setDashboardEndDate("");
              }}
              className={`h-9 rounded-full border px-3 text-xs font-bold transition ${
                dateFilter === filter
                  ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                  : "border-border-system bg-background text-text-muted hover:border-border-system-hover hover:text-foreground"
              }`}
            >
              {dateFilterLabels[filter]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:min-w-[310px]">
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            From
            <input
              type="date"
              value={dashboardStartDate}
              onChange={(event) => updateDashboardStartDate(event.target.value)}
              className="h-9 rounded-sm border border-border-system bg-card px-2 text-xs font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            To
            <input
              type="date"
              value={dashboardEndDate}
              onChange={(event) => updateDashboardEndDate(event.target.value)}
              className="h-9 rounded-sm border border-border-system bg-card px-2 text-xs font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
        </div>
        {dateFilter === "custom" ? (
          <button
            type="button"
            onClick={resetDashboardDateFilter}
            className="h-9 rounded-sm border border-border-system bg-card px-3 text-xs font-bold uppercase tracking-wider text-text-muted transition hover:border-border-system-hover hover:text-foreground"
          >
            Clear dates
          </button>
        ) : null}
        </div>
        <details className="group relative">
          <summary className="flex h-9 cursor-pointer list-none items-center rounded-sm border border-border-system bg-card px-4 text-xs font-bold text-text-muted transition hover:border-border-system-hover hover:text-foreground">
            Export reports
          </summary>
          <div className="absolute right-0 z-20 mt-2 grid w-[calc(100vw-2rem)] max-w-[360px] gap-2 rounded-sm border border-border-system bg-card p-3 shadow-2xl shadow-black/35 sm:min-w-[320px]">
            <div className="rounded-sm border border-border-system bg-background p-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Report date range
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  From
                  <input
                    type="date"
                    value={reportStartDate}
                    onChange={(event) => setReportStartDate(event.target.value)}
                    className="h-9 rounded-sm border border-border-system bg-background px-2 text-xs font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </label>
                <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  To
                  <input
                    type="date"
                    value={reportEndDate}
                    onChange={(event) => setReportEndDate(event.target.value)}
                    className="h-9 rounded-sm border border-border-system bg-background px-2 text-xs font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </label>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[11px] leading-4 text-text-muted">
                  Blank uses the selected dashboard period.
                </p>
                {reportRangeActive ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReportStartDate("");
                      setReportEndDate("");
                    }}
                    className="h-8 rounded-sm border border-border-system bg-card px-2 text-[10px] font-bold uppercase tracking-wider text-text-muted transition hover:border-border-system-hover hover:text-foreground"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
            {visibleExportReportOptions.map((option) => (
              <button
                key={option.filename}
                type="button"
                onClick={() =>
                  downloadCsvReport(
                    option.filename,
                    option.dateScoped
                      ? filterRowsForReportRange(option.rows)
                      : option.rows,
                  )
                }
                className="h-9 rounded-sm px-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted transition hover:bg-accent-muted-bg hover:text-foreground"
              >
                {option.label}
              </button>
            ))}
          </div>
        </details>
      </div>
      {!ownerOverviewActive ? (
        <div className="mb-5 grid gap-3">
          <div
            className={`grid gap-4 rounded-sm border px-5 py-4 shadow-2xl shadow-black/20 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
              roleNextAction.tone === "healthy"
                ? "border-accent-muted-border bg-accent-muted-bg"
                : "border-status-attention-border bg-status-attention-bg"
            }`}
          >
            <div className="min-w-0">
              <p
                className={`font-mono text-[10px] font-bold uppercase tracking-widest ${
                  roleNextAction.tone === "healthy"
                    ? "text-accent"
                    : "text-status-attention-text"
                }`}
              >
                {roleNextAction.eyebrow}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-foreground">
                {roleNextAction.title}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-text-muted">
                {roleNextAction.detail}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openDashboardSection(roleNextAction.sectionId)}
              className={
                roleNextAction.tone === "healthy"
                  ? compactPrimaryActionButtonClass
                  : "h-10 rounded-sm border border-status-attention-border bg-card px-4 text-xs font-bold uppercase tracking-wider text-status-attention-text shadow-sm transition hover:border-status-attention-text"
              }
            >
              {roleNextAction.cta}
            </button>
          </div>

          <div className={`rounded-sm border p-3 ${
            isFinanceFocus
              ? "border-slate-200 bg-card shadow-[var(--finance-shadow)]"
              : "border-border-system bg-background shadow-2xl shadow-black/10"
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Today&apos;s required actions
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {roleLabels[focusRole]} / {currentOperatingDate}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                  ownedDayCloseActions.length > 0
                    ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                    : "border-accent-muted-border bg-accent-muted-bg text-accent"
                }`}
              >
                {ownedDayCloseActions.length > 0
                  ? `${ownedDayCloseActions.length} open`
                  : "Clear"}
              </span>
            </div>
            <div className="mt-3 grid gap-2 lg:grid-cols-3">
              {visibleDayDisciplineActions.map((action) => {
                const financeActionTone =
                  action.status === "exception"
                    ? {
                        border: "border-l-status-critical-text",
                        icon: "border-status-critical-border bg-status-critical-bg text-status-critical-text",
                        button: "border-status-critical-border bg-status-critical-bg text-status-critical-text hover:border-status-critical-text",
                      }
                    : action.status === "clear"
                      ? {
                          border: "border-l-accent",
                          icon: "border-accent-muted-border bg-accent-muted-bg text-accent",
                          button: "border-accent-muted-border bg-accent text-background hover:bg-accent-hover",
                        }
                      : {
                          border: "border-l-status-attention-text",
                          icon: "border-status-attention-border bg-status-attention-bg text-status-attention-text",
                          button: "border-status-attention-border bg-card text-status-attention-text hover:border-status-attention-text",
                        };
                const ActionIcon =
                  action.status === "clear"
                    ? BadgeCheck
                    : action.status === "exception"
                      ? AlertTriangle
                      : ClipboardCheck;

                return (
                  <article
                    key={action.id}
                    className={
                      isFinanceFocus
                        ? `grid min-h-[168px] grid-rows-[1fr_auto] gap-3 rounded-sm border border-slate-200 border-l-4 bg-card p-4 shadow-[var(--finance-shadow)] ${financeActionTone.border}`
                        : `grid min-h-[168px] grid-rows-[1fr_auto] gap-3 rounded-sm border p-3 ${
                            action.status === "exception"
                              ? "border-status-critical-border bg-status-critical-bg"
                              : action.status === "clear"
                                ? "border-accent-muted-border bg-accent-muted-bg"
                                : "border-status-attention-border bg-status-attention-bg"
                          }`
                    }
                  >
                    <div className="flex min-w-0 gap-3">
                      {isFinanceFocus ? (
                        <span
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-sm border ${financeActionTone.icon}`}
                        >
                          <ActionIcon size={18} strokeWidth={2.3} />
                        </span>
                      ) : null}
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground">
                          {action.label}
                        </p>
                        <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                          {action.department} / {roleLabels[action.ownerRole]}
                        </p>
                        <p
                          className={`mt-2 text-xs leading-5 text-text-muted ${
                            isFinanceFocus ? "line-clamp-1" : "line-clamp-2"
                          }`}
                          title={action.detail}
                        >
                          {action.detail}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        openDashboardSection(
                          action.sectionId,
                          undefined,
                          action.targetElementId,
                        )
                      }
                      className={
                        isFinanceFocus
                          ? `inline-flex h-10 items-center justify-center gap-2 rounded-sm border px-3 text-xs font-extrabold uppercase tracking-wider shadow-sm transition active:scale-[0.98] ${financeActionTone.button}`
                          : "h-11 w-full rounded-sm border border-border-system bg-card px-3 text-xs font-bold uppercase tracking-wider text-foreground transition hover:border-border-system-hover"
                      }
                    >
                      {isFinanceFocus && action.status === "clear" ? (
                        <BadgeCheck size={15} strokeWidth={2.4} />
                      ) : null}
                      {action.actionLabel}
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      {ownerOverviewActive ? (
        <div className="owner-dashboard-shell mx-auto grid w-full max-w-[1080px] gap-6 rounded-[18px] bg-[#f4f2ee] p-4 text-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.10)] sm:p-6">
          <section className="grid gap-4 border-b border-slate-200 pb-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="h-11 w-11 shrink-0 rounded-2xl bg-blue-100" />
                <div className="min-w-0">
                  <h1 className="truncate text-base font-black tracking-tight text-slate-950">
                    {organization.name}
                  </h1>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {stats.locations.toLocaleString()} location
                    {stats.locations === 1 ? "" : "s"} · Owner view
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
                  Live
                </span>
                <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm">
                  {selectedPeriodLabel}
                </span>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {[
                {
                  label: "Revenue",
                  value: formatCurrency(latestDayRevenue),
                  detail:
                    previousDayRevenue > 0
                      ? `${formatSignedCurrency(latestDayRevenue - previousDayRevenue)} vs yesterday`
                      : latestOperatingDayLabel,
                  tone: "healthy" as const,
                },
                {
                  label: "Gross profit",
                  value: formatCurrency(latestDayGrossProfit),
                  detail:
                    previousDayGrossProfit !== 0
                      ? `${formatSignedCurrency(latestDayGrossProfit - previousDayGrossProfit)} vs yesterday`
                      : "After food cost",
                  tone:
                    latestDayGrossProfit >= 0
                      ? ("healthy" as const)
                      : ("critical" as const),
                },
                {
                  label: "Margin",
                  value:
                    latestDayMarginPct === null
                      ? `${marginHealthScore}%`
                      : `${latestDayMarginPct.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}%`,
                  detail: `Target: ${targetMenuMarginPct}%`,
                  tone:
                    latestDayMarginPct !== null &&
                    latestDayMarginPct < targetMenuMarginPct
                      ? ("attention" as const)
                      : ("healthy" as const),
                },
                {
                  label: "Inventory",
                  value: formatCurrency(currentStockValue, 0),
                  detail: `${ownerUniqueSkuCount.toLocaleString()} unique SKU${
                    ownerUniqueSkuCount === 1 ? "" : "s"
                  } valued`,
                  tone:
                    negativeStockExceptions.length > 0
                      ? ("critical" as const)
                      : reorderTodayCount > 0
                        ? ("attention" as const)
                        : ("healthy" as const),
                },
                {
                  label: "Procurement",
                  value: formatCurrency(procurementCommittedSpend, 0),
                  detail: `${todayPurchaseOrderCount.toLocaleString()} PO today / ${formatCurrency(procurementTaxExposure, 0)} VAT`,
                  tone:
                    priceIncreaseImpact > 0 || partialPurchaseOrders.length > 0
                      ? ("attention" as const)
                      : ("healthy" as const),
                },
                {
                  label: "Overall leak",
                  value: formatCurrency(ownerOverallLeakValue, 0),
                  detail:
                    ownerOverallLeakValue > 0
                      ? "Waste plus price inflation"
                      : "No leak in selected period",
                  tone:
                    ownerOverallLeakValue > Math.max(1000, totalSalesRevenue * 0.08)
                      ? ("critical" as const)
                      : ownerOverallLeakValue > 0
                        ? ("attention" as const)
                        : ("healthy" as const),
                },
              ].map((metric) => (
                <article
                  key={metric.label}
                  className={`grid min-h-[74px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-4 py-3 shadow-sm ${
                    metric.tone === "critical"
                      ? "border-red-100 bg-red-50 text-red-950"
                      : metric.tone === "attention"
                        ? "border-amber-100 bg-amber-50 text-amber-950"
                      : "border-slate-100 bg-white text-slate-950"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-500">
                      {metric.label}
                    </span>
                    <span
                      className={`mt-1 block truncate text-xs font-semibold ${
                        metric.tone === "critical"
                          ? "text-red-700"
                          : metric.tone === "attention"
                            ? "text-amber-800"
                            : "text-emerald-800"
                      }`}
                    >
                      {metric.detail}
                    </span>
                  </span>
                  <span className="max-w-[46vw] truncate text-right font-mono text-xl font-black leading-none tracking-tight sm:max-w-none">
                    {metric.value}
                  </span>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-3">
            <h2 className="text-base font-black text-slate-950">
              What needs your attention
            </h2>
            <div className="grid gap-2">
              {visibleOwnerAttentionItems.map((item) => (
                <button
                  key={`${item.label}-${item.title}`}
                  type="button"
                  onClick={() =>
                    openDashboardSection(
                      item.sectionId,
                      undefined,
                      item.targetElementId,
                    )
                  }
                  className={`grid gap-3 rounded-xl border px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:grid-cols-[1fr_auto] sm:items-center ${
                    item.tone === "critical"
                      ? "border-red-100 bg-red-50"
                      : item.tone === "attention"
                        ? "border-amber-100 bg-amber-50"
                        : "border-slate-100 bg-white"
                  }`}
                >
                  <span>
                    <span
                      className={`text-sm font-black ${
                        item.tone === "critical"
                          ? "text-red-950"
                          : item.tone === "attention"
                            ? "text-amber-950"
                            : "text-slate-950"
                      }`}
                    >
                      {item.title}
                    </span>
                    <span className="mt-1 block text-sm text-slate-600">
                      {item.detail}
                    </span>
                  </span>
                  <span className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm">
                    Review
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-4">
            <div id="inventory-location-summary" className="scroll-mt-24">
              <h2 className="text-base font-black text-slate-950">
                Inventory position
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Closing stock value by storage location and SKU type.
              </p>
              <div className="mt-3 grid gap-2">
                {ownerLocationRows.map((location) => (
                  <button
                    key={location.location}
                    type="button"
                    onClick={() => openDashboardSection("inventory")}
                    className={`grid gap-2 rounded-xl border px-4 py-3 text-left shadow-sm sm:grid-cols-[1fr_auto] sm:items-center ${
                      location.tone === "critical"
                        ? "border-red-100 bg-red-50"
                        : location.tone === "attention"
                          ? "border-amber-100 bg-amber-50"
                          : "border-slate-100 bg-white"
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-semibold text-slate-950">
                        {location.location}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {location.statusDetail}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-base font-black text-slate-950">
                        {formatCurrency(location.stockValue, 0)}
                      </span>
                      <span
                        className={`mt-1 block text-xs font-black ${
                          location.tone === "critical"
                            ? "text-red-800"
                            : location.tone === "attention"
                              ? "text-amber-800"
                              : "text-emerald-800"
                        }`}
                      >
                        {location.tone === "healthy"
                          ? "Optimal"
                          : location.status}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-100 bg-white shadow-sm">
                <table className="executive-table w-full table-fixed text-left text-sm">
                  <thead className="bg-[#faf9f6] text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-black">Type</th>
                      <th className="px-4 py-3 text-right font-black">SKUs</th>
                      <th className="px-4 py-3 text-right font-black">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ownerInventoryTypeRows.slice(0, 4).map((row) => (
                      <tr key={row.type} className="hover:bg-[#faf9f6]">
                        <td className="px-4 py-3 font-semibold capitalize text-slate-950">
                          {row.type}
                          <span className="mt-0.5 block text-xs font-medium text-slate-500">
                            {row.highValueCount.toLocaleString()} high-value SKU
                            {row.highValueCount === 1 ? "" : "s"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">
                          {row.skuCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-black text-slate-950">
                          {formatCurrency(row.stockValue, 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ownerInventoryTypeRows.length > 4 ? (
                  <details className="border-t border-slate-100 px-4 py-3">
                    <summary className="cursor-pointer text-sm font-black text-slate-700">
                      See more inventory types
                    </summary>
                    <div className="mt-3 grid gap-2">
                      {ownerInventoryTypeRows.slice(4).map((row) => (
                        <div
                          key={`extra-${row.type}`}
                          className="grid gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:grid-cols-[minmax(0,1fr)_140px_170px] sm:items-center"
                        >
                          <span className="font-semibold capitalize text-slate-950">
                            {row.type}
                          </span>
                          <span className="text-right font-mono text-sm text-slate-600">
                            {row.skuCount.toLocaleString()} SKU
                            {row.skuCount === 1 ? "" : "s"}
                          </span>
                          <span className="text-right font-mono font-black text-slate-950">
                            {formatCurrency(row.stockValue, 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-black text-slate-950">
                Day-close checklist
              </h2>
              <span className="text-sm font-medium text-slate-500">
                {dayCloseCompletedCount} of {dayCloseChecks.length} done
              </span>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-emerald-600"
                style={{
                  width: `${
                    (dayCloseCompletedCount /
                      Math.max(dayCloseChecks.length, 1)) *
                    100
                  }%`,
                }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {dayCloseChecks.slice(0, 5).map((check) => (
                <button
                  key={check.key}
                  type="button"
                  onClick={() =>
                    openDashboardSection(
                      check.href.replace("#", ""),
                      undefined,
                      "day-close-checklist",
                    )
                  }
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    check.passed
                      ? "bg-emerald-50 text-emerald-800"
                      : check.status === "exception"
                        ? "bg-red-50 text-red-800"
                        : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {check.passed ? "✓ " : ""}
                  {check.label}
                </button>
              ))}
            </div>
          </section>

          <section id="avt-location-summary" className="scroll-mt-24 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
            <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <h2 className="text-base font-black text-slate-950">
                  AvT by storage location
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Variance exposure is only reliable when POS, counts, waste, and production confirmations are complete.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openDashboardSection("overview")}
                className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm"
              >
                Review AvT
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="executive-table w-full table-fixed text-left text-sm">
                <thead className="bg-[#faf9f6] text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-black">Location</th>
                    <th className="px-4 py-3 text-right font-black">Revenue</th>
                    <th className="px-4 py-3 text-right font-black">Variance</th>
                    <th className="px-4 py-3 text-right font-black">Confidence</th>
                    <th className="px-4 py-3 text-right font-black">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ownerAvtLocationRows.length > 0 ? (
                    ownerAvtLocationRows.slice(0, 5).map((row) => (
                      <tr key={row.location} className="hover:bg-[#faf9f6]">
                        <td className="px-4 py-3 font-semibold text-slate-950">
                          {row.location}
                          <span className="mt-0.5 block text-xs font-medium text-slate-500">
                            {row.periodCount.toLocaleString()} period
                            {row.periodCount === 1 ? "" : "s"} checked
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-950">
                          {formatCurrency(row.revenue, 0)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-black ${
                            row.variance > 0.01
                              ? "text-red-800"
                              : "text-emerald-700"
                          }`}
                        >
                          {formatCurrency(row.variance, 0)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">
                          {row.confidence.toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}
                          %
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`rounded-lg px-2.5 py-1 text-xs font-black ${
                              row.reviewCount > 0
                                ? "bg-amber-50 text-amber-800"
                                : "bg-emerald-50 text-emerald-800"
                            }`}
                          >
                            {row.reviewCount > 0 ? "Review" : "Ready"}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-5 text-sm text-slate-500"
                      >
                        No AvT summary is visible for the selected period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {ownerAvtLocationRows.length > 5 ? (
                <details className="border-t border-slate-100 px-4 py-3">
                  <summary className="cursor-pointer text-sm font-black text-slate-700">
                    See more AvT locations
                  </summary>
                  <div className="mt-3 grid gap-2">
                    {ownerAvtLocationRows.slice(5).map((row) => (
                      <div
                        key={`extra-avt-${row.location}`}
                        className="grid gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:grid-cols-[minmax(0,1fr)_150px_170px] sm:items-center"
                      >
                        <span className="font-semibold text-slate-950">
                          {row.location}
                        </span>
                        <span className="text-right font-mono text-sm text-slate-600">
                          {row.confidence.toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}
                          % confidence
                        </span>
                        <span
                          className={`text-right font-mono font-black ${
                            row.variance > 0.01
                              ? "text-red-800"
                              : "text-emerald-700"
                          }`}
                        >
                          {formatCurrency(row.variance, 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-5">
            {[
              {
                label: "Inventory Position",
                section: "overview",
                targetElementId: "inventory-location-summary",
              },
              {
                label: "Procurement Intel",
                section: "overview",
                targetElementId: "procurement-intelligence-summary",
              },
              {
                label: "Waste & Leaks",
                section: "overview",
                targetElementId: "waste-analysis-summary",
              },
              {
                label: "Food Cost Overview",
                section: "overview",
                targetElementId: "menu-profitability-summary",
              },
              {
                label: "Trend Analysis",
                section: "overview",
                targetElementId: "trend-analysis-summary",
              },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() =>
                  openDashboardSection(
                    item.section,
                    undefined,
                    item.targetElementId,
                  )
                }
                className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-left text-sm font-semibold text-slate-900 shadow-sm transition hover:border-slate-400 hover:shadow-md"
              >
                {item.label}
              </button>
            ))}
          </section>

          <section
            id="trend-analysis-summary"
            className="scroll-mt-24"
          >
            <div className="grid gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                  Trend analysis
                </p>
                <h2 className="mt-1 text-base font-black text-slate-950">
                  What changed across {selectedPeriodLabel}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Separate trend lines for the signals owners should review before asking teams for detail. Each chart has its own operating filter.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-5 lg:grid-cols-2">
              {ownerTrendCards.map((card) => renderOwnerTrendCard(card))}
            </div>
          </section>

          <section className="grid gap-10">
            <div id="menu-profitability-summary" className="scroll-mt-24">
              <h2 className="text-base font-black text-slate-950">
                Food cost overview
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Recipe costing, menu pricing, and margin readiness across sub-recipes and final menu items.
              </p>
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-[#fbfaf7] px-4 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                        Price simulation
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Select a recipe below to model selling price and gross margin impact.
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_130px] lg:w-[520px]">
                      <label className="grid gap-1 text-xs font-black uppercase tracking-widest text-slate-400">
                        Recipe
                        <select
                          value={selectedOwnerFoodCostRow?.recipeId ?? ""}
                          onChange={(event) =>
                            setSelectedPricingSimulationRecipeId(event.target.value)
                          }
                          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                        >
                          {ownerFoodCostRows.map((row) => (
                            <option key={`owner-sim-option-${row.recipeId}`} value={row.recipeId}>
                              {row.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-black uppercase tracking-widest text-slate-400">
                        Price change
                        <input
                          type="number"
                          step="0.1"
                          value={priceSimulationPct}
                          onChange={(event) => setPriceSimulationPct(event.target.value)}
                          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="owner-table-scroll mt-4 overflow-x-auto">
                    <table className="executive-table w-full table-fixed text-left text-sm">
                      <colgroup>
                        <col className="w-[260px]" />
                        <col className="w-[120px]" />
                        <col className="w-[135px]" />
                        <col className="w-[100px]" />
                        <col className="w-[115px]" />
                        <col className="w-[120px]" />
                      </colgroup>
                      <thead className="bg-white text-xs uppercase text-slate-400">
                        <tr>
                          <th className="px-4 py-3 font-black">Selected recipe</th>
                          <th className="px-4 py-3 text-right font-black">Current price</th>
                          <th className="px-4 py-3 text-right font-black">Simulated price</th>
                          <th className="px-4 py-3 text-right font-black">Food cost</th>
                          <th className="px-4 py-3 text-right font-black">Gross margin</th>
                          <th className="px-4 py-3 text-right font-black">Target price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedOwnerFoodCostRow ? (
                          <tr className="rounded-xl border border-emerald-200 bg-emerald-50/60">
                            <td className="px-4 py-3 font-semibold text-slate-950">
                              {selectedOwnerFoodCostRow.name}
                              <span className="mt-0.5 block text-xs font-medium text-slate-500">
                                {selectedOwnerFoodCostRow.category} / {selectedOwnerFoodCostRow.batchQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedOwnerFoodCostRow.batchUom}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-slate-950">
                              {selectedOwnerFoodCostRow.isFinalMenu
                                ? formatCurrency(selectedOwnerFoodCostRow.sellingPrice, 0)
                                : "N/A"}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-black text-emerald-800">
                              {selectedOwnerFoodCostRow.isFinalMenu
                                ? formatCurrency(ownerSimulatedSellingPrice, 0)
                                : "N/A"}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-slate-950">
                              {selectedOwnerFoodCostRow.foodCostPct === null
                                ? "N/A"
                                : `${selectedOwnerFoodCostRow.foodCostPct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-black text-slate-950">
                              {ownerSimulatedGrossMarginPct === null
                                ? "N/A"
                                : `${ownerSimulatedGrossMarginPct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-slate-950">
                              {selectedOwnerFoodCostRow.isFinalMenu
                                ? formatCurrency(selectedOwnerFoodCostRow.recommendedPrice, 0)
                                : "N/A"}
                            </td>
                          </tr>
                        ) : (
                          <tr>
                            <td colSpan={6} className="px-4 py-5 text-sm text-slate-500">
                              Add recipes to start price simulation.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="owner-table-scroll overflow-x-auto">
                  <table className="executive-table w-full table-fixed text-left text-sm">
                    <colgroup>
                      <col className="w-[210px]" />
                      <col className="w-[120px]" />
                      <col className="w-[85px]" />
                      <col className="w-[85px]" />
                      <col className="w-[115px]" />
                      <col className="w-[115px]" />
                      <col className="w-[120px]" />
                      <col className="w-[95px]" />
                      <col className="w-[105px]" />
                    </colgroup>
                    <thead className="sticky top-0 bg-[#faf9f6] text-xs uppercase text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-black">Recipe</th>
                        <th className="px-4 py-3 font-black">Category</th>
                        <th className="px-4 py-3 text-right font-black">Batch UOM</th>
                        <th className="px-4 py-3 text-right font-black">Batch qty</th>
                        <th className="px-4 py-3 text-right font-black">Total cost</th>
                        <th className="px-4 py-3 text-right font-black">Cost / batch</th>
                        <th className="px-4 py-3 text-right font-black">Selling price</th>
                        <th className="px-4 py-3 text-right font-black">Food cost %</th>
                        <th className="px-4 py-3 text-right font-black">Gross margin %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ownerVisibleFoodCostRows.map((row) => (
                        <tr
                          key={`owner-food-cost-${row.recipeId}`}
                          onClick={() => setSelectedPricingSimulationRecipeId(row.recipeId)}
                          className={`cursor-pointer hover:bg-[#faf9f6] ${
                            selectedOwnerFoodCostRow?.recipeId === row.recipeId
                              ? "bg-emerald-50/70"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-3 font-semibold text-slate-950">
                            {row.name}
                            <span className="mt-0.5 block text-xs font-medium text-slate-500">
                              {row.componentCount.toLocaleString()} components
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {row.category}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-700">
                            {row.batchUom}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-950">
                            {row.batchQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-950">
                            {formatCurrency(row.totalCost, 0)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-950">
                            {formatCurrency(row.costPerBatch, 0)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-950">
                            {row.isFinalMenu ? formatCurrency(row.sellingPrice, 0) : "N/A"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-950">
                            {row.foodCostPct === null
                              ? "N/A"
                              : `${row.foodCostPct.toLocaleString(undefined, {
                                  maximumFractionDigits: 1,
                                })}%`}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-black text-slate-950">
                            {row.grossMarginPct === null
                              ? "N/A"
                              : `${row.grossMarginPct.toLocaleString(undefined, {
                                  maximumFractionDigits: 1,
                                })}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {ownerExtraFoodCostRows.length > 0 ? (
                    <details className="border-t border-slate-100 px-4 py-3">
                      <summary className="cursor-pointer text-sm font-black text-slate-700">
                        See more recipes
                      </summary>
                      <div className="owner-table-scroll mt-3 overflow-x-auto">
                        <table className="executive-table w-full table-fixed text-left text-sm">
                          <colgroup>
                            <col className="w-[210px]" />
                            <col className="w-[120px]" />
                            <col className="w-[85px]" />
                            <col className="w-[85px]" />
                            <col className="w-[115px]" />
                            <col className="w-[115px]" />
                            <col className="w-[120px]" />
                            <col className="w-[95px]" />
                            <col className="w-[105px]" />
                          </colgroup>
                          <tbody className="divide-y divide-slate-100">
                            {ownerExtraFoodCostRows.map((row) => (
                              <tr
                                key={`extra-owner-food-cost-${row.recipeId}`}
                                onClick={() => setSelectedPricingSimulationRecipeId(row.recipeId)}
                                className={`cursor-pointer rounded-xl border border-slate-200 hover:bg-[#faf9f6] ${
                                  selectedOwnerFoodCostRow?.recipeId === row.recipeId
                                    ? "bg-emerald-50/70"
                                    : "bg-white"
                                }`}
                              >
                                <td className="px-4 py-3 font-semibold text-slate-950">
                                  {row.name}
                                  <span className="mt-0.5 block text-xs font-medium text-slate-500">
                                    {row.componentCount.toLocaleString()} components
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-slate-700">{row.category}</td>
                                <td className="px-4 py-3 text-right font-mono text-slate-700">{row.batchUom}</td>
                                <td className="px-4 py-3 text-right font-mono text-slate-950">
                                  {row.batchQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-slate-950">
                                  {formatCurrency(row.totalCost, 0)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-slate-950">
                                  {formatCurrency(row.costPerBatch, 0)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-slate-950">
                                  {row.isFinalMenu ? formatCurrency(row.sellingPrice, 0) : "N/A"}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-slate-950">
                                  {row.foodCostPct === null
                                    ? "N/A"
                                    : `${row.foodCostPct.toLocaleString(undefined, {
                                        maximumFractionDigits: 1,
                                      })}%`}
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-black text-slate-950">
                                  {row.grossMarginPct === null
                                    ? "N/A"
                                    : `${row.grossMarginPct.toLocaleString(undefined, {
                                        maximumFractionDigits: 1,
                                      })}%`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ) : null}
                </div>
              </div>
            </div>

            <div id="waste-analysis-summary" className="scroll-mt-24">
              <h2 className="text-base font-black text-slate-950">
                Waste, {selectedPeriodLabel}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Broken down by reason for the selected operating period.
              </p>
              <div className="mt-4 grid gap-2">
                {wasteByReason.length > 0 ? (
                  wasteByReason.slice(0, 4).map((reason) => (
                    <button
                      key={reason.name}
                      type="button"
                      onClick={() => openDashboardSection("waste")}
                      className="grid rounded-xl border border-slate-100 bg-white px-5 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <span className="font-semibold capitalize text-slate-950">
                        {reason.name.replaceAll("_", " ")}
                      </span>
                      <span className="font-mono font-black text-red-800">
                        {formatCurrency(reason.cost, 0)}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="rounded-xl border border-slate-100 bg-white p-4 text-sm text-slate-500">
                    No waste cost is visible for this period.
                  </p>
                )}
                {wasteByReason.length > 4 ? (
                  <details className="rounded-xl border border-slate-100 bg-white px-5 py-3 shadow-sm">
                    <summary className="cursor-pointer text-sm font-black text-slate-700">
                      See more waste reasons
                    </summary>
                    <div className="mt-3 grid gap-2">
                      {wasteByReason.slice(4).map((reason) => (
                        <button
                          key={`extra-waste-${reason.name}`}
                          type="button"
                          onClick={() => openDashboardSection("waste")}
                          className="grid rounded-xl border border-slate-200 bg-white px-4 py-3 text-left sm:grid-cols-[minmax(0,1fr)_170px] sm:items-center"
                        >
                          <span className="font-semibold capitalize text-slate-950">
                            {reason.name.replaceAll("_", " ")}
                          </span>
                          <span className="text-right font-mono font-black text-red-800">
                            {formatCurrency(reason.cost, 0)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>

            <div id="procurement-intelligence-summary" className="scroll-mt-24">
              <h2 className="text-base font-black text-slate-950">
                Procurement intelligence
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Spend, supplier reliability, VAT, and price movement from recent purchase orders.
              </p>
              <div className="mt-5 grid gap-6">
                <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="text-xs font-black uppercase text-slate-400">
                      Product spend
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="executive-table w-full table-fixed text-left text-sm">
                      <thead className="bg-[#faf9f6] text-xs uppercase text-slate-400">
                        <tr>
                          <th className="px-4 py-3 font-black">Product</th>
                          <th className="px-4 py-3 text-right font-black">Spend</th>
                          <th className="px-4 py-3 text-right font-black">VAT</th>
                          <th className="px-4 py-3 text-right font-black">Inflation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ownerProcurementProductRows.length > 0 ? (
                          ownerProcurementProductRows.slice(0, 4).map((row) => (
                            <tr key={`${row.item}-${row.sku}`} className="hover:bg-[#faf9f6]">
                              <td className="px-4 py-3 font-semibold text-slate-950">
                                {row.item}
                                <span className="mt-0.5 block text-xs font-medium text-slate-500">
                                  {row.lastSupplier} / {formatCurrency(row.lastUnitCost, 2)} unit
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-slate-950">
                                {formatCurrency(row.spend, 0)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-slate-700">
                                {formatCurrency(row.tax, 0)}
                              </td>
                              <td
                                className={`px-4 py-3 text-right font-mono font-black ${
                                  row.priceVariance > 0.01
                                    ? "text-red-800"
                                    : row.priceVariance < -0.01
                                      ? "text-emerald-700"
                                      : "text-slate-500"
                                }`}
                              >
                                {formatSignedCurrency(row.priceVariance)}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-4 py-5 text-sm text-slate-500"
                            >
                              No purchase order spend is visible for this period.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {ownerProcurementProductRows.length > 4 ? (
                      <details className="border-t border-slate-100 px-4 py-3">
                        <summary className="cursor-pointer text-sm font-black text-slate-700">
                          See more product spend
                        </summary>
                        <div className="mt-3 grid gap-2">
                          {ownerProcurementProductRows.slice(4).map((row) => (
                            <div
                              key={`extra-product-${row.item}-${row.sku}`}
                              className="grid gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:grid-cols-[minmax(0,1fr)_160px_130px_150px] sm:items-center"
                            >
                              <span className="font-semibold text-slate-950">
                                {row.item}
                                <span className="block text-xs font-medium text-slate-500">
                                  {row.lastSupplier}
                                </span>
                              </span>
                              <span className="text-right font-mono font-black text-slate-950">
                                {formatCurrency(row.spend, 0)}
                              </span>
                              <span className="text-right font-mono text-sm text-slate-600">
                                {formatCurrency(row.tax, 0)} VAT
                              </span>
                              <span
                                className={`text-right font-mono font-black ${
                                  row.priceVariance > 0.01
                                    ? "text-red-800"
                                    : row.priceVariance < -0.01
                                      ? "text-emerald-700"
                                      : "text-slate-500"
                                }`}
                              >
                                {formatSignedCurrency(row.priceVariance)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </div>

                <div id="supplier-performance-summary" className="scroll-mt-24 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="text-xs font-black uppercase text-slate-400">
                      Supplier performance
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="executive-table w-full table-fixed text-left text-sm">
                      <thead className="bg-[#faf9f6] text-xs uppercase text-slate-400">
                        <tr>
                          <th className="px-4 py-3 font-black">Supplier</th>
                          <th className="px-4 py-3 text-right font-black">Spend</th>
                          <th className="px-4 py-3 text-right font-black">Receipt</th>
                          <th className="px-4 py-3 text-right font-black">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ownerSupplierRows.length > 0 ? (
                          ownerSupplierRows.slice(0, 4).map((row) => (
                            <tr key={row.supplier} className="hover:bg-[#faf9f6]">
                              <td className="px-4 py-3 font-semibold text-slate-950">
                                {row.supplier}
                                <span className="mt-0.5 block text-xs font-medium text-slate-500">
                                  {row.orders.toLocaleString()} PO
                                  {row.orders === 1 ? "" : "s"} / {row.partial_orders.toLocaleString()} partial
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-slate-950">
                                {formatCurrency(row.ordered_value, 0)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-slate-700">
                                {row.receipt_rate.toLocaleString(undefined, {
                                  maximumFractionDigits: 0,
                                })}
                                %
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span
                                  className={`rounded-lg px-2.5 py-1 text-xs font-black ${
                                    row.status === "Reliable"
                                      ? "bg-emerald-50 text-emerald-800"
                                      : row.status === "Monitor"
                                        ? "bg-amber-50 text-amber-800"
                                        : "bg-red-50 text-red-800"
                                  }`}
                                >
                                  {row.status}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-4 py-5 text-sm text-slate-500"
                            >
                              No supplier performance data is visible yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {ownerSupplierRows.length > 4 ? (
                      <details className="border-t border-slate-100 px-4 py-3">
                        <summary className="cursor-pointer text-sm font-black text-slate-700">
                          See more suppliers
                        </summary>
                        <div className="mt-3 grid gap-2">
                          {ownerSupplierRows.slice(4).map((row) => (
                            <div
                              key={`extra-supplier-${row.supplier}`}
                              className="grid gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:grid-cols-[minmax(0,1fr)_160px_140px_130px] sm:items-center"
                            >
                              <span className="font-semibold text-slate-950">
                                {row.supplier}
                                <span className="block text-xs font-medium text-slate-500">
                                  {row.orders.toLocaleString()} PO
                                  {row.orders === 1 ? "" : "s"} / {row.partial_orders.toLocaleString()} partial
                                </span>
                              </span>
                              <span className="text-right font-mono font-black text-slate-950">
                                {formatCurrency(row.ordered_value, 0)}
                              </span>
                              <span className="text-right font-mono text-sm text-slate-600">
                                {row.receipt_rate.toLocaleString(undefined, {
                                  maximumFractionDigits: 0,
                                })}
                                % receipt
                              </span>
                              <span
                                className={`rounded-lg px-2.5 py-1 text-xs font-black ${
                                  row.status === "Reliable"
                                    ? "bg-emerald-50 text-emerald-800"
                                    : row.status === "Monitor"
                                      ? "bg-amber-50 text-amber-800"
                                      : "bg-red-50 text-red-800"
                                }`}
                              >
                                {row.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div id="ingredient-price-summary" className="scroll-mt-24">
              <h2 className="text-base font-black text-slate-950">
                Ingredient price changes
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                What suppliers have changed recently, and what it affects.
              </p>
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="executive-table w-full table-fixed text-left text-sm">
                    <colgroup>
                      <col className="w-[38%]" />
                      <col className="w-[18%]" />
                      <col className="w-[20%]" />
                      <col className="w-[24%]" />
                    </colgroup>
                    <thead className="sticky top-0 bg-[#faf9f6] text-xs uppercase text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-black">Ingredient</th>
                        <th className="px-4 py-3 font-black">Change</th>
                        <th className="px-4 py-3 font-black">Affects</th>
                        <th className="px-4 py-3 font-black">Impact</th>
                      </tr>
                    </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ownerPriceRows.length > 0 ? (
                        ownerPriceRows.slice(0, 4).map((row) => (
                          <tr key={row.id} className="hover:bg-[#faf9f6]">
                            <td className="px-4 py-3 font-semibold text-slate-950">
                              {row.itemName}
                            </td>
                            <td
                              className={`px-4 py-3 font-mono font-black ${
                                row.tone === "healthy"
                                  ? "text-emerald-700"
                                  : row.tone === "attention"
                                    ? "text-red-800"
                                    : "text-slate-500"
                              }`}
                            >
                              {row.change}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {row.affectedRecipeCount.toLocaleString()} recipe
                              {row.affectedRecipeCount === 1 ? "" : "s"}
                            </td>
                            <td className="px-4 py-3 font-mono text-slate-950">
                              {row.impact}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-4 py-5 text-sm text-slate-500"
                          >
                            No supplier price movement is visible for this period.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {ownerPriceRows.length > 4 ? (
                    <details className="border-t border-slate-100 px-4 py-3">
                      <summary className="cursor-pointer text-sm font-black text-slate-700">
                        See more price changes
                      </summary>
                      <div className="mt-3 overflow-x-auto">
                        <table className="executive-table w-full table-fixed text-left text-sm">
                          <colgroup>
                            <col className="w-[38%]" />
                            <col className="w-[18%]" />
                            <col className="w-[20%]" />
                            <col className="w-[24%]" />
                          </colgroup>
                          <tbody className="divide-y divide-slate-100">
                            {ownerPriceRows.slice(4).map((row) => (
                              <tr
                                key={`extra-price-${row.id}`}
                                className="hover:bg-[#faf9f6]"
                              >
                                <td className="px-4 py-3 font-semibold text-slate-950">
                                  {row.itemName}
                                </td>
                                <td
                                  className={`px-4 py-3 font-mono font-black ${
                                    row.tone === "healthy"
                                      ? "text-emerald-700"
                                      : row.tone === "attention"
                                        ? "text-red-800"
                                        : "text-slate-500"
                                  }`}
                                >
                                  {row.change}
                                </td>
                                <td className="px-4 py-3 text-slate-700">
                                  {row.affectedRecipeCount.toLocaleString()} recipe
                                  {row.affectedRecipeCount === 1 ? "" : "s"}
                                </td>
                                <td className="px-4 py-3 font-mono text-slate-950">
                                  {row.impact}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ) : null}
                </div>
              </div>
            </div>

            <section className="grid gap-7 xl:grid-cols-2">
              <div>
                <h2 className="text-base font-black text-slate-950">
                  Approvals waiting on you
                </h2>
                <div className="mt-4 grid gap-2">
                  {ownerApprovalRows.length > 0 ? (
                    ownerApprovalRows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() =>
                          openDashboardSection("approvals")
                        }
                        className="grid rounded-xl border border-slate-100 bg-white px-4 py-3 text-left shadow-sm sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-3"
                      >
                        <span className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-black text-amber-800">
                          {row.label}
                        </span>
                        <span className="font-semibold text-slate-950">
                          {row.title} · {row.detail}
                        </span>
                        <span className="text-xs text-slate-500">{row.status}</span>
                      </button>
                    ))
                  ) : (
                    <p className="rounded-xl border border-slate-100 bg-white p-4 text-sm text-slate-500">
                      No approvals are waiting right now.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <h2 className="text-base font-black text-slate-950">
                  Recent activity
                </h2>
                <div className="mt-4 grid gap-2">
                  {ownerRecentActivity.length > 0 ? (
                    ownerRecentActivity.slice(0, 5).map((event) => (
                      <div
                        key={event.id}
                        className="grid rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm sm:grid-cols-[1fr_auto] sm:items-center"
                      >
                        <span className="min-w-0">
                          <span className="font-black text-slate-950">
                            {event.type}
                          </span>
                          <span className="text-slate-500"> · {event.title}</span>
                        </span>
                        <span
                          className={`font-mono font-black ${
                            event.tone === "positive"
                              ? "text-emerald-700"
                              : event.tone === "warning"
                                ? "text-red-800"
                                : "text-slate-600"
                          }`}
                        >
                          {event.value}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-xl border border-slate-100 bg-white p-4 text-sm text-slate-500">
                      No operating activity is visible yet.
                    </p>
                  )}
                </div>
              </div>
            </section>
          </section>
        </div>
      ) : null}

      <div className={`${ownerOverviewActive ? "hidden" : ""} overflow-hidden rounded-sm border ${
        isFinanceFocus
          ? "border-slate-200 bg-card shadow-[var(--finance-shadow)]"
          : "border-border-system bg-card shadow-2xl shadow-black/40"
      }`}>
        <div className="border-b border-border-system px-6 py-7 text-foreground sm:px-8">
          <div className="min-w-0 max-w-4xl">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
              {roleDashboardLabel}
            </p>
            <h1 className="mt-3 font-serif text-4xl font-normal leading-tight text-foreground sm:text-5xl">
              {roleDashboardHeadline}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-text-muted">
              {roleDashboardDescription}{" "}
              <strong className="font-extrabold text-foreground">
                {operatingScopeLabel}
              </strong>
              .
            </p>
            <p className="mt-3 text-sm font-semibold text-text-ghost">
              {roleLabels[focusRole]} / {planLabels[organization.subscription_tier]}
            </p>
          </div>
          <div className={`mt-7 overflow-hidden rounded-sm border ${
            isFinanceFocus
              ? "border-slate-200 bg-[var(--finance-canvas)] shadow-[var(--finance-shadow)]"
              : "border-border-system bg-background shadow-[0_10px_30px_rgba(25,65,45,0.04)]"
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-system bg-card px-5 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Live control signals
              </p>
              <span className="h-2 w-2 rounded-full bg-accent" />
            </div>
            <div className="grid divide-y divide-border-system sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            {roleHeroSignals.map((signal) => {
              const quietValue = isFinanceFocus && isQuietMetricValue(signal.value);

              return (
                <div
                  key={signal.label}
                  className={`min-h-[108px] p-5 ${quietValue ? "opacity-65" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      {signal.label}
                    </p>
                    <span
                      className={`${inlineSignalClass} ${inlineSignalToneStyles[quietValue ? "info" : signal.tone]}`}
                    >
                      {quietValue ? "Idle" : "Live"}
                    </span>
                  </div>
                  <p
                    className={`mt-3 break-words font-mono text-[clamp(1.125rem,2vw,1.5rem)] font-semibold leading-tight tracking-tight sm:whitespace-nowrap ${
                      quietValue ? "text-text-ghost" : "text-foreground"
                    }`}
                  >
                    {signal.value}
                  </p>
                  <p className="mt-2 text-sm text-text-muted">{signal.detail}</p>
                </div>
              );
            })}
            </div>
          </div>
        </div>
        <div className="px-6 py-6 sm:px-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleExecutiveKpis.map((metric) => (
              <ExecutiveKpiCard key={metric.label} metric={metric} inverse />
            ))}
          </div>
        </div>
      </div>

      {message ? (
        <div className="mt-5">
          <NoticeBanner message={message} />
        </div>
      ) : null}

      <section
        id="day"
        className={`${showDayControlSection && isSectionActive("day") ? "" : "hidden"} mt-8 scroll-mt-24 rounded-sm border border-border-system bg-card p-7 shadow-2xl shadow-black/25`}
      >
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-sm border border-accent-muted-border bg-accent-muted-bg p-6">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Day-Close Readiness
            </p>
            <p
              className={`mt-3 text-6xl font-semibold leading-none ${
                readinessScore >= 80
                  ? "text-accent"
                  : readinessScore >= 55
                    ? "text-status-attention-text"
                    : "text-status-critical-text"
              }`}
            >
              {readinessScore.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}
              %
            </p>
            <p className="mt-3 text-sm font-semibold text-foreground">
              Live-operation readiness
            </p>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-background">
              <div
                className={`h-full rounded-full ${
                  readinessScore >= 80
                    ? "bg-accent"
                    : readinessScore >= 55
                      ? "bg-status-attention-text"
                      : "bg-status-critical-text"
                }`}
                style={{ width: `${readinessScore}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Operating Priorities
                </p>
                <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
                  Day-Close Checklist
                </h2>
              </div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                {formatShortDate(latestActivityMs)}
              </p>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {visibleManagementActions.map((item) => (
                <ActionCard
                  key={`${item.priority}-${item.action}`}
                  item={item}
                  actionLabel="Open checklist"
                  onOpen={() =>
                    openDashboardSection("day", undefined, "day-close-checklist")
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="profit-movement"
        className={`${showFinancialDashboardSection && isSectionActive("profit-movement") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-slate-200 bg-card p-4 shadow-[var(--finance-shadow)] sm:p-6`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Finance Command Center
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Profit Movement
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-[var(--finance-canvas)] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              {formatShortDate(latestActivityMs)}
            </span>
            <span
              className={`rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                profitMovementNet >= 0
                  ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                  : "border-status-critical-border bg-status-critical-bg text-status-critical-text"
              }`}
            >
              {profitMovementNet >= 0 ? "Protected" : "Exposure"}
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                {
                  label: "Net movement",
                  value:
                    profitMovementNet === 0
                      ? "No exposure"
                      : formatSignedCurrency(profitMovementNet),
                  detail: largestProfitMovement
                    ? `${largestProfitMovement.owner} / ${largestProfitMovement.label}`
                    : "No captured movement",
                  tone:
                    profitMovementNet >= 0
                      ? ("healthy" as const)
                      : ("critical" as const),
                },
                {
                  label: "Margin health",
                  value: `${marginHealthScore}%`,
                  detail: "Current finance score",
                  tone:
                    marginHealthScore >= 75
                      ? ("healthy" as const)
                      : marginHealthScore >= 55
                        ? ("attention" as const)
                        : ("critical" as const),
                },
                {
                  label: "Visible exposure",
                  value: formatCurrency(potentialLossExposure, 0),
                  detail: "Loss and recovery queue",
                  tone:
                    potentialLossExposure > 0
                      ? ("attention" as const)
                      : ("healthy" as const),
                },
              ].map((metric) => {
                const quietMetric = isQuietMetricValue(metric.value);
                const toneClass =
                  metric.tone === "healthy"
                    ? "border-accent-muted-border text-accent"
                    : metric.tone === "attention"
                      ? "border-status-attention-border text-status-attention-text"
                      : "border-status-critical-border text-status-critical-text";

                return (
                  <article
                    key={metric.label}
                    className={`rounded-sm border border-l-4 bg-card p-4 shadow-[var(--finance-shadow)] ${toneClass} ${
                      quietMetric ? "opacity-70" : ""
                    }`}
                  >
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      {metric.label}
                    </p>
                    <p className={`mt-3 break-words font-mono text-2xl font-black leading-tight ${
                      quietMetric ? "text-text-ghost" : ""
                    }`}>
                      {metric.value}
                    </p>
                    <p className="mt-2 line-clamp-1 text-xs text-text-muted" title={metric.detail}>
                      {metric.detail}
                    </p>
                  </article>
                );
              })}
            </div>

            <div className="rounded-sm border border-slate-200 bg-[var(--finance-canvas)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                    Cost Cascade Watch
                  </p>
                  <h3 className="mt-1 text-lg font-extrabold text-foreground">
                    {primaryCostCascadeAlert
                      ? primaryCostCascadeAlert.skuName
                      : "No active purchased SKU spike"}
                  </h3>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                    primaryCostCascadeAlert
                      ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                      : "border-accent-muted-border bg-accent-muted-bg text-accent"
                  }`}
                >
                  {primaryCostCascadeAlert
                    ? formatCurrency(primaryCostCascadeAlert.impact, 0)
                    : "Clear"}
                </span>
              </div>

              {primaryCostCascadeAlert ? (
                <div className="mt-4 grid gap-2">
                  {[
                    {
                      level: "Level 1",
                      label: "Raw SKU trigger",
                      value:
                        primaryCostCascadeAlert.changePct !== null
                          ? `${primaryCostCascadeAlert.skuName} +${primaryCostCascadeAlert.changePct.toLocaleString(
                              undefined,
                              { maximumFractionDigits: 1 },
                            )}%`
                          : primaryCostCascadeAlert.skuName,
                      tone: "critical" as const,
                    },
                    {
                      level: "Level 2",
                      label: "Recipe layer",
                      value: primaryCostCascadeAlert.subRecipeName,
                      tone: "attention" as const,
                    },
                    {
                      level: "Level 3",
                      label: "Menu margin check",
                      value:
                        primaryCostCascadeAlert.marginPct === null
                          ? `${primaryCostCascadeAlert.menuName} / check margin`
                          : `${primaryCostCascadeAlert.menuName} / ${primaryCostCascadeAlert.marginPct.toLocaleString(
                              undefined,
                              { maximumFractionDigits: 1 },
                            )}% margin`,
                      tone: "critical" as const,
                    },
                  ].map((step, index, steps) => (
                    <div
                      key={step.level}
                      className="grid gap-2 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-center"
                    >
                      <span className="font-mono text-[10px] font-black uppercase tracking-widest text-text-ghost">
                        {step.level}
                      </span>
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                            step.tone === "attention"
                              ? "bg-status-attention-text"
                              : "bg-status-critical-text"
                          }`}
                        />
                        <div className="min-w-0 flex-1 rounded-sm border border-slate-200 bg-card px-3 py-2">
                          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                            {step.label}
                          </p>
                          <p className="truncate text-sm font-bold text-foreground">
                            {step.value}
                          </p>
                        </div>
                        {index < steps.length - 1 ? (
                          <ArrowRight className="hidden text-text-ghost sm:block" size={16} />
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-sm border border-accent-muted-border bg-accent-muted-bg px-3 py-3 text-sm font-semibold text-accent">
                  No supplier cost spike is currently driving recipe or menu-margin exposure.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-sm border border-slate-200 bg-card p-4 shadow-[var(--finance-shadow)]">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Exposure Queue
                </p>
                <h3 className="mt-1 text-lg font-extrabold text-foreground">
                  What Finance should review
                </h3>
              </div>
              <LineChart className="text-text-ghost" size={20} />
            </div>
            <div className="mt-3 grid gap-2">
              {profitMovementRows.map((row) => {
              const movementClass =
                row.value > 0
                  ? "text-accent"
                  : row.value < 0
                    ? "text-status-critical-text"
                    : "text-text-ghost";
              const rowIcon =
                row.label.includes("Waste")
                  ? AlertTriangle
                  : row.label.includes("Menu")
                    ? CircleDollarSign
                    : row.label.includes("Purchased")
                      ? ReceiptText
                      : LineChart;
              const RowIcon = rowIcon;

              return (
                <article
                  key={row.label}
                  className="grid gap-3 rounded-sm border border-slate-200 bg-[var(--finance-canvas)] p-3 transition hover:border-border-system-hover"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-slate-200 bg-[var(--finance-canvas)] text-text-muted">
                      <RowIcon size={18} strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold text-foreground">{row.label}</p>
                        <span className={`font-mono text-sm font-black ${movementClass}`}>
                          {row.value === 0 ? "No exposure" : formatSignedCurrency(row.value)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-text-ghost" title={row.detail}>
                        {row.detail}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="rounded-full border border-slate-200 bg-card px-2.5 py-1 text-[11px] font-bold text-text-muted">
                          {row.owner}
                        </span>
                        <a
                          href={row.href}
                          className="inline-flex h-8 w-fit items-center gap-2 rounded-sm border border-border-system bg-card px-3 text-[11px] font-bold uppercase tracking-wider text-foreground transition hover:border-border-system-hover"
                        >
                          Review
                          <ArrowRight size={13} strokeWidth={2.4} />
                        </a>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
            </div>
          </div>
        </div>
      </section>

      <section
        id="approvals"
        className={`${showApprovalSection && isSectionActive("approvals") ? "" : "hidden"} mt-8 rounded-sm border border-border-system bg-card p-7 shadow-2xl shadow-black/25`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Approvals
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Pending Decisions
            </h2>
          </div>
          <span className="rounded-full border border-border-system bg-background px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            {roleLabels[currentRole]}
          </span>
        </div>

        {pendingApprovalRequests.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {pendingApprovalRequests.map((request) => (
              <div
                key={request.id}
                className="grid gap-4 rounded-sm border border-border-system bg-background p-4 lg:grid-cols-[1fr_auto] lg:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground">
                      {request.request_type.replaceAll("_", " ")}
                    </p>
                    <span className="rounded-full border border-status-attention-border bg-status-attention-bg px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-status-attention-text">
                      {request.status === "accepted"
                        ? "Awaiting receipt"
                        : "Pending"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-text-muted">
                    Requested{" "}
                    {request.created_at
                      ? new Date(request.created_at).toLocaleString()
                      : "recently"}
                  </p>
                  <ApprovalRequestSummary
                    request={request}
                    inventoryItems={inventoryItems}
                  />
                </div>
                <div className="grid gap-2">
                  {request.request_type === "inventory_requisition" &&
                  request.status === "pending" ? (
                    <div className="grid min-w-0 gap-2 sm:min-w-[280px]">
                      {Array.isArray(request.payload?.lines)
                        ? request.payload.lines.map((line, index) => {
                            const typedLine = line as Record<string, unknown>;
                            const inventoryItemId = extractUuid(
                              typedLine.inventory_item_id,
                            );
                            const inputKey = `${request.id}-${inventoryItemId || index}`;
                            const itemName =
                              typeof typedLine.item_name === "string"
                                ? typedLine.item_name
                                : "Inventory item";
                            const requestedQuantity = Number(
                              typedLine.quantity ?? 0,
                            );
                            const uom =
                              typeof typedLine.uom === "string"
                                ? typedLine.uom
                                : "unit";

                            return (
                              <label
                                key={inputKey}
                                className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost"
                              >
                                {itemName} requested{" "}
                                {requestedQuantity.toLocaleString(undefined, {
                                  maximumFractionDigits: 3,
                                })}{" "}
                                {uom}
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  placeholder="Transfer qty"
                                  value={requisitionIssueQtyByKey[inputKey] ?? ""}
                                  onChange={(event) =>
                                    setRequisitionIssueQtyByKey((currentValues) => ({
                                      ...currentValues,
                                      [inputKey]: event.target.value,
                                    }))
                                  }
                                  className={formControlClass}
                                />
                              </label>
                            );
                          })
                        : null}
                    </div>
                  ) : request.request_type === "inventory_requisition" &&
                    request.status === "accepted" ? (
                    <p className="max-w-sm rounded-sm border border-status-info-border bg-status-info-bg px-3 py-2 text-sm font-semibold text-status-info-text">
                      Store has dispatched this request. The receiving department can
                      acknowledge receipt to post stock movement, or reject it if the
                      physical delivery is wrong.
                    </p>
                  ) : request.request_type === "stock_count_approval" &&
                    !canApproveFinanceStockControl ? (
                    <p className="max-w-sm rounded-sm border border-status-attention-border bg-status-attention-bg px-3 py-2 text-sm font-semibold text-status-attention-text">
                      Stock counts and adjustments require Finance approval
                      before balances are posted.
                    </p>
                  ) : ["sku_creation_approval", "vendor_creation_approval"].includes(
                      request.request_type,
                    ) && !canApproveFinanceStockControl ? (
                    <p className="max-w-sm rounded-sm border border-status-attention-border bg-status-attention-bg px-3 py-2 text-sm font-semibold text-status-attention-text">
                      Vendor and SKU master-data requests require Finance
                      approval before they become live records.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {request.request_type === "inventory_requisition" &&
                    request.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          disabled={!canRecordOperations}
                          onClick={() => handleEditRequisitionRequest(request)}
                          className="h-10 rounded-sm border border-border-system bg-card px-4 text-sm font-semibold text-foreground transition hover:border-border-system-hover disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Edit request
                        </button>
                        <button
                          type="button"
                          disabled={!canApproveOperations}
                          onClick={() => handleConfirmRequisitionRequest(request)}
                          className="h-10 rounded-sm bg-accent px-4 text-sm font-semibold text-background transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Dispatch for acknowledgement
                        </button>
                      </>
                    ) : request.request_type === "inventory_requisition" &&
                      request.status === "accepted" ? (
                      <>
                        <button
                          type="button"
                          disabled={!canRecordOperations}
                          onClick={() => handleAcknowledgeRequisitionRequest(request)}
                          className="h-10 rounded-sm bg-accent px-4 text-sm font-semibold text-background transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Acknowledge receipt
                        </button>
                        <button
                          type="button"
                          disabled={!canRecordOperations}
                          onClick={() =>
                            handleRejectRequisitionReceiptRequest(request)
                          }
                          className="h-10 rounded-sm border border-status-critical-border bg-status-critical-bg px-4 text-sm font-semibold text-status-critical-text transition hover:border-status-critical-text disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Reject receipt
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          !canApproveOperations ||
                          (request.request_type === "stock_count_approval" &&
                            !canApproveFinanceStockControl) ||
                          ([
                            "sku_creation_approval",
                            "vendor_creation_approval",
                          ].includes(request.request_type) &&
                            !canApproveFinanceStockControl)
                        }
                        onClick={() => onApproveRequest(request.id)}
                        className="h-10 rounded-sm bg-accent px-4 text-sm font-semibold text-background transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Approve
                      </button>
                    )}
                  {request.status === "pending" ? (
                    <button
                      type="button"
                      disabled={!canApproveOperations}
                      onClick={() => onRejectRequest(request.id)}
                      className="h-10 rounded-sm border border-border-system bg-card px-4 text-sm font-semibold text-foreground transition hover:border-border-system-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Reject
                    </button>
                  ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-sm border border-border-system bg-background px-5 py-4 text-sm text-text-muted">
            No pending approval requests.
          </p>
        )}
      </section>

      <section
        id="finance-brief"
        className={`${showFinancialDashboardSection && isSectionActive("finance-brief") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-slate-200 bg-card p-4 shadow-[var(--finance-shadow)] sm:p-6`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Finance Brief
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Margin Recovery Actions
            </h2>
          </div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            {formatShortDate(latestActivityMs)}
          </p>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="grid gap-3 sm:grid-cols-3">
            {strategicIndexes.map((index) => {
              const toneClass =
                index.tone === "healthy"
                  ? "border-accent-muted-border bg-card"
                  : index.tone === "attention"
                    ? "border-status-attention-border bg-card"
                    : "border-status-critical-border bg-card";
              const valueClass =
                index.tone === "healthy"
                  ? "text-accent"
                  : index.tone === "attention"
                    ? "text-status-attention-text"
                    : "text-status-critical-text";
              const quietValue = isQuietMetricValue(index.value);

              return (
                <article
                  key={index.label}
                  className={`rounded-sm border border-l-4 p-4 shadow-[var(--finance-shadow)] ${toneClass} ${
                    quietValue ? "opacity-70" : ""
                  }`}
                >
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                    {index.label}
                  </p>
                  <p className={`mt-2 font-mono text-3xl font-semibold ${quietValue ? "text-text-ghost" : valueClass}`}>
                    {index.value}
                  </p>
                  <p className="mt-2 text-sm text-text-muted">{index.detail}</p>
                </article>
              );
            })}
          </div>

          <div className="grid gap-3">
            {visibleManagementActions.map((item) => {
              const badgeClass =
                item.tone === "critical"
                  ? "border-status-critical-border bg-status-critical-bg text-status-critical-text"
                  : item.tone === "attention"
                    ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                    : "border-status-info-border bg-status-info-bg text-status-info-text";
              const itemIcon =
                item.tone === "critical"
                  ? AlertTriangle
                  : item.tone === "attention"
                    ? ClipboardCheck
                    : ShieldCheck;
              const ItemIcon = itemIcon;

              return (
                <article
                  key={`${item.priority}-${item.action}`}
                  className="grid gap-4 rounded-sm border border-slate-200 bg-card p-4 text-sm text-text-muted shadow-[var(--finance-shadow)] transition hover:border-border-system-hover md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-center"
                >
                  <div className="flex min-w-0 gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-sm border ${badgeClass}`}>
                      <ItemIcon size={18} strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0">
                      <span
                        className={`inline-flex w-fit rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${badgeClass}`}
                      >
                        {item.priority}
                      </span>
                      <p className="mt-2 font-semibold text-foreground">
                        {item.action}
                      </p>
                    </div>
                  </div>
                  <p className="line-clamp-2 text-sm leading-6 text-text-muted" title={item.detail}>
                    {item.detail}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="overview"
        className={`${showFinancialDashboardSection && isSectionActive("overview") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Margin Overview
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Sales and Margin Summary
            </h2>
          </div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            {menuSaleSummaries.length.toLocaleString()} sale
            {menuSaleSummaries.length === 1 ? "" : "s"} analyzed
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricPill
            label="Revenue"
            value={`${organization.local_currency} ${totalSalesRevenue.toLocaleString(
              undefined,
              { maximumFractionDigits: 2 },
            )}`}
          />
          <MetricPill
            label="Food cost"
            value={`${organization.local_currency} ${totalSalesFoodCost.toLocaleString(
              undefined,
              { maximumFractionDigits: 2 },
            )}`}
          />
          <MetricPill
            label="Gross profit"
            value={`${organization.local_currency} ${totalSalesGrossProfit.toLocaleString(
              undefined,
              { maximumFractionDigits: 2 },
            )}`}
          />
          <MetricPill
            label="Margin"
            value={
              totalSalesMarginPct === null
                ? "N/A"
                : `${totalSalesMarginPct.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}%`
            }
          />
          <MetricPill
            label="Variance losses"
            value={`${organization.local_currency} ${(
              productionLossImpact + stockLossImpact + directWasteImpact
            ).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            valueClassName={
              productionLossImpact + stockLossImpact + directWasteImpact > 0
                ? "font-semibold text-status-critical-text"
                : "font-semibold text-foreground"
            }
          />
        </div>

        <div className="mt-5 rounded-sm border border-border-system bg-background p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Actual vs Theoretical
              </p>
              <h3 className="mt-1 text-xl font-semibold text-foreground">
                AvT readiness
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
                Compares POS revenue and recipe depletion against production,
                waste, and stock variance by operating date and location.
              </p>
            </div>
            <span
              className={`rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                avtNeedsReviewCount > 0 || visibleAvtSummary.length === 0
                  ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                  : "border-accent-muted-border bg-accent-muted-bg text-accent"
              }`}
            >
              {avtReadinessLabel}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricPill
              label="AvT locations"
              value={visibleAvtSummary.length.toLocaleString()}
              detail={`${avtReadyCount.toLocaleString()} ready`}
            />
            <MetricPill
              label="Confidence"
              value={
                visibleAvtSummary.length === 0
                  ? "0%"
                  : `${avtConfidenceScore.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}%`
              }
              detail={avtConfidenceDetail}
              valueClassName={
                avtConfidenceStatus === "high" ||
                avtConfidenceStatus === "usable"
                  ? "font-semibold text-foreground"
                  : "font-semibold text-status-critical-text"
              }
            />
            <MetricPill
              label="Revenue checked"
              value={`${organization.local_currency} ${avtRevenue.toLocaleString(
                undefined,
                { maximumFractionDigits: 2 },
              )}`}
            />
            <MetricPill
              label="Theoretical cost"
              value={`${organization.local_currency} ${avtTheoreticalCost.toLocaleString(
                undefined,
                { maximumFractionDigits: 2 },
              )}`}
            />
            <MetricPill
              label="Variance exposure"
              value={`${organization.local_currency} ${avtVarianceExposure.toLocaleString(
                undefined,
                { maximumFractionDigits: 2 },
              )}`}
              valueClassName={
                avtVarianceExposure > 0
                  ? "font-semibold text-status-critical-text"
                  : "font-semibold text-foreground"
              }
            />
            <MetricPill
              label="AvT food cost"
              value={
                avtFoodCostPct === null
                  ? "N/A"
                  : `${avtFoodCostPct.toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })}%`
              }
              detail={latestAvtRow ? latestAvtRow.operating_date : "No AvT row"}
            />
          </div>

          {latestAvtRow?.readiness_flags.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {latestAvtRow.readiness_flags.slice(0, 4).map((flag) => (
                <div
                  key={flag.key}
                  className="rounded-sm border border-status-attention-border bg-status-attention-bg px-4 py-3 text-sm text-status-attention-text"
                >
                  <p className="font-semibold">{flag.label}</p>
                  <p className="mt-1 leading-5">{flag.message}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <FinancialTrendChart
          points={financialTrendPoints}
          currency={organization.local_currency}
        />

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="overflow-hidden rounded-sm border border-border-system bg-card">
            <div className="grid gap-4 border-b border-border-system bg-background px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:grid-cols-[1fr_0.42fr_0.62fr_0.62fr_0.5fr_0.5fr_0.72fr]">
              <span>Menu item</span>
              <span>Qty</span>
              <span>Revenue</span>
              <span>Gross profit</span>
              <span>Food cost %</span>
              <span>Margin</span>
              <span>Action</span>
            </div>

            {menuPerformance.length > 0 ? (
              menuPerformance.slice(0, 8).map((item) => {
                const action =
                  item.foodCostPct !== null && item.foodCostPct >= 40
                    ? "Review recipe"
                    : item.marginPct !== null && item.marginPct < 55
                      ? "Price recovery"
                      : "Protected";
                const actionClass =
                  action === "Protected"
                    ? "text-accent"
                    : action === "Price recovery"
                      ? "text-status-critical-text"
                      : "text-status-attention-text";

                return (
                  <div
                    key={item.name}
                    className="grid gap-3 border-t border-border-system px-5 py-4 text-sm text-text-muted transition hover:bg-background/70 lg:grid-cols-[1fr_0.42fr_0.62fr_0.62fr_0.5fr_0.5fr_0.72fr] lg:items-center"
                  >
                    <Cell label="Menu item" strong>
                      {item.name}
                    </Cell>
                    <Cell label="Qty">
                      {item.quantity.toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })}
                    </Cell>
                    <Cell label="Revenue" strong>
                      {organization.local_currency}{" "}
                      {item.revenue.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </Cell>
                    <Cell label="Gross profit" strong>
                      {organization.local_currency}{" "}
                      {item.grossProfit.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </Cell>
                    <Cell label="Food cost %">
                      {item.foodCostPct === null
                        ? "N/A"
                        : `${item.foodCostPct.toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                          })}%`}
                    </Cell>
                    <Cell label="Margin" strong>
                      {item.marginPct === null
                        ? "N/A"
                        : `${item.marginPct.toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                          })}%`}
                    </Cell>
                    <Cell label="Action" strong className={actionClass}>
                      {action}
                    </Cell>
                  </div>
                );
              })
            ) : (
              <p className="border-t border-border-system px-5 py-5 text-sm text-text-muted">
                No sales depletion events recorded yet.
              </p>
            )}
          </div>

          <div className="grid content-start gap-3">
            <div className="rounded-sm border border-border-system bg-background p-4">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Best performer
              </p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {menuPerformance[0]?.name ?? "No sales yet"}
              </p>
              <p className="mt-1 text-sm text-text-muted">
                {menuPerformance[0]
                  ? `${organization.local_currency} ${menuPerformance[0].grossProfit.toLocaleString(
                      undefined,
                      { maximumFractionDigits: 2 },
                    )} gross profit`
                  : "Record sales to rank menu items."}
              </p>
            </div>
            <div className="rounded-sm border border-border-system bg-background p-4">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Variance exposure
              </p>
              <div className="mt-3 grid gap-2">
                <MetricPill
                  label="Production"
                  value={`${organization.local_currency} ${productionLossImpact.toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 },
                  )}`}
                />
                <MetricPill
                  label="Stock count"
                  value={`${organization.local_currency} ${stockLossImpact.toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 },
                  )}`}
                />
                <MetricPill
                  label="Direct waste"
                  value={`${organization.local_currency} ${directWasteImpact.toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 },
                  )}`}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="pricing"
        className={`${showFinancialSection && isSectionActive("pricing") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Price Recovery
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Menu Margin Compression Guardrails
            </h2>
          </div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            {targetMenuMarginPct}% target margin threshold
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricPill
            label="Menus checked"
            value={menuPricingGuardrails.length.toLocaleString()}
          />
          <MetricPill
            label="Need review"
            value={underpricedMenuItems.length.toLocaleString()}
            valueClassName={
              underpricedMenuItems.length > 0
                ? "font-semibold text-status-critical-text"
                : "font-semibold text-foreground"
            }
          />
          <MetricPill
            label="Protected"
            value={protectedMenuItems.length.toLocaleString()}
            valueClassName={
              protectedMenuItems.length > 0
                ? "font-semibold text-accent"
                : "font-semibold text-foreground"
            }
          />
          <MetricPill
            label="Recent recovery"
            value={`${organization.local_currency} ${menuMarginRecovery.toLocaleString(
              undefined,
              { maximumFractionDigits: 2 },
            )}`}
          />
        </div>

        <div className="mt-5 overflow-hidden rounded-sm border border-border-system bg-background">
          <div className="grid gap-4 border-b border-border-system bg-card px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:grid-cols-[1fr_0.7fr_0.7fr_0.8fr_1.1fr]">
            <span>Recovery action</span>
            <span>Cost movement</span>
            <span>Margin</span>
            <span>Responsible</span>
            <span>Recommended action</span>
          </div>

          {marginRecoveryActions.length > 0 ? (
            marginRecoveryActions.slice(0, 8).map((action) => (
              <div
                key={action.id}
                className="grid gap-3 border-t border-border-system px-5 py-4 text-sm text-text-muted transition hover:bg-card/70 lg:grid-cols-[1fr_0.7fr_0.7fr_0.8fr_1.1fr] lg:items-center"
              >
                <Cell label="Recovery action" strong>
                  <span className="block truncate">
                    {action.recipe?.name ?? "Recipe impact"}
                  </span>
                  <span className="mt-1 block text-xs font-normal text-text-ghost">
                    {action.item?.name ?? "Received ingredient"} /{" "}
                    {new Date(action.createdAt).toLocaleDateString()}
                  </span>
                </Cell>
                <Cell
                  label="Cost movement"
                  strong
                  className={
                    action.costDelta > 0
                      ? "text-status-critical-text"
                      : "text-accent"
                  }
                >
                  {action.costDelta > 0 ? "+" : ""}
                  {organization.local_currency}{" "}
                  {action.costDelta.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </Cell>
                <Cell
                  label="Margin"
                  strong
                  className={
                    action.currentMarginPct !== null &&
                    action.currentMarginPct < targetMenuMarginPct
                      ? "text-status-critical-text"
                      : "text-accent"
                  }
                >
                  {action.currentMarginPct === null
                    ? "Sub-recipe"
                    : `${action.currentMarginPct.toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}%`}
                </Cell>
                <Cell label="Responsible" strong>
                  {action.responsibleRole}
                </Cell>
                <Cell label="Recommended action" strong>
                  {action.recommendedAction}
                  {action.priceGap > 0.01 ? (
                    <span className="mt-1 block text-xs font-normal text-text-ghost">
                      Recovery gap: {organization.local_currency}{" "}
                      {action.priceGap.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })} per sale
                    </span>
                  ) : null}
                </Cell>
              </div>
            ))
          ) : (
            <p className="border-t border-border-system px-5 py-5 text-sm text-text-muted">
              New purchase receipts will create margin recovery actions when they
              change recipe costs.
            </p>
          )}
        </div>

        {simulatedPricingItem ? (
          <div className="mt-6 grid gap-4 rounded-sm border border-status-info-border bg-status-info-bg p-5 xl:grid-cols-[1fr_280px] xl:items-center">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-status-info-text">
                  Live Price Recalculation Simulation
              </p>
              <h3 className="mt-1 text-xl font-semibold text-foreground">
                {simulatedPricingItem.recipe.name}
              </h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricPill
                  label="Current price"
                  value={`${organization.local_currency} ${simulatedPricingItem.sellingPrice.toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 },
                  )}`}
                />
                <MetricPill
                  label="New selling price"
                  value={`${organization.local_currency} ${simulatedPrice.toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 },
                  )}`}
                />
                <MetricPill
                  label="Expected margin"
                  value={
                    simulatedMarginPct === null
                      ? "N/A"
                      : `${simulatedMarginPct.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}%`
                  }
                  valueClassName={
                    simulatedMarginPct !== null &&
                    simulatedMarginPct >= targetMenuMarginPct
                      ? "font-semibold text-accent"
                      : "font-semibold text-status-attention-text"
                  }
                />
                <MetricPill
                  label="Selected-period impact"
                  value={
                    simulatedPricingItem.soldQuantity > 0
                      ? `${organization.local_currency} ${simulatedSelectedPeriodImpact.toLocaleString(
                          undefined,
                          { maximumFractionDigits: 2 },
                        )}`
                      : "N/A"
                  }
                  valueClassName={
                    simulatedSelectedPeriodImpact > 0
                      ? "font-semibold text-accent"
                      : simulatedSelectedPeriodImpact < 0
                        ? "font-semibold text-status-critical-text"
                      : "font-semibold text-text-muted"
                  }
                />
              </div>
              <p className="mt-3 text-sm leading-6 text-text-muted">
                Impact uses actual selected-period sales only:{" "}
                <span className="font-semibold text-foreground">
                  {simulatedPricingItem.soldQuantity.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}{" "}
                  unit{simulatedPricingItem.soldQuantity === 1 ? "" : "s"} sold
                </span>{" "}
                x{" "}
                <span className="font-semibold text-foreground">
                  {formatSignedCurrency(simulatedPriceDelta)}
                </span>{" "}
                price movement. Target price remains{" "}
                <span className="font-semibold text-foreground">
                  {formatCurrency(simulatedPricingItem.recommendedPrice)}
                </span>{" "}
                for the {targetMenuMarginPct}% margin benchmark.
              </p>
            </div>
            <label className="grid gap-2 text-sm font-semibold text-text-muted">
              What-if menu price movement
              <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                <input
                  type="number"
                  min="-90"
                  step="1"
                  value={priceSimulationPct}
                  onChange={(event) => setPriceSimulationPct(event.target.value)}
                  className={formControlClass}
                />
                <span className="text-sm font-semibold text-text-muted">%</span>
              </div>
            </label>
          </div>
        ) : null}

        <div className="mt-5 overflow-hidden rounded-sm border border-border-system bg-card">
          <div className="grid gap-4 border-b border-border-system bg-background px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:grid-cols-[1fr_0.7fr_0.7fr_0.6fr_0.8fr_0.75fr]">
            <span>Menu item</span>
            <span>Selling price</span>
            <span>Unit food cost</span>
            <span>Margin</span>
            <span>Target price</span>
            <span>Action</span>
          </div>

          {menuPricingGuardrails.length > 0 ? (
            menuPricingGuardrails.slice(0, 10).map((item) => {
              const needsReview = item.priceGap > 0.01;
              const isSimulatedItem =
                simulatedPricingItem &&
                getRecipeId(simulatedPricingItem.recipe) ===
                  getRecipeId(item.recipe);

              return (
                <button
                  key={item.recipe.id}
                  type="button"
                  onClick={() =>
                    setSelectedPricingSimulationRecipeId(getRecipeId(item.recipe))
                  }
                  className={`grid w-full gap-3 border-t border-border-system px-5 py-4 text-left text-sm text-text-muted transition hover:bg-background/70 lg:grid-cols-[1fr_0.7fr_0.7fr_0.6fr_0.8fr_0.75fr] lg:items-center ${
                    isSimulatedItem
                      ? "bg-status-info-bg ring-1 ring-inset ring-status-info-border"
                      : ""
                  }`}
                >
                  <Cell label="Menu item" strong>
                    {item.recipe.name}
                    {isSimulatedItem ? (
                      <span className="mt-1 block text-xs font-normal text-status-info-text">
                        Active simulation
                      </span>
                    ) : null}
                  </Cell>
                  <Cell label="Selling price">
                    {organization.local_currency}{" "}
                    {item.sellingPrice.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                  </Cell>
                  <Cell label="Unit food cost">
                    {organization.local_currency}{" "}
                    {item.unitFoodCost.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                  </Cell>
                  <Cell
                    label="Margin"
                    strong
                    className={
                      item.marginPct !== null && item.marginPct < targetMenuMarginPct
                        ? "text-status-critical-text"
                        : "text-accent"
                    }
                  >
                    {item.marginPct === null
                      ? "N/A"
                      : `${item.marginPct.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}%`}
                  </Cell>
                  <Cell label="Target price" strong>
                    {organization.local_currency}{" "}
                    {item.recommendedPrice.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                  </Cell>
                  <Cell
                    label="Action"
                    strong
                    className={
                      needsReview ? "text-status-critical-text" : "text-accent"
                    }
                  >
                    <span className="block">
                      {needsReview
                        ? `Raise ${organization.local_currency} ${item.priceGap.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 2 },
                          )}`
                        : "Protected"}
                    </span>
                    <span className="mt-1 block text-xs font-normal text-text-ghost">
                      {isSimulatedItem ? "Selected" : "Simulate"}
                    </span>
                  </Cell>
                </button>
              );
            })
          ) : (
            <p className="border-t border-border-system px-5 py-5 text-sm text-text-muted">
              <span
                className={`${inlineSignalClass} ${inlineSignalToneStyles.info}`}
              >
                Add final menu recipes
              </span>{" "}
              with ingredients and selling prices to see pricing guardrails.
            </p>
          )}
        </div>
      </section>

      <section
        id="menu-profitability"
        className={`${showFinancialSection && isSectionActive("menu-profitability") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Executive Menu Economics
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Final Menu Profitability Summary
            </h2>
          </div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            {targetMenuMarginPct}% margin target / {targetMenuFoodCostPct}% food cost ceiling
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricPill
            label="Final menu items"
            value={menuProfitabilityTotals.total.toLocaleString()}
          />
          <MetricPill
            label="Margin risk"
            value={menuProfitabilityTotals.marginRisk.toLocaleString()}
            valueClassName={
              menuProfitabilityTotals.marginRisk > 0
                ? "font-semibold text-status-attention-text"
                : "font-semibold text-foreground"
            }
          />
          <MetricPill
            label="Protected"
            value={menuProfitabilityTotals.protected.toLocaleString()}
            valueClassName={
              menuProfitabilityTotals.protected > 0
                ? "font-semibold text-accent"
                : "font-semibold text-foreground"
            }
          />
          <MetricPill
            label="Setup gaps"
            value={menuProfitabilityTotals.missingSetup.toLocaleString()}
            valueClassName={
              menuProfitabilityTotals.missingSetup > 0
                ? "font-semibold text-status-critical-text"
                : "font-semibold text-foreground"
            }
          />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_260px]">
          <label className="grid gap-2 text-sm font-semibold text-text-muted">
            Search menu item
            <input
              type="search"
              value={menuProfitabilitySearch}
              onChange={(event) => setMenuProfitabilitySearch(event.target.value)}
              placeholder="Search final menu items"
              className={formControlClass}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-text-muted">
            Profitability status
            <select
              value={menuProfitabilityFilter}
              onChange={(event) =>
                setMenuProfitabilityFilter(
                  event.target.value as MenuProfitabilityFilter,
                )
              }
              className={formControlClass}
            >
              {menuProfitabilityFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 overflow-hidden rounded-sm border border-border-system bg-background">
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[1240px] table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-[230px]" />
                <col className="w-[95px]" />
                <col className="w-[95px]" />
                <col className="w-[150px]" />
                <col className="w-[135px]" />
                <col className="w-[115px]" />
                <col className="w-[125px]" />
                <col className="w-[155px]" />
                <col className="w-[140px]" />
              </colgroup>
              <thead className="border-b border-border-system bg-card">
                <tr className="whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  <th className="px-4 py-3">Final menu item</th>
                  <th className="px-4 py-3">Batch UOM</th>
                  <th className="px-4 py-3 text-right">Batch qty</th>
                  <th className="px-4 py-3 text-right">Cost per batch</th>
                  <th className="px-4 py-3 text-right">Selling price</th>
                  <th className="px-4 py-3 text-right">Food cost %</th>
                  <th className="px-4 py-3 text-right">Gross margin %</th>
                  <th className="px-4 py-3 text-right">Suggested price</th>
                  <th className="px-4 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredMenuProfitabilityRows.length > 0 ? (
                  filteredMenuProfitabilityRows.map((item) => (
                    <tr
                      key={item.recipe.id}
                      className="border-t border-border-system transition hover:bg-card/80"
                    >
                      <td className="px-4 py-4 align-top">
                        <p className="truncate font-semibold text-foreground">
                          {item.recipe.name}
                        </p>
                        <p className="mt-1 truncate font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                          {item.components.length.toLocaleString()} ingredient
                          {item.components.length === 1 ? "" : "s"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 align-top font-semibold text-text-muted">
                        {item.outputUom}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums text-foreground">
                        {item.batchOutput.toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums text-foreground">
                        {formatCurrency(item.costPerBatch)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums text-foreground">
                        {formatCurrency(item.sellingPrice)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums text-text-muted">
                        {item.foodCostPct === null
                          ? "N/A"
                          : `${item.foodCostPct.toLocaleString(undefined, {
                              maximumFractionDigits: 1,
                            })}%`}
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums ${
                          item.marginPct !== null &&
                          item.marginPct >= targetMenuMarginPct
                            ? "text-accent"
                            : "text-status-attention-text"
                        }`}
                      >
                        {item.marginPct === null
                          ? "N/A"
                          : `${item.marginPct.toLocaleString(undefined, {
                              maximumFractionDigits: 1,
                            })}%`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums text-foreground">
                        {formatCurrency(item.recommendedPrice)}
                        {item.priceGap > 0.01 ? (
                          <span className="mt-1 block text-[11px] text-status-critical-text">
                            +{formatCurrency(item.priceGap)}
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top">
                        <span
                          className={`${inlineSignalClass} ${
                            menuProfitabilityStatusStyles[item.status]
                          }`}
                        >
                          {menuProfitabilityStatusLabels[item.status]}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-5 py-8 text-center text-sm text-text-muted"
                    >
                      No final menu item matches the selected profitability filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 p-3 xl:hidden">
            {filteredMenuProfitabilityRows.length > 0 ? (
              filteredMenuProfitabilityRows.map((item) => (
                <div
                  key={item.recipe.id}
                  className="rounded-sm border border-border-system bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">
                        {item.recipe.name}
                      </p>
                      <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                        {item.batchOutput.toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })}{" "}
                        {item.outputUom} batch
                      </p>
                    </div>
                    <span
                      className={`${inlineSignalClass} ${
                        menuProfitabilityStatusStyles[item.status]
                      }`}
                    >
                      {menuProfitabilityStatusLabels[item.status]}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <MetricPill
                      label="Cost per batch"
                      value={formatCurrency(item.costPerBatch)}
                    />
                    <MetricPill
                      label="Selling price"
                      value={formatCurrency(item.sellingPrice)}
                    />
                    <MetricPill
                      label="Food cost"
                      value={
                        item.foodCostPct === null
                          ? "N/A"
                          : `${item.foodCostPct.toLocaleString(undefined, {
                              maximumFractionDigits: 1,
                            })}%`
                      }
                    />
                    <MetricPill
                      label="Gross margin"
                      value={
                        item.marginPct === null
                          ? "N/A"
                          : `${item.marginPct.toLocaleString(undefined, {
                              maximumFractionDigits: 1,
                            })}%`
                      }
                      valueClassName={
                        item.marginPct !== null &&
                        item.marginPct >= targetMenuMarginPct
                          ? "font-semibold text-accent"
                          : "font-semibold text-status-attention-text"
                      }
                    />
                  </div>
                  <div className="mt-3 rounded-sm border border-border-system bg-background p-3">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Suggested selling price
                    </p>
                    <p className="mt-1 font-mono text-lg font-semibold text-foreground">
                      {formatCurrency(item.recommendedPrice)}
                    </p>
                    {item.priceGap > 0.01 ? (
                      <p className="mt-1 text-sm font-semibold text-status-critical-text">
                        Increase by {formatCurrency(item.priceGap)}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-sm border border-border-system bg-card p-4 text-sm text-text-muted">
                No final menu item matches the selected profitability filter.
              </p>
            )}
          </div>
        </div>
      </section>

      <section
        id="procurement-intelligence"
        className={`${(showFinancialSection || isRole("procurement_manager")) && isSectionActive("procurement-intelligence") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Procurement & Supplier Intelligence
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Supplier spend, price variance, and delivery discipline
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-text-muted">
              VAT is captured separately from landed cost, so recipe costing stays clean
              while Finance can still review tax exposure.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              downloadCsvReport(
                `supplier-intelligence-${reportDateLabel}.csv`,
                procurementSupplierReportRows,
              )
            }
            disabled={procurementSupplierReportRows.length === 0}
            className={secondaryButtonClass}
          >
            Download
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricPill
            label="Committed spend"
            value={formatCurrency(procurementCommittedSpend)}
          />
          <MetricPill
            label="Received value"
            value={formatCurrency(procurementReceivedValue)}
          />
          <MetricPill
            label="Inflation exposure"
            value={formatCurrency(procurementInflationExposure)}
            valueClassName={
              procurementInflationExposure > 0
                ? "font-semibold text-status-critical-text"
                : "font-semibold text-foreground"
            }
          />
          <MetricPill
            label="Price relief"
            value={formatCurrency(procurementDeflationRelief)}
            valueClassName={
              procurementDeflationRelief > 0
                ? "font-semibold text-accent"
                : "font-semibold text-foreground"
            }
          />
          <MetricPill
            label="VAT / tax captured"
            value={formatCurrency(procurementTaxExposure)}
          />
        </div>

        <div className="mt-5 overflow-hidden rounded-sm border border-border-system bg-background">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-[210px]" />
                <col className="w-[90px]" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
              </colgroup>
              <thead className="border-b border-border-system bg-card">
                <tr className="whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3 text-right">Orders</th>
                  <th className="px-4 py-3 text-right">Ordered</th>
                  <th className="px-4 py-3 text-right">Received</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-right">Receipt %</th>
                  <th className="px-4 py-3 text-right">Price variance</th>
                  <th className="px-4 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {supplierIntelligenceRows.length > 0 ? (
                  supplierIntelligenceRows.map((supplier) => (
                    <tr
                      key={supplier.supplier}
                      className="border-t border-border-system transition hover:bg-card/80"
                    >
                      <td className="px-4 py-4 align-top">
                        <p className="truncate font-semibold text-foreground">
                          {supplier.supplier}
                        </p>
                        <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                          {supplier.short_supply_orders.toLocaleString()} short supply /{" "}
                          {supplier.partial_orders.toLocaleString()} partial
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums text-foreground">
                        {supplier.orders.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums text-foreground">
                        {formatCurrency(supplier.ordered_value)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums text-foreground">
                        {formatCurrency(supplier.received_value)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums text-status-attention-text">
                        {formatCurrency(supplier.outstanding_value)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums text-text-muted">
                        {supplier.receipt_rate.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}%
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-4 text-right align-top font-mono font-semibold tabular-nums ${
                          supplier.price_variance_value > 0
                            ? "text-status-critical-text"
                            : supplier.price_variance_value < 0
                              ? "text-accent"
                              : "text-foreground"
                        }`}
                      >
                        {formatCurrency(supplier.price_variance_value)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right align-top">
                        <span
                          className={`${inlineSignalClass} ${
                            supplier.status === "Reliable"
                              ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                              : supplier.status === "Monitor"
                                ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                                : "border-status-critical-border bg-status-critical-bg text-status-critical-text"
                          }`}
                        >
                          {supplier.status}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-8 text-center text-sm text-text-muted"
                    >
                      No procurement activity is available for the selected window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section
        id="costing"
        className={`${showFinancialSection && isSectionActive("costing") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Procurement Cost Changes
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Purchased Ingredient Price Changes
            </h2>
          </div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            {ingredientPriceMovements.length.toLocaleString()} movement
            {ingredientPriceMovements.length === 1 ? "" : "s"} tracked
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricPill
            label="Net stock impact"
            value={formatCurrency(totalPriceMovementImpact)}
            valueClassName={
              totalPriceMovementImpact > 0
                ? "font-semibold text-status-critical-text"
                : totalPriceMovementImpact < 0
                  ? "font-semibold text-accent"
                  : "font-semibold text-foreground"
            }
          />
          <MetricPill
            label="Increase exposure"
            value={formatCurrency(priceIncreaseImpact)}
            valueClassName={
              priceIncreaseImpact > 0
                ? "font-semibold text-status-critical-text"
                : "font-semibold text-foreground"
            }
          />
          <MetricPill
            label="Decrease relief"
            value={formatCurrency(priceDecreaseRelief)}
            valueClassName={
              priceDecreaseRelief > 0
                ? "font-semibold text-accent"
                : "font-semibold text-foreground"
            }
          />
          <MetricPill
            label="Largest move"
            value={
              largestPriceMover
                ? largestPriceMover.changePct === null
                  ? formatCurrency(largestPriceMover.costDelta)
                  : `${largestPriceMover.changePct.toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })}%`
                : "N/A"
            }
          />
        </div>

        <div className="mt-5 rounded-sm border border-border-system bg-background p-6">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            Active Tier 3 Menu Erosion Stream
          </p>
          <h3 className="mt-2 font-serif text-2xl font-normal text-foreground">
            Real-Time Purchased SKU Cost Event
          </h3>
          <p className="mt-2 text-sm text-text-muted">
            Click a purchased SKU below to see its recipe and menu impact.
          </p>

          {macroCascadePriceMover ? (
            <div className="mt-5 space-y-3 font-mono text-sm">
              <div className="grid gap-3 border-b border-border-system pb-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0 text-text-muted">
                  Tier 1 Material:{" "}
                  <span className="font-bold text-foreground">
                    {macroCascadePriceMover.item?.name ?? "Ingredient cost"}
                  </span>
                  <p className="mt-1 text-xs text-text-ghost">
                    {formatCurrency(macroCascadePriceMover.oldCost)} to{" "}
                    {formatCurrency(macroCascadePriceMover.newCost)}{" "}
                    per{" "}
                    {macroCascadePriceMover.item?.base_uom ??
                      macroCascadePriceMover.item?.on_hand_uom ??
                      "unit"}{" "}
                    / Stock impact:{" "}
                    {formatCurrency(macroCascadePriceMover.onHandImpact)}
                  </p>
                </div>
                <div
                  className={`text-right font-bold ${
                    macroCascadePriceMover.costDelta > 0
                      ? "text-status-critical-text"
                      : "text-accent"
                  }`}
                >
                  <p>
                    {macroCascadePriceMover.costDelta > 0 ? "UP" : "DOWN"}{" "}
                    {macroCascadePriceMover.changePct === null
                      ? `${organization.local_currency} ${Math.abs(
                          macroCascadePriceMover.costDelta,
                        ).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}`
                      : `${Math.abs(
                          macroCascadePriceMover.changePct,
                        ).toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}%`}{" "}
                    {macroCascadePriceMover.costDelta > 0
                      ? "Price Drift"
                      : "Cost Relief"}
                  </p>
                  <p className="mt-1 text-xs">
                    {macroCascadePriceMover.costDelta > 0 ? "+" : ""}
                    {organization.local_currency}{" "}
                    {macroCascadePriceMover.costDelta.toLocaleString(
                      undefined,
                      { maximumFractionDigits: 2 },
                    )}{" "}
                    / base unit
                  </p>
                </div>
              </div>
              <div className="grid gap-3 border-b border-border-system pb-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0 text-text-muted">
                  Tier 2 Recipe:{" "}
                  <span className="font-bold text-foreground">
                    {macroCascadeSubRecipeImpact?.recipe.name ??
                      macroCascadeMenuImpact?.recipe.name ??
                      "Unlinked recipe path"}
                  </span>
                  <p className="mt-1 text-xs text-text-ghost">
                    {macroCascadeSubRecipeImpact
                      ? `${macroCascadeSubRecipeImpact.ingredientQtyPerOutput.toLocaleString(
                          undefined,
                          { maximumFractionDigits: 4 },
                        )} ${
                          macroCascadePriceMover.item?.base_uom ??
                          macroCascadePriceMover.item?.on_hand_uom ??
                          "unit"
                        } used per ${
                          macroCascadeSubRecipeImpact.outputUom ?? "output unit"
                        }`
                      : macroCascadeMenuImpact
                        ? `${macroCascadeMenuImpact.impactedQtyPerDish.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 4 },
                          )} ${
                            macroCascadePriceMover.item?.base_uom ??
                            macroCascadePriceMover.item?.on_hand_uom ??
                            "unit"
                          } used per dish`
                        : "No linked recipe component."}
                  </p>
                </div>
                <span
                  className={`text-right font-bold ${
                    (macroCascadeSubRecipeImpact?.unitCostImpact ??
                      macroCascadeMenuImpact?.compressedProfitPerDish ??
                      0) > 0
                      ? "text-status-attention-text"
                      : "text-accent"
                  }`}
                >
                  {macroCascadeSubRecipeImpact
                    ? `${
                        macroCascadeSubRecipeImpact.unitCostImpact > 0 ? "+" : ""
                      }${organization.local_currency} ${macroCascadeSubRecipeImpact.unitCostImpact.toLocaleString(
                        undefined,
                        { maximumFractionDigits: 2 },
                      )} / ${macroCascadeSubRecipeImpact.outputUom ?? "unit"}`
                    : macroCascadeMenuImpact
                      ? `${
                          macroCascadeMenuImpact.compressedProfitPerDish > 0
                            ? "+"
                            : ""
                        }${organization.local_currency} ${macroCascadeMenuImpact.compressedProfitPerDish.toLocaleString(
                          undefined,
                          { maximumFractionDigits: 2 },
                        )} direct dish cost`
                      : "No recipe impact"}
                </span>
              </div>
              <div className="grid gap-2 pt-2 text-base font-bold text-foreground md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div>
                  <span>Tier 3 Menu Item</span>
                  <p className="mt-1 font-mono text-xs font-normal text-text-ghost">
                    {macroCascadeMenuImpact
                      ? `${macroCascadeMenuImpact.recipe.name} / ${
                          macroCascadeMenuImpact.soldQuantity > 0
                            ? `${macroCascadeMenuImpact.soldQuantity.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 3 },
                              )} sold`
                            : "no sales yet"
                        }`
                      : "Link this material to a final menu recipe."}
                  </p>
                </div>
                <span
                  className={
                    macroCascadeMenuImpact &&
                    macroCascadeMenuImpact.compressedProfitPerDish <= 0
                      ? "font-mono text-accent"
                      : "font-mono text-status-critical-text"
                  }
                >
                  {macroCascadeMenuImpact
                    ? `${
                        macroCascadeMenuImpact.compressedProfitPerDish > 0
                          ? "-"
                          : "+"
                      } ${organization.local_currency} ${Math.abs(
                        macroCascadeMenuImpact.compressedProfitPerDish,
                      ).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })} / dish`
                    : "No menu impact"}
                </span>
              </div>
              {macroCascadeMenuImpact ? (
                <p className="pt-1 text-xs text-text-ghost">
                  Total impact: {organization.local_currency}{" "}
                  {(
                    macroCascadeMenuImpact.compressedProfitPerDish *
                    macroCascadeMenuImpact.soldQuantity
                  ).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}{" "}
                  / Target price: {organization.local_currency}{" "}
                  {macroCascadeMenuImpact.recommendedPrice.toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 },
                  )}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 rounded-sm border border-status-info-border bg-status-info-bg px-5 py-4 text-sm text-status-info-text">
              Record a receipt or cost update, then attach the ingredient to a
              final menu recipe.
            </div>
          )}
        </div>

        <div className="mt-5 overflow-hidden rounded-sm border border-border-system bg-card">
          <div className="grid gap-4 border-b border-border-system bg-background px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:grid-cols-[1fr_0.7fr_0.7fr_0.65fr_0.8fr_0.7fr]">
            <span>Purchased SKU</span>
            <span>Old cost</span>
            <span>New cost</span>
            <span>Move</span>
            <span>On hand impact</span>
            <span>Tier trace</span>
          </div>

          {ingredientPriceMovements.length > 0 ? (
            ingredientPriceMovements.slice(0, 8).map((event) => {
              const isSelected = event.id === activePriceMovementId;

              return (
                <button
                  key={event.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedPriceMovementId(event.id)}
                  className={`grid w-full gap-3 border-t px-5 py-4 text-left text-sm text-text-muted transition lg:grid-cols-[1fr_0.7fr_0.7fr_0.65fr_0.8fr_0.7fr] lg:items-center ${
                    isSelected
                      ? "border-accent-muted-border bg-accent-muted-bg/50"
                      : "border-border-system hover:bg-background/70"
                  }`}
                >
                  <Cell label="Purchased ingredient" strong>
                    {event.item?.name ?? "Ingredient cost"}
                  </Cell>
                  <Cell label="Old cost">
                    {formatCurrency(event.oldCost)}
                  </Cell>
                  <Cell label="New cost">
                    {formatCurrency(event.newCost)}
                  </Cell>
                  <Cell
                    label="Move"
                    strong
                    className={
                      event.costDelta > 0
                        ? "text-status-critical-text"
                        : "text-accent"
                    }
                  >
                    {event.changePct === null
                      ? formatCurrency(event.costDelta)
                      : `${event.changePct.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}%`}
                  </Cell>
                  <Cell
                    label="On hand impact"
                    strong
                    className={
                      event.onHandImpact > 0
                        ? "text-status-critical-text"
                        : event.onHandImpact < 0
                          ? "text-accent"
                          : ""
                    }
                  >
                    {formatCurrency(event.onHandImpact)}
                  </Cell>
                  <Cell
                    label="Tier trace"
                    strong
                    className={isSelected ? "text-accent" : "text-text-muted"}
                  >
                    {isSelected ? "Viewing tiers" : "View tiers"}
                  </Cell>
                </button>
              );
            })
          ) : (
            <p className="border-t border-border-system px-5 py-5 text-sm text-text-muted">
              No ingredient price movement recorded yet.
            </p>
          )}
        </div>
      </section>

      <section
        id="exceptions"
        className={`${showFinancialSection && isSectionActive("exceptions") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              What Needs Your Attention
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Margin Risk Board
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <MetricPill
              label="Critical"
              value={criticalExceptionCount.toLocaleString()}
              valueClassName={
                criticalExceptionCount > 0
                  ? "font-semibold text-status-critical-text"
                  : "font-semibold text-foreground"
              }
            />
            <MetricPill
              label="Watch"
              value={watchExceptionCount.toLocaleString()}
              valueClassName={
                watchExceptionCount > 0
                  ? "font-semibold text-status-attention-text"
                  : "font-semibold text-foreground"
              }
            />
          </div>
        </div>

        {exceptionItems.length > 0 ? (
          <>
          <div className="mt-5 grid gap-3 lg:hidden">
            {exceptionItems.map((item) => {
              const severityClass =
                item.tone === "critical"
                  ? "border-status-critical-border bg-status-critical-bg text-status-critical-text"
                  : item.tone === "warning"
                    ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                    : "border-status-info-border bg-status-info-bg text-status-info-text";
              const estimatedMonthlyLoss =
                item.sortImpact > 0 ? item.sortImpact * 4 : 0;
              const owner = item.category.includes("Price") ||
                item.category.includes("Margin")
                ? "Finance"
                : item.category.includes("Stock")
                  ? "Operations"
                  : "Manager";

              return (
                <article
                  key={item.id}
                  className="rounded-sm border border-border-system bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${severityClass}`}
                      >
                        {item.severity}
                      </span>
                      <h3 className="mt-3 text-base font-extrabold text-foreground">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-sm text-text-muted">
                        {item.detail}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-status-attention-border bg-status-attention-bg px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-attention-text">
                      Open
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-sm border border-border-system bg-background px-3 py-2">
                      <dt className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                        Owner
                      </dt>
                      <dd className="mt-1 font-bold text-foreground">
                        {owner}
                      </dd>
                    </div>
                    <div className="rounded-sm border border-border-system bg-background px-3 py-2">
                      <dt className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                        Deadline
                      </dt>
                      <dd className="mt-1 font-bold text-foreground">
                        {item.severity === "Critical" ? "Today" : "This week"}
                      </dd>
                    </div>
                    <div className="col-span-2 rounded-sm border border-border-system bg-background px-3 py-2">
                      <dt className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                        Monthly impact
                      </dt>
                      <dd className="mt-1 font-bold text-foreground">
                        {organization.local_currency}{" "}
                        {estimatedMonthlyLoss.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      className="rounded-sm bg-accent px-3 py-2 text-xs font-semibold text-background transition hover:bg-accent-hover"
                    >
                      Review
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-border-system bg-card px-3 py-2 text-xs font-semibold text-foreground transition hover:border-border-system-hover"
                    >
                      Escalate
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-border-system bg-background px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-border-system-hover"
                    >
                      Defer
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-5 hidden overflow-x-auto rounded-sm border border-border-system bg-card lg:block">
            <div className="min-w-[1040px]">
              <div className="grid grid-cols-[0.55fr_1.2fr_0.75fr_0.75fr_0.65fr_0.85fr_1fr] gap-4 border-b border-border-system bg-background px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                <span>Priority</span>
                <span>Issue</span>
                <span>Owner</span>
                <span>Deadline</span>
                <span>Status</span>
                <span>Monthly impact</span>
                <span>Action</span>
              </div>
            {exceptionItems.map((item) => {
              const severityClass =
                item.tone === "critical"
                  ? "border-status-critical-border bg-status-critical-bg text-status-critical-text"
                  : item.tone === "warning"
                    ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                    : "border-status-info-border bg-status-info-bg text-status-info-text";
              const estimatedMonthlyLoss =
                item.sortImpact > 0 ? item.sortImpact * 4 : 0;

              return (
                <div
                  key={item.id}
                  className="grid grid-cols-[0.55fr_1.2fr_0.75fr_0.75fr_0.65fr_0.85fr_1fr] items-center gap-4 border-t border-border-system px-5 py-4 text-sm text-text-muted transition hover:bg-background/70"
                >
                  <span
                    className={`w-fit rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${severityClass}`}
                  >
                    {item.severity}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">
                      {item.title}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-text-ghost">
                      {item.detail}
                    </p>
                  </div>
                  <span className="font-semibold text-foreground">
                    {item.category.includes("Price") ||
                    item.category.includes("Margin")
                      ? "Finance"
                      : item.category.includes("Stock")
                        ? "Operations"
                        : "Manager"}
                  </span>
                  <span>{item.severity === "Critical" ? "Today" : "This week"}</span>
                  <span className="rounded-full border border-status-attention-border bg-status-attention-bg px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-attention-text">
                    Open
                  </span>
                  <span className="font-semibold text-foreground">
                    {organization.local_currency}{" "}
                    {estimatedMonthlyLoss.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-sm bg-accent px-3 py-2 text-xs font-semibold text-background transition hover:bg-accent-hover"
                    >
                      Review
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-border-system bg-card px-3 py-2 text-xs font-semibold text-foreground transition hover:border-border-system-hover"
                    >
                      Escalate
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-border-system bg-background px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-border-system-hover"
                    >
                      Defer
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
          </>
        ) : (
          <div className="mt-5 rounded-sm border border-border-system bg-background px-5 py-6">
            <p className="text-sm font-semibold text-foreground">
              <span
                className={`${inlineSignalClass} ${inlineSignalToneStyles.healthy}`}
              >
                No active margin risks
              </span>
              .
            </p>
            <p className="mt-1 text-sm text-text-muted">
              {isInventoryFocus
                ? "Stock, receipts, requisitions, and count losses are"
                : "Stock, production variance, count losses, and menu margin are"}{" "}
              currently{" "}
              <span
                className={`${inlineSignalClass} ${inlineSignalToneStyles.healthy}`}
              >
                inside target range
              </span>
              .
            </p>
          </div>
        )}
      </section>

      <section
        id="day-history"
        className={`${showDayControlSection && isSectionActive("day") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Daily Control Ledger
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Operating Day
            </h2>
          </div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            {formatShortDate(latestActivityMs)}
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visibleOperatingDayMetrics.map((metric) => (
            <div
              key={metric.label}
              className="flex min-h-[132px] flex-col justify-between rounded-sm border border-border-system bg-background p-4 shadow-inner shadow-black/10"
            >
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  {metric.label}
                </p>
                <p className="mt-3 break-words font-mono text-xl font-semibold leading-tight tracking-tight text-foreground sm:whitespace-nowrap sm:text-2xl">
                  {metric.value}
                </p>
              </div>
              <p className="mt-3 text-sm leading-5 text-text-muted">
                {metric.detail}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.5fr)]">
          <div className="rounded-sm border border-border-system bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Operating posture
              </p>
              <span
                className={`rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                  readinessScore >= 80
                    ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                    : readinessScore >= 55
                      ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                      : "border-status-critical-border bg-status-critical-bg text-status-critical-text"
                }`}
              >
                {readinessScore >= 80
                  ? "Stable"
                  : readinessScore >= 55
                    ? "Watch"
                    : "Action open"}
              </span>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-card">
              <div
                className={`h-full rounded-full ${
                  readinessScore >= 80
                    ? "bg-accent"
                    : readinessScore >= 55
                      ? "bg-status-attention-text"
                      : "bg-status-critical-text"
                }`}
                style={{ width: `${readinessScore}%` }}
              />
            </div>
            <p className="mt-3 text-sm text-text-muted">
              <span
                className={`${inlineSignalClass} ${inlineSignalToneStyles.info}`}
              >
                Daily registers
              </span>
              , no-activity declarations, and exception flags shape the
              operating readiness score.
            </p>
          </div>

          <div className="rounded-sm border border-border-system bg-background p-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Day close focus
            </p>
            <p className="mt-2 text-lg font-semibold text-foreground">
              {complianceExceptionCount > 0
                ? "Resolve register exceptions"
                : compliancePendingCount > 0
                  ? "Complete open registers"
                  : "Daily compliance is complete"}
            </p>
            <p className="mt-1 text-sm text-text-muted">
              {complianceExceptionCount > 0 ? (
                <>
                  <span
                    className={`${inlineSignalClass} ${inlineSignalToneStyles.critical}`}
                  >
                    Exception declared
                  </span>{" "}
                  in a daily register. Review the department owner and notes.
                </>
              ) : compliancePendingCount > 0 ? (
                <>
                  <span
                    className={`${inlineSignalClass} ${inlineSignalToneStyles.attention}`}
                  >
                    {compliancePendingCount} open register
                    {compliancePendingCount === 1 ? "" : "s"}
                  </span>{" "}
                  must be recorded, declared clear, or flagged as an exception.
                </>
              ) : (
                <>
                  <span
                    className={`${inlineSignalClass} ${inlineSignalToneStyles.healthy}`}
                  >
                    Compliance complete
                  </span>{" "}
                  across the required daily operating registers.
                </>
              )}
            </p>
          </div>
        </div>

        <div
          id="day-close-checklist"
          className="mt-5 scroll-mt-24 rounded-sm border border-border-system bg-background"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-system px-5 py-4">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Department performance
              </p>
              <h3 className="mt-1 text-lg font-semibold text-foreground">
                Register completion by team
              </h3>
            </div>
            <span className="rounded-full border border-border-system bg-card px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              {currentOperatingDate}
            </span>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
            {departmentPerformanceRows.map((department) => (
              <div
                key={department.department}
                className="rounded-sm border border-border-system bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-foreground">
                    {department.department}
                  </p>
                  <span
                    className={`${inlineSignalClass} ${
                      department.score >= 80
                        ? inlineSignalToneStyles.healthy
                        : department.score >= 50
                          ? inlineSignalToneStyles.attention
                          : inlineSignalToneStyles.critical
                    }`}
                  >
                    {department.score}%
                  </span>
                </div>
                <p className="mt-2 text-sm text-text-muted">
                  {department.passed}/{department.total} register
                  {department.total === 1 ? "" : "s"} complete
                  {department.exceptions > 0
                    ? ` / ${department.exceptions} exception${
                        department.exceptions === 1 ? "" : "s"
                      }`
                    : ""}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-sm border border-border-system bg-background">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-system px-5 py-4">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Close control
              </p>
              <h3 className="mt-1 text-lg font-semibold text-foreground">
                Day Close Checklist
              </h3>
            </div>
            <span
              className={`rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                dayCloseChecklistReady
                  ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                  : "border-status-attention-border bg-status-attention-bg text-status-attention-text"
              }`}
            >
              {dayCloseCompletedCount}/{dayCloseChecks.length} complete
            </span>
          </div>

          <div className="grid gap-3 p-3 lg:hidden">
            {dayCloseChecks.map((check) => {
              const checkCanAct = canActOnRegister(check);
              const actionLabel = getRegisterActionLabel(check);

              return (
              <article
                key={`mobile-${check.label}`}
                className={`rounded-sm border p-3 shadow-sm ${
                  check.status === "exception"
                    ? "border-status-critical-border bg-status-critical-bg/70"
                    : check.passed
                      ? "border-accent-muted-border bg-accent-muted-bg/45"
                      : "border-status-attention-border bg-status-attention-bg/45"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold leading-6 text-foreground">
                      {check.label}
                    </p>
                    <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      {check.key.replaceAll("_", " ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {check.passed && check.status !== "exception" ? (
                      <span className="inline-flex h-7 min-w-8 items-center justify-center rounded-full border border-accent-muted-border bg-accent-muted-bg px-2 text-[10px] font-black text-accent">
                        OK
                      </span>
                    ) : null}
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${registerStatusStyles[check.status]}`}
                    >
                      {check.passed && check.status !== "exception"
                        ? "Verified"
                        : registerStatusLabels[check.status]}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 rounded-sm border border-border-system bg-background/80 p-3 text-sm leading-6 text-text-muted">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Owner
                    </p>
                    <p className="font-semibold text-foreground">
                      {check.department} / {roleLabels[check.ownerRole]}
                    </p>
                    {checkCanAct ? (
                      <span className="mt-2 inline-flex rounded-full border border-accent-muted-border bg-accent-muted-bg px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
                        Your task
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Evidence
                    </p>
                    <p>{check.detail}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                        Activity
                      </p>
                      <p className="font-semibold text-foreground">
                        {check.activityCount > 0
                          ? `${check.activityCount.toLocaleString()} record${
                              check.activityCount === 1 ? "" : "s"
                            }`
                          : check.entry?.activity_state === "no_activity"
                            ? "Zero declared"
                            : "Missing"}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                        Submitted
                      </p>
                      <p className="font-semibold text-foreground">
                        {check.submittedAt
                          ? new Date(check.submittedAt).toLocaleString()
                          : "Not submitted"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      openDashboardSection(
                        check.href.replace("#", ""),
                        check.ownerRole,
                      )
                    }
                    className="h-10 rounded-sm border border-border-system bg-card px-3 text-xs font-bold uppercase tracking-wider text-foreground transition hover:border-border-system-hover"
                  >
                    Open ledger
                  </button>
                  {checkCanAct ? (
                    <div className="grid grid-cols-2 gap-2">
                      {check.passed && check.status !== "exception" ? (
                        <span className="col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-accent-muted-border bg-accent-muted-bg px-3 text-xs font-bold uppercase tracking-wider text-accent">
                          <span className="text-sm leading-none">OK</span>
                          Checked
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            onDeclareOperationRegister({
                              registerKey: check.key,
                              department: check.department,
                              status: "clear",
                              activityState:
                                check.activityCount > 0
                                  ? "reviewed"
                                  : check.key.includes("readiness")
                                    ? "reviewed"
                                    : "no_activity",
                              notes:
                                check.activityCount > 0
                                  ? "Reviewed existing activity for today's register."
                                  : check.key.includes("readiness")
                                    ? "Readiness checklist confirmed."
                                    : "No activity for this register today.",
                            })
                          }
                          className="h-11 rounded-sm bg-accent px-3 text-xs font-bold uppercase tracking-wider text-background transition hover:bg-accent-hover"
                        >
                          {actionLabel}
                        </button>
                      )}
                      {check.passed && check.status !== "exception" ? null : (
                        <button
                          type="button"
                          onClick={() =>
                            onDeclareOperationRegister({
                              registerKey: check.key,
                              department: check.department,
                              status: "exception",
                              activityState: "exception",
                              notes: "Exception flagged from daily checklist.",
                            })
                          }
                          className="h-11 rounded-sm border border-status-critical-border bg-status-critical-bg px-3 text-xs font-bold uppercase tracking-wider text-status-critical-text transition hover:border-status-critical-text"
                        >
                          Flag issue
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-sm border border-border-system bg-background/80 px-3 py-2 text-xs font-semibold text-text-muted">
                      {isAuditFocus
                        ? "Review only"
                        : `Owned by ${roleLabels[check.ownerRole]}`}
                    </p>
                  )}
                </div>
              </article>
              );
            })}
          </div>

          <div className="hidden overflow-hidden lg:block">
            <table className="w-full table-fixed border-collapse text-sm">
              <thead className="bg-card">
                <tr className="border-b border-border-system font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  <th className="px-4 py-3 text-left">Control</th>
                  <th className="hidden px-4 py-3 text-left lg:table-cell">Owner</th>
                  <th className="px-4 py-3 text-left">Evidence</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="hidden px-4 py-3 text-left xl:table-cell">Activity</th>
                  <th className="hidden px-4 py-3 text-left 2xl:table-cell">Last submitted</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {dayCloseChecks.map((check) => {
                  const checkCanAct = canActOnRegister(check);
                  const actionLabel = getRegisterActionLabel(check);

                  return (
                  <tr
                    key={check.label}
                    className={`border-b border-border-system align-top transition hover:bg-card/70 ${
                      check.status === "exception"
                        ? "bg-status-critical-bg/60"
                        : check.passed
                          ? "bg-accent-muted-bg/35"
                          : "bg-status-attention-bg/35"
                    }`}
                  >
                    <td className="px-4 py-4">
                      <p className="font-semibold text-foreground">{check.label}</p>
                      <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                        {check.key.replaceAll("_", " ")}
                      </p>
                    </td>
                    <td className="hidden px-4 py-4 text-text-muted lg:table-cell">
                      <span>{check.department}</span>
                      <span className="mt-1 block font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                        {roleLabels[check.ownerRole]}
                      </span>
                      {checkCanAct ? (
                        <span className="mt-2 inline-flex rounded-full border border-accent-muted-border bg-accent-muted-bg px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
                          Your task
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-4 leading-6 text-text-muted">
                      <p>{check.detail}</p>
                      <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost xl:hidden">
                        {check.activityCount > 0
                          ? `${check.activityCount.toLocaleString()} activity record${
                              check.activityCount === 1 ? "" : "s"
                            }`
                          : check.entry?.activity_state === "no_activity"
                            ? "Zero declared"
                            : "Missing"}{" "}
                        /{" "}
                        {check.submittedAt
                          ? new Date(check.submittedAt).toLocaleString()
                          : "not submitted"}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {check.passed && check.status !== "exception" ? (
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-accent-muted-border bg-accent-muted-bg text-accent">
                            <BadgeCheck size={16} strokeWidth={2.5} />
                          </span>
                        ) : null}
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${registerStatusStyles[check.status]}`}
                        >
                          {check.passed && check.status !== "exception"
                            ? "Verified"
                            : registerStatusLabels[check.status]}
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-4 text-text-muted xl:table-cell">
                      {check.activityCount > 0
                        ? `${check.activityCount.toLocaleString()} activity record${
                            check.activityCount === 1 ? "" : "s"
                          }`
                        : check.entry?.activity_state === "no_activity"
                          ? "Zero declared"
                          : "Missing"}
                    </td>
                    <td className="hidden px-4 py-4 text-text-muted 2xl:table-cell">
                      {check.submittedAt
                        ? new Date(check.submittedAt).toLocaleString()
                        : "-"}
                    </td>
                    <td className="w-[150px] px-4 py-4">
                      <div className="ml-auto grid w-full max-w-[132px] gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            openDashboardSection(
                              check.href.replace("#", ""),
                              check.ownerRole,
                            )
                          }
                          className={`${compactActionButtonClass} w-full text-center`}
                        >
                          Open
                        </button>
                        {checkCanAct ? (
                          <>
                            {check.passed && check.status !== "exception" ? (
                              <span className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-sm border border-accent-muted-border bg-accent-muted-bg px-2 text-center text-xs font-bold uppercase tracking-wider text-accent">
                                <BadgeCheck size={15} strokeWidth={2.5} />
                                Checked
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  onDeclareOperationRegister({
                                    registerKey: check.key,
                                    department: check.department,
                                    status: "clear",
                                    activityState:
                                      check.activityCount > 0
                                        ? "reviewed"
                                        : check.key.includes("readiness")
                                          ? "reviewed"
                                          : "no_activity",
                                    notes:
                                      check.activityCount > 0
                                        ? "Reviewed existing activity for today's register."
                                        : check.key.includes("readiness")
                                          ? "Readiness checklist confirmed."
                                          : "No activity for this register today.",
                                  })
                                }
                                className={`${compactPrimaryActionButtonClass} w-full px-2 text-center`}
                              >
                                {actionLabel}
                              </button>
                            )}
                            {check.passed && check.status !== "exception" ? null : (
                              <button
                                type="button"
                                onClick={() =>
                                  onDeclareOperationRegister({
                                    registerKey: check.key,
                                    department: check.department,
                                    status: "exception",
                                    activityState: "exception",
                                    notes: "Exception flagged from daily checklist.",
                                  })
                                }
                                className="h-9 w-full rounded-sm border border-status-critical-border bg-status-critical-bg px-2 text-center text-xs font-bold uppercase tracking-wider text-status-critical-text transition hover:border-status-critical-text"
                              >
                                Flag issue
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="inline-flex h-9 w-full items-center justify-center rounded-sm border border-border-system bg-background px-2 text-center text-xs font-semibold text-text-muted">
                            {isAuditFocus ? "Review only" : "Owner only"}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border-system bg-card px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Authoritative day status
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`${inlineSignalClass} ${
                      currentOperatingDay?.status === "closed" ||
                      currentOperatingDay?.status === "locked"
                        ? inlineSignalToneStyles.healthy
                        : currentOperatingDay?.status === "closing_review"
                          ? inlineSignalToneStyles.attention
                          : inlineSignalToneStyles.info
                    }`}
                  >
                    {(currentOperatingDay?.status ?? "open").replace("_", " ")}
                  </span>
                  <span
                    className={`${inlineSignalClass} ${
                      currentOperatingDay?.reconciliation_status === "reconciled"
                        ? inlineSignalToneStyles.healthy
                        : currentOperatingDay?.reconciliation_status ===
                            "exception"
                          ? inlineSignalToneStyles.critical
                          : inlineSignalToneStyles.info
                    }`}
                  >
                    Financial:{" "}
                    {(
                      currentOperatingDay?.reconciliation_status ??
                      "awaiting_data"
                    ).replace("_", " ")}
                  </span>
                  <span className="text-sm text-text-muted">
                    Operating date {currentOperatingDate}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-text-muted">
                  Review recalculates blockers from required registers and
                  requisitions still in transit. Closing creates an audited,
                  role-controlled record. POS reconciliation follows the
                  workspace&apos;s configured import cadence and remains a
                  separate financial status.
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {canManageOperatingDayClose &&
                currentOperatingDay?.status !== "closed" &&
                currentOperatingDay?.status !== "locked" ? (
                  <button
                    type="button"
                    disabled={dayCloseSaving}
                    onClick={() =>
                      onReviewOperatingDay(currentOperatingDate)
                    }
                    className="h-10 rounded-sm border border-border-system bg-background px-4 text-xs font-bold uppercase tracking-wider text-foreground transition hover:border-border-system-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Review close
                  </button>
                ) : null}
                {canManageOperatingDayClose &&
                currentOperatingDay?.status !== "closed" &&
                currentOperatingDay?.status !== "locked" ? (
                  <button
                    type="button"
                    disabled={
                      dayCloseSaving ||
                      currentOperatingDay?.status !== "closing_review" ||
                      dayCloseBlockers.length > 0
                    }
                    onClick={() =>
                      onCloseOperatingDay(currentOperatingDate)
                    }
                    className="h-10 rounded-sm bg-accent px-4 text-xs font-bold uppercase tracking-wider text-background transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Close operating day
                  </button>
                ) : null}
                {canManageOperatingDayClose &&
                currentOperatingDay?.status === "closed" ? (
                  <button
                    type="button"
                    disabled={dayCloseSaving}
                    onClick={() => {
                      const reason = window.prompt(
                        "Why must this operating day be reopened?",
                      );

                      if (reason?.trim()) {
                        void onReopenOperatingDay(
                          currentOperatingDate,
                          reason.trim(),
                        );
                      }
                    }}
                    className="h-10 rounded-sm border border-status-attention-border bg-status-attention-bg px-4 text-xs font-bold uppercase tracking-wider text-status-attention-text transition hover:border-status-attention-text disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reopen with reason
                  </button>
                ) : null}
                {!canManageOperatingDayClose ? (
                  <p className="max-w-sm rounded-sm border border-border-system bg-background px-3 py-2 text-xs font-semibold leading-5 text-text-muted">
                    Department roles clear their own rows. Operating day review
                    is managed by Operations or ownership.
                  </p>
                ) : null}
              </div>
            </div>

            {dayCloseBlockers.length > 0 ? (
              <details
                className="mt-4 rounded-sm border border-status-critical-border bg-status-critical-bg"
                open={canManageOperatingDayClose}
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-status-critical-text">
                  <span>
                    {dayCloseBlockers.length} blocking control
                    {dayCloseBlockers.length === 1 ? "" : "s"} require action
                  </span>
                  <span className="rounded-full border border-status-critical-border bg-card px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-critical-text">
                    View / hide
                  </span>
                </summary>
                <ul className="grid gap-2 border-t border-status-critical-border px-4 py-3 text-sm text-text-muted md:grid-cols-2">
                  {dayCloseBlockers.map((blocker) => (
                    <li key={`${blocker.type}-${blocker.key}`}>
                      <span className="font-semibold text-foreground">
                        {blocker.department}:
                      </span>{" "}
                      {blocker.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : currentOperatingDay?.status === "closing_review" ? (
              <p className="mt-4 rounded-sm border border-accent-muted-border bg-accent-muted-bg p-3 text-sm font-semibold text-accent">
                No blocking controls remain. An authorized approver can close
                this operating day.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-5 rounded-sm border border-border-system bg-background">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-system px-5 py-4">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Recent activity
              </p>
              <h3 className="mt-1 text-lg font-semibold text-foreground">
                Operating Timeline
              </h3>
            </div>
            <span className="rounded-full border border-border-system bg-card px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              {activityEvents.length.toLocaleString()} latest
            </span>
          </div>

          {activityEvents.length > 0 ? (
            <div className="divide-y divide-border-system">
              {activityEvents.map((event) => {
                const valueClass =
                  event.tone === "positive"
                    ? "text-accent"
                    : event.tone === "warning"
                      ? "text-status-critical-text"
                      : "text-foreground";
                const badgeClass =
                  event.tone === "positive"
                    ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                    : event.tone === "warning"
                      ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                      : "border-status-info-border bg-status-info-bg text-status-info-text";

                return (
                  <article
                    key={event.id}
                    className="grid gap-3 px-5 py-4 text-sm text-text-muted transition hover:bg-card md:grid-cols-[120px_minmax(0,1fr)_auto] md:items-center"
                  >
                    <div>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${badgeClass}`}
                      >
                        {event.type}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {event.title}
                      </p>
                      <p className="mt-1 text-text-muted">{event.detail}</p>
                    </div>
                    <div className="md:text-right">
                      <p className={`font-semibold ${valueClass}`}>
                        {event.value}
                      </p>
                      <p className="mt-1 text-xs text-text-ghost">
                        {event.timestamp
                          ? new Date(event.timestamp).toLocaleString()
                          : "No timestamp"}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="px-5 py-5 text-sm text-text-muted">
              No transformation activity recorded yet.
            </p>
          )}
        </div>
      </section>

      <div
        className={`${
          (showSetupSection && isSectionActive("setup")) ||
          (showInventorySection && isSectionActive("inventory")) ||
          (showInventorySection && isSectionActive("stock-movement")) ||
          (showInventorySection && isSectionActive("yield-tests")) ||
          showRequisitionWorkspace ||
          showPurchaseOrderWorkspace ||
          showStockCountWorkspace ||
          showFullStockCountWorkspace ||
          showStockAdjustmentWorkspace
            ? ""
            : "hidden"
        } mt-6 grid min-w-0 gap-6`}
      >
        <section
          id="setup"
          className={`${showSetupSection && isSectionActive("setup") ? "" : "hidden"} scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
        >
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border-system pb-4">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Operating Setup
              </p>
              <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
                Locations and Suppliers
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MetricPill
                label="Locations"
                value={activeLocations.length.toLocaleString()}
              />
              <MetricPill
                label="Suppliers"
                value={activeSuppliers.length.toLocaleString()}
              />
            </div>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            {showLocationSetupSection ? (
            <div className="rounded-sm border border-border-system bg-background p-4">
              <h3 className="text-lg font-semibold text-foreground">
                Location Setup
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                Use Main store for stock-holding rooms like Food Main Store and
                Drink Main Store. Use User department for consuming teams like
                Kitchen and Bar.
              </p>
              <form
                onSubmit={onCreateLocation}
                className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px_160px_230px_auto]"
              >
                <input
                  name="location_name"
                  placeholder="Location name"
                  required
                  className={formControlClass}
                />
                <select
                  name="location_type"
                  defaultValue="main_store"
                  className={formControlClass}
                >
                  <option value="main_store">Main store / stockroom</option>
                  <option value="department">User department</option>
                  <option value="sales_outlet">Sales outlet / front counter</option>
                  <option value="central_warehouse">Central warehouse</option>
                </select>
                <select
                  name="inventory_domain"
                  defaultValue="food"
                  className={formControlClass}
                >
                  <option value="food">Food stock</option>
                  <option value="beverage">Drink stock</option>
                  <option value="shared">Shared stock</option>
                </select>
                <select
                  name="routing_model"
                  defaultValue="model_1_single_location"
                  className={formControlClass}
                >
                  <option value="model_1_single_location">
                    Single restaurant
                  </option>
                  <option value="model_2_central_warehouse">
                    Central warehouse network
                  </option>
                </select>
                <button
                  type="submit"
                  disabled={setupSaving || !canManageWorkspace}
                  className={primaryButtonClass}
                >
                  Add
                </button>
              </form>
              <div className="mt-4 grid gap-2">
                {activeLocations.length > 0 ? (
                  activeLocations.slice(0, 6).map((location) => (
                    editingLocationId === location.id ? (
                      <form
                        key={location.id}
                        onSubmit={(event) =>
                          handleLocationEditSubmit(event, location)
                        }
                        className="grid gap-2 rounded-sm border border-border-system bg-card p-3 text-sm lg:grid-cols-[minmax(0,1fr)_190px_150px_210px_auto_auto]"
                      >
                        <input
                          name="edit_location_name"
                          defaultValue={location.name}
                          required
                          aria-label={`Edit ${location.name} location name`}
                          className={formControlClass}
                        />
                        <select
                          name="edit_location_type"
                          defaultValue={location.location_type}
                          className={formControlClass}
                        >
                          <option value="main_store">Main store / stockroom</option>
                          <option value="department">User department</option>
                          <option value="sales_outlet">
                            Sales outlet / front counter
                          </option>
                          <option value="central_warehouse">
                            Central warehouse
                          </option>
                          <option value="branch_store">Branch store</option>
                          <option value="production_kitchen">
                            Production kitchen legacy
                          </option>
                          <option value="local_kitchen">Local kitchen legacy</option>
                          <option value="kitchen_line">Kitchen line legacy</option>
                          <option value="bar">Bar legacy</option>
                        </select>
                        <select
                          name="edit_inventory_domain"
                          defaultValue={location.inventory_domain}
                          className={formControlClass}
                        >
                          <option value="food">Food stock</option>
                          <option value="beverage">Drink stock</option>
                          <option value="shared">Shared stock</option>
                        </select>
                        <select
                          name="edit_routing_model"
                          defaultValue={location.routing_model}
                          className={formControlClass}
                        >
                          <option value="model_1_single_location">
                            Single restaurant
                          </option>
                          <option value="model_2_central_warehouse">
                            Central warehouse network
                          </option>
                          <option value="model_2_central_kitchen">
                            Central kitchen legacy
                          </option>
                          <option value="model_3_commissary">
                            Commissary legacy
                          </option>
                        </select>
                        <button
                          type="submit"
                          disabled={setupSaving || !canManageWorkspace}
                          className={primaryButtonClass}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingLocationId("")}
                          className={secondaryButtonClass}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div
                        key={location.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border-system bg-card px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <span className="block truncate font-semibold text-foreground">
                            {location.name}
                          </span>
                          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                            {location.location_type.replaceAll("_", " ")} /{" "}
                            {location.inventory_domain} /{" "}
                            {location.routing_model.replaceAll("_", " ")}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={setupSaving || !canManageWorkspace}
                          onClick={() => setEditingLocationId(location.id)}
                          className={secondaryButtonClass}
                        >
                          Edit
                        </button>
                      </div>
                    )
                  ))
                ) : (
                  <p className="text-sm text-text-muted">
                    Add at least one store, kitchen, or outlet before assigning stock.
                  </p>
                )}
              </div>
            </div>
            ) : null}

            {showSupplierSetupSection ? (
            <div
              id="supplier-setup"
              className="scroll-mt-24 rounded-sm border border-border-system bg-background p-4"
            >
              <h3 className="text-lg font-semibold text-foreground">
                Supplier Setup
              </h3>
              <p className="mt-1 text-sm text-text-muted">
                {currentRole === "procurement_manager"
                  ? "Submit new vendors for Finance approval before they become active suppliers."
                  : "Create and maintain active supplier records for purchase ordering."}
              </p>
              <form
                onSubmit={onCreateSupplier}
                className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_150px_minmax(0,1fr)_auto]"
              >
                <input
                  name="supplier_name"
                  placeholder="Supplier"
                  required
                  className={formControlClass}
                />
                <input
                  name="contact_name"
                  placeholder="Contact"
                  className={formControlClass}
                />
                <input
                  name="phone"
                  placeholder="Phone"
                  className={formControlClass}
                />
                <input
                  name="email"
                  type="email"
                  placeholder="Email"
                  className={formControlClass}
                />
                <button
                  type="submit"
                  disabled={setupSaving || !canSubmitSupplierMasterData}
                  className={primaryButtonClass}
                >
                  {currentRole === "procurement_manager" ? "Submit" : "Add"}
                </button>
              </form>
              <div className="mt-4 grid gap-2">
                {activeSuppliers.length > 0 ? (
                  activeSuppliers.slice(0, 6).map((supplier) => (
                    editingSupplierId === supplier.id ? (
                      <form
                        key={supplier.id}
                        onSubmit={(event) =>
                          handleSupplierEditSubmit(event, supplier)
                        }
                        className="grid gap-2 rounded-sm border border-border-system bg-card p-3 text-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_140px_minmax(0,1fr)_auto_auto]"
                      >
                        <input
                          name="edit_supplier_name"
                          defaultValue={supplier.name}
                          required
                          aria-label={`Edit ${supplier.name} supplier name`}
                          className={formControlClass}
                        />
                        <input
                          name="edit_contact_name"
                          defaultValue={supplier.contact_name ?? ""}
                          placeholder="Contact"
                          className={formControlClass}
                        />
                        <input
                          name="edit_phone"
                          defaultValue={supplier.phone ?? ""}
                          placeholder="Phone"
                          className={formControlClass}
                        />
                        <input
                          name="edit_email"
                          type="email"
                          defaultValue={supplier.email ?? ""}
                          placeholder="Email"
                          className={formControlClass}
                        />
                        <button
                          type="submit"
                          disabled={setupSaving || !canDirectMaintainSuppliers}
                          className={primaryButtonClass}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSupplierId("")}
                          className={secondaryButtonClass}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div
                        key={supplier.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border-system bg-card px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <span className="block truncate font-semibold text-foreground">
                            {supplier.name}
                          </span>
                          <span className="text-xs text-text-ghost">
                            {supplier.contact_name || "No contact person"} /{" "}
                            {supplier.phone || supplier.email || "No contact"}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={setupSaving || !canDirectMaintainSuppliers}
                          onClick={() => setEditingSupplierId(supplier.id)}
                          className={secondaryButtonClass}
                        >
                          Edit
                        </button>
                      </div>
                    )
                  ))
                ) : (
                  <p className="text-sm text-text-muted">
                    Add suppliers before creating purchase orders.
                  </p>
                )}
              </div>
            </div>
            ) : null}
          </div>
        </section>

        <section
          id="inventory"
          className={`${showInventorySection && isSectionActive("inventory") ? "" : "hidden"} min-w-0 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
        >
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border-system pb-4">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Inventory
              </p>
              <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
                {isKitchenFocus ? "Kitchen Stock Position" : "Stock Value by Location"}
              </h2>
            </div>
            <p className="max-w-md text-sm text-text-muted">
              {isKitchenFocus
                ? "Kitchen Manager sees only the SKUs assigned to Kitchen storage locations."
                : "SKUs can repeat across Food Main Store, Drink Main Store, Kitchen, and Bar so each location holds its own stock value."}
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricPill
              label="Current stock value"
              value={formatCurrency(currentStockValue)}
            />
            <MetricPill
              label="Reorder flags"
              value={reorderTodayCount.toLocaleString()}
              valueClassName={
                reorderTodayCount > 0
                  ? "font-semibold text-status-attention-text"
                  : "font-semibold text-accent"
              }
            />
            <MetricPill
              label="Inventory accuracy"
              value={`${inventoryAccuracyScore}%`}
              valueClassName={
                inventoryAccuracyScore >= 85
                  ? "font-semibold text-accent"
                  : inventoryAccuracyScore >= 65
                    ? "font-semibold text-status-attention-text"
                    : "font-semibold text-status-critical-text"
              }
            />
            <MetricPill
              label="Active ingredients"
              value={activePurchasedIngredients.length.toLocaleString()}
            />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {locationStockSummaries.length > 0 ? (
              locationStockSummaries.map((location) => (
                <div
                  key={location.location}
                  className="rounded-sm border border-border-system bg-background p-4"
                >
                  <p className="truncate font-semibold text-foreground">
                    {location.location}
                  </p>
                  <p className="mt-2 font-mono text-xl font-semibold text-accent">
                    {formatCurrency(location.stockValue)}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-text-ghost">
                    {location.itemCount.toLocaleString()} SKU
                    {location.itemCount === 1 ? "" : "s"} /{" "}
                    {location.highValueCount.toLocaleString()} high value
                  </p>
                </div>
              ))
            ) : (
              <p className="rounded-sm border border-border-system bg-background px-4 py-3 text-sm text-text-muted xl:col-span-4">
                Stock value will appear after SKUs are assigned to locations.
              </p>
            )}
          </div>
          {unassignedZeroStockSkuCount > 0 ? (
            <p className="mt-3 text-xs font-semibold text-text-ghost">
              {unassignedZeroStockSkuCount.toLocaleString()} zero-stock SKU
              {unassignedZeroStockSkuCount === 1 ? "" : "s"} still need a
              storage location assignment in the SKU table.
            </p>
          ) : null}

          <form
            onSubmit={onCreateInventoryItem}
            className={`${canSubmitInventoryMasterData ? "" : "hidden"} mt-5 grid gap-3 rounded-sm border border-border-system bg-background p-3 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_0.75fr_0.85fr_0.55fr_0.7fr_0.55fr_0.65fr_110px_auto] xl:border-0 xl:bg-transparent xl:p-0`}
          >
            <input
              name="name"
              placeholder="Ingredient"
              required
              className={formControlClass}
            />
            <input
              name="sku"
              placeholder="SKU"
              className={formControlClass}
            />
            <select name="department" defaultValue="" className={formControlClass}>
              <option value="">Intended department</option>
              <option value="Kitchen">Kitchen</option>
              <option value="Bar">Bar</option>
              <option value="Both">Both</option>
            </select>
            <select name="location_id" className={formControlClass}>
              <option value="">Stock balance location</option>
              {activeLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {formatStockLocationOption(location)}
                </option>
              ))}
            </select>
            <input
              name="base_uom"
              placeholder="UOM"
              defaultValue="kg"
              required
              className={formControlClass}
            />
            <input
              name="current_cost_per_base_uom"
              type="number"
              min="0"
              step="0.01"
              placeholder="Cost"
              className={formControlClass}
            />
            {currentRole === "procurement_manager" ? (
              <>
                <input name="yield_pct" type="hidden" value="1" />
                <input name="shrinkage_factor_pct" type="hidden" value="0" />
              </>
            ) : (
              <>
                <input
                  name="yield_pct"
                  type="number"
                  min="0.01"
                  max="1"
                  step="0.01"
                  defaultValue="1"
                  className={formControlClass}
                  aria-label="Yield percentage as a decimal"
                />
                <input
                  name="shrinkage_factor_pct"
                  type="number"
                  min="0"
                  max="0.99"
                  step="0.01"
                  defaultValue="0"
                  className={formControlClass}
                  aria-label="Shrinkage percentage as a decimal"
                />
              </>
            )}
            <label className="flex h-11 items-center gap-2 rounded-sm border border-border-system bg-background px-3 text-sm font-semibold text-text-muted">
              <input name="is_high_value" type="checkbox" className="h-4 w-4" />
              High value
            </label>
            <button
              type="submit"
              disabled={inventorySaving || !canSubmitInventoryMasterData}
              className={primaryButtonClass}
            >
              {currentRole === "procurement_manager"
                ? "Submit"
                : "Add"}
            </button>
          </form>
          <p
            className={`${canSubmitInventoryMasterData ? "" : "hidden"} mt-2 text-xs font-semibold leading-5 text-text-ghost`}
          >
            {currentRole === "procurement_manager"
              ? "Procurement SKU submissions go to Finance approval before they become live stock master data."
              : "Intended department is ownership/usage metadata. Stock balance location controls where the SKU exists. To make a Food Main Store SKU available to Kitchen, raise a requisition from Food Main Store to Kitchen; Inventory confirmation creates or increases the Kitchen stock balance."}
          </p>

          <div className={`mt-5 w-full min-w-0 max-w-full ${ledgerFrameClass}`}>
            <div>
              <div className="grid gap-3 border-b border-border-system bg-card px-4 py-4 md:grid-cols-[minmax(220px,1fr)_180px_160px_150px_auto] md:items-center sm:px-5">
                <input
                  type="search"
                  value={inventorySearch}
                  onChange={(event) => setInventorySearch(event.target.value)}
                  placeholder="Search SKU, ingredient, UOM"
                  className={formControlClass}
                />
                <select
                  value={inventoryLocationFilter}
                  onChange={(event) => setInventoryLocationFilter(event.target.value)}
                  className={formControlClass}
                >
                  <option value="">
                    {isKitchenFocus ? "Kitchen locations" : "All locations"}
                  </option>
                  {inventoryFilterLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                <select
                  value={inventoryDepartmentFilter}
                  onChange={(event) =>
                    setInventoryDepartmentFilter(event.target.value)
                  }
                  className={formControlClass}
                >
                  <option value="">All departments</option>
                  <option value="Kitchen">Kitchen</option>
                  <option value="Bar">Bar</option>
                  <option value="Both">Both</option>
                </select>
                <label className="flex h-11 items-center gap-2 rounded-sm border border-border-system bg-background px-3 text-sm font-semibold text-text-muted">
                  <input
                    type="checkbox"
                    checked={inventoryHighValueOnly}
                    onChange={(event) =>
                      setInventoryHighValueOnly(event.target.checked)
                    }
                    className="h-4 w-4"
                  />
                  High value
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setInventorySearch("");
                    setInventoryLocationFilter("");
                    setInventoryDepartmentFilter("");
                    setInventoryHighValueOnly(false);
                  }}
                  className={secondaryButtonClass}
                >
                  Clear
                </button>
              </div>
              <div className={`${ledgerColumnHeaderClass} grid-cols-[minmax(0,1.35fr)_minmax(180px,0.8fr)_minmax(220px,0.95fr)_130px]`}>
                <span>Item</span>
                <span>Stock posture</span>
                <span>Cost control</span>
                <span>Status</span>
              </div>

              {filteredInventoryDisplayItems.length > 0 ? (
                filteredInventoryDisplayItems.map((item) => (
                  <InventoryItemRow
                    key={item.id}
                    item={item}
                    locations={activeLocations}
                    currency={organization.local_currency}
                    disabled={inventorySaving || !canMaintainLiveInventoryCost}
                    onUpdate={onUpdateInventoryItem}
                  />
                ))
              ) : (
                <p className="px-5 py-6 text-sm text-text-muted">
                  No inventory items match the current filter.
                </p>
              )}
            </div>
          </div>
        </section>

        <section
          id="stock-movement"
          className={`${showInventorySection && isSectionActive("stock-movement") ? "" : "hidden"} min-w-0 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
        >
          <div className="rounded-sm border border-border-system bg-background">
            <div className="flex flex-col gap-3 border-b border-border-system px-4 py-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Stock movement drill-down
                </p>
                <h3 className="mt-1 text-lg font-semibold text-foreground">
                  SKU movement table
                </h3>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-text-muted">
                  Opening, inflow, outflow, and closing are calculated from the
                  append-only movement ledger for the selected period and SKU
                  filters. The ledger includes receipts, requisitions/transfers,
                  production inputs and outputs, waste, sales depletion, and
                  Finance-approved stock adjustments.
                </p>
              </div>
              <span className="w-fit rounded-full border border-border-system bg-card px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                {selectedPeriodLabel}
              </span>
            </div>

            {stockMovementSummaryRows.length > 0 ? (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[1720px] table-fixed border-collapse text-left text-sm">
                    <colgroup>
                      <col className="w-[245px]" />
                      <col className="w-[180px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[110px]" />
                      <col className="w-[120px]" />
                      <col className="w-[120px]" />
                      <col className="w-[140px]" />
                      <col className="w-[130px]" />
                      <col className="w-[120px]" />
                      <col className="w-[150px]" />
                      <col className="w-[120px]" />
                    </colgroup>
                    <thead className="border-b border-border-system bg-card">
                      <tr className="whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                        <th className="px-4 py-3">SKU</th>
                        <th className="px-4 py-3">Location</th>
                        <th className="px-4 py-3 text-right">Opening</th>
                        <th className="px-4 py-3 text-right">Inflow</th>
                        <th className="px-4 py-3 text-right">Outflow</th>
                        <th className="px-4 py-3 text-right">Closing</th>
                        <th className="px-4 py-3 text-right">Production</th>
                        <th className="px-4 py-3 text-right">Waste</th>
                        <th className="px-4 py-3 text-right">Sales dep.</th>
                        <th className="px-4 py-3 text-right">Adjust.</th>
                        <th className="px-4 py-3 text-right">Other</th>
                        <th className="px-4 py-3 text-right">Closing value</th>
                        <th className="px-4 py-3 text-right">Audit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-system">
                      {stockMovementSummaryRows.map((row) => {
                        const location = activeLocations.find(
                          (activeLocation) =>
                            extractUuid(activeLocation.id) ===
                            extractUuid(row.item.location_id),
                        );
                        const uom =
                          row.item.on_hand_uom ||
                          row.item.base_uom ||
                          row.item.recipe_uom ||
                          "unit";

                        return (
                          <tr
                            key={row.itemId}
                            className={`transition hover:bg-accent-muted-bg/50 ${
                              selectedMovementInventoryItemId === row.itemId
                                ? "bg-accent-muted-bg"
                                : "bg-background"
                            }`}
                          >
                            <td className="px-4 py-3 align-top">
                              <p className="truncate font-semibold text-foreground">
                                {row.item.name}
                              </p>
                              <p className="mt-1 truncate font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                                {row.item.sku || "No SKU"} / {uom}
                              </p>
                            </td>
                            <td className="px-4 py-3 align-top text-text-muted">
                              {location?.name ?? "Unassigned"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right align-top font-mono font-semibold tabular-nums text-foreground">
                              {row.openingQty.toLocaleString(undefined, {
                                maximumFractionDigits: 3,
                              })}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right align-top font-mono font-semibold tabular-nums text-accent">
                              {row.inflowQty.toLocaleString(undefined, {
                                maximumFractionDigits: 3,
                              })}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right align-top font-mono font-semibold tabular-nums text-status-critical-text">
                              {row.outflowQty.toLocaleString(undefined, {
                                maximumFractionDigits: 3,
                              })}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right align-top font-mono font-semibold tabular-nums text-foreground">
                              {row.closingQty.toLocaleString(undefined, {
                                maximumFractionDigits: 3,
                              })}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right align-top font-mono font-semibold tabular-nums text-text-muted">
                              {row.movementBuckets.production.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 3 },
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right align-top font-mono font-semibold tabular-nums text-status-critical-text">
                              {row.movementBuckets.waste.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 3 },
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right align-top font-mono font-semibold tabular-nums text-status-critical-text">
                              {row.movementBuckets.sales.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 3 },
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right align-top font-mono font-semibold tabular-nums text-text-muted">
                              {row.movementBuckets.adjustment.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 3 },
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right align-top font-mono font-semibold tabular-nums text-text-muted">
                              {row.movementBuckets.other.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 3 },
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right align-top font-mono font-semibold tabular-nums text-text-muted">
                              {formatCurrency(row.closingStockValue)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right align-top">
                              <button
                                type="button"
                                onClick={() => openStockMovementAudit(row.itemId)}
                                className={`h-9 rounded-sm border px-3 text-[11px] font-bold uppercase tracking-wider transition ${
                                  selectedMovementInventoryItemId === row.itemId
                                    ? "border-status-info-border bg-status-info-bg text-status-info-text"
                                    : "border-border-system bg-card text-foreground hover:border-border-system-hover"
                                }`}
                              >
                                {selectedMovementInventoryItemId === row.itemId
                                  ? "Open"
                                  : "Audit"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 p-3 lg:hidden">
                  {stockMovementSummaryRows.map((row) => {
                    const location = activeLocations.find(
                      (activeLocation) =>
                        extractUuid(activeLocation.id) ===
                        extractUuid(row.item.location_id),
                    );
                    const uom =
                      row.item.on_hand_uom ||
                      row.item.base_uom ||
                      row.item.recipe_uom ||
                      "unit";

                    return (
                      <button
                        key={row.itemId}
                        type="button"
                        onClick={() => openStockMovementAudit(row.itemId)}
                        className={`rounded-sm border p-4 text-left transition ${
                          selectedMovementInventoryItemId === row.itemId
                            ? "border-accent-muted-border bg-accent-muted-bg"
                            : "border-border-system bg-card"
                        }`}
                      >
                        <span className="block font-semibold text-foreground">
                          {row.item.name}
                        </span>
                        <span className="mt-1 block text-xs font-semibold text-text-muted">
                          {location?.name ?? "Unassigned"} / {uom}
                        </span>
                        <span className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <span className="rounded-sm border border-border-system bg-background p-2">
                            <span className="block font-mono uppercase tracking-widest text-text-ghost">
                              Opening
                            </span>
                            <span className="mt-1 block font-mono font-semibold text-foreground">
                              {row.openingQty.toLocaleString(undefined, {
                                maximumFractionDigits: 3,
                              })}
                            </span>
                          </span>
                          <span className="rounded-sm border border-border-system bg-background p-2">
                            <span className="block font-mono uppercase tracking-widest text-text-ghost">
                              Closing
                            </span>
                            <span className="mt-1 block font-mono font-semibold text-foreground">
                              {row.closingQty.toLocaleString(undefined, {
                                maximumFractionDigits: 3,
                              })}
                            </span>
                          </span>
                          <span className="col-span-2 rounded-sm border border-border-system bg-background p-2">
                            <span className="block font-mono uppercase tracking-widest text-text-ghost">
                              Closing value
                            </span>
                            <span className="mt-1 block font-mono font-semibold text-foreground">
                              {formatCurrency(row.closingStockValue)}
                            </span>
                          </span>
                          <span className="rounded-sm border border-accent-muted-border bg-accent-muted-bg p-2 text-accent">
                            <span className="block font-mono uppercase tracking-widest">
                              Inflow
                            </span>
                            <span className="mt-1 block font-mono font-semibold">
                              {row.inflowQty.toLocaleString(undefined, {
                                maximumFractionDigits: 3,
                              })}
                            </span>
                          </span>
                          <span className="rounded-sm border border-status-critical-border bg-status-critical-bg p-2 text-status-critical-text">
                            <span className="block font-mono uppercase tracking-widest">
                              Outflow
                            </span>
                            <span className="mt-1 block font-mono font-semibold">
                              {row.outflowQty.toLocaleString(undefined, {
                                maximumFractionDigits: 3,
                              })}
                            </span>
                          </span>
                          <span className="rounded-sm border border-border-system bg-background p-2">
                            <span className="block font-mono uppercase tracking-widest text-text-ghost">
                              Production
                            </span>
                            <span className="mt-1 block font-mono font-semibold text-text-muted">
                              {row.movementBuckets.production.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 3 },
                              )}
                            </span>
                          </span>
                          <span className="rounded-sm border border-status-critical-border bg-status-critical-bg p-2 text-status-critical-text">
                            <span className="block font-mono uppercase tracking-widest">
                              Waste
                            </span>
                            <span className="mt-1 block font-mono font-semibold">
                              {row.movementBuckets.waste.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 3 },
                              )}
                            </span>
                          </span>
                          <span className="rounded-sm border border-status-critical-border bg-status-critical-bg p-2 text-status-critical-text">
                            <span className="block font-mono uppercase tracking-widest">
                              Sales depletion
                            </span>
                            <span className="mt-1 block font-mono font-semibold">
                              {row.movementBuckets.sales.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 3 },
                              )}
                            </span>
                          </span>
                          <span className="rounded-sm border border-border-system bg-background p-2">
                            <span className="block font-mono uppercase tracking-widest text-text-ghost">
                              Adjustment
                            </span>
                            <span className="mt-1 block font-mono font-semibold text-text-muted">
                              {row.movementBuckets.adjustment.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 3 },
                              )}
                            </span>
                          </span>
                          <span className="col-span-2 rounded-sm border border-border-system bg-background p-2">
                            <span className="block font-mono uppercase tracking-widest text-text-ghost">
                              Other stock flows
                            </span>
                            <span className="mt-1 block font-mono font-semibold text-text-muted">
                              {row.movementBuckets.other.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 3 },
                              )}
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="px-5 py-6 text-sm text-text-muted">
                No stock movement is visible for the selected period and SKU
                filters.
              </p>
            )}

            {selectedMovementItem ? (
              <div
                id="stock-movement-audit-panel"
                className="scroll-mt-24 border-t border-border-system bg-card px-4 py-4 sm:px-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Individual SKU audit
                    </p>
                    <h4 className="mt-1 text-base font-semibold text-foreground">
                      {selectedMovementItem.name}
                    </h4>
                    <p className="mt-1 text-sm text-text-muted">
                      {selectedMovementAuditRows.length.toLocaleString()} ledger
                      movement
                      {selectedMovementAuditRows.length === 1 ? "" : "s"} in{" "}
                      {selectedPeriodLabel}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedMovementInventoryItemId("")}
                    className={compactActionButtonClass}
                  >
                    Close
                  </button>
                </div>

                {selectedMovementAuditRows.length > 0 ? (
                  <div className="mt-4 grid gap-2">
                    {selectedMovementAuditRows.map((movement) => (
                      <div
                        key={movement.movement_id}
                        className="grid gap-3 rounded-sm border border-border-system bg-background p-3 text-sm md:grid-cols-[minmax(0,1fr)_120px_140px_150px]"
                      >
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest ${getMovementToneClass(
                                movement.event_type,
                              )}`}
                            >
                              {formatMovementType(movement.event_type)}
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-text-muted">
                            {movement.location_name} /{" "}
                            {movement.source_table ?? "ledger"}
                            {movement.source_id
                              ? ` / ${movement.source_id.slice(0, 8)}`
                              : ""}
                          </p>
                        </div>
                        <span
                          className={`font-mono font-semibold ${
                            movement.movement_qty >= 0
                              ? "text-accent"
                              : "text-status-critical-text"
                          }`}
                        >
                          {movement.movement_qty > 0 ? "+" : ""}
                          {movement.movement_qty.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                        </span>
                        <span className="font-mono font-semibold text-text-muted">
                          {formatSignedCurrency(movement.movement_value)}
                        </span>
                        <span className="text-text-muted md:text-right">
                          {movement.created_at
                            ? new Date(movement.created_at).toLocaleString()
                            : "No date"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-sm border border-border-system bg-background p-4 text-sm text-text-muted">
                    This SKU has no ledger movement in the selected period.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </section>

        <section
          id="yield-tests"
          className={`${showInventorySection && !isInventoryFocus && !isProcurementFocus && isSectionActive("yield-tests") ? "" : "hidden"} min-w-0 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Periodic supplier quality control
              </p>
              <h2 className="mt-2 font-serif text-2xl font-normal text-foreground">
                Yield Tests
              </h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold text-text-muted">
                Test high-value proteins and perishables periodically. ProfitPlate
                updates the SKU master yield from the rolling average of the
                latest three tests.
              </p>
            </div>
            <button
              type="button"
              onClick={onRefreshYieldTestNotifications}
              disabled={yieldTestSaving || !canRecordOperations}
              className={secondaryButtonClass}
            >
              Refresh reminders
            </button>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_0.9fr]">
            <form
              onSubmit={onCreateYieldTest}
              className="grid gap-3 rounded-sm border border-border-system bg-background p-4"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  name="yield_inventory_item_id"
                  value={selectedYieldTestItemId}
                  onChange={(event) =>
                    setSelectedYieldTestItemId(extractUuid(event.target.value))
                  }
                  required
                  className={formControlClass}
                >
                  <option value="">High-value SKU</option>
                  {highValueYieldItems.map((item) => (
                    <option key={extractUuid(item.id)} value={extractUuid(item.id)}>
                      {item.name ?? "Unnamed item"} ({item.base_uom ?? "unit"})
                    </option>
                  ))}
                </select>
                <input
                  name="test_date"
                  type="date"
                  defaultValue={getLocalDateInputValue()}
                  className={formControlClass}
                />
                <input
                  name="starting_weight"
                  type="number"
                  min="0.000001"
                  step="any"
                  placeholder="Starting weight"
                  required
                  className={formControlClass}
                />
                <input
                  name="usable_weight"
                  type="number"
                  min="0.000001"
                  step="any"
                  placeholder="Usable trimmed weight"
                  required
                  className={formControlClass}
                />
              </div>
              <textarea
                name="yield_test_notes"
                rows={3}
                placeholder="Supplier quality, trimming notes, batch condition"
                className={formControlClass}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-semibold text-text-ghost">
                  {selectedYieldTestItem
                    ? `${selectedYieldTestCount.toLocaleString()} previous test${
                        selectedYieldTestCount === 1 ? "" : "s"
                      } / current master yield ${Math.round(
                        selectedYieldTestItem.yield_pct * 100,
                      )}%`
                    : "Mark proteins and perishables as high value in Ingredients first."}
                </p>
                <button
                  type="submit"
                  disabled={
                    yieldTestSaving ||
                    !canRecordOperations ||
                    highValueYieldItems.length === 0
                  }
                  className={primaryButtonClass}
                >
                  Save test
                </button>
              </div>
            </form>

            <div className="grid gap-4">
              <div className="rounded-sm border border-border-system bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Open Alerts
                  </h3>
                  <span className="rounded-sm border border-status-attention-border bg-status-attention-bg px-2 py-1 font-mono text-[10px] font-bold text-status-attention-text">
                    {openYieldTestNotifications.length.toLocaleString()}
                  </span>
                </div>
                <div className="mt-3 grid gap-2">
                  {openYieldTestNotifications.length > 0 ? (
                    openYieldTestNotifications.slice(0, 4).map((notification) => {
                      const item = activeInventoryItemsById.get(
                        extractUuid(notification.inventory_item_id),
                      );

                      return (
                        <div
                          key={notification.id}
                          className="rounded-sm border border-border-system bg-card p-3"
                        >
                          <p className="text-xs font-bold text-foreground">
                            {notification.title}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-text-muted">
                            {item?.name ? `${item.name}: ` : ""}
                            {notification.detail}
                          </p>
                          <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-wider text-text-ghost">
                            {notification.recipients.join(", ")}
                          </p>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-text-muted">
                      No open yield test reminders.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-sm border border-border-system bg-background p-4">
                <h3 className="text-sm font-semibold text-foreground">
                  Recent Tests
                </h3>
                <div className="mt-3 grid gap-2">
                  {yieldTestEntries.length > 0 ? (
                    yieldTestEntries.slice(0, 5).map((entry) => {
                      const item = activeInventoryItemsById.get(
                        extractUuid(entry.inventory_item_id),
                      );
                      const masterYieldAtTest =
                        entry.master_yield_pct_at_test ?? item?.yield_pct ?? null;
                      const yieldDelta =
                        entry.yield_delta_pct ??
                        (masterYieldAtTest === null
                          ? null
                          : entry.measured_yield_pct - masterYieldAtTest);
                      const deltaPercentagePoints =
                        yieldDelta === null ? null : yieldDelta * 100;

                      return (
                        <div
                          key={entry.id}
                          className={`grid gap-2 rounded-sm border p-3 sm:grid-cols-[1fr_auto] ${
                            entry.is_below_master
                              ? "border-status-critical-border bg-status-critical-bg"
                              : "border-border-system bg-card"
                          }`}
                        >
                          <div>
                            <p className="text-xs font-bold text-foreground">
                              {item?.name ?? "High-value SKU"}
                            </p>
                            <p className="mt-1 text-xs text-text-muted">
                              {new Date(entry.test_date).toLocaleDateString()} /{" "}
                              waste {entry.trim_waste_weight.toLocaleString()}{" "}
                              {item?.base_uom ?? "unit"}
                            </p>
                            {entry.is_below_master &&
                            deltaPercentagePoints !== null ? (
                              <p className="mt-1 text-xs font-semibold text-status-critical-text">
                                Below master by{" "}
                                {Math.abs(deltaPercentagePoints).toFixed(2)} pp
                              </p>
                            ) : null}
                          </div>
                          <div className="text-left sm:text-right">
                            <p className="font-mono text-sm font-bold text-accent">
                              {Math.round(entry.measured_yield_pct * 100)}%
                            </p>
                            {masterYieldAtTest !== null ? (
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-ghost">
                                Master {Math.round(masterYieldAtTest * 100)}%
                              </p>
                            ) : null}
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-ghost">
                              {entry.master_yield_updated
                                ? "Master updated"
                                : "Waiting for 3 tests"}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-text-muted">
                      No yield tests recorded yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="inventory-operations-workspace"
          className={`${
            showRequisitionWorkspace ||
            showPurchaseOrderWorkspace ||
            showStockCountWorkspace ||
            showFullStockCountWorkspace ||
            showStockAdjustmentWorkspace
              ? ""
              : "hidden"
          } min-w-0 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
        >
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            {showRequisitionWorkspace
              ? "Requisition Control"
              : showPurchaseOrderWorkspace
                ? "Purchase Order / GRN Control"
                : showFullStockCountWorkspace
                  ? "Full Stock Count Control"
                  : showStockCountWorkspace
                    ? "Cycle Count Control"
                  : "Stock Adjustment Control"}
          </p>
          <h2 className="mt-2 font-serif text-2xl font-normal text-foreground">
            {showRequisitionWorkspace
              ? "Requisitions and Transfer Requests"
              : showPurchaseOrderWorkspace
                ? "Purchase Orders and GRN Receipts"
                : showFullStockCountWorkspace
                  ? "Full Monthly Stock Count"
                  : showStockCountWorkspace
                    ? "Cycle Counts"
                  : "Controlled Stock Adjustments"}
          </h2>

          {false ? (
            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              {[
                {
                  id: "department-requisition-log",
                  label: "Requisition lane",
                  value: openRequisitionRequestCount.toLocaleString(),
                  detail: "Department requests, store dispatch, receiver acknowledgement",
                },
                {
                  id: "po-receipt-queue",
                  label: "Purchase order lane",
                  value: openPurchaseOrderCount.toLocaleString(),
                  detail: "Supplier POs, receiving queue, and GRN confirmation",
                },
                {
                  id: "stock-control-workspace",
                  label: "Stocks & adjustments lane",
                  value: latestDayStockCountCount.toLocaleString(),
                  detail: "Store-scoped counts and adjustments for Finance approval",
                },
              ].map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  onClick={() =>
                    document
                      .getElementById(workflow.id)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className="grid min-h-[118px] rounded-sm border border-border-system bg-background p-4 text-left transition hover:border-accent-muted-border hover:bg-accent-muted-bg/30"
                >
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                    {workflow.label}
                  </span>
                  <span className="mt-3 font-mono text-3xl font-semibold leading-none text-foreground">
                    {workflow.value}
                  </span>
                  <span className="mt-2 text-sm leading-5 text-text-muted">
                    {workflow.detail}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <h3
            id="requisitions"
            className={`${showRequisitionWorkspace && showRequisitionRequestSection ? "" : "hidden"} mt-5 scroll-mt-24 text-lg font-semibold text-foreground`}
          >
            Kitchen Requisition / Transfer
          </h3>
          <p
            className={`${showRequisitionWorkspace && showRequisitionRequestSection ? "" : "hidden"} mt-1 text-sm font-semibold text-text-muted`}
          >
            Request items from store, production, or another storage location.
            Store or inventory confirms the issued quantity before stock moves;
            the request remains visible here as the acknowledgement trail.
          </p>
          <form
            onSubmit={handleRequisitionFormSubmit}
            className={`${showRequisitionWorkspace && showRequisitionRequestSection ? "" : "hidden"} mt-3 grid gap-3 rounded-sm border border-border-system bg-background p-4`}
          >
            <input
              type="hidden"
              name="requisition_lines"
              value={JSON.stringify(requisitionLinesPayload)}
            />
            <input
              type="hidden"
              name="requisition_request_id"
              value={editingRequisitionRequestId}
            />
            <input
              type="hidden"
              name="approver_role"
              value={requisitionApproverRole}
            />
            <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <input
                name="requested_by_name"
                placeholder="Requester"
                value={requisitionRequesterName}
                onChange={(event) => setRequisitionRequesterName(event.target.value)}
                className={formControlClass}
              />
              <select
                name="from_location_id"
                value={requisitionFromLocationId}
                onChange={(event) => {
                  setRequisitionFromLocationId(event.target.value);
                  setRequisitionRows((currentRows) =>
                    currentRows.map((currentRow) => ({
                      ...currentRow,
                      inventoryItemId: "",
                    })),
                  );
                }}
                className={formControlClass}
              >
                <option value="">Issuing store / kitchen location</option>
                {requisitionSourceLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name} / {location.inventory_domain}
                  </option>
                ))}
              </select>
              <select
                name="to_location_id"
                value={requisitionToLocationId}
                onChange={(event) => setRequisitionToLocationId(event.target.value)}
                className={formControlClass}
              >
                <option value="">Receiving department / front house</option>
                {requisitionDestinationLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <input
                name="approver_name"
                placeholder="Approver name / details"
                value={requisitionApproverName}
                onChange={(event) => setRequisitionApproverName(event.target.value)}
                required
                className={formControlClass}
              />
            </div>
            <div className="grid gap-2">
              {requisitionRows.map((row) => (
                <div
                  key={row.id}
                  className="grid min-w-0 gap-3 rounded-sm border border-border-system bg-card p-3 xl:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)_96px] xl:border-0 xl:bg-transparent xl:p-0"
                >
                  <select
                    value={row.inventoryItemId}
                    onChange={(event) =>
                      setRequisitionRows((currentRows) =>
                        currentRows.map((currentRow) =>
                          currentRow.id === row.id
                            ? {
                                ...currentRow,
                                inventoryItemId: extractUuid(event.target.value),
                              }
                            : currentRow,
                        ),
                      )
                    }
                    required
                    className={formControlClass}
                  >
                    <option value="">
                      {requisitionFromLocationId
                        ? "Item available at selected source"
                        : "Select a source store to narrow items"}
                    </option>
                    {requisitionSelectableInventoryItems.map((item) => {
                      const itemLocation = activeLocations.find(
                        (location) =>
                          extractUuid(location.id) === extractUuid(item.location_id),
                      );

                      return (
                        <option
                          key={extractUuid(item.id)}
                          value={extractUuid(item.id)}
                        >
                          {item.name ?? "Unnamed item"} /{" "}
                          {itemLocation?.name ?? "Unassigned stock"} /{" "}
                          {Number(item.on_hand_qty ?? 0).toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}{" "}
                          {item.on_hand_uom ?? item.base_uom ?? "unit"}
                        </option>
                      );
                    })}
                  </select>
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    placeholder="Qty needed"
                    value={row.quantity}
                    onChange={(event) =>
                      setRequisitionRows((currentRows) =>
                        currentRows.map((currentRow) =>
                          currentRow.id === row.id
                            ? { ...currentRow, quantity: event.target.value }
                            : currentRow,
                        ),
                      )
                    }
                    required
                    className={formControlClass}
                  />
                  <input
                    placeholder="Need / note"
                    value={row.note}
                    onChange={(event) =>
                      setRequisitionRows((currentRows) =>
                        currentRows.map((currentRow) =>
                          currentRow.id === row.id
                            ? { ...currentRow, note: event.target.value }
                            : currentRow,
                        ),
                      )
                    }
                    className={formControlClass}
                  />
                  <button
                    type="button"
                    disabled={requisitionRows.length === 1}
                    onClick={() =>
                      setRequisitionRows((currentRows) =>
                        currentRows.filter((currentRow) => currentRow.id !== row.id),
                      )
                    }
                    className={secondaryButtonClass}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              {editingRequisitionRequestId ? (
                <button
                  type="button"
                  onClick={resetRequisitionForm}
                  className={secondaryButtonClass}
                >
                  Cancel edit
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  setRequisitionRows((currentRows) => [
                    ...currentRows,
                    {
                      id: `requisition-line-${Date.now()}`,
                      inventoryItemId: "",
                      quantity: "",
                      note: "",
                    },
                  ])
                }
                className={secondaryButtonClass}
              >
                Add request line
              </button>
              <button
                type="submit"
                disabled={
                  requisitionSaving ||
                  !canRecordOperations ||
                  requisitionSelectableInventoryItems.length === 0
                }
                className={primaryButtonClass}
              >
                {editingRequisitionRequestId
                  ? "Update requisition"
                  : "Submit request / transfer"}
              </button>
            </div>
            <p className="text-xs font-semibold text-text-ghost">
              Request from the source store SKU. Kitchen/Bar stock rows are
              created or increased only after the receiving department accepts
              the issued transfer.{" "}
              {pendingRequisitionIssueCount.toLocaleString()} awaiting store dispatch /{" "}
              {awaitingRequisitionReceiptCount.toLocaleString()} awaiting receiver acknowledgement.
            </p>
          </form>

          <div
            id="department-requisition-log"
            className={`${showRequisitionWorkspace ? "" : "hidden"} mt-6 scroll-mt-24 ${ledgerFrameClass}`}
          >
            <div className={ledgerHeaderClass}>
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Department Stock Requests
                </p>
                <h3 className="mt-1 text-lg font-semibold text-foreground">
                  Department Requisition Trail
                </h3>
              </div>
              <span className="rounded-full border border-border-system bg-card px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                {pendingRequisitionRequests.length.toLocaleString()} open
              </span>
            </div>
            {pendingRequisitionRequests.length > 0 ? (
              <div className="divide-y divide-border-system">
                {pendingRequisitionRequests.map((request) => (
                  <div
                    key={`department-requisition-${request.id}`}
                    className="grid gap-4 px-5 py-4 text-sm text-text-muted xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.38fr)]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-foreground">
                          Department requisition
                        </p>
                        <span className="rounded-full border border-status-attention-border bg-status-attention-bg px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-status-attention-text">
                          {request.status === "accepted"
                            ? "Awaiting receipt"
                            : "Pending issue"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-text-ghost">
                        Requested{" "}
                        {request.created_at
                          ? new Date(request.created_at).toLocaleString()
                          : "recently"}
                      </p>
                      <ApprovalRequestSummary
                        request={request}
                        inventoryItems={inventoryItems}
                      />
                    </div>
                    <div className="grid content-start gap-2">
                      {request.status === "pending" &&
                      Array.isArray(request.payload?.lines) ? (
                        <div className="overflow-hidden rounded-sm border border-border-system bg-card">
                          {request.payload.lines.map((line, index) => {
                            const typedLine = line as Record<string, unknown>;
                            const inventoryItemId = extractUuid(
                              typedLine.inventory_item_id,
                            );
                            const inputKey = `${request.id}-${inventoryItemId || index}`;
                            const itemName =
                              typeof typedLine.item_name === "string"
                                ? typedLine.item_name
                                : "Inventory item";
                            const requestedQuantity = Number(
                              typedLine.quantity ?? 0,
                            );
                            const uom =
                              typeof typedLine.uom === "string"
                                ? typedLine.uom
                                : "unit";

                            return (
                              <label
                                key={inputKey}
                                className="grid gap-2 border-b border-border-system px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_120px]"
                              >
                                <span>
                                  <span className="block text-sm font-semibold normal-case tracking-normal text-foreground">
                                    {itemName}
                                  </span>
                                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                                    Requested{" "}
                                    {requestedQuantity.toLocaleString(undefined, {
                                      maximumFractionDigits: 3,
                                    })}{" "}
                                    {uom}
                                  </span>
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  placeholder="Issue qty"
                                  value={requisitionIssueQtyByKey[inputKey] ?? ""}
                                  onChange={(event) =>
                                    setRequisitionIssueQtyByKey((currentValues) => ({
                                      ...currentValues,
                                      [inputKey]: event.target.value,
                                    }))
                                  }
                                  className={formControlClass}
                                />
                              </label>
                            );
                          })}
                        </div>
                      ) : request.status === "accepted" ? (
                        <p className="rounded-sm border border-status-info-border bg-status-info-bg px-3 py-2 text-sm font-semibold text-status-info-text">
                          Dispatch is waiting for destination acknowledgement.
                          Stock movement posts only when the receiver acknowledges
                          receipt.
                        </p>
                      ) : null}
                      {request.status === "accepted" &&
                      currentUserIssuedRequisition(request) ? (
                        <p className="rounded-sm border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-semibold text-status-info-text">
                          Receiving department roles can acknowledge or reject
                          this handoff after physical delivery is checked.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {request.status === "pending" ? (
                          <>
                            <button
                              type="button"
                              disabled={!canRecordOperations}
                              onClick={() => handleEditRequisitionRequest(request)}
                              className={compactActionButtonClass}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={!canApproveOperations}
                              onClick={() =>
                                handleConfirmRequisitionRequest(request)
                              }
                              className={compactPrimaryActionButtonClass}
                            >
                              Dispatch
                            </button>
                          </>
                        ) : request.status === "accepted" ? (
                          <>
                            <button
                              type="button"
                              disabled={!canRecordOperations}
                              onClick={() =>
                                handleAcknowledgeRequisitionRequest(request)
                              }
                              className={compactPrimaryActionButtonClass}
                            >
                              Acknowledge receipt
                            </button>
                            <button
                              type="button"
                              disabled={!canRecordOperations}
                              onClick={() =>
                                handleRejectRequisitionReceiptRequest(request)
                              }
                              className={compactActionButtonClass}
                            >
                              Reject receipt
                            </button>
                          </>
                        ) : null}
                        {request.status === "pending" ? (
                          <button
                            type="button"
                            disabled={!canApproveOperations}
                            onClick={() => onRejectRequest(request.id)}
                            className={compactActionButtonClass}
                          >
                            Reject
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-5 py-5 text-sm text-text-muted">
                No department requisitions are waiting for store action.
              </p>
            )}
          </div>

          <h3
            id="purchase-orders"
            className={`${showPurchaseOrderWorkspace && showPurchaseOrderDraftSection ? "" : "hidden"} mt-6 scroll-mt-24 text-lg font-semibold text-foreground`}
          >
            Procurement Purchase Order
          </h3>
          <p
            className={`${showPurchaseOrderWorkspace && showPurchaseOrderDraftSection ? "" : "hidden"} mt-1 text-sm font-semibold text-text-muted`}
          >
            Procurement drafts open purchase orders from expected supply. Inventory confirms
            receipt before stock and weighted cost update.
          </p>
          <form
            onSubmit={handlePurchaseReceiptFormSubmit}
            className={`${showPurchaseOrderWorkspace && showPurchaseOrderDraftSection ? "" : "hidden"} mt-3 grid gap-3 rounded-sm border border-border-system bg-background p-4`}
          >
            <input
              type="hidden"
              name="purchase_lines"
              value={JSON.stringify(purchaseLinesPayload)}
            />
            <input
              type="hidden"
              name="purchase_order_id"
              value={editingPurchaseOrderId}
            />
            <div className="grid gap-3 md:grid-cols-3">
              <select
                name="supplier_id"
                value={purchaseSupplierId}
                onChange={(event) => {
                  const supplierId = event.target.value;
                  const supplier = activeSuppliers.find(
                    (item) => extractUuid(item.id) === extractUuid(supplierId),
                  );

                  setPurchaseSupplierId(supplierId);
                  if (supplier) {
                    setPurchaseSupplierName(supplier.name);
                  }
                }}
                className={formControlClass}
              >
                <option value="">Supplier</option>
                {activeSuppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
              <input
                name="supplier_name"
                placeholder="Supplier name"
                value={purchaseSupplierName}
                onChange={(event) => {
                  setPurchaseSupplierName(event.target.value);
                  const matchingSupplier = activeSuppliers.find(
                    (supplier) =>
                      supplier.name.trim().toLowerCase() ===
                      event.target.value.trim().toLowerCase(),
                  );
                  setPurchaseSupplierId(extractUuid(matchingSupplier?.id));
                }}
                className={formControlClass}
              />
              <select
                name="receiving_location_id"
                value={purchaseReceivingLocationId}
                onChange={(event) => {
                  const nextLocationId = extractUuid(event.target.value);
                  setPurchaseReceivingLocationId(nextLocationId);
                  setPurchaseReceiptRows((currentRows) =>
                    currentRows.map((row) => {
                      const selectedItem = canonicalStorePurchasedIngredients.find(
                        (item) =>
                          extractUuid(item.id) ===
                          extractUuid(row.inventoryItemId),
                      );
                      const remainsInSelectedStore =
                        selectedItem &&
                        extractUuid(selectedItem.location_id) === nextLocationId;

                      return remainsInSelectedStore
                        ? row
                        : {
                            ...row,
                            inventoryItemId: "",
                            stockOnHandQty: "",
                            landedUnitCost: "",
                            taxRatePct: "",
                          };
                    }),
                  );
                }}
                className={formControlClass}
              >
                <option value="">Receiving location</option>
                {stockHoldingLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              {purchaseReceiptRows.map((row) => {
                const selectedPurchaseItem = canonicalStorePurchasedIngredients.find(
                  (item) => extractUuid(item.id) === extractUuid(row.inventoryItemId),
                );
                const purchaseSearchText = row.searchText.trim().toLowerCase();
                const visiblePurchaseIngredients = purchaseReceivingIngredients
                  .filter((item) => {
                    if (!purchaseSearchText) {
                      return true;
                    }

                    const itemLocation = activeLocations.find(
                      (location) =>
                        extractUuid(location.id) === extractUuid(item.location_id),
                    );
                    const searchableText = [
                      item.name,
                      item.sku,
                      item.department,
                      item.base_uom,
                      item.on_hand_uom,
                      itemLocation?.name,
                    ]
                      .filter(Boolean)
                      .join(" ")
                      .toLowerCase();

                    return searchableText.includes(purchaseSearchText);
                  })
                  .slice(0, 80);
                const selectedPurchaseUom =
                  selectedPurchaseItem?.on_hand_uom ??
                  selectedPurchaseItem?.base_uom ??
                  "unit";
                const selectedPurchaseCurrentUnitCost = Number(
                  selectedPurchaseItem?.current_cost_per_base_uom ?? 0,
                );

                return (
                <div
                  key={row.id}
                  className="grid min-w-0 max-w-full gap-3 overflow-hidden rounded-sm border border-border-system bg-card p-3"
                >
                  <div className="grid min-w-0 max-w-full gap-1">
                    <input
                      type="search"
                      placeholder={
                        purchaseReceivingLocationId
                          ? "Search ingredient or SKU"
                          : "Select receiving store first"
                      }
                      value={row.searchText}
                      onChange={(event) =>
                        setPurchaseReceiptRows((currentRows) =>
                          currentRows.map((currentRow) =>
                            currentRow.id === row.id
                              ? {
                                  ...currentRow,
                                  searchText: event.target.value,
                                }
                              : currentRow,
                          ),
                        )
                      }
                      className={formControlClass}
                    />
                    <select
                      value={row.inventoryItemId}
                      onChange={(event) =>
                        setPurchaseReceiptRows((currentRows) =>
                          currentRows.map((currentRow) => {
                            if (currentRow.id !== row.id) {
                              return currentRow;
                            }

                            const nextItem = canonicalStorePurchasedIngredients.find(
                              (item) =>
                                extractUuid(item.id) ===
                                extractUuid(event.target.value),
                            );

                            return {
                              ...currentRow,
                              inventoryItemId: extractUuid(event.target.value),
                              searchText: nextItem?.name ?? currentRow.searchText,
                              stockOnHandQty: nextItem?.on_hand_qty.toString() ?? "",
                              landedUnitCost:
                                nextItem?.current_cost_per_base_uom.toString() ?? "",
                            };
                          }),
                        )
                      }
                      required
                      className={formControlClass}
                    >
                      <option value="">Ingredient</option>
                      {visiblePurchaseIngredients.map((item) => {
                        const itemLocation = activeLocations.find(
                          (location) =>
                            extractUuid(location.id) === extractUuid(item.location_id),
                        );
                        const itemUom =
                          item.on_hand_uom ?? item.base_uom ?? item.recipe_uom ?? "unit";

                        return (
                          <option key={extractUuid(item.id)} value={extractUuid(item.id)}>
                            {item.name ?? "Unnamed item"} /{" "}
                            {item.sku ? `${item.sku} / ` : ""}
                            {itemLocation?.name ?? "No location"} /{" "}
                            {Number(item.on_hand_qty ?? 0).toLocaleString()} {itemUom} on hand
                          </option>
                        );
                      })}
                    </select>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-ghost">
                      {purchaseSearchText
                        ? `${visiblePurchaseIngredients.length.toLocaleString()} matching store SKU${
                            visiblePurchaseIngredients.length === 1 ? "" : "s"
                          }`
                        : `${purchaseReceivingIngredients.length.toLocaleString()} SKU${
                            purchaseReceivingIngredients.length === 1 ? "" : "s"
                          } in selected location`}
                    </p>
                  </div>
                  <div className="grid min-w-0 max-w-full gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.75fr)_minmax(0,1.15fr)_minmax(0,1fr)_96px]">
                    <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Stock in hand
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="On hand"
                          value={row.stockOnHandQty}
                          readOnly
                          aria-readonly="true"
                          title="Stock on hand is system-calculated and updates only after Inventory confirms receipt."
                          className={`${formControlClass} min-w-0 cursor-not-allowed bg-background font-mono tabular-nums text-text-muted`}
                        />
                        <span className="shrink-0 text-xs font-semibold normal-case tracking-normal text-text-muted">
                          {selectedPurchaseUom}
                        </span>
                      </div>
                    </label>
                    <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Qty
                      <input
                        type="number"
                        min="0.000001"
                        step="any"
                        placeholder="Qty"
                        value={row.quantity}
                        onChange={(event) =>
                          setPurchaseReceiptRows((currentRows) =>
                            currentRows.map((currentRow) =>
                              currentRow.id === row.id
                                ? { ...currentRow, quantity: event.target.value }
                                : currentRow,
                            ),
                          )
                        }
                        required
                        className={`${formControlClass} min-w-0 font-mono tabular-nums`}
                      />
                    </label>
                    <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Unit cost
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder={
                            selectedPurchaseCurrentUnitCost > 0
                              ? selectedPurchaseCurrentUnitCost.toLocaleString(
                                  undefined,
                                  { maximumFractionDigits: 2 },
                                )
                              : "Unit cost"
                          }
                          value={row.landedUnitCost}
                          onChange={(event) =>
                            setPurchaseReceiptRows((currentRows) =>
                              currentRows.map((currentRow) =>
                                currentRow.id === row.id
                                  ? {
                                      ...currentRow,
                                      landedUnitCost: event.target.value,
                                    }
                                  : currentRow,
                              ),
                            )
                          }
                          required
                          className={`${formControlClass} min-w-0 font-mono tabular-nums`}
                        />
                        <span className="shrink-0 text-xs font-semibold normal-case tracking-normal text-text-muted">
                          {organization.local_currency}
                        </span>
                      </div>
                    </label>
                    <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      VAT / Tax
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="7.5"
                          value={row.taxRatePct}
                          onChange={(event) =>
                            setPurchaseReceiptRows((currentRows) =>
                              currentRows.map((currentRow) =>
                                currentRow.id === row.id
                                  ? {
                                      ...currentRow,
                                      taxRatePct: event.target.value,
                                    }
                                  : currentRow,
                              ),
                            )
                          }
                          className={`${formControlClass} min-w-0 font-mono tabular-nums`}
                        />
                        <span className="shrink-0 text-xs font-semibold normal-case tracking-normal text-text-muted">
                          %
                        </span>
                      </div>
                      <span className="text-[10px] font-semibold normal-case tracking-normal text-text-ghost">
                        Enter 7.5 for 7.5%
                      </span>
                    </label>
                    <button
                      type="button"
                      disabled={purchaseReceiptRows.length === 1}
                      onClick={() =>
                        setPurchaseReceiptRows((currentRows) =>
                          currentRows.filter((currentRow) => currentRow.id !== row.id),
                        )
                      }
                      className={`${secondaryButtonClass} self-end`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-3">
              {editingPurchaseOrderId ? (
                <button
                  type="button"
                  onClick={resetPurchaseOrderDraftForm}
                  className={secondaryButtonClass}
                >
                  Cancel edit
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  setPurchaseReceiptRows((currentRows) => [
                    ...currentRows,
                    {
                      id: `purchase-line-${Date.now()}`,
                      inventoryItemId: "",
                      searchText: "",
                      stockOnHandQty: "",
                      quantity: "",
                      landedUnitCost: "",
                      taxRatePct: "",
                    },
                  ])
                }
                className={secondaryButtonClass}
              >
                Add line
              </button>
              <button
                type="submit"
                disabled={
                  purchaseOrderSaving ||
                  !canDraftPurchaseOrders ||
                  canonicalStorePurchasedIngredients.length === 0
                }
                className={primaryButtonClass}
              >
                {editingPurchaseOrderId
                  ? "Update draft purchase order"
                  : "Create draft purchase order"}
              </button>
            </div>
            {editingPurchaseOrderId ? (
              <p className="text-xs font-semibold text-status-info-text">
                Editing open purchase order. Stock will still not update until receipt is confirmed.
              </p>
            ) : null}
          </form>

          <h3
            id="po-receipt-queue"
            className={`${showPurchaseOrderWorkspace && showPurchaseOrderQueue ? "" : "hidden"} mt-6 scroll-mt-24 text-lg font-semibold text-foreground`}
          >
            {showInventoryMovementSection
              ? "Purchase Order and Receipt Queue"
              : "Open Purchase Orders"}
          </h3>
          <p
            className={`${showPurchaseOrderWorkspace && showPurchaseOrderQueue ? "" : "hidden"} mt-1 text-sm font-semibold text-text-muted`}
          >
            {showInventoryMovementSection
              ? "Inventory managers review purchase order details, confirm received stock, and trigger the margin recovery cost cascade."
              : "Procurement can review and adjust open purchase orders until Inventory confirms receipt."}
          </p>
          {showPurchaseOrderWorkspace && showPurchaseOrderQueue ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                {
                  value: "open" as const,
                  label: "Open purchase orders",
                  count: purchaseOrderQueueCounts.open,
                },
                {
                  value: "partial" as const,
                  label: "Partial purchase orders",
                  count: purchaseOrderQueueCounts.partial,
                },
                {
                  value: "completed" as const,
                  label: "Completed purchase orders",
                  count: purchaseOrderQueueCounts.completed,
                },
                {
                  value: "all" as const,
                  label: "All",
                  count: purchaseOrderQueueCounts.all,
                },
              ].map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setPurchaseOrderQueueFilter(filter.value)}
                  className={`h-9 rounded-sm border px-3 text-xs font-bold uppercase tracking-wider transition ${
                    purchaseOrderQueueFilter === filter.value
                      ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                      : "border-border-system bg-background text-text-muted hover:border-border-system-hover hover:text-foreground"
                  }`}
                >
                  {filter.label} ({filter.count.toLocaleString()})
                </button>
              ))}
            </div>
          ) : null}
          <div
            className={`${showPurchaseOrderWorkspace && showPurchaseOrderQueue ? "" : "hidden"} mt-5 ${ledgerFrameClass}`}
          >
            <div>
              <div className={`${ledgerColumnHeaderClass} grid-cols-[minmax(0,1fr)_150px_170px_280px]`}>
                <span>Purchase order</span>
                <span>Status</span>
                <span>Total</span>
                <span>Review / Receipt</span>
              </div>
              {visiblePurchaseOrderQueue.length > 0 ? (
                visiblePurchaseOrderQueue.slice(0, 10).map((order) => {
                  const orderHasReceivedLines = order.lines.some(
                    (line) => Number(line.received_qty ?? 0) > 0,
                  );
                  const orderCanBeReceived =
                    canReceivePurchaseOrders &&
                    ["draft", "pending", "accepted"].includes(order.status) &&
                    order.outstandingLineCount > 0;
                  const orderCanBeEdited =
                    canDraftPurchaseOrders &&
                    ["draft", "pending", "accepted"].includes(order.status) &&
                    !orderHasReceivedLines;
                  const isExpanded = expandedPurchaseOrderId === order.id;
                  const receiptDraftLines = order.lines
                    .map((line) => {
                      const outstandingQty = Math.max(
                        Number(line.qty) - Number(line.received_qty ?? 0),
                        0,
                      );
                      const enteredQty = Number(
                        purchaseReceiptQuantities[line.id] ?? outstandingQty,
                      );

                      return {
                        purchase_order_line_id: line.id,
                        received_qty: Math.min(
                          Math.max(Number.isFinite(enteredQty) ? enteredQty : 0, 0),
                          outstandingQty,
                        ),
                        outstanding_qty: outstandingQty,
                        ordered_qty: Number(line.qty ?? 0),
                        already_received_qty: Number(line.received_qty ?? 0),
                        landed_unit_cost: Number(line.landed_unit_cost ?? 0),
                      };
                    })
                    .filter((line) => line.received_qty > 0);
                  const totalOrderedQty = order.lines.reduce(
                    (total, line) => total + Number(line.qty ?? 0),
                    0,
                  );
                  const totalAlreadyReceivedQty = order.lines.reduce(
                    (total, line) => total + Number(line.received_qty ?? 0),
                    0,
                  );
                  const totalReceivingQty = receiptDraftLines.reduce(
                    (total, line) => total + line.received_qty,
                    0,
                  );
                  const expectedRemainingQty = Math.max(
                    totalOrderedQty - totalAlreadyReceivedQty,
                    0,
                  );
                  const shortLineCount = receiptDraftLines.filter(
                    (line) => line.received_qty < line.outstanding_qty,
                  ).length;
                  const hasShortDelivery =
                    orderCanBeReceived &&
                    (shortLineCount > 0 ||
                      totalReceivingQty < expectedRemainingQty);
                  const receiptValue = receiptDraftLines.reduce(
                    (total, line) =>
                      total + line.received_qty * line.landed_unit_cost,
                    0,
                  );
                  const receiptNeedsReason =
                    hasShortDelivery && purchaseShortSupplyReason.trim().length === 0;
                  const confirmReceiptDisabled =
                    !orderCanBeReceived ||
                    receivingPurchaseOrderId === order.id ||
                    receiptDraftLines.length === 0 ||
                    receiptNeedsReason;

                  return (
                    <div
                      key={order.id}
                      className="border-t border-border-system text-sm text-text-muted"
                    >
                      <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_150px_170px_280px] lg:items-center">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">
                            {order.po_number ?? order.id} / {order.supplierName}
                          </p>
                          <p className="text-xs text-text-ghost">
                            {order.receivingLocationName} /{" "}
                            {order.lines.length.toLocaleString()} line
                            {order.lines.length === 1 ? "" : "s"} /{" "}
                            {order.created_at
                              ? new Date(order.created_at).toLocaleDateString()
                              : "No date"}
                            {order.grn_number ? ` / ${order.grn_number}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-fit rounded-full border border-status-info-border bg-status-info-bg px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-info-text">
                            {order.receipt_status === "partially_received"
                              ? "Partial delivery"
                              : order.receipt_status ?? order.status}
                          </span>
                          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:hidden">
                            {order.outstandingLineCount.toLocaleString()} outstanding
                          </span>
                        </div>
                        <span className="font-semibold text-foreground">
                          {organization.local_currency}{" "}
                          {order.totalCost.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </span>
                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedPurchaseOrderId((currentId) =>
                                currentId === order.id ? "" : order.id,
                              )
                            }
                            className={compactActionButtonClass}
                          >
                            {isExpanded ? "Hide details" : "View details"}
                          </button>
                          <button
                            type="button"
                            disabled={!orderCanBeEdited}
                            onClick={() => handleEditPurchaseOrder(order)}
                            title={
                              orderHasReceivedLines
                                ? "PO lines are locked after Inventory confirms any receipt."
                                : undefined
                            }
                            className={
                              orderCanBeEdited
                                ? compactActionButtonClass
                                : `${compactActionButtonClass} opacity-50`
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={confirmReceiptDisabled}
                            onClick={() => {
                              void onReceivePurchaseOrder(
                                order.id,
                                receiptDraftLines.map((line) => ({
                                  purchase_order_line_id:
                                    line.purchase_order_line_id,
                                  received_qty: line.received_qty,
                                })),
                                purchaseShortSupplyReason,
                              ).then(() => {
                                setPurchaseReceiptQuantities({});
                                setPurchaseShortSupplyReason("");
                              });
                            }}
                            className={
                              !confirmReceiptDisabled
                                ? compactPrimaryActionButtonClass
                                : `${compactPrimaryActionButtonClass} opacity-50`
                            }
                          >
                            {receivingPurchaseOrderId === order.id
                              ? "Receiving..."
                              : order.status === "completed"
                                ? "Received"
                                : "Confirm"}
                          </button>
                        </div>
                      </div>
                      {isExpanded ? (
                        <div className="border-t border-border-system bg-card/40 px-4 py-4 sm:px-5">
                          <div className="grid gap-3 pb-4 sm:grid-cols-4">
                            {[
                              ["Expected", totalOrderedQty],
                              ["Already received", totalAlreadyReceivedQty],
                              ["Receiving now", totalReceivingQty],
                              ["Still missing", Math.max(expectedRemainingQty - totalReceivingQty, 0)],
                            ].map(([label, value]) => (
                              <div
                                key={String(label)}
                                className="rounded-sm border border-border-system bg-background px-3 py-3"
                              >
                                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                                  {label}
                                </p>
                                <p className="mt-1 text-xl font-black leading-none text-foreground">
                                  {Number(value).toLocaleString(undefined, {
                                    maximumFractionDigits: 3,
                                  })}
                                </p>
                              </div>
                            ))}
                          </div>
                          {receiptNeedsReason ? (
                            <p className="mb-3 rounded-sm border border-status-attention-border bg-status-attention-bg px-3 py-2 text-xs font-semibold text-status-attention-text">
                              Delivery is short. Record the supplier or invoice
                              discrepancy before confirming receipt.
                            </p>
                          ) : null}
                          <div className="hidden grid-cols-[minmax(0,1fr)_120px_160px_140px] gap-3 border-b border-border-system pb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:grid">
                            <span>SKU</span>
                            <span>Order qty</span>
                            <span>Cost / Stock</span>
                            <span>Receive now</span>
                          </div>
                          {order.lines.length > 0 ? (
                            order.lines.map((line) => {
                              const lineItem = activeInventoryItemsById.get(
                                extractUuid(line.inventory_item_id),
                              );
                              const lineLocation = activeLocations.find(
                                (location) =>
                                  extractUuid(location.id) ===
                                  extractUuid(lineItem?.location_id),
                              );
                              const lineUom =
                                lineItem?.on_hand_uom ??
                                lineItem?.base_uom ??
                                lineItem?.recipe_uom ??
                                "unit";
                              const currentQty = Number(lineItem?.on_hand_qty ?? 0);
                              const lineTotal =
                                Number(line.qty ?? 0) *
                                Number(line.landed_unit_cost ?? 0);
                              const outstandingQty = Math.max(
                                Number(line.qty ?? 0) -
                                  Number(line.received_qty ?? 0),
                                0,
                              );
                              const lineCanReceive =
                                orderCanBeReceived && outstandingQty > 0;
                              const enteredReceiptQty = Math.min(
                                Math.max(
                                  Number(
                                    purchaseReceiptQuantities[line.id] ??
                                      outstandingQty,
                                  ) || 0,
                                  0,
                                ),
                                outstandingQty,
                              );
                              const varianceQty = outstandingQty - enteredReceiptQty;
                              const lineIsShort =
                                lineCanReceive && varianceQty > 0;

                              return (
                                <div
                                  key={line.id}
                                  className={`grid gap-3 border-b border-border-system/70 py-3 lg:grid-cols-[minmax(0,1fr)_120px_160px_140px] lg:items-center ${
                                    lineIsShort
                                      ? "bg-status-attention-bg/35 px-3"
                                      : ""
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-foreground">
                                      {lineItem?.name ?? "Unknown SKU"}
                                    </p>
                                    <p className="text-xs text-text-ghost">
                                      {lineItem?.sku ?? "No SKU"} /{" "}
                                      {lineLocation?.name ??
                                        order.receivingLocationName}{" "}
                                      / {Number(line.received_qty ?? 0).toLocaleString()} received
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2 lg:hidden">
                                      <span className="rounded-full border border-border-system bg-background px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                                        Ordered{" "}
                                        {Number(line.qty ?? 0).toLocaleString(
                                          undefined,
                                          { maximumFractionDigits: 3 },
                                        )}{" "}
                                        {lineUom}
                                      </span>
                                      <span
                                        className={`rounded-full border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                                          lineIsShort
                                            ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                                            : "border-accent-muted-border bg-accent-muted-bg text-accent"
                                        }`}
                                      >
                                        {lineIsShort
                                          ? `${varianceQty.toLocaleString(undefined, {
                                              maximumFractionDigits: 3,
                                            })} short`
                                          : "Matched"}
                                      </span>
                                    </div>
                                  </div>
                                  <span>
                                    {Number(line.qty ?? 0).toLocaleString(undefined, {
                                      maximumFractionDigits: 3,
                                    })}{" "}
                                    {lineUom}
                                  </span>
                                  <div className="text-xs text-text-muted">
                                    <p>
                                      Unit {organization.local_currency}{" "}
                                      {Number(line.landed_unit_cost ?? 0).toLocaleString(
                                        undefined,
                                        { maximumFractionDigits: 2 },
                                      )}{" "}
                                      / line {organization.local_currency}{" "}
                                      {lineTotal.toLocaleString(undefined, {
                                        maximumFractionDigits: 2,
                                      })}
                                    </p>
                                    <p className="mt-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                                      Current {currentQty.toLocaleString(undefined, {
                                        maximumFractionDigits: 3,
                                      })}{" "}
                                      {lineUom}
                                    </p>
                                  </div>
                                  <div className="grid gap-2">
                                    <input
                                      type="number"
                                      min="0"
                                      max={outstandingQty}
                                      step="any"
                                      aria-label={`Received quantity for ${
                                        lineItem?.name ?? "purchase order item"
                                      }`}
                                      value={
                                        purchaseReceiptQuantities[line.id] ??
                                        outstandingQty.toString()
                                      }
                                      onChange={(event) =>
                                        setPurchaseReceiptQuantities((current) => ({
                                          ...current,
                                          [line.id]: event.target.value,
                                        }))
                                      }
                                      disabled={!lineCanReceive}
                                      className={receivingQuantityInputClass}
                                    />
                                    {lineCanReceive ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPurchaseReceiptQuantities(
                                            (current) => ({
                                              ...current,
                                              [line.id]: outstandingQty.toString(),
                                            }),
                                          )
                                        }
                                        className={compactActionButtonClass}
                                      >
                                        Match invoice
                                      </button>
                                    ) : null}
                                  </div>
                                  {!lineCanReceive && outstandingQty === 0 ? (
                                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
                                      Complete
                                    </p>
                                  ) : null}
                                </div>
                              );
                            })
                          ) : (
                            <p className="py-3 text-sm text-text-muted">
                              This purchase order has no line items.
                            </p>
                          )}
                          {orderCanBeReceived ? (
                            <input
                              placeholder="Reason required when delivery is short"
                              value={purchaseShortSupplyReason}
                              onChange={(event) =>
                                setPurchaseShortSupplyReason(event.target.value)
                              }
                              className={`${formControlClass} mt-3 w-full`}
                            />
                          ) : null}
                          {orderCanBeReceived ? (
                            <div className="mt-3 flex flex-col gap-3 border-t border-border-system pt-3 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-xs font-semibold text-text-muted">
                                Receiving value: {organization.local_currency}{" "}
                                {receiptValue.toLocaleString(undefined, {
                                  maximumFractionDigits: 2,
                                })}
                                {hasShortDelivery
                                  ? ` / ${shortLineCount.toLocaleString()} short line${
                                      shortLineCount === 1 ? "" : "s"
                                    }`
                                  : " / all expected quantities matched"}
                              </p>
                              <button
                                type="button"
                                disabled={confirmReceiptDisabled}
                                onClick={() =>
                                  void onReceivePurchaseOrder(
                                    order.id,
                                    receiptDraftLines.map((line) => ({
                                      purchase_order_line_id:
                                        line.purchase_order_line_id,
                                      received_qty: line.received_qty,
                                    })),
                                    purchaseShortSupplyReason,
                                  ).then(() => {
                                    setPurchaseReceiptQuantities({});
                                    setPurchaseShortSupplyReason("");
                                  })
                                }
                                className={
                                  !confirmReceiptDisabled
                                    ? primaryButtonClass
                                    : `${primaryButtonClass} opacity-50`
                                }
                              >
                                Confirm checked receipt
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="px-4 py-4 text-sm text-text-muted">
                  {showInventoryMovementSection
                    ? "No purchase orders recorded yet."
                    : "No open purchase orders awaiting adjustment or receipt."}
                </p>
              )}
            </div>
          </div>

          <h3
            id="stock-control-workspace"
            className={`${showStockCountWorkspace || showFullStockCountWorkspace || showStockAdjustmentWorkspace ? "" : "hidden"} mt-6 scroll-mt-24 text-lg font-semibold text-foreground`}
          >
            {showFullStockCountWorkspace
              ? "Full Stock Count Workspace"
              : showStockCountWorkspace
                ? "Cycle Count Workspace"
                : "Stock Adjustment Workspace"}
          </h3>
          <p
            className={`${showStockCountWorkspace || showFullStockCountWorkspace || showStockAdjustmentWorkspace ? "" : "hidden"} mt-1 text-sm text-text-muted`}
          >
            Select the target storage location first. Counts and adjustments
            are submitted to Finance for approval before stock balance, AvT
            variance, or margin impact is trusted.
          </p>
          <div
            className={`${showStockCountWorkspace || showFullStockCountWorkspace || showStockAdjustmentWorkspace ? "" : "hidden"} mt-5 rounded-sm border border-border-system bg-background p-4`}
          >
            <label className="grid gap-2 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Target storage location
              <select
                name="stock_control_location_id"
                value={stockControlLocationId}
                onChange={(event) => {
                  setStockControlLocationId(event.target.value);
                  setFullStockCountQuantities({});
                  setStockCountRows((currentRows) =>
                    currentRows.map((currentRow) => ({
                      ...currentRow,
                      inventoryItemId: "",
                    })),
                  );
                }}
                className={formControlClass}
              >
                <option value="">Select count location</option>
                {scopedStockControlLocations.map((location) => (
                  <option key={location.id} value={extractUuid(location.id)}>
                    {formatStockLocationOption(location)}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricPill
                label="Count scope"
                value={selectedStockControlLocation?.name ?? "No store selected"}
              />
              <MetricPill
                label="High-value SKUs"
                value={highValueStockControlItemCount.toLocaleString()}
                valueClassName={
                  highValueStockControlItemCount > 0
                    ? "font-semibold text-status-attention-text"
                    : "font-semibold text-text-muted"
                }
              />
              <MetricPill
                label="Lines ready"
                value={
                  showFullStockCountWorkspace
                    ? `${fullStockCountCompletedLineCount.toLocaleString()} / ${fullStockCountRows.length.toLocaleString()}`
                    : `${countedStockCountLineCount.toLocaleString()} / ${stockCountRows.length.toLocaleString()}`
                }
              />
              <MetricPill
                label="Pending Finance"
                value={pendingStockCountApprovalCount.toLocaleString()}
                valueClassName={
                  pendingStockCountApprovalCount > 0
                    ? "font-semibold text-status-attention-text"
                    : "font-semibold text-accent"
                }
              />
            </div>
          </div>

          <h4
            id="full-stock-counts"
            className={`${showFullStockCountWorkspace ? "" : "hidden"} mt-6 scroll-mt-24 text-base font-semibold text-foreground`}
          >
            Full Monthly Stock Count
          </h4>
          <p
            className={`${showFullStockCountWorkspace ? "" : "hidden"} mt-1 text-sm text-text-muted`}
          >
            Use this for full month-end counts. The system intentionally hides
            current on-hand quantities so the physical count is independent.
          </p>
          <form
            onSubmit={handleStockCountFormSubmit}
            className={`${showFullStockCountWorkspace ? "" : "hidden"} mt-5 overflow-hidden rounded-sm border border-border-system bg-background`}
          >
            <input
              type="hidden"
              name="target_location_id"
              value={stockControlLocationId}
            />
            <input
              type="hidden"
              name="stock_count_lines"
              value={JSON.stringify(fullStockCountLinesPayload)}
            />
            <div className="grid gap-3 border-b border-border-system bg-card px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="font-semibold text-foreground">
                  {selectedStockControlLocation?.name ?? "Select a location"}
                </p>
                <p className="mt-1 text-xs font-semibold leading-5 text-text-muted">
                  {fullStockCountRows.length.toLocaleString()} SKU
                  {fullStockCountRows.length === 1 ? "" : "s"} in count scope.
                  Count every row before submitting to Finance.
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                  fullStockCountReady
                    ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                    : "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                }`}
              >
                {fullStockCountCompletedLineCount.toLocaleString()} /{" "}
                {fullStockCountRows.length.toLocaleString()} counted
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full table-fixed text-left text-sm">
                <thead className="sticky top-0 bg-card font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                  <tr>
                    <th className="w-[30%] px-4 py-3">SKU name</th>
                    <th className="w-[18%] px-4 py-3">SKU code</th>
                    <th className="w-[12%] px-4 py-3">Unit</th>
                    <th className="w-[16%] px-4 py-3 text-right">Unit cost</th>
                    <th className="w-[24%] px-4 py-3">Physical count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-system">
                  {fullStockCountRows.length > 0 ? (
                    fullStockCountRows.map((item) => {
                      const itemId = extractUuid(item.id);
                      const uom =
                        item.on_hand_uom ||
                        item.base_uom ||
                        item.recipe_uom ||
                        "unit";

                      return (
                        <tr key={itemId} className="bg-background hover:bg-card">
                          <td className="px-4 py-3 font-semibold text-foreground">
                            {item.name ?? "Unnamed item"}
                            <span className="mt-0.5 block text-xs font-medium text-text-ghost">
                              {item.cost_type?.replaceAll("_", " ") ?? "inventory"}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-text-muted">
                            {item.sku || "No SKU"}
                          </td>
                          <td className="px-4 py-3 font-semibold text-text-muted">
                            {uom}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-foreground">
                            {formatCurrency(
                              Number(item.current_cost_per_base_uom ?? 0),
                              2,
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              placeholder={`Count in ${uom}`}
                              value={fullStockCountQuantities[itemId] ?? ""}
                              onChange={(event) =>
                                setFullStockCountQuantities((currentValues) => ({
                                  ...currentValues,
                                  [itemId]: event.target.value,
                                }))
                              }
                              disabled={!stockControlLocationId}
                              required
                              className={formControlClass}
                            />
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-sm font-semibold text-text-muted"
                      >
                        Select a storage location to load the full SKU count
                        sheet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 border-t border-border-system bg-card px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
              <p className="text-xs font-semibold leading-5 text-text-muted">
                The variance is calculated only after submission and Finance
                approval. Counters should not see the system balance during
                the count.
              </p>
              <button
                type="submit"
                disabled={
                  stockCountSaving ||
                  !canRecordOperations ||
                  !stockControlLocationId ||
                  !fullStockCountReady
                }
                className={primaryButtonClass}
              >
                Submit full count to Finance
              </button>
            </div>
          </form>

          <h4
            id="stock-adjustments"
            className={`${showStockAdjustmentWorkspace ? "" : "hidden"} mt-6 scroll-mt-24 text-base font-semibold text-foreground`}
          >
            Opening Balance / Stock Adjustment
          </h4>
          <form
            onSubmit={onAdjustStock}
            className={`${showStockAdjustmentWorkspace ? "" : "hidden"} mt-5 grid gap-3 rounded-sm border border-border-system bg-background p-3 sm:p-4`}
          >
            <input
              type="hidden"
              name="target_location_id"
              value={stockControlLocationId}
            />
            <select
              name="inventory_item_id"
              required
              disabled={!stockControlLocationId}
              className={formControlClass}
            >
              <option value="">
                {stockControlLocationId
                  ? "Item in selected location"
                  : "Select a target store first"}
              </option>
              {stockControlInventoryItems.map((item) => (
                <option key={extractUuid(item.id)} value={extractUuid(item.id)}>
                  {item.name ?? "Unnamed item"} ({item.on_hand_uom ?? item.base_uom ?? "unit"})
                </option>
              ))}
            </select>
            <div className="grid gap-3">
              <select
                name="adjustment_mode"
                defaultValue="set"
                className={formControlClass}
              >
                <option value="set">Set balance</option>
                <option value="adjust">Adjust by</option>
              </select>
              <input
                name="quantity"
                type="number"
                step="any"
                placeholder="Quantity"
                required
                className={formControlClass}
              />
            </div>
            <button
              type="submit"
              disabled={
              stockSaving ||
              !canRecordOperations ||
                !stockControlLocationId ||
                stockControlInventoryItems.length === 0
              }
              className={primaryButtonClass}
            >
              Submit adjustment to Finance
            </button>
            <p className="text-xs font-semibold text-text-muted">
              Use “Adjust by” for signed movements, for example -5 to reduce stock
              or 5 to increase it. Finance approval still controls the final post.
            </p>
          </form>

          <div className={`${showStockAdjustmentWorkspace ? "" : "hidden"} mt-5 ${ledgerFrameClass}`}>
            <div className={`${ledgerColumnHeaderClass} grid-cols-[minmax(0,1fr)_130px_130px_130px]`}>
              <span>Adjustment report</span>
              <span>Status</span>
              <span>Change</span>
              <span>Final qty</span>
            </div>
            {stockAdjustmentReportRows.length > 0 ? (
              stockAdjustmentReportRows.slice(0, 8).map((row) => {
                const changeClass =
                  row.adjustment_quantity < 0
                    ? "font-semibold text-status-critical-text"
                    : row.adjustment_quantity > 0
                      ? "font-semibold text-accent"
                      : "font-semibold text-foreground";

                return (
                  <div
                    key={`${row.request_id}-${row.item}-${row.created_at}`}
                    className="grid gap-3 border-t border-border-system px-5 py-4 text-sm text-text-muted lg:grid-cols-[minmax(0,1fr)_130px_130px_130px] lg:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {row.item}
                      </p>
                      <p className="text-xs text-text-ghost">
                        {row.location} / {row.adjustment_mode} /{" "}
                        {row.created_at
                          ? new Date(row.created_at).toLocaleString()
                          : "No date"}
                      </p>
                    </div>
                    <span className="w-fit rounded-full border border-status-info-border bg-status-info-bg px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-info-text">
                      {row.status}
                    </span>
                    <span className={changeClass}>
                      <span className="mr-2 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:hidden">
                        Change
                      </span>
                      {row.adjustment_quantity.toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })}{" "}
                      {row.uom}
                    </span>
                    <span className="font-semibold text-foreground">
                      <span className="mr-2 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:hidden">
                        Final
                      </span>
                      {row.final_quantity.toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })}{" "}
                      {row.uom}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="border-t border-border-system px-4 py-4 text-sm text-text-muted">
                No stock adjustments submitted yet.
              </p>
            )}
          </div>

          <h4
            id="stock-counts"
            className={`${showStockCountWorkspace ? "" : "hidden"} mt-6 scroll-mt-24 text-base font-semibold text-foreground`}
          >
            Cycle Count
          </h4>
          <p
            className={`${showStockCountWorkspace ? "" : "hidden"} mt-1 text-sm text-text-muted`}
          >
            Use this for focused location checks, high-value spot checks, and
            operational cycle counts. Finance compares
            the physical count against expected stock after receipts, issues,
            production, sales depletion, and waste confirmations are complete.
          </p>
          <div
            className={`${showStockCountWorkspace ? "" : "hidden"} mt-4 rounded-sm border border-status-info-border bg-status-info-bg px-4 py-3 text-sm text-status-info-text`}
          >
            <p className="font-semibold text-foreground">
              Count sequence
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              {[
                "Confirm receipts and transfers",
                "Count high-value SKUs",
                "Submit to Finance",
                "Finance approves AvT variance",
              ].map((step, index) => (
                <div
                  key={step}
                  className="rounded-sm border border-status-info-border bg-card px-3 py-2"
                >
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                    Step {index + 1}
                  </span>
                  <p className="mt-1 font-semibold text-foreground">{step}</p>
                </div>
              ))}
            </div>
          </div>
          <form
            onSubmit={handleStockCountFormSubmit}
            className={`${showStockCountWorkspace ? "" : "hidden"} mt-5 grid gap-3 rounded-sm border border-border-system bg-background p-3 sm:p-4`}
          >
            <input
              type="hidden"
              name="target_location_id"
              value={stockControlLocationId}
            />
            <input
              type="hidden"
              name="stock_count_lines"
              value={JSON.stringify(stockCountLinesPayload)}
            />
            <div className="grid gap-2">
              {stockCountRows.map((row) => {
                const selectedItem = stockControlInventoryItems.find(
                  (item) =>
                    extractUuid(item.id) === extractUuid(row.inventoryItemId),
                );
                const countedQuantity = Number(row.countedQuantity);
                const hasCount = Number.isFinite(countedQuantity);
                const systemQuantity = Number(selectedItem?.on_hand_qty ?? 0);
                const varianceQuantity = hasCount
                  ? systemQuantity - countedQuantity
                  : 0;
                const varianceImpact =
                  varianceQuantity *
                  Number(selectedItem?.current_cost_per_base_uom ?? 0);
                const uom =
                  selectedItem?.on_hand_uom ||
                  selectedItem?.base_uom ||
                  selectedItem?.recipe_uom ||
                  "unit";

                return (
                  <div
                    key={row.id}
                    className="grid gap-3 rounded-sm border border-border-system bg-card p-3 md:grid-cols-[minmax(0,1fr)_160px_160px_auto] md:items-start"
                  >
                    <label className="grid gap-2 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      SKU
                      <select
                        value={row.inventoryItemId}
                        onChange={(event) =>
                          setStockCountRows((currentRows) =>
                            currentRows.map((currentRow) =>
                              currentRow.id === row.id
                                ? {
                                    ...currentRow,
                                    inventoryItemId: extractUuid(event.target.value),
                                  }
                                : currentRow,
                            ),
                          )
                        }
                        required
                        disabled={!stockControlLocationId}
                        className={formControlClass}
                      >
                        <option value="">
                          {stockControlLocationId
                            ? "Item in selected location"
                            : "Select a target store first"}
                        </option>
                        {stockControlInventoryItems.map((item) => (
                          <option
                            key={extractUuid(item.id)}
                            value={extractUuid(item.id)}
                          >
                            {item.name ?? "Unnamed item"} (
                            {item.on_hand_uom ?? item.base_uom ?? "unit"})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-2 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Physical count
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0"
                        value={row.countedQuantity}
                        onChange={(event) =>
                          setStockCountRows((currentRows) =>
                            currentRows.map((currentRow) =>
                              currentRow.id === row.id
                                ? {
                                    ...currentRow,
                                    countedQuantity: event.target.value,
                                  }
                                : currentRow,
                            ),
                          )
                        }
                        required
                        className={formControlClass}
                      />
                    </label>
                    <div className="grid gap-2 rounded-sm border border-border-system bg-background p-3 text-xs">
                      <p className="font-mono font-bold uppercase tracking-widest text-text-ghost">
                        Expected / variance
                      </p>
                      <p className="font-semibold text-foreground">
                        {systemQuantity.toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })}{" "}
                        {uom}
                      </p>
                      <p
                        className={`font-semibold ${
                          varianceImpact > 0
                            ? "text-status-critical-text"
                            : varianceImpact < 0
                              ? "text-accent"
                              : "text-text-muted"
                        }`}
                      >
                        {hasCount
                          ? `${varianceQuantity.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })} ${uom} / ${formatSignedCurrency(varianceImpact)}`
                          : "Enter count"}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={stockCountRows.length === 1}
                      onClick={() =>
                        setStockCountRows((currentRows) =>
                          currentRows.filter((currentRow) => currentRow.id !== row.id),
                        )
                      }
                      className={secondaryButtonClass}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-3 rounded-sm border border-border-system bg-card p-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Estimated variance before Finance approval
                </p>
                <p
                  className={`mt-1 font-mono text-lg font-semibold ${
                    estimatedStockCountVariance > 0
                      ? "text-status-critical-text"
                      : estimatedStockCountVariance < 0
                        ? "text-accent"
                        : "text-foreground"
                  }`}
                >
                  {formatSignedCurrency(estimatedStockCountVariance)}
                </p>
              </div>
              <p className="text-xs font-semibold leading-5 text-text-muted">
                This preview becomes official only after Finance approves the
                count and confirms all receipts, issues, and production movement
                are posted.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() =>
                  setStockCountRows((currentRows) => [
                    ...currentRows,
                    {
                      id: `stock-count-line-${Date.now()}`,
                      inventoryItemId: "",
                      countedQuantity: "",
                    },
                  ])
                }
                className={secondaryButtonClass}
              >
                Add line
              </button>
              <button
                type="submit"
                disabled={
                  stockCountSaving ||
                  !canRecordOperations ||
                  !stockControlLocationId ||
                  stockControlInventoryItems.length === 0
                }
                className={primaryButtonClass}
              >
                Submit count to Finance
              </button>
            </div>
          </form>

          <div className={`${showStockCountWorkspace ? "" : "hidden"} mt-5 ${ledgerFrameClass}`}>
            <div className={`${ledgerColumnHeaderClass} grid-cols-[minmax(0,1fr)_140px_160px]`}>
              <span>Item</span>
              <span>Variance</span>
              <span>Impact</span>
            </div>
            {stockVarianceHistory.length > 0 ? (
              stockVarianceHistory.slice(0, 6).map((row) => {
                const impactClass =
                  row.hard_currency_impact > 0
                    ? "font-semibold text-status-critical-text"
                    : row.hard_currency_impact < 0
                      ? "font-semibold text-accent"
                      : "font-semibold text-foreground";

                return (
                  <div
                    key={`${row.stock_count_id}-${row.ingredient_name}`}
                    className="grid gap-3 border-t border-border-system px-5 py-4 text-sm text-text-muted lg:grid-cols-[minmax(0,1fr)_140px_160px] lg:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {row.ingredient_name}
                      </p>
                      <p className="text-xs text-text-ghost">
                        Counted {row.counted_qty.toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })}{" "}
                        of {row.system_qty.toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })}{" "}
                        {row.uom ?? "unit"}
                      </p>
                    </div>
                    <span className="font-semibold text-foreground">
                      <span className="mr-2 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:hidden">
                        Variance
                      </span>
                      {row.variance_qty.toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })}
                    </span>
                    <span className={impactClass}>
                      <span className="mr-2 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:hidden">
                        Impact
                      </span>
                      {organization.local_currency}{" "}
                      {row.hard_currency_impact.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="border-t border-border-system px-4 py-4 text-sm text-text-muted">
                No stock count variance yet.
              </p>
            )}
          </div>
        </section>
      </div>

      <section
        id="waste"
        className={`${showOperationsSection && isSectionActive("waste") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Waste Variance Intelligence
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Waste Event Isolation
            </h2>
          </div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            {wasteExposureRows.length.toLocaleString()} exposure
            {wasteExposureRows.length === 1 ? "" : "s"} logged
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricPill
            label="Waste cost"
            value={`${organization.local_currency} ${directWasteImpact.toLocaleString(
              undefined,
              { maximumFractionDigits: 2 },
            )}`}
            valueClassName={
              directWasteImpact > 0
                ? "font-semibold text-status-critical-text"
                : "font-semibold text-foreground"
            }
          />
          <MetricPill
            label="Events"
            value={wasteExposureRows.length.toLocaleString()}
          />
          <MetricPill
            label="Top reason"
            value={
              wasteByReason[0]
                ? wasteByReason[0].name.replaceAll("_", " ")
                : "N/A"
            }
          />
          <MetricPill
            label="Top stage"
            value={
              wasteByStage[0] ? wasteByStage[0].name.replaceAll("_", " ") : "N/A"
            }
          />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <form
            onSubmit={handleWasteEventFormSubmit}
            className="grid content-start gap-3 rounded-sm border border-border-system bg-background p-4"
          >
            <div>
              <p className="font-semibold text-foreground">
                Record waste vector
              </p>
              <p className="mt-1 text-xs font-semibold text-text-muted">
                Select the SKU at the exact storage location where the waste
                happened.
              </p>
            </div>
            <select
              name="waste_inventory_item_id"
              required
              className={formControlClass}
            >
              <option value="">Item / storage location</option>
              {activeInventoryItems.map((item) => {
                const itemLocation = activeLocations.find(
                  (location) =>
                    extractUuid(location.id) === extractUuid(item.location_id),
                );
                const itemUom = item.on_hand_uom ?? item.base_uom ?? "unit";

                return (
                  <option key={extractUuid(item.id)} value={extractUuid(item.id)}>
                    {item.name ?? "Unnamed item"} /{" "}
                    {itemLocation?.name ?? "Unassigned location"} /{" "}
                    {Number(item.on_hand_qty ?? 0).toLocaleString(undefined, {
                      maximumFractionDigits: 3,
                    })}{" "}
                    {itemUom}
                  </option>
                );
              })}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                name="waste_quantity"
                type="number"
                min="0.000001"
                step="any"
                placeholder="Quantity wasted"
                required
                className={formControlClass}
              />
              <select
                name="waste_reason"
                defaultValue="spoilage"
                className={formControlClass}
              >
                <option value="spoilage">Spoilage</option>
                <option value="prep_trim">Prep trim</option>
                <option value="overproduction">Overproduction</option>
                <option value="expired">Expired</option>
                <option value="quality_reject">Quality reject</option>
                <option value="dropped">Dropped</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                name="waste_stage"
                defaultValue="prep"
                className={formControlClass}
              >
                <option value="receiving">Receiving</option>
                <option value="storage">Storage</option>
                <option value="prep">Prep</option>
                <option value="cooking">Cooking</option>
                <option value="holding">Holding</option>
                <option value="service">Service</option>
                <option value="transfer">Transfer</option>
              </select>
              <input
                name="waste_notes"
                placeholder="Notes"
                className={formControlClass}
              />
            </div>
            <button
              type="submit"
              disabled={
                wasteSaving ||
                !canRecordOperations ||
                activeInventoryItems.length === 0
              }
              className={primaryButtonClass}
            >
              {wasteSaving ? "Recording..." : "Log waste vector"}
            </button>
          </form>

          <div className="grid content-start gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-sm border border-border-system bg-background p-4">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Reasons
                </p>
                <div className="mt-3 grid gap-2">
                  {wasteByReason.length > 0 ? (
                    wasteByReason.slice(0, 4).map((reason) => (
                      <MetricPill
                        key={reason.name}
                        label={reason.name.replaceAll("_", " ")}
                        value={`${organization.local_currency} ${reason.cost.toLocaleString(
                          undefined,
                          { maximumFractionDigits: 2 },
                        )}`}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-text-muted">
                      Waste reasons will appear after the first event.
                    </p>
                  )}
                </div>
              </div>
              <div className="rounded-sm border border-border-system bg-background p-4">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Stages
                </p>
                <div className="mt-3 grid gap-2">
                  {wasteByStage.length > 0 ? (
                    wasteByStage.slice(0, 4).map((stage) => (
                      <MetricPill
                        key={stage.name}
                        label={stage.name.replaceAll("_", " ")}
                        value={`${stage.count.toLocaleString()} event${
                          stage.count === 1 ? "" : "s"
                        }`}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-text-muted">
                      Waste stages will appear after the first event.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-sm border border-border-system bg-background">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-system px-5 py-4">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Waste Ledger
              </p>
              <h3 className="mt-1 text-lg font-semibold text-foreground">
                Waste History
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowWasteTable((isVisible) => !isVisible)}
              aria-expanded={showWasteTable}
              className="flex h-10 w-10 items-center justify-center rounded-sm border border-border-system bg-card text-xl font-semibold text-foreground transition hover:border-border-system-hover"
            >
              {showWasteTable ? "-" : "+"}
            </button>
          </div>

          {showWasteTable ? (
            <div>
              <div className="hidden grid-cols-[0.85fr_1fr_0.55fr_0.75fr_0.65fr_0.65fr_1fr] gap-4 border-b border-border-system bg-card px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:grid">
                <span>Recorded</span>
                <span>Item</span>
                <span>Qty</span>
                <span>Reason</span>
                <span>Stage</span>
                <span>Cost</span>
                <span>Notes</span>
              </div>

              {wasteExposureRows.length > 0 ? (
                wasteExposureRows.slice(0, 18).map((row) => (
                  <div
                    key={row.waste_event_id}
                    className="grid gap-3 border-t border-border-system px-5 py-4 text-sm text-text-muted lg:grid-cols-[0.85fr_1fr_0.55fr_0.75fr_0.65fr_0.65fr_1fr] lg:items-center"
                  >
                    <Cell label="Recorded">
                      {row.created_at
                        ? new Date(row.created_at).toLocaleString()
                        : "Recorded"}
                    </Cell>
                    <Cell label="Item" strong>
                      {row.ingredient_name}
                    </Cell>
                    <Cell label="Qty">
                      {row.quantity.toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })}{" "}
                      {row.uom ?? "unit"}
                    </Cell>
                    <Cell label="Reason">
                      {row.waste_reason.replaceAll("_", " ")}
                    </Cell>
                    <Cell label="Stage">
                      {row.waste_stage.replaceAll("_", " ")}
                    </Cell>
                    <Cell
                      label="Cost"
                      className="font-semibold text-status-critical-text"
                    >
                      {organization.local_currency}{" "}
                      {row.waste_cost.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </Cell>
                    <Cell label="Notes">{row.notes || "-"}</Cell>
                  </div>
                ))
              ) : (
                <p className="border-t border-border-system px-5 py-5 text-sm text-text-muted">
                  No waste event recorded yet.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <section
        id="recipes"
        className={`${showMasterDataSection && isSectionActive("recipes") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-system pb-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Recipe Costs
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Recipe Catalog
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-sm border border-border-system bg-background px-3 py-2">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Sub-recipes
              </p>
              <p className="font-semibold text-foreground">
                {activeSubRecipes.length}
              </p>
            </div>
            <div className="rounded-sm border border-border-system bg-background px-3 py-2">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Menu items
              </p>
              <p className="font-semibold text-foreground">
                {activeFinalMenuItems.length}
              </p>
            </div>
            <div className="rounded-sm border border-border-system bg-background px-3 py-2">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Components
              </p>
              <p className="font-semibold text-foreground">
                {recipeComponents.length}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            <form
              onSubmit={onCreateRecipe}
              className="grid gap-3 rounded-sm border border-border-system bg-background p-4 sm:grid-cols-2 xl:grid-cols-1"
            >
              <input
                name="name"
                placeholder="Recipe name"
                required
                className={formControlClass}
              />
              <select
                name="recipe_type"
                defaultValue="sub_recipe"
                className={formControlClass}
              >
                <option value="sub_recipe">Sub-recipe</option>
                {canManageCosting ? (
                  <option value="final_dish">Final menu item</option>
                ) : null}
              </select>
              <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Output UOM
                <input
                  name="output_uom"
                  placeholder="kg, portion, ml"
                  defaultValue="kg"
                  className={formControlClass}
                />
              </label>
              <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Output qty per batch
                <input
                  name="standard_batch_output_qty"
                  type="number"
                  min="0.000001"
                  step="any"
                  placeholder="Batch output"
                  defaultValue="1"
                  className={formControlClass}
                />
              </label>
              <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Yield decimal
                <input
                  name="standard_yield_pct"
                  type="number"
                  min="0.01"
                  max="1"
                  step="0.01"
                  defaultValue="1"
                  aria-label="Standard yield percentage as a decimal"
                  className={formControlClass}
                />
              </label>
              <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Selling price
                <input
                  name="selling_price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Sell price"
                  defaultValue="0"
                  aria-label="Selling price"
                  disabled={!canManageCosting}
                  className={formControlClass}
                />
              </label>
              {!canManageCosting ? (
                <p className="text-xs font-semibold leading-5 text-text-muted sm:col-span-2 xl:col-span-1">
                  Kitchen and bar teams can create sub-recipes here. Final menu
                  items and selling prices stay with costing/finance.
                </p>
              ) : null}
              <button
                type="submit"
                disabled={recipeSaving || !canAuthorSubRecipes}
                className={`${primaryButtonClass} sm:col-span-2 xl:col-span-1`}
              >
                Create recipe
              </button>
            </form>

            <form
              onSubmit={onAddRecipeComponent}
              className="grid gap-3 rounded-sm border border-border-system bg-background p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">
                    Component chain
                  </p>
                </div>
              </div>
              <input
                type="hidden"
                name="component_lines"
                value={JSON.stringify(componentLinesPayload)}
              />
              <select
                name="recipe_id"
                required
                className={formControlClass}
              >
                <option value="">Recipe</option>
                {authorableRecipeComponentTargets.map((recipe) => (
                  <option key={getRecipeId(recipe)} value={getRecipeId(recipe)}>
                    {recipe.name}
                  </option>
                ))}
              </select>

              <div className="grid gap-2">
                {componentInputRows.map((row, index) => {
                  const selectedComponentItem = recipeComponentInventoryItems.find(
                    (item) =>
                      extractUuid(item.id) === extractUuid(row.inventoryItemId),
                  );
                  const selectedComponentUom =
                    selectedComponentItem?.recipe_uom ??
                    selectedComponentItem?.base_uom ??
                    selectedComponentItem?.on_hand_uom ??
                    "unit";
                  const selectedYieldPct = Math.max(
                    Number(selectedComponentItem?.yield_pct ?? 1) || 1,
                    0.0001,
                  );
                  const netQuantity = Number(row.quantity) || 0;
                  const grossQuantity = netQuantity / selectedYieldPct;

                  return (
                    <div
                      key={row.id}
                      className="grid gap-3 sm:grid-cols-[1fr_0.5fr_auto] xl:grid-cols-1"
                    >
                    <select
                      value={row.inventoryItemId}
                      onChange={(event) =>
                        setComponentInputRows((currentRows) =>
                          currentRows.map((currentRow) =>
                            currentRow.id === row.id
                              ? {
                                  ...currentRow,
                                  inventoryItemId: extractUuid(event.target.value),
                                }
                              : currentRow,
                          ),
                        )
                      }
                      required
                      className={formControlClass}
                    >
                      <option value="">Ingredient</option>
                      {recipeComponentInventoryItems.map((item) => {
                        const itemUom =
                          item.recipe_uom ??
                          item.base_uom ??
                          item.on_hand_uom ??
                          "unit";

                        return (
                          <option
                            key={extractUuid(item.id)}
                            value={extractUuid(item.id)}
                          >
                            {item.name ?? "Unnamed item"} / {itemUom}
                          </option>
                        );
                      })}
                    </select>
                    <label className="grid gap-1 text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Net qty used ({selectedComponentUom})
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder={`Qty in ${selectedComponentUom}`}
                        value={row.quantity}
                        onChange={(event) =>
                          setComponentInputRows((currentRows) =>
                            currentRows.map((currentRow) =>
                              currentRow.id === row.id
                                ? { ...currentRow, quantity: event.target.value }
                                : currentRow,
                            ),
                          )
                        }
                        required
                        className={formControlClass}
                      />
                      {selectedComponentItem ? (
                        <span className="text-[11px] normal-case leading-5 tracking-normal text-text-muted">
                          Gross draw: {grossQuantity.toLocaleString(undefined, {
                            maximumFractionDigits: 4,
                          })}{" "}
                          {selectedComponentUom} at{" "}
                          {Math.round(selectedYieldPct * 100)}% yield
                        </span>
                      ) : null}
                    </label>
                    <button
                      type="button"
                      disabled={componentInputRows.length === 1}
                      onClick={() =>
                        setComponentInputRows((currentRows) =>
                          currentRows.filter(
                            (currentRow) => currentRow.id !== row.id,
                          ),
                        )
                      }
                      className={secondaryButtonClass}
                    >
                      Remove
                    </button>
                    {index === componentInputRows.length - 1 ? null : null}
                  </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setComponentInputRows((currentRows) => [
                      ...currentRows,
                      {
                        id: `component-line-${Date.now()}`,
                        inventoryItemId: "",
                        quantity: "",
                      },
                    ])
                  }
                  className={secondaryButtonClass}
                >
                  Add line
                </button>
                <button
                  type="submit"
                  disabled={
                    recipeSaving ||
                    !canAuthorSubRecipes ||
                    authorableRecipeComponentTargets.length === 0 ||
                    recipeComponentInventoryItems.length === 0
                  }
                  className={primaryButtonClass}
                >
                  Attach component chain
                </button>
              </div>
            </form>
          </div>

          <div className="rounded-sm border border-border-system bg-card shadow-2xl shadow-black/20">
            <div className="lg:min-w-[900px]">
              <div className="hidden grid-cols-[1.1fr_0.65fr_0.55fr_0.7fr_1.2fr] gap-4 border-b border-border-system bg-background px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:grid">
                <span>Recipe</span>
                <span>Type</span>
                <span>Cost</span>
                <span>Sell price</span>
                <span>Components</span>
              </div>

              {recipes.length > 0 ? (
                recipes.map((recipe) => {
                  const recipeFamilyIds = activeRecipes
                    .filter(
                      (activeRecipe) =>
                        activeRecipe.recipe_type === recipe.recipe_type &&
                        activeRecipe.name.trim().toLowerCase() ===
                          recipe.name.trim().toLowerCase(),
                    )
                    .map(getRecipeId);

                  return (
                    <RecipeRow
                      key={getRecipeId(recipe)}
                      recipe={recipe}
                      components={dedupeRecipeComponentsByIngredient(
                        recipeComponents.filter((component) =>
                          recipeFamilyIds.includes(
                            extractUuid(component.recipe_id),
                          ),
                        ),
                      )}
                      inventoryItems={inventoryItems}
                      currency={organization.local_currency}
                      disabled={recipeSaving || !canManageCosting}
                      onUpdateRecipeDetails={onUpdateRecipeDetails}
                      onUpdateRecipeComponentQuantity={
                        onUpdateRecipeComponentQuantity
                      }
                    />
                  );
                })
              ) : (
                <p className="px-5 py-6 text-sm text-text-muted">
                  No recipe exists yet. Create a recipe, then attach ingredients.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section
        id="production-plan"
        className={`${showProductionPlanningSection && isSectionActive("production-plan") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="flex flex-col gap-4 border-b border-border-system pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Kitchen Demand Planning
            </p>
            <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
              Production Planning
            </h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold text-text-muted">
              Plan recipe output, then convert recipes into ingredient demand, shortages, and estimated cost before requisition or purchase decisions.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[520px]">
            <div className="rounded-sm border border-border-system bg-background px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Planned recipes
              </p>
              <p className="mt-1 text-xl font-semibold text-foreground">
                {validProductionPlanRows.length.toLocaleString()}
              </p>
            </div>
            <div className="rounded-sm border border-border-system bg-background px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Short items
              </p>
              <p
                className={`mt-1 text-xl font-semibold ${
                  productionPlanShortageCount > 0
                    ? "text-status-attention-text"
                    : "text-accent"
                }`}
              >
                {productionPlanShortageCount.toLocaleString()}
              </p>
            </div>
            <div className="rounded-sm border border-border-system bg-background px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Plan cost
              </p>
              <p className="mt-1 text-xl font-semibold text-foreground">
                {formatCurrencyAmount(
                  organization.local_currency,
                  productionPlanEstimatedCost,
                  0,
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 rounded-sm border border-border-system bg-background p-4">
          {productionPlanRows.map((row, index) => (
            <div
              key={row.id}
              className="grid gap-3 md:grid-cols-[1fr_0.45fr_auto]"
            >
              <select
                value={row.recipeId}
                onChange={(event) =>
                  setProductionPlanRows((currentRows) =>
                    currentRows.map((currentRow) =>
                      currentRow.id === row.id
                        ? { ...currentRow, recipeId: event.target.value }
                        : currentRow,
                    ),
                  )
                }
                className={formControlClass}
                aria-label={`Production recipe ${index + 1}`}
              >
                <option value="">Recipe or sub-recipe</option>
                {productionPlanRecipeOptions.map((recipe) => (
                  <option key={getRecipeId(recipe)} value={getRecipeId(recipe)}>
                    {recipe.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="any"
                value={row.targetOutputQty}
                placeholder="Target output"
                onChange={(event) =>
                  setProductionPlanRows((currentRows) =>
                    currentRows.map((currentRow) =>
                      currentRow.id === row.id
                        ? { ...currentRow, targetOutputQty: event.target.value }
                        : currentRow,
                    ),
                  )
                }
                className={formControlClass}
                aria-label={`Target output ${index + 1}`}
              />
              <button
                type="button"
                onClick={() =>
                  setProductionPlanRows((currentRows) =>
                    currentRows.length === 1
                      ? [
                          {
                            id: "production-plan-line-1",
                            recipeId: "",
                            targetOutputQty: "",
                          },
                        ]
                      : currentRows.filter(
                          (currentRow) => currentRow.id !== row.id,
                        ),
                  )
                }
                disabled={productionPlanRows.length === 1}
                className={secondaryButtonClass}
              >
                Remove
              </button>
            </div>
          ))}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() =>
                setProductionPlanRows((currentRows) => [
                  ...currentRows,
                  {
                    id: `production-plan-line-${Date.now()}`,
                    recipeId: "",
                    targetOutputQty: "",
                  },
                ])
              }
              className={secondaryButtonClass}
            >
              Add planned recipe
            </button>
            <button
              type="button"
              onClick={() =>
                setProductionPlanRows([
                  {
                    id: "production-plan-line-1",
                    recipeId: "",
                    targetOutputQty: "",
                  },
                ])
              }
              className={secondaryButtonClass}
            >
              Clear plan
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 rounded-sm border border-border-system bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Kitchen requisition handoff
              </p>
              <h3 className="mt-1 text-base font-semibold text-foreground">
                Convert plan to editable requisition
              </h3>
            </div>
            <span
              className={`rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                canConvertProductionPlanToRequisition
                  ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                  : "border-status-attention-border bg-status-attention-bg text-status-attention-text"
              }`}
            >
              {productionPlanRequisitionDraftLines.length.toLocaleString()} line
              {productionPlanRequisitionDraftLines.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(220px,0.55fr)_auto]">
            <select
              value={productionPlanRequisitionFromLocationId}
              onChange={(event) =>
                setProductionPlanRequisitionFromLocationId(event.target.value)
              }
              className={formControlClass}
              aria-label="Production requisition issuing location"
            >
              <option value="">Issuing store / kitchen source</option>
              {requisitionSourceLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} / {location.inventory_domain}
                </option>
              ))}
            </select>
            <select
              value={productionPlanRequisitionToLocationId}
              onChange={(event) =>
                setProductionPlanRequisitionToLocationId(event.target.value)
              }
              className={formControlClass}
              aria-label="Production requisition receiving location"
            >
              <option value="">Receiving kitchen / front house</option>
              {requisitionDestinationLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            <select
              value={productionPlanRequisitionMode}
              onChange={(event) =>
                setProductionPlanRequisitionMode(
                  event.target.value as ProductionPlanRequisitionMode,
                )
              }
              className={formControlClass}
              aria-label="Production requisition quantity basis"
            >
              <option value="required">Request full required qty</option>
              <option value="shortage">Request shortage only</option>
            </select>
            <button
              type="button"
              disabled={!canConvertProductionPlanToRequisition}
              onClick={handleConvertProductionPlanToRequisition}
              className={primaryButtonClass}
            >
              Create requisition
            </button>
          </div>

          {productionPlanUnmatchedRequisitionCount > 0 ? (
            <p className="rounded-sm border border-status-attention-border bg-status-attention-bg px-3 py-2 text-xs font-semibold text-status-attention-text">
              {productionPlanUnmatchedRequisitionCount.toLocaleString()} plan item
              {productionPlanUnmatchedRequisitionCount === 1 ? "" : "s"} need
              a matching SKU at the selected issuing location.
            </p>
          ) : null}
          {productionPlanRequisitionNotice ? (
            <p className="rounded-sm border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-semibold text-status-info-text">
              {productionPlanRequisitionNotice}
            </p>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 lg:hidden">
          {productionPlanRequirements.length > 0 ? (
            productionPlanRequirements.map((requirement) => (
              <article
                key={`mobile-${requirement.id}`}
                className="rounded-sm border border-border-system bg-background p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {requirement.ingredientName}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-text-ghost">
                      {requirement.uom}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                      requirement.shortageQty > 0
                        ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                        : "border-accent-muted-border bg-accent-muted-bg text-accent"
                    }`}
                  >
                    {requirement.shortageQty > 0 ? "Short" : "Covered"}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-sm border border-border-system bg-card p-3">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Required
                    </p>
                    <p className="mt-1 font-semibold text-foreground">
                      {requirement.requiredQty.toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })}
                    </p>
                  </div>
                  <div className="rounded-sm border border-border-system bg-card p-3">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      On hand
                    </p>
                    <p className="mt-1 font-semibold text-foreground">
                      {requirement.onHandQty.toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })}
                    </p>
                  </div>
                  <div className="rounded-sm border border-border-system bg-card p-3">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Shortage
                    </p>
                    <p
                      className={`mt-1 font-semibold ${
                        requirement.shortageQty > 0
                          ? "text-status-attention-text"
                          : "text-accent"
                      }`}
                    >
                      {requirement.shortageQty.toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })}
                    </p>
                  </div>
                  <div className="rounded-sm border border-border-system bg-card p-3">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Est. cost
                    </p>
                    <p className="mt-1 font-semibold text-foreground">
                      {formatCurrencyAmount(
                        organization.local_currency,
                        requirement.estimatedCost,
                        0,
                      )}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs font-semibold leading-5 text-text-ghost">
                  Plan source: {requirement.sourceRecipes.join(", ")}
                </p>
              </article>
            ))
          ) : (
            <p className="rounded-sm border border-border-system bg-background px-5 py-6 text-sm text-text-muted">
              Select one or more recipes and target outputs to generate ingredient demand.
            </p>
          )}
        </div>

        <div className="mt-5 hidden overflow-x-auto rounded-sm border border-border-system bg-background lg:block">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[1.15fr_0.6fr_0.6fr_0.6fr_0.65fr_1fr] gap-4 border-b border-border-system px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              <span>Ingredient</span>
              <span>Required</span>
              <span>On hand</span>
              <span>Shortage</span>
              <span>Est. cost</span>
              <span>Plan source</span>
            </div>

            {productionPlanRequirements.length > 0 ? (
              productionPlanRequirements.map((requirement) => (
                <div
                  key={requirement.id}
                  className="grid grid-cols-[1.15fr_0.6fr_0.6fr_0.6fr_0.65fr_1fr] items-center gap-4 border-t border-border-system px-5 py-3 text-sm text-text-muted"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">
                      {requirement.ingredientName}
                    </p>
                    <p className="text-xs text-text-ghost">{requirement.uom}</p>
                  </div>
                  <span className="font-semibold text-foreground">
                    {requirement.requiredQty.toLocaleString(undefined, {
                      maximumFractionDigits: 3,
                    })}
                  </span>
                  <span className="font-semibold text-text-muted">
                    {requirement.onHandQty.toLocaleString(undefined, {
                      maximumFractionDigits: 3,
                    })}
                  </span>
                  <span
                    className={
                      requirement.shortageQty > 0
                        ? "font-semibold text-status-attention-text"
                        : "font-semibold text-accent"
                    }
                  >
                    {requirement.shortageQty.toLocaleString(undefined, {
                      maximumFractionDigits: 3,
                    })}
                  </span>
                  <span className="font-semibold text-foreground">
                    {formatCurrencyAmount(
                      organization.local_currency,
                      requirement.estimatedCost,
                      0,
                    )}
                  </span>
                  <span className="truncate text-xs font-semibold text-text-ghost">
                    {requirement.sourceRecipes.join(", ")}
                  </span>
                </div>
              ))
            ) : (
              <p className="px-5 py-6 text-sm text-text-muted">
                Select one or more recipes and target outputs to generate ingredient demand.
              </p>
            )}
          </div>
        </div>

        {productionPlanShortageValue > 0 ? (
          <p className="mt-4 rounded-sm border border-status-attention-border bg-status-attention-bg px-4 py-3 text-sm font-semibold text-status-attention-text">
            Shortage exposure:{" "}
            {formatCurrencyAmount(
              organization.local_currency,
              productionPlanShortageValue,
              0,
            )}
            . Use these rows to guide kitchen requisitions and procurement follow-up.
          </p>
        ) : productionPlanRequirements.length > 0 ? (
          <p className="mt-4 rounded-sm border border-accent-muted-border bg-accent-muted-bg px-4 py-3 text-sm font-semibold text-accent">
            Next step: stock can cover this plan. Move to Production Ledger to
            log the run, or raise a transfer requisition if the ingredients are
            held in another storage location.
          </p>
        ) : (
          <p className="mt-4 rounded-sm border border-border-system bg-background px-4 py-3 text-sm font-semibold text-text-muted">
            Next step: select recipes and target output. ProfitPlate will show
            whether to raise a requisition, transfer request, or proceed to
            production logging.
          </p>
        )}
      </section>

      <section
        id="ledger"
        className={`${showProductionLedgerSection && isSectionActive("ledger") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="border-b border-border-system pb-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            Production Ledger
          </p>
          <h2 className="mt-1 font-serif text-2xl font-normal text-foreground">
            Production Yield Runs
          </h2>
        </div>

        <form
          onSubmit={handleProductionFormSubmit}
          className="mt-5 grid gap-4 rounded-sm border border-border-system bg-background p-4"
        >
          <div className="grid gap-3 md:grid-cols-[1fr_0.55fr_auto]">
            <select
              name="production_recipe_id"
              value={selectedProductionRecipeId}
              onChange={(event) => {
                setSelectedProductionRecipeId(event.target.value);
                setActualProductionInputs({});
              }}
              required
              className={formControlClass}
            >
              <option value="">Production item</option>
              {productionRunRecipeOptions.map((recipe) => (
                <option key={getRecipeId(recipe)} value={getRecipeId(recipe)}>
                  {recipe.name}{" "}
                  {recipe.recipe_type === "sub_recipe"
                    ? "(Sub-recipe)"
                    : "(Final menu item)"}
                </option>
              ))}
            </select>
            <input
              name="target_output_qty"
              type="number"
              min="0"
              step="any"
              placeholder="Actual output produced"
              value={targetProductionOutput}
              onChange={(event) => setTargetProductionOutput(event.target.value)}
              required
              className={formControlClass}
            />
            <input type="hidden" name="actual_output_qty" value={targetProductionOutput} />
            <input type="hidden" name="origin" value="kitchen_prep_line" />
            <button
              type="submit"
              disabled={!canRecordProduction}
              className={primaryButtonClass}
            >
              Log production run
            </button>
          </div>

          <div className="rounded-sm border border-border-system bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  More production lines
                </p>
                <p className="mt-1 text-sm text-text-muted">
                  Add other final menu items or sub-recipes produced in this
                  kitchen session. Extra lines use standard recipe usage; keep
                  the first line for detailed actual-usage variance.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setAdditionalProductionRunRows((currentRows) => [
                    ...currentRows,
                    {
                      id: `production-run-line-${Date.now()}`,
                      recipeId: "",
                      targetOutputQty: "",
                    },
                  ])
                }
                className={secondaryButtonClass}
              >
                Add production line
              </button>
            </div>

            {additionalProductionRunRows.length > 0 ? (
              <div className="mt-4 grid gap-3">
                {additionalProductionRunRows.map((row, index) => (
                  <div
                    key={row.id}
                    className="grid gap-3 md:grid-cols-[1fr_0.45fr_auto]"
                  >
                    <select
                      value={row.recipeId}
                      onChange={(event) =>
                        setAdditionalProductionRunRows((currentRows) =>
                          currentRows.map((currentRow) =>
                            currentRow.id === row.id
                              ? { ...currentRow, recipeId: event.target.value }
                              : currentRow,
                          ),
                        )
                      }
                      className={formControlClass}
                      aria-label={`Additional production item ${index + 1}`}
                    >
                      <option value="">Additional production item</option>
                      {productionRunRecipeOptions.map((recipe) => (
                        <option
                          key={`extra-production-${row.id}-${getRecipeId(recipe)}`}
                          value={getRecipeId(recipe)}
                        >
                          {recipe.name}{" "}
                          {recipe.recipe_type === "sub_recipe"
                            ? "(Sub-recipe)"
                            : "(Final menu item)"}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={row.targetOutputQty}
                      placeholder="Output produced"
                      onChange={(event) =>
                        setAdditionalProductionRunRows((currentRows) =>
                          currentRows.map((currentRow) =>
                            currentRow.id === row.id
                              ? {
                                  ...currentRow,
                                  targetOutputQty: event.target.value,
                                }
                              : currentRow,
                          ),
                        )
                      }
                      className={formControlClass}
                      aria-label={`Additional output produced ${index + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setAdditionalProductionRunRows((currentRows) =>
                          currentRows.filter(
                            (currentRow) => currentRow.id !== row.id,
                          ),
                        )
                      }
                      className={secondaryButtonClass}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {hasInvalidAdditionalProductionRunLine ? (
              <p className="mt-3 rounded-sm border border-status-attention-border bg-status-attention-bg px-4 py-3 text-sm font-semibold text-status-attention-text">
                Complete or remove every additional production line before
                logging the batch.
              </p>
            ) : null}
          </div>

          {selectedProductionIsFinalMenu ? (
            <div className="grid gap-3 rounded-sm border border-status-info-border bg-status-info-bg p-4 md:grid-cols-[0.8fr_1.2fr] md:items-start">
              <div className="rounded-sm border border-status-info-border bg-card/80 px-4 py-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Auto destination
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {selectedProductionOutputLocation?.name ?? "Front Counter not set"}
                </p>
                <p className="mt-1 text-xs font-semibold text-text-muted">
                  Final menu production lands in sales outlet stock.
                </p>
              </div>
              <div className="text-sm leading-6 text-status-info-text">
                <p className="font-semibold text-foreground">
                  QSR finished-goods run
                </p>
                <p>
                  ProfitPlate will credit the produced quantity as manufactured
                  final-product stock in{" "}
                  {selectedProductionOutputLocation?.name ??
                    "Front Counter"}
                  . POS sales can then deplete it 1-to-1.
                </p>
              </div>
              {salesOutletLocations.length === 0 ? (
                <div className="rounded-sm border border-status-attention-border bg-status-attention-bg px-4 py-3 text-sm font-semibold text-status-attention-text md:col-span-2">
                  No sales outlet/front counter location exists yet. Create one
                  in Operating Setup, then return here to receive finished goods
                  into that counter.
                  <button
                    type="button"
                    onClick={() => openDashboardSection("setup")}
                    className="ml-0 mt-3 block rounded-sm border border-status-attention-border bg-card px-3 py-2 text-xs font-bold text-foreground transition hover:border-border-system-hover sm:ml-3 sm:mt-0 sm:inline-flex"
                  >
                    Create sales outlet
                  </button>
                </div>
              ) : null}
              <input
                type="hidden"
                name="output_location_id_value"
                value={resolvedProductionOutputLocationId}
              />
            </div>
          ) : (
            <input
              type="hidden"
              name="output_location_id_value"
              value=""
            />
          )}

          <input
            type="hidden"
            name="actual_component_usages"
            value={JSON.stringify(actualComponentUsages)}
          />
          <input
            type="hidden"
            name="production_run_lines"
            value={JSON.stringify(productionRunLinePayloads)}
          />

          {selectedProductionRecipe ? (
            <p className="text-sm font-semibold text-text-muted">
              Baseline batch: {selectedRecipeBatchOutput.toLocaleString()}{" "}
              {selectedProductionRecipe.output_uom ?? "unit"}
            </p>
          ) : null}
          {selectedProductionRecipe ? (
            <p className="text-sm leading-6 text-text-muted">
              {selectedProductionIsFinalMenu
                ? "Enter the actual output produced and the raw materials used. ProfitPlate will add finished goods to the selected counter, then POS imports can deplete that final product 1-to-1."
                : "Enter the actual output produced and the actual raw material used. ProfitPlate calculates what that material should have produced, then flags the output gap as production variance."}
            </p>
          ) : null}
          {selectedProductionIsFinalMenu ? (
            <p
              className={`rounded-sm border px-4 py-3 text-sm font-semibold ${
                selectedProductionFinishedGood
                  ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                  : "border-status-attention-border bg-status-attention-bg text-status-attention-text"
              }`}
            >
              {selectedProductionFinishedGood
                ? `Counter SKU ready: ${selectedProductionFinishedGood.name ?? selectedProductionRecipe?.name} has ${Number(
                    selectedProductionFinishedGood.on_hand_qty ?? 0,
                  ).toLocaleString(undefined, {
                    maximumFractionDigits: 3,
                  })} ${selectedProductionFinishedGood.on_hand_uom ?? selectedProductionRecipe?.output_uom ?? "unit"} on hand.`
                : salesOutletLocations.length === 0
                  ? "Create a sales outlet/front counter first. Finished-goods SKUs are created per recipe and per counter location."
                  : !resolvedProductionOutputLocationId
                    ? "Select the counter that will receive this finished good."
                    : "No finished-goods SKU exists yet for this recipe/counter. Recording this run will create it and credit the produced quantity."}
            </p>
          ) : null}

          {selectedProductionRecipe ? (
            <div className="grid gap-3 lg:hidden">
              {productionComponents.length > 0 ? (
                productionComponents.map((component) => {
                  const item = inventoryItems.find(
                    (inventoryItem) =>
                      extractUuid(inventoryItem.id) ===
                      extractUuid(component.component_inventory_item_id),
                  );
                  const ingredientUnitCost = Number(
                    item?.current_cost_per_base_uom ??
                      component.ingredient_unit_cost ??
                      0,
                  );
                  const requiredQty = hasValidTargetOutput
                    ? (component.qty_in_recipe_uom / selectedRecipeBatchOutput) *
                      targetOutputQty
                    : 0;
                  const enteredQty = Number(actualProductionInputs[component.id]);
                  const actualQty =
                    Number.isFinite(enteredQty) && enteredQty >= 0
                      ? enteredQty
                      : 0;
                  const varianceQty = actualQty - requiredQty;
                  const expectedOutputFromActualQty =
                    component.qty_in_recipe_uom > 0
                      ? (actualQty / component.qty_in_recipe_uom) *
                        selectedRecipeBatchOutput
                      : 0;
                  const outputVarianceQty =
                    expectedOutputFromActualQty - targetOutputQty;
                  const currencyImpact = varianceQty * ingredientUnitCost;

                  return (
                    <article
                      key={`mobile-production-${component.id}`}
                      className="rounded-sm border border-border-system bg-card p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">
                            {item?.name ?? component.ingredient_name ?? "Ingredient"}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-text-ghost">
                            {component.recipe_uom}
                          </p>
                        </div>
                        <span
                          className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                            outputVarianceQty > 0
                              ? "border-status-critical-border bg-status-critical-bg text-status-critical-text"
                              : outputVarianceQty < 0
                                ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                                : "border-border-system bg-background text-text-muted"
                          }`}
                        >
                          {outputVarianceQty > 0
                            ? "Over"
                            : outputVarianceQty < 0
                              ? "Under"
                              : "Flat"}
                        </span>
                      </div>
                      <label className="mt-4 block">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                          Actual used
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={actualProductionInputs[component.id] ?? ""}
                          placeholder={requiredQty.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                          onChange={(event) =>
                            setActualProductionInputs((currentInputs) => ({
                              ...currentInputs,
                              [component.id]: event.target.value,
                            }))
                          }
                          className="mt-2 h-11 w-full rounded-sm border border-border-system bg-background px-3 text-base font-semibold text-foreground outline-none transition placeholder:text-text-ghost focus:border-accent focus:ring-2 focus:ring-accent/20"
                          required
                          aria-label={`Actual quantity used for ${
                            item?.name ?? "ingredient"
                          }`}
                        />
                      </label>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-sm border border-border-system bg-background p-3">
                          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                            Standard
                          </p>
                          <p className="mt-1 font-semibold text-foreground">
                            {requiredQty.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}
                          </p>
                        </div>
                        <div className="rounded-sm border border-border-system bg-background p-3">
                          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                            Should output
                          </p>
                          <p
                            className={`mt-1 font-semibold ${
                              outputVarianceQty > 0
                                ? "text-status-critical-text"
                                : outputVarianceQty < 0
                                  ? "text-accent"
                                  : "text-text-muted"
                            }`}
                          >
                            {expectedOutputFromActualQty.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}
                          </p>
                        </div>
                        <div className="rounded-sm border border-border-system bg-background p-3">
                          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                            Output gap
                          </p>
                          <p
                            className={`mt-1 font-semibold ${
                              outputVarianceQty > 0
                                ? "text-status-critical-text"
                                : outputVarianceQty < 0
                                  ? "text-accent"
                                  : "text-text-muted"
                            }`}
                          >
                            {outputVarianceQty.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}
                          </p>
                        </div>
                        <div className="rounded-sm border border-border-system bg-background p-3">
                          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                            Cost impact
                          </p>
                          <p className="mt-1 font-semibold text-foreground">
                            {organization.local_currency}{" "}
                            {currencyImpact.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </p>
                        </div>
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="rounded-sm border border-border-system bg-card px-5 py-6 text-sm text-text-muted">
                  <span
                    className={`${inlineSignalClass} ${inlineSignalToneStyles.info}`}
                  >
                    Attach ingredients
                  </span>{" "}
                  to this production item before recording production.
                </p>
              )}
            </div>
          ) : null}

          {selectedProductionRecipe ? (
            <div className="hidden overflow-x-auto rounded-sm border border-border-system bg-card lg:block">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[1.1fr_0.55fr_0.55fr_0.6fr_0.55fr_0.5fr] items-center gap-4 border-b border-border-system bg-background px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  <span>Ingredient</span>
                  <span>Standard for output</span>
                  <span>Actual used</span>
                  <span>Should output</span>
                  <span>Output gap</span>
                  <span>Cost impact</span>
                </div>

                {productionComponents.length > 0 ? (
                  productionComponents.map((component) => {
                    const item = inventoryItems.find(
                      (inventoryItem) =>
                        extractUuid(inventoryItem.id) ===
                        extractUuid(component.component_inventory_item_id),
                    );
                    const ingredientUnitCost = Number(
                      item?.current_cost_per_base_uom ??
                        component.ingredient_unit_cost ??
                        0,
                    );
                    const requiredQty = hasValidTargetOutput
                      ? (component.qty_in_recipe_uom / selectedRecipeBatchOutput) *
                        targetOutputQty
                      : 0;
                    const enteredQty = Number(actualProductionInputs[component.id]);
                    const actualQty =
                      Number.isFinite(enteredQty) && enteredQty >= 0
                        ? enteredQty
                        : 0;
                    const varianceQty = actualQty - requiredQty;
                    const expectedOutputFromActualQty =
                      component.qty_in_recipe_uom > 0
                        ? (actualQty / component.qty_in_recipe_uom) *
                          selectedRecipeBatchOutput
                        : 0;
                    const outputVarianceQty =
                      expectedOutputFromActualQty - targetOutputQty;
                    const currencyImpact = varianceQty * ingredientUnitCost;

                    return (
                      <div
                        key={component.id}
                        className="grid grid-cols-[1.1fr_0.55fr_0.55fr_0.6fr_0.55fr_0.5fr] items-center gap-4 border-t border-border-system px-5 py-3 text-sm text-text-muted"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">
                            {item?.name ?? component.ingredient_name ?? "Ingredient"}
                          </p>
                          <p className="text-xs text-text-ghost">
                            {component.recipe_uom}
                          </p>
                        </div>
                        <span className="font-semibold text-foreground">
                          {requiredQty.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={actualProductionInputs[component.id] ?? ""}
                          placeholder={requiredQty.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                          onChange={(event) =>
                            setActualProductionInputs((currentInputs) => ({
                              ...currentInputs,
                              [component.id]: event.target.value,
                            }))
                          }
                          className="h-10 rounded-sm border border-border-system bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-text-ghost focus:border-accent focus:ring-2 focus:ring-accent/20"
                          required
                          aria-label={`Actual quantity used for ${
                            item?.name ?? "ingredient"
                          }`}
                        />
                        <span
                          className={
                            outputVarianceQty > 0
                              ? "font-semibold text-status-critical-text"
                              : outputVarianceQty < 0
                                ? "font-semibold text-accent"
                                : "font-semibold text-text-muted"
                          }
                        >
                          {expectedOutputFromActualQty.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                        </span>
                        <span
                          className={
                            outputVarianceQty > 0
                              ? "font-semibold text-status-critical-text"
                              : outputVarianceQty < 0
                                ? "font-semibold text-accent"
                                : "font-semibold text-text-muted"
                          }
                        >
                          {outputVarianceQty.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                        </span>
                        <span className="font-semibold text-foreground">
                          {organization.local_currency}{" "}
                          {currencyImpact.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="px-5 py-6 text-sm text-text-muted">
                    <span
                      className={`${inlineSignalClass} ${inlineSignalToneStyles.info}`}
                    >
                      Attach ingredients
                    </span>{" "}
                    to this production item before recording production.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </form>

      </section>

      <section
        id="pos-mapping"
        className={`${showFinancialSection && isSectionActive("pos-mapping") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              POS / Menu Mapping
            </p>
            <h3 className="mt-1 text-xl font-semibold text-foreground">
              Link POS item names to ProfitPlate final menu items
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted">
              Upload the POS item master once during onboarding, map each POS
              code or sales name to a final menu item, and future POS CSV imports
              will match automatically. Any new POS name later appears as a
              mapping gap before posting sales.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[420px]">
            <MetricPill
              label="Saved mappings"
              value={savedPosMappingCount.toLocaleString()}
            />
            <MetricPill
              label="Rows loaded"
              value={posMappingPreview.length.toLocaleString()}
            />
            <MetricPill
              label="Mapped"
              value={mappedPosMappingRows.length.toLocaleString()}
            />
            <MetricPill
              label="Gaps"
              value={posMappingRowsNeedingWork.length.toLocaleString()}
            />
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="rounded-sm border border-status-info-border bg-status-info-bg p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-status-info-text">
                  Onboarding input
                </p>
                <h4 className="mt-1 font-semibold text-foreground">
                  POS item master list
                </h4>
              </div>
              <label className={secondaryButtonClass}>
                Upload CSV
                <input
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  onChange={handlePosMappingFileChange}
                  disabled={saleSaving}
                  className="sr-only"
                />
              </label>
            </div>
            <textarea
              value={posMappingText}
              onChange={(event) => setPosMappingText(event.target.value)}
              rows={9}
              disabled={saleSaving}
              placeholder={
                "POS Code,POS Item Name\nTRIB3-SEA,Trib3 Seafood Pasta\nMARG-001,Margarita\nASUN-PEN,Asun Rosie Penne"
              }
              className="mt-4 min-h-52 w-full rounded-sm border border-status-info-border bg-card px-3 py-3 text-sm text-foreground outline-none transition placeholder:text-text-ghost focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <div className="mt-3 grid gap-2 text-xs leading-5 text-text-muted sm:grid-cols-3">
              <p>
                <span className="font-bold text-foreground">Code first.</span>{" "}
                PLU/SKU/POS code becomes the stable key when present.
              </p>
              <p>
                <span className="font-bold text-foreground">Name fallback.</span>{" "}
                If no code exists, the POS item name is used.
              </p>
              <p>
                <span className="font-bold text-foreground">One-time save.</span>{" "}
                Saved mappings are reused by every later POS import.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setPosMappingText("")}
                disabled={!posMappingText || saleSaving}
                className={secondaryButtonClass}
              >
                Clear list
              </button>
              <button
                type="button"
                onClick={() => openDashboardSection("sales-pos")}
                className={secondaryButtonClass}
              >
                Go to sales import
              </button>
            </div>
          </div>

          <div className="rounded-sm border border-border-system bg-background">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-system px-4 py-4">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Mapping queue
                </p>
                <h4 className="mt-1 font-semibold text-foreground">
                  Resolve POS names before import
                </h4>
              </div>
              <span
                className={`${inlineSignalClass} ${
                  posMappingRowsNeedingWork.length > 0
                    ? inlineSignalToneStyles.attention
                    : savedPosMappingCount > 0
                      ? inlineSignalToneStyles.healthy
                      : inlineSignalToneStyles.info
                }`}
              >
                {posMappingRowsNeedingWork.length > 0
                  ? `${posMappingRowsNeedingWork.length.toLocaleString()} need mapping`
                  : savedPosMappingCount > 0
                    ? "Ready"
                    : "Awaiting list"}
              </span>
            </div>

            {posMappingPreview.length > 0 ? (
              <div>
                <div className="grid max-h-[520px] gap-3 overflow-auto p-3 lg:hidden">
                  {posMappingPreview.map((row) => (
                    <article
                      key={`mobile-pos-map-${row.id}`}
                      className="rounded-sm border border-border-system bg-card p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                            Row {row.rowNumber}
                          </p>
                          <p className="mt-1 font-semibold text-foreground">
                            {row.posItemLabel || "Blank POS item"}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-text-ghost">
                            Code: {row.posItemCode || "-"}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                            row.status === "mapped"
                              ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                              : "border-status-warning-border bg-status-warning-bg text-status-warning-text"
                          }`}
                        >
                          {row.status === "mapped" ? "Mapped" : "Gap"}
                        </span>
                      </div>
                      <label className="mt-3 block">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                          ProfitPlate menu item
                        </span>
                        <select
                          value={row.recipeId}
                          onChange={(event) =>
                            handlePosMasterMappingChange(row, event.target.value)
                          }
                          disabled={saleSaving || !row.posItemKey}
                          className="mt-2 h-10 w-full rounded-sm border border-border-system bg-background px-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={`Map POS item ${row.posItemLabel || row.rowNumber} to final menu item`}
                        >
                          <option value="">Choose menu item</option>
                          {activeFinalMenuItems.map((recipe) => (
                            <option
                              key={getRecipeId(recipe)}
                              value={getRecipeId(recipe)}
                            >
                              {recipe.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="mt-2 text-xs leading-5 text-text-muted">
                        {row.error ??
                          (row.matchSource === "mapping"
                            ? "Saved POS mapping found."
                            : row.matchSource === "name"
                              ? "Matched by menu item name."
                              : "Choose a final menu item to save this mapping.")}
                      </p>
                    </article>
                  ))}
                </div>

                <div className="hidden max-h-[520px] overflow-auto lg:block">
                  <table className="min-w-full divide-y divide-border-system text-sm">
                    <thead className="bg-card">
                      <tr>
                        {[
                          "Row",
                          "POS item",
                          "POS code",
                          "POS key",
                          "Maps to",
                          "Status",
                        ].map((header) => (
                          <th
                            key={header}
                            className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-text-ghost"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-system">
                      {posMappingPreview.map((row) => (
                        <tr key={row.id} className="align-top">
                          <td className="px-4 py-3 text-text-muted">
                            {row.rowNumber}
                          </td>
                          <td className="max-w-[260px] px-4 py-3">
                            <p className="font-semibold text-foreground">
                              {row.posItemLabel || "Blank POS item"}
                            </p>
                            <p className="mt-1 text-xs text-text-muted">
                              {row.matchSource === "mapping"
                                ? "Saved mapping"
                                : row.matchSource === "name"
                                  ? "Name match"
                                  : "Manual mapping required"}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-text-muted">
                            {row.posItemCode || "-"}
                          </td>
                          <td className="max-w-[180px] px-4 py-3 font-mono text-xs text-text-muted">
                            {row.posItemKey || "-"}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={row.recipeId}
                              onChange={(event) =>
                                handlePosMasterMappingChange(
                                  row,
                                  event.target.value,
                                )
                              }
                              disabled={saleSaving || !row.posItemKey}
                              className="h-9 min-w-[240px] rounded-sm border border-border-system bg-background px-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                              aria-label={`Map POS item ${row.posItemLabel || row.rowNumber} to final menu item`}
                            >
                              <option value="">Choose menu item</option>
                              {activeFinalMenuItems.map((recipe) => (
                                <option
                                  key={getRecipeId(recipe)}
                                  value={getRecipeId(recipe)}
                                >
                                  {recipe.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest ${
                                row.status === "mapped"
                                  ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                                  : "border-status-warning-border bg-status-warning-bg text-status-warning-text"
                              }`}
                            >
                              {row.status === "mapped" ? "Mapped" : "Needs mapping"}
                            </span>
                            <p className="mt-1 text-xs text-text-muted">
                              {row.error ?? (row.matchedRecipeName || "Not saved")}
                            </p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="px-4 py-8 text-sm leading-6 text-text-muted">
                Paste or upload the restaurant POS item master list to begin.
                Existing saved mappings remain active even when this input is
                empty.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 rounded-sm border border-border-system bg-background">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-system px-4 py-4">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Saved mapping register
              </p>
              <h4 className="mt-1 font-semibold text-foreground">
                What future POS imports will use
              </h4>
            </div>
            <button
              type="button"
              onClick={() =>
                downloadCsvReport(
                  `pos-menu-mappings-${reportDateLabel}.csv`,
                  posMappingReportRows,
                )
              }
              className={secondaryButtonClass}
            >
              Download mappings
            </button>
          </div>

          {posSalesItemMappings.length > 0 ? (
            <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
              {posSalesItemMappings.slice(0, 12).map((mapping) => {
                const mappedRecipe = activeRecipesById.get(
                  extractUuid(mapping.recipe_id),
                );

                return (
                  <article
                    key={mapping.id}
                    className="rounded-sm border border-border-system bg-card p-3"
                  >
                    <p className="font-semibold text-foreground">
                      {mapping.pos_item_label}
                    </p>
                    <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      {mapping.pos_item_code || mapping.pos_item_key}
                    </p>
                    <div className="mt-3 rounded-sm border border-accent-muted-border bg-accent-muted-bg px-3 py-2 text-sm font-semibold text-accent">
                      {mappedRecipe?.name ?? "Menu item needs review"}
                    </div>
                  </article>
                );
              })}
              {posSalesItemMappings.length > 12 ? (
                <p className="rounded-sm border border-border-system bg-card p-3 text-sm text-text-muted">
                  Showing 12 of {posSalesItemMappings.length.toLocaleString()} saved
                  mappings. Download the full register for the complete list.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="px-4 py-8 text-sm text-text-muted">
              No POS mappings have been saved yet.
            </p>
          )}
        </div>
      </section>

      <section
        id="sales-pos"
        className={`${showFinancialSection && isSectionActive("sales-pos") ? "" : "hidden"} mt-6 scroll-mt-24 rounded-sm border border-border-system bg-card p-4 shadow-2xl shadow-black/25 sm:p-6`}
      >
        <div>
          <div className="mb-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Sales & POS Simulation
            </p>
            <h3 className="mt-1 text-xl font-semibold text-foreground">
              Record sales, import POS evidence, and review depletion
            </h3>
          </div>

          <div className="mb-5 grid gap-3 rounded-sm border border-status-info-border bg-status-info-bg p-4 text-sm text-status-info-text lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="font-semibold text-foreground">
                Sales capture control: {salesCaptureModeLabel}
              </p>
              <ol className="mt-2 grid gap-2 text-xs leading-5 text-text-muted sm:grid-cols-3">
                <li>
                  <span className="font-bold text-foreground">1.</span>{" "}
                  {salesCaptureMode === "pos_import"
                    ? "Import POS files as the source of sales depletion."
                    : salesCaptureMode === "manual_sales"
                      ? "Record sales manually as the source of sales depletion."
                      : "Use test mode only for demos and controlled validation."}
                </li>
                <li>
                  <span className="font-bold text-foreground">2.</span>{" "}
                  {manualSalesAllowed
                    ? "Manual sale posting is enabled for this workspace."
                    : "Manual sale posting is disabled to avoid double depletion."}
                </li>
                <li>
                  <span className="font-bold text-foreground">3.</span>{" "}
                  {posImportAllowed
                    ? "POS import posting is enabled for this workspace."
                    : "POS import posting is disabled while manual sales mode is active."}
                </li>
              </ol>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openDashboardSection("recipes")}
                className={secondaryButtonClass}
              >
                Set up menu item
              </button>
              <button
                type="button"
                onClick={() => openDashboardSection("overview")}
                className={secondaryButtonClass}
              >
                Review margins
              </button>
            </div>
          </div>

          {activeFinalMenuItems.length === 0 ? (
            <p className="mb-4 rounded-sm border border-border-system bg-background px-4 py-3 text-sm text-text-muted">
              Create an active final menu item, then attach its ingredients or
              manufactured sub-recipe stock before recording sales.
            </p>
          ) : null}

          <form
            onSubmit={handleMenuSaleFormSubmit}
            className="grid gap-4 rounded-sm border border-border-system bg-background p-4"
          >
          <div className="grid gap-3 md:grid-cols-[1fr_0.8fr_0.55fr_auto]">
            <select
              name="sale_recipe_id"
              value={selectedSaleRecipeId}
              onChange={(event) => setSelectedSaleRecipeId(event.target.value)}
              required
              disabled={!manualSalesAllowed || saleSaving}
              className={formControlClass}
            >
              <option value="">Final menu item</option>
              {activeFinalMenuItems.map((recipe) => (
                <option key={getRecipeId(recipe)} value={getRecipeId(recipe)}>
                  {recipe.name}
                </option>
              ))}
            </select>
            <label className="grid gap-1">
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                Stock location to deplete
              </span>
              <select
                name="sale_location_id"
                value={selectedSaleLocationId}
                onChange={(event) => setSelectedSaleLocationId(event.target.value)}
                disabled={!manualSalesAllowed || saleSaving}
                className={formControlClass}
                aria-label="Stock location to deplete for this sale"
              >
                <option value="">Use default depletion routing</option>
                {departmentStockLocations.map((location) => (
                  <option
                    key={extractUuid(location.id)}
                    value={extractUuid(location.id)}
                  >
                    {formatStockLocationOption(location)}
                  </option>
                ))}
              </select>
              <span className="text-[11px] leading-4 text-text-muted">
                Kitchen/Bar here means their stock balance, not the user role.
              </span>
            </label>
            <input
              name="sold_quantity"
              type="number"
              min="0.000001"
              step="any"
              placeholder="Quantity sold"
              value={saleQuantity}
              onChange={(event) => setSaleQuantity(event.target.value)}
              required
              disabled={!manualSalesAllowed || saleSaving}
              className={formControlClass}
            />
            <button
              type="submit"
              disabled={!canRecordSale}
              className={primaryButtonClass}
            >
              Record sale
            </button>
          </div>

          {!manualSalesAllowed ? (
            <p className="rounded-sm border border-status-warning-border bg-status-warning-bg px-4 py-3 text-xs font-semibold text-status-warning-text">
              Manual sales are locked because this workspace is configured for POS
              import depletion. This prevents the same business day from being
              depleted twice.
            </p>
          ) : null}

          {selectedSaleRecipe ? (
            <p className="text-sm font-semibold text-text-muted">
              Sales baseline: {selectedSaleBatchOutput.toLocaleString()}{" "}
              {selectedSaleRecipe.output_uom ?? "unit"}
            </p>
          ) : null}

          {selectedSaleRecipe ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-sm border border-border-system bg-card px-4 py-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Unit price
                </p>
                <p className="mt-1 font-semibold text-foreground">
                  {organization.local_currency}{" "}
                  {Number(selectedSaleRecipe.selling_price ?? 0).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 },
                  )}
                </p>
              </div>
              <div className="rounded-sm border border-border-system bg-card px-4 py-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Revenue
                </p>
                <p className="mt-1 font-semibold text-foreground">
                  {organization.local_currency}{" "}
                  {saleRevenue.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div className="rounded-sm border border-border-system bg-card px-4 py-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Food cost
                </p>
                <p className="mt-1 font-semibold text-foreground">
                  {organization.local_currency}{" "}
                  {saleFoodCost.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div className="rounded-sm border border-border-system bg-card px-4 py-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Margin
                </p>
                <p className="mt-1 font-semibold text-foreground">
                  {saleGrossMarginPct === null
                    ? "N/A"
                    : `${saleGrossMarginPct.toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}%`}
                </p>
              </div>
            </div>
          ) : null}

          {selectedSaleRecipe ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {saleComponents.length > 0 ? (
                saleComponents.map((component) => {
                  const item = resolveInventoryItemForLocation(
                    component.component_inventory_item_id,
                    selectedSaleLocationId,
                    {
                      componentRecipeId: component.component_recipe_id,
                      ingredientName: component.ingredient_name,
                    },
                  );
                  const requiredQty = hasValidSaleQty
                    ? (component.qty_in_recipe_uom / selectedSaleBatchOutput) *
                      saleQty
                    : 0;
                  const unitCost = Number(
                    item?.current_cost_per_base_uom ??
                      component.ingredient_unit_cost ??
                      0,
                  );
                  const costImpact = requiredQty * unitCost;

                  return (
                    <div
                      key={component.id}
                      className="rounded-sm border border-border-system bg-card p-4"
                    >
                      <p className="truncate font-semibold text-foreground">
                        {item?.name ?? component.ingredient_name ?? "Component"}
                      </p>
                      <div className="mt-3 grid gap-2 text-sm">
                        <MetricPill
                          label="Required"
                          value={`${requiredQty.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })} ${component.recipe_uom}`}
                        />
                        <MetricPill
                          label="On hand"
                          value={`${Number(item?.on_hand_qty ?? 0).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 3 },
                          )} ${item?.on_hand_uom ?? item?.base_uom ?? "unit"}`}
                        />
                        <MetricPill
                          label="Cost"
                          value={`${organization.local_currency} ${costImpact.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 2 },
                          )}`}
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="rounded-sm border border-border-system bg-card px-5 py-6 text-sm text-text-muted sm:col-span-2 xl:col-span-3">
                  <span
                    className={`${inlineSignalClass} ${inlineSignalToneStyles.info}`}
                  >
                    Attach ingredients
                  </span>{" "}
                  or sub-recipe stock to this final menu item before recording
                  sales.
                </p>
              )}
            </div>
          ) : null}
          </form>

          <div className="mt-4 rounded-sm border border-status-info-border bg-status-info-bg p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-status-info-text">
                  POS mapping workflow
                </p>
                <h4 className="mt-1 font-semibold text-foreground">
                  How POS sales become reliable AvT
                </h4>
              </div>
              <span className="w-fit rounded-full border border-status-info-border bg-card px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-info-text">
                Finance owned
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {[
                {
                  title: "Import POS file",
                  detail: "Upload or paste the POS export with business date, item code, quantity, and sales value.",
                },
                {
                  title: "Map exceptions",
                  detail: "Rows marked Needs mapping must be connected to a final menu item once; future imports reuse the saved POS code mapping.",
                },
                {
                  title: "Post matched sales",
                  detail: "Only matched rows are imported. Posting sales depletes recipe components and creates theoretical food cost.",
                },
                {
                  title: "Close Finance control",
                  detail: "Finance confirms POS import and unmapped POS review in the daily checklist before AvT is trusted.",
                },
              ].map((step, index) => (
                <div
                  key={step.title}
                  className="rounded-sm border border-status-info-border bg-card p-3"
                >
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                    Step {index + 1}
                  </span>
                  <p className="mt-1 font-semibold text-foreground">
                    {step.title}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-text-muted">
                    {step.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <form
            onSubmit={handleSalesImportSubmit}
            className="mt-4 grid gap-4 rounded-sm border border-border-system bg-background p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Bulk sales import
                </p>
                <h4 className="mt-1 font-semibold text-foreground">
                  POS export
                </h4>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Detected period:{" "}
                  <span className="font-bold text-foreground">
                    {salesImportPeriodLabel}
                  </span>
                  . {salesImportDateContext}.
                </p>
              </div>
              <label className={secondaryButtonClass}>
                Upload CSV
                <input
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  onChange={handleSalesImportFileChange}
                  disabled={!posImportAllowed || saleSaving}
                  className="sr-only"
                />
              </label>
            </div>

            <textarea
              value={salesImportText}
              onChange={(event) => setSalesImportText(event.target.value)}
              rows={5}
              disabled={!posImportAllowed || saleSaving}
              placeholder={
                "Business Date,Transaction ID,Item Code,Menu Item,Quantity,Gross Sales,Discount,Promo,Void,Net Sales\n2026-07-09,RCPT-1042,JOL-LRG,Jollof Rice Large,12,60000,3000,0,0,57000\n2026-07-09,RCPT-1043,ASUN-001,Asun,8,48000,0,4000,0,44000"
              }
              className="min-h-32 w-full rounded-sm border border-border-system bg-background px-3 py-3 text-sm text-foreground outline-none transition placeholder:text-text-ghost focus:border-accent focus:ring-2 focus:ring-accent/20"
            />

            {!posImportAllowed ? (
              <p className="rounded-sm border border-status-warning-border bg-status-warning-bg px-4 py-3 text-xs font-semibold text-status-warning-text">
                POS import posting is locked because this workspace is configured
                for manual sales depletion. Switch the workspace mode before
                importing POS files.
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-8">
              <MetricPill
                label="Rows detected"
                value={salesImportPreview.length.toLocaleString()}
              />
              <MetricPill
                label="Ready to import"
                value={aggregatedSalesImportRows.length.toLocaleString()}
              />
              <MetricPill
                label="Needs mapping"
                value={invalidSalesImportRows.toLocaleString()}
              />
              <MetricPill
                label="POS period"
                value={salesImportPeriodLabel}
              />
              <MetricPill
                label="Date status"
                value={
                  missingSalesImportDateCount > 0
                    ? "Needs review"
                    : verifiedSalesImportDates.length > 0
                      ? "Verified"
                      : "Provisional"
                }
              />
              <MetricPill
                label="Gross sales"
                value={`${organization.local_currency} ${validSalesImportRows
                  .reduce((total, row) => total + row.grossSales, 0)
                  .toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              />
              <MetricPill
                label="Deductions"
                value={`${organization.local_currency} ${validSalesImportRows
                  .reduce(
                    (total, row) =>
                      total +
                      row.discountAmount +
                      row.promoAmount +
                      row.voidAmount,
                    0,
                  )
                  .toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              />
              <MetricPill
                label="Net sales"
                value={`${organization.local_currency} ${validSalesImportRows
                  .reduce((total, row) => total + row.netSales, 0)
                  .toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              />
            </div>

            {salesImportPreview.length > 0 ? (
              <div className="rounded-sm border border-border-system">
                <div className="grid max-h-96 gap-3 overflow-auto p-3 lg:hidden">
                  {salesImportPreview.slice(0, 20).map((row) => {
                    const depletionMode = getSalesImportDepletionMode(row);

                    return (
                    <article
                      key={`mobile-import-${row.id}`}
                      className="rounded-sm border border-border-system bg-card p-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                            Row {row.rowNumber}
                          </p>
                          <p className="mt-1 font-semibold text-foreground">
                            {row.menuItem || "Blank menu item"}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-text-ghost">
                            POS code: {row.posItemCode || "-"}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                            row.error
                              ? "border-status-critical-border bg-status-critical-bg text-status-critical-text"
                              : "border-accent-muted-border bg-accent-muted-bg text-accent"
                          }`}
                        >
                          {row.error ?? row.matchSource}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-sm border border-border-system bg-background p-2">
                          <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                            Depletion
                          </p>
                          <p className="mt-1 font-semibold text-foreground">
                            {depletionMode.label}
                          </p>
                          <p className="mt-1 text-[11px] leading-4 text-text-muted">
                            {depletionMode.detail}
                          </p>
                        </div>
                        <div className="rounded-sm border border-border-system bg-background p-2">
                          <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                            Date
                          </p>
                          <p className="mt-1 font-semibold text-foreground">
                            {row.businessDate ||
                              (row.dateStatus === "missing_date"
                                ? "Unreadable"
                                : "Not supplied")}
                          </p>
                        </div>
                        <div className="rounded-sm border border-border-system bg-background p-2">
                          <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                            Qty
                          </p>
                          <p className="mt-1 font-semibold text-foreground">
                            {row.soldQuantity.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}
                          </p>
                        </div>
                        <div className="rounded-sm border border-border-system bg-background p-2">
                          <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                            Net sales
                          </p>
                          <p className="mt-1 font-semibold text-foreground">
                            {row.hasRevenueData
                              ? `${organization.local_currency} ${row.netSales.toLocaleString(
                                  undefined,
                                  { maximumFractionDigits: 2 },
                                )}`
                              : "-"}
                          </p>
                        </div>
                        <div className="rounded-sm border border-border-system bg-background p-2">
                          <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                            Effective price
                          </p>
                          <p className="mt-1 font-semibold text-foreground">
                            {row.hasRevenueData && row.soldQuantity > 0
                              ? `${organization.local_currency} ${(
                                  row.netSales / row.soldQuantity
                                ).toLocaleString(undefined, {
                                  maximumFractionDigits: 2,
                                })}`
                              : "-"}
                          </p>
                        </div>
                      </div>
                      <label className="mt-3 block">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                          Maps to
                        </span>
                        <select
                          value={row.recipeId}
                          onChange={(event) =>
                            handleSalesImportMappingChange(
                              row,
                              event.target.value,
                            )
                          }
                          disabled={saleSaving || !row.posItemKey}
                          className="mt-2 h-10 w-full rounded-sm border border-border-system bg-background px-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={`Map POS row ${row.rowNumber} to final menu item`}
                        >
                          <option value="">Choose item</option>
                          {activeFinalMenuItems.map((recipe) => (
                            <option
                              key={getRecipeId(recipe)}
                              value={getRecipeId(recipe)}
                            >
                              {recipe.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </article>
                    );
                  })}
                </div>

                <div className="hidden max-h-72 overflow-auto lg:block">
                <table className="min-w-full divide-y divide-border-system text-sm">
                  <thead className="bg-card">
                    <tr>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                        Row
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                        Menu item
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                        POS code
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                        Business date
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                        Qty
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                        Net sales
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                        Effective price
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                        Maps to
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                        Depletion
                      </th>
                      <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-system">
                    {salesImportPreview.slice(0, 20).map((row) => {
                      const depletionMode = getSalesImportDepletionMode(row);

                      return (
                      <tr key={row.id}>
                        <td className="px-4 py-3 text-text-muted">
                          {row.rowNumber}
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground">
                          {row.menuItem || "Blank"}
                        </td>
                        <td className="px-4 py-3 text-text-muted">
                          {row.posItemCode || "-"}
                        </td>
                        <td className="px-4 py-3 text-text-muted">
                          {row.businessDate ||
                            (row.dateStatus === "missing_date"
                              ? "Unreadable"
                              : "Not supplied")}
                        </td>
                        <td className="px-4 py-3 text-text-muted">
                          {row.soldQuantity.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                        </td>
                        <td className="px-4 py-3 text-text-muted">
                          {row.hasRevenueData
                            ? `${organization.local_currency} ${row.netSales.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 2 },
                              )}`
                            : "-"}
                        </td>
                        <td className="px-4 py-3 text-text-muted">
                          {row.hasRevenueData && row.soldQuantity > 0
                            ? `${organization.local_currency} ${(
                                row.netSales / row.soldQuantity
                              ).toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })}`
                            : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={row.recipeId}
                            onChange={(event) =>
                              handleSalesImportMappingChange(
                                row,
                                event.target.value,
                              )
                            }
                            disabled={saleSaving || !row.posItemKey}
                            className="h-9 min-w-[220px] rounded-sm border border-border-system bg-background px-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label={`Map POS row ${row.rowNumber} to final menu item`}
                          >
                            <option value="">Choose item</option>
                            {activeFinalMenuItems.map((recipe) => (
                              <option
                                key={getRecipeId(recipe)}
                                value={getRecipeId(recipe)}
                              >
                                {recipe.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest ${depletionMode.badgeClass}`}
                          >
                            {depletionMode.label}
                          </span>
                          <p className="mt-1 text-xs text-text-muted">
                            {depletionMode.detail}
                          </p>
                        </td>
                        <td
                          className={`px-4 py-3 font-semibold ${
                            row.error ? "text-status-critical-text" : "text-accent"
                          }`}
                        >
                          {row.error ??
                            (row.matchSource === "mapping"
                              ? "Mapped"
                              : "Name match")}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>

                {salesImportPreview.length > 20 ? (
                  <p className="border-t border-border-system px-4 py-3 text-xs font-semibold text-text-muted">
                    Showing first 20 rows only.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={
                  saleSaving || !posImportAllowed || validSalesImportRows.length === 0
                }
                className={primaryButtonClass}
              >
                Import matched sales
              </button>
              <button
                type="button"
                onClick={() => setSalesImportText("")}
                disabled={!salesImportText || saleSaving}
                className={secondaryButtonClass}
              >
                Clear import
              </button>
            </div>
          </form>

          <div className="mt-6 grid gap-5">
            <div className="rounded-sm border border-border-system bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-system px-5 py-4">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                    Sales Profitability
                  </p>
                  <h4 className="mt-1 text-lg font-semibold text-foreground">
                    Sales summary
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSalesTable((isVisible) => !isVisible)}
                  aria-expanded={showSalesTable}
                  className="flex h-10 w-10 items-center justify-center rounded-sm border border-border-system bg-background text-xl font-semibold text-foreground transition hover:border-border-system-hover"
                >
                  {showSalesTable ? "-" : "+"}
                </button>
              </div>

              {showSalesTable ? (
                <div>
                  <div className="hidden grid-cols-[0.9fr_1fr_0.55fr_0.7fr_0.7fr_0.7fr_0.5fr_1.2fr] gap-4 border-b border-border-system bg-background px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:grid">
                    <span>Recorded</span>
                    <span>Menu item</span>
                    <span>Sold</span>
                    <span>Revenue</span>
                    <span>Food cost</span>
                    <span>Gross profit</span>
                    <span>Margin</span>
                    <span>Components</span>
                  </div>

                  {menuSaleSummaries.length > 0 ? (
                    menuSaleSummaries.slice(0, 12).map((sale) => {
                      const recordedAt = sale.created_at
                        ? new Date(sale.created_at).toLocaleString()
                        : "Recorded";
                      const componentSummary = sale.rows
                        .map(
                          (component) =>
                            `${component.component_name}: ${component.depleted_qty.toLocaleString(
                              undefined,
                              { maximumFractionDigits: 3 },
                            )} ${component.component_uom ?? "unit"}`,
                        )
                        .join(", ");

                      return (
                        <div
                          key={sale.menu_sale_id}
                          className="grid gap-3 border-t border-border-system px-5 py-4 text-sm text-text-muted lg:grid-cols-[0.9fr_1fr_0.55fr_0.7fr_0.7fr_0.7fr_0.5fr_1.2fr] lg:items-center"
                        >
                          <Cell label="Recorded">{recordedAt}</Cell>
                          <Cell label="Menu item" strong>
                            {sale.recipe_name}
                          </Cell>
                          <Cell label="Sold">
                            {sale.sold_quantity.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}{" "}
                            {sale.output_uom ?? "unit"}
                          </Cell>
                          <Cell label="Revenue" strong>
                            {organization.local_currency}{" "}
                            {sale.total_revenue.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </Cell>
                          <Cell label="Food cost">
                            {organization.local_currency}{" "}
                            {sale.foodCost.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </Cell>
                          <Cell label="Gross profit" strong>
                            {organization.local_currency}{" "}
                            {sale.gross_profit.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </Cell>
                          <Cell label="Margin" strong>
                            {sale.gross_margin_pct === null
                              ? "N/A"
                              : `${sale.gross_margin_pct.toLocaleString(undefined, {
                                  maximumFractionDigits: 1,
                                })}%`}
                          </Cell>
                          <Cell label="Components">{componentSummary}</Cell>
                        </div>
                      );
                    })
                  ) : (
                    <p className="border-t border-border-system px-5 py-5 text-sm text-text-muted">
                      No sales depletion events recorded yet.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="rounded-sm border border-border-system bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-system px-5 py-4">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                    Ingredient Depletion
                  </p>
                  <h4 className="mt-1 text-lg font-semibold text-foreground">
                    Production variance table
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setShowDepletionTable((isVisible) => !isVisible)
                  }
                  aria-expanded={showDepletionTable}
                  className="flex h-10 w-10 items-center justify-center rounded-sm border border-border-system bg-background text-xl font-semibold text-foreground transition hover:border-border-system-hover"
                >
                  {showDepletionTable ? "-" : "+"}
                </button>
              </div>

              {showDepletionTable ? (
                <div>
                  <div className="hidden grid-cols-[0.9fr_1fr_0.8fr_0.65fr_0.65fr_0.65fr_0.65fr_0.7fr] gap-4 border-b border-border-system bg-background px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:grid">
                    <span>Recorded</span>
                    <span>Recipe</span>
                    <span>Ingredient</span>
                    <span>Actual</span>
                    <span>Should output</span>
                    <span>Actual output</span>
                    <span>Output gap</span>
                    <span>Impact</span>
                  </div>

                  {productionHistory.length > 0 ? (
                    productionHistory.slice(0, 24).map((row) => {
                      const recordedAt = row.created_at
                        ? new Date(row.created_at).toLocaleString()
                        : "Recorded";
                      const impactClass =
                        row.naira_loss > 0
                          ? "font-semibold text-status-critical-text"
                          : row.naira_loss < 0
                            ? "font-semibold text-accent"
                            : "font-semibold text-foreground";

                      return (
                        <div
                          key={`${row.production_run_id}-${row.ingredient_name}-${row.target_qty_required}-${row.actual_qty_used}`}
                          className="grid gap-3 border-t border-border-system px-5 py-4 text-sm text-text-muted lg:grid-cols-[0.9fr_1fr_0.8fr_0.65fr_0.65fr_0.65fr_0.65fr_0.7fr] lg:items-center"
                        >
                          <Cell label="Recorded">{recordedAt}</Cell>
                          <Cell label="Recipe" strong>
                            {row.recipe_name}
                          </Cell>
                          <Cell label="Ingredient" strong>
                            {row.ingredient_name}
                          </Cell>
                          <Cell label="Actual">
                            {row.actual_qty_used.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}
                          </Cell>
                          <Cell label="Should output">
                            {row.expected_output_from_actual_qty.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}
                          </Cell>
                          <Cell label="Actual output">
                            {(row.actual_output_qty ?? row.target_output_qty).toLocaleString(
                              undefined,
                              { maximumFractionDigits: 3 },
                            )}
                          </Cell>
                          <Cell label="Output gap">
                            {row.output_variance_qty.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}
                          </Cell>
                          <Cell label="Impact" className={impactClass}>
                            {organization.local_currency}{" "}
                            {row.naira_loss.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </Cell>
                        </div>
                      );
                    })
                  ) : (
                    <p className="border-t border-border-system px-5 py-5 text-sm text-text-muted">
                      <span
                        className={`${inlineSignalClass} ${inlineSignalToneStyles.info}`}
                      >
                        Record a production run
                      </span>{" "}
                      to see ingredient variance here.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      </div>
    </section>
  );
}

function NoticeBanner({ message }: { message: string }) {
  const tone = getNoticeTone(message);

  return (
    <p
      className={`rounded-sm border px-4 py-3 text-sm font-semibold ${noticeToneStyles[tone]}`}
    >
      {message}
    </p>
  );
}
