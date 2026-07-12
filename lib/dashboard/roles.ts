export type AppRole =
  | "owner"
  | "admin"
  | "manager"
  | "operations_manager"
  | "procurement_manager"
  | "finance_manager"
  | "inventory_manager"
  | "storekeeper"
  | "kitchen_manager"
  | "chef"
  | "quality_assurance"
  | "bar_manager"
  | "bartender"
  | "auditor"
  | "viewer";

export const roleLabels: Record<AppRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  operations_manager: "Operations manager",
  procurement_manager: "Procurement manager",
  finance_manager: "Finance manager",
  inventory_manager: "Inventory manager",
  storekeeper: "Storekeeper",
  kitchen_manager: "Kitchen manager",
  chef: "Chef",
  quality_assurance: "Quality assurance",
  bar_manager: "Bar manager",
  bartender: "Bartender",
  auditor: "Auditor",
  viewer: "Viewer",
};

export const roleDescriptions: Record<AppRole, string> = {
  owner: "Full workspace, costing, approval, and operations access.",
  admin: "Manages workspace settings, roles, costing, approvals, and daily operations.",
  manager: "Manages approvals, costing decisions, and daily variance review.",
  operations_manager:
    "Runs daily restaurant operations, inventory discipline, production variance, waste, day close, exceptions, and team accountability.",
  procurement_manager:
    "Focused on supplier onboarding, purchase intake, purchase orders, supplier price changes, and delivery follow-up.",
  finance_manager:
    "Owns recipe costing, food-cost variance, menu margins, pricing recovery, POS controls, inflation exposure, and executive reporting.",
  inventory_manager:
    "Owns receiving, stock counts, storage accuracy, and inventory variance review.",
  storekeeper:
    "Receives fresh supplies, issues stock to departments, and keeps store movement records clean.",
  kitchen_manager:
    "Plans recipe output, coordinates production records and yield tests, manages ingredient demand, kitchen requisitions, and production execution.",
  chef: "Records kitchen production, yield variance, waste, and recipe execution activity.",
  quality_assurance:
    "Checks yield tests, supplier quality, production hygiene, and operational exceptions.",
  bar_manager:
    "Owns bar stock, bar requisitions, beverage waste, and bar operating control.",
  bartender:
    "Records bar activity, requisitions, waste, and stock usage under bar supervision.",
  auditor:
    "Reviews daily registers, exceptions, approvals, and audit trails without routine data entry.",
  viewer: "Reviews margin and operations data without changing records.",
};

export const costingRoles = new Set<AppRole>([
  "owner",
  "admin",
  "manager",
  "operations_manager",
  "finance_manager",
]);

export const workspaceRoles = new Set<AppRole>(["owner", "admin"]);

export const operationsRoles = new Set<AppRole>([
  "owner",
  "admin",
  "manager",
  "operations_manager",
  "procurement_manager",
  "finance_manager",
  "inventory_manager",
  "storekeeper",
  "kitchen_manager",
  "chef",
  "quality_assurance",
  "bar_manager",
  "bartender",
]);

export const approvalRoles = new Set<AppRole>([
  "owner",
  "admin",
  "manager",
  "operations_manager",
  "procurement_manager",
  "finance_manager",
  "inventory_manager",
  "storekeeper",
  "kitchen_manager",
  "quality_assurance",
  "bar_manager",
  "auditor",
]);

export const activeDashboardRoles: AppRole[] = [
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
  "bartender",
  "auditor",
];

const validRoles = new Set<AppRole>([
  "owner",
  "admin",
  "manager",
  "operations_manager",
  "procurement_manager",
  "finance_manager",
  "inventory_manager",
  "storekeeper",
  "kitchen_manager",
  "chef",
  "quality_assurance",
  "bar_manager",
  "bartender",
  "auditor",
  "viewer",
]);

export function normalizeRole(value: unknown): AppRole {
  const normalizedValue = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (
    normalizedValue === "general_manager" ||
    normalizedValue === "gm" ||
    normalizedValue === "restaurant_manager"
  ) {
    return "operations_manager";
  }

  if (normalizedValue === "cost_controller") {
    return "finance_manager";
  }

  if (normalizedValue === "production_supervisor") {
    return "kitchen_manager";
  }

  if (
    normalizedValue === "pos_supervisor" ||
    normalizedValue === "cashier" ||
    normalizedValue === "sales_supervisor"
  ) {
    return "finance_manager";
  }

  if (normalizedValue === "kitchen" || normalizedValue === "kitchen_lead") {
    return "kitchen_manager";
  }

  if (
    normalizedValue === "inventory_clerk" ||
    normalizedValue === "receiving_officer"
  ) {
    return "storekeeper";
  }

  if (normalizedValue === "qa" || normalizedValue === "quality_control") {
    return "quality_assurance";
  }

  if (
    normalizedValue === "bar_head" ||
    normalizedValue === "head_bartender"
  ) {
    return "bar_manager";
  }

  return validRoles.has(normalizedValue as AppRole)
    ? (normalizedValue as AppRole)
    : "viewer";
}
