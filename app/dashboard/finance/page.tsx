import DashboardPage from "../page";

export const metadata = {
  title: "Finance Dashboard | ProfitPlate",
};

export default function FinanceDashboardPage() {
  return <DashboardPage initialFocusRole="finance_manager" />;
}
