"use client";

/**
 * Finance role page reference for ProfitPlate.
 *
 * This is a documentation extract, not an active application route.
 * The live dashboard remains at app/dashboard/page.tsx and uses the
 * role-focus logic below to show the Finance dashboard experience when
 * the active focus role is finance_manager.
 */

import DashboardPage from "../app/dashboard/page";

export default function FinanceRolePageReference() {
  return <DashboardPage />;
}

/**
 * In the live dashboard page, Finance role visibility is controlled by
 * these focus-role checks:
 *
 * const isFinanceFocus = ["finance_manager", "auditor"].includes(focusRole);
 *
 * const showFinancialDashboardSection = isRole(
 *   "owner",
 *   "operations_manager",
 *   "finance_manager",
 * );
 *
 * const showFinancialSection = isRole(
 *   "owner",
 *   "operations_manager",
 *   "finance_manager",
 * );
 *
 * const showReportsSection = isRole(
 *   "owner",
 *   "operations_manager",
 *   "finance_manager",
 *   "procurement_manager",
 *   "inventory_manager",
 *   "auditor",
 * );
 *
 * Finance users are therefore connected through the main dashboard page.
 * They see finance/costing/reporting controls based on role, without
 * requiring a separate app route.
 */
