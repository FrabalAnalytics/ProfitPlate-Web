"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type PlatformWorkspaceSummary = {
  organization_id: string;
  organization_name: string;
  subscription_tier: string;
  system_status: string;
  local_currency: string;
  owner_user_id: string | null;
  created_at: string;
  profile_count: number;
  active_location_count: number;
  active_sales_outlet_count?: number;
  active_sku_count: number;
  manufactured_final_product_count?: number;
  pending_approval_count: number;
  open_operating_day_count: number;
  latest_operating_date: string | null;
  latest_operating_status: string | null;
};

const statusClass: Record<string, string> = {
  live_operations:
    "border-accent-muted-border bg-accent-muted-bg text-accent",
  implementation_mode:
    "border-status-attention-border bg-status-attention-bg text-status-attention-text",
  open:
    "border-status-attention-border bg-status-attention-bg text-status-attention-text",
  closing_review:
    "border-status-attention-border bg-status-attention-bg text-status-attention-text",
  closed: "border-accent-muted-border bg-accent-muted-bg text-accent",
  locked: "border-status-info-border bg-status-info-bg text-status-info-text",
};

function formatLabel(value: string | null | undefined) {
  return String(value ?? "unknown").replaceAll("_", " ");
}

export default function PlatformAdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [adminRole, setAdminRole] = useState("");
  const [workspaces, setWorkspaces] = useState<PlatformWorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedSystemStatus, setSelectedSystemStatus] = useState("");
  const [selectedSubscriptionTier, setSelectedSubscriptionTier] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [managementSaving, setManagementSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceTier, setNewWorkspaceTier] = useState("multi_unit");
  const [newWorkspaceCurrency, setNewWorkspaceCurrency] = useState("NGN");
  const [newWorkspaceOwnerEmail, setNewWorkspaceOwnerEmail] = useState("");
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [frontCounterEnsuring, setFrontCounterEnsuring] = useState(false);

  const loadPlatformAdminDashboard = useCallback(async () => {
    setLoading(true);
    setMessage("");

    const { data: sessionData } = await supabase.auth.getSession();

    if (!sessionData.session) {
      router.replace("/login");
      return;
    }

    const { data: adminData, error: adminError } = await supabase
      .from("platform_admins")
      .select("role")
      .eq("user_id", sessionData.session.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (adminError) {
      setMessage(adminError.message);
      setLoading(false);
      return;
    }

    if (!adminData) {
      setMessage(
        "This account is not a ProfitPlate platform admin. Ask a Super Admin to grant platform access.",
      );
      setLoading(false);
      return;
    }

    setAdminRole(String(adminData.role ?? "platform_admin"));

    const { data, error } = await supabase.rpc(
      "get_platform_admin_workspace_summary",
    );

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setWorkspaces((data ?? []) as PlatformWorkspaceSummary[]);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void loadPlatformAdminDashboard();
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, [loadPlatformAdminDashboard]);

  const totals = useMemo(
    () =>
      workspaces.reduce(
        (summary, workspace) => ({
          entities: summary.entities + 1,
          users: summary.users + Number(workspace.profile_count ?? 0),
          approvals:
            summary.approvals + Number(workspace.pending_approval_count ?? 0),
          openDays:
            summary.openDays + Number(workspace.open_operating_day_count ?? 0),
        }),
        {
          entities: 0,
          users: 0,
          approvals: 0,
          openDays: 0,
        },
      ),
    [workspaces],
  );

  const attentionWorkspaces = workspaces.filter(
    (workspace) =>
      workspace.pending_approval_count > 0 ||
      workspace.open_operating_day_count > 0 ||
      workspace.system_status !== "live_operations",
  );
  const filteredWorkspaces = useMemo(
    () =>
      workspaces.filter((workspace) => {
        const searchText = [
          workspace.organization_name,
          workspace.subscription_tier,
          workspace.system_status,
          workspace.local_currency,
        ]
          .join(" ")
          .toLowerCase();

        const matchesSearch = searchText.includes(searchTerm.toLowerCase());
        const matchesStatus =
          statusFilter === "all" || workspace.system_status === statusFilter;

        return matchesSearch && matchesStatus;
      }),
    [searchTerm, statusFilter, workspaces],
  );
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.organization_id === selectedWorkspaceId,
  );
  const selectedSalesOutletCount = Number(
    selectedWorkspace?.active_sales_outlet_count ?? 0,
  );
  const selectedFinalProductCount = Number(
    selectedWorkspace?.manufactured_final_product_count ?? 0,
  );
  const selectedHasSalesOutlet = selectedSalesOutletCount > 0;

  function beginManageWorkspace(workspace: PlatformWorkspaceSummary) {
    setSelectedWorkspaceId(workspace.organization_id);
    setSelectedSystemStatus(workspace.system_status);
    setSelectedSubscriptionTier(workspace.subscription_tier);
    setSelectedCurrency(workspace.local_currency);
    setMessage("");
    window.setTimeout(() => {
      document
        .getElementById("restaurant-management-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function handleUpdateWorkspaceSettings(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selectedWorkspaceId) {
      setMessage("Select a restaurant entity to manage.");
      return;
    }

    setManagementSaving(true);
    setMessage("");

    const normalizedCurrency = selectedCurrency.trim().toUpperCase();
    const hasChanges =
      selectedWorkspace?.system_status !== selectedSystemStatus ||
      selectedWorkspace?.subscription_tier !== selectedSubscriptionTier ||
      selectedWorkspace?.local_currency !== normalizedCurrency;

    if (!hasChanges) {
      setSelectedWorkspaceId("");
      setMessage("No restaurant workspace changes to save.");
      setManagementSaving(false);
      return;
    }

    const { error } = await supabase.rpc(
      "update_platform_admin_workspace_settings",
      {
        target_organization_id: selectedWorkspaceId,
        system_status_value: selectedSystemStatus,
        subscription_tier_value: selectedSubscriptionTier,
        local_currency_value: normalizedCurrency,
      },
    );

    if (error) {
      setMessage(error.message);
      setManagementSaving(false);
      return;
    }

    await loadPlatformAdminDashboard();
    setSelectedWorkspaceId("");
    setMessage("Restaurant workspace settings updated.");
    setManagementSaving(false);
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newWorkspaceName.trim()) {
      setMessage("Enter the restaurant name before creating a workspace.");
      return;
    }

    setWorkspaceCreating(true);
    setMessage("");

    const { data, error } = await supabase.rpc(
      "create_platform_admin_workspace",
      {
        workspace_name: newWorkspaceName.trim(),
        subscription_tier_value: newWorkspaceTier,
        local_currency_value: newWorkspaceCurrency.trim().toUpperCase(),
        owner_email_value: newWorkspaceOwnerEmail.trim() || null,
      },
    );

    if (error) {
      setMessage(error.message);
      setWorkspaceCreating(false);
      return;
    }

    setNewWorkspaceName("");
    setNewWorkspaceTier("multi_unit");
    setNewWorkspaceCurrency("NGN");
    setNewWorkspaceOwnerEmail("");
    await loadPlatformAdminDashboard();
    setSelectedWorkspaceId(
      typeof data === "object" && data !== null && "id" in data
        ? String((data as { id?: string }).id ?? "")
        : "",
    );
    setMessage("Restaurant workspace created in implementation mode.");
    setWorkspaceCreating(false);
  }

  async function handleEnsureFrontCounter() {
    if (!selectedWorkspaceId) {
      setMessage("Select a restaurant entity to manage.");
      return;
    }

    setFrontCounterEnsuring(true);
    setMessage("");

    const { error } = await supabase.rpc("ensure_platform_admin_front_counter", {
      target_organization_id: selectedWorkspaceId,
    });

    if (error) {
      setMessage(error.message);
      setFrontCounterEnsuring(false);
      return;
    }

    await loadPlatformAdminDashboard();
    setMessage("Front Counter sales outlet is ready for this restaurant.");
    setFrontCounterEnsuring(false);
  }

  return (
    <main className="dashboard-readable min-h-screen bg-background font-sans text-foreground antialiased">
      <header className="sticky top-0 z-50 border-b border-border-system/80 bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-sm border border-accent/15 bg-card shadow-sm">
              <Image
                src="/profitplate-logo.png"
                alt="ProfitPlate Logo"
                width={72}
                height={72}
                priority
                className="h-8 w-8 object-cover object-center"
              />
            </span>
            <span>
              <span className="block text-sm font-extrabold leading-none tracking-tight">
                ProfitPlate
              </span>
              <span className="mt-1 hidden font-mono text-[9px] uppercase tracking-widest text-text-ghost sm:block">
                Restaurant margin control system
              </span>
            </span>
          </Link>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            <Link
              href="/dashboard"
              className="rounded-sm border border-border-system bg-card px-3 py-2.5 text-center text-xs font-bold text-foreground shadow-sm transition hover:border-border-system-hover sm:px-4"
            >
              My workspace dashboard
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-sm border border-border-system bg-card px-3 py-2.5 text-xs font-bold text-foreground shadow-sm transition hover:border-border-system-hover sm:px-4"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <section className="rounded-sm border border-border-system bg-card p-5 shadow-2xl shadow-black/40 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr] lg:items-end">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
                Super admin dashboard
              </p>
              <h1 className="mt-4 max-w-3xl text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
                ProfitPlate entity command.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-text-muted">
                Monitor distinct restaurant workspaces, onboarding posture,
                open approvals, and operating-day hygiene from one privileged
                platform vantage point.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {adminRole ? (
                  <span className="inline-flex rounded-sm border border-accent-muted-border bg-accent-muted-bg px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
                    {formatLabel(adminRole)}
                  </span>
                ) : null}
                <a
                  href="#add-restaurant"
                  className="inline-flex rounded-sm border border-border-system bg-card px-3 py-2 text-xs font-bold text-foreground shadow-sm transition hover:border-border-system-hover"
                >
                  Add restaurant entity
                </a>
              </div>
            </div>

            <div className="grid overflow-hidden rounded-sm border border-border-system bg-background min-[420px]:grid-cols-2">
              {[
                ["Entities", totals.entities],
                ["Users", totals.users],
                ["Pending approvals", totals.approvals],
                ["Open operating days", totals.openDays],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="border-b border-border-system p-4 even:min-[420px]:border-l min-[420px]:[&:nth-child(n+3)]:border-b-0 sm:p-5"
                >
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                    {label}
                  </p>
                  <p className="mt-3 text-3xl font-extrabold">
                    {Number(value).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {loading ? (
          <p className="mt-6 rounded-sm border border-border-system bg-card px-5 py-4 text-sm font-semibold text-text-muted">
            Loading platform dashboard...
          </p>
        ) : (
          <>
            {message ? (
              <p className="mt-6 rounded-sm border border-status-info-border bg-status-info-bg px-5 py-4 text-sm font-semibold text-status-info-text">
                {message}
              </p>
            ) : null}
            <section
              id="add-restaurant"
              className="mt-6 rounded-sm border border-border-system bg-card p-5 shadow-2xl shadow-black/25"
            >
              <div className="grid gap-5 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                    Platform onboarding
                  </p>
                  <h2 className="mt-1 text-xl font-extrabold">
                    Add restaurant entity
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    Create a restaurant workspace in implementation mode. Add an
                    owner email only if that user already exists in Supabase Auth.
                  </p>
                </div>
                <form
                  onSubmit={handleCreateWorkspace}
                  className="grid gap-3 rounded-sm border border-border-system bg-background p-4 sm:grid-cols-2"
                >
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                      Restaurant name
                    </span>
                    <input
                      value={newWorkspaceName}
                      onChange={(event) =>
                        setNewWorkspaceName(event.target.value)
                      }
                      placeholder="e.g. Lagos Island Grill"
                      className="h-11 rounded-sm border border-border-system bg-card px-3 text-sm font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                      Subscription tier
                    </span>
                    <select
                      value={newWorkspaceTier}
                      onChange={(event) =>
                        setNewWorkspaceTier(event.target.value)
                      }
                      className="h-11 rounded-sm border border-border-system bg-card px-3 text-sm font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                    >
                      <option value="solo">Solo</option>
                      <option value="multi_unit">Multi Unit</option>
                      <option value="enterprise_grid">Enterprise Grid</option>
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                      Currency
                    </span>
                    <input
                      value={newWorkspaceCurrency}
                      onChange={(event) =>
                        setNewWorkspaceCurrency(
                          event.target.value.toUpperCase(),
                        )
                      }
                      maxLength={3}
                      className="h-11 rounded-sm border border-border-system bg-card px-3 text-sm font-semibold uppercase text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                      Owner email, optional
                    </span>
                    <input
                      type="email"
                      value={newWorkspaceOwnerEmail}
                      onChange={(event) =>
                        setNewWorkspaceOwnerEmail(event.target.value)
                      }
                      placeholder="owner@restaurant.com"
                      className="h-11 rounded-sm border border-border-system bg-card px-3 text-sm font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={workspaceCreating}
                    className="h-11 rounded-sm bg-accent px-4 text-sm font-bold text-background transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2"
                  >
                    {workspaceCreating ? "Creating..." : "Create restaurant"}
                  </button>
                </form>
              </div>
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
              <div className="rounded-sm border border-border-system bg-card p-5 shadow-2xl shadow-black/25">
                <div className="flex items-center justify-between border-b border-border-system pb-4">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Attention queue
                    </p>
                    <h2 className="mt-1 text-xl font-extrabold">
                      Entities needing review
                    </h2>
                  </div>
                  <span className="rounded-sm border border-status-attention-border bg-status-attention-bg px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-attention-text">
                    {attentionWorkspaces.length.toLocaleString()} open
                  </span>
                </div>

                <div className="mt-4 grid gap-2">
                  {attentionWorkspaces.length > 0 ? (
                    attentionWorkspaces.slice(0, 6).map((workspace) => (
                      <button
                        type="button"
                        key={workspace.organization_id}
                        onClick={() => beginManageWorkspace(workspace)}
                        className="rounded-sm border border-border-system bg-background px-4 py-3 text-left transition hover:border-border-system-hover hover:bg-card"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-bold">
                              {workspace.organization_name}
                            </p>
                            <p className="mt-1 text-xs text-text-muted">
                              {workspace.pending_approval_count.toLocaleString()} approvals /{" "}
                              {workspace.open_operating_day_count.toLocaleString()} open days
                            </p>
                          </div>
                          <span
                            className={`rounded-sm border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest ${
                              statusClass[workspace.system_status] ??
                              "border-border-system bg-card text-text-muted"
                            }`}
                          >
                            {formatLabel(workspace.system_status)}
                          </span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="rounded-sm border border-accent-muted-border bg-accent-muted-bg px-4 py-3 text-sm font-semibold text-accent">
                      No workspace needs platform attention right now.
                    </p>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-sm border border-border-system bg-card shadow-2xl shadow-black/25">
                <div className="grid gap-4 border-b border-border-system px-5 py-4 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Workspace estate
                    </p>
                    <h2 className="mt-1 text-xl font-extrabold">
                      Restaurant entities
                    </h2>
                    <p className="mt-1 text-sm text-text-muted">
                      Select a restaurant to manage onboarding status,
                      subscription posture, and currency settings.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(180px,260px)_180px]">
                    <input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search restaurants"
                      className="h-11 rounded-sm border border-border-system bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                      className="h-11 rounded-sm border border-border-system bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                    >
                      <option value="all">All statuses</option>
                      <option value="implementation_mode">
                        Implementation mode
                      </option>
                      <option value="live_operations">Live operations</option>
                    </select>
                  </div>
                </div>

                {selectedWorkspace ? (
                  <form
                    id="restaurant-management-panel"
                    onSubmit={handleUpdateWorkspaceSettings}
                    className="grid gap-4 border-b border-border-system bg-background px-5 py-4 lg:grid-cols-[minmax(220px,1fr)_minmax(300px,0.9fr)]"
                  >
                    <div className="rounded-sm border border-border-system bg-card p-4">
                      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                        Managing
                      </p>
                      <p className="mt-1 text-lg font-extrabold">
                        {selectedWorkspace.organization_name}
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                        {[
                          ["Users", selectedWorkspace.profile_count],
                          ["Locations", selectedWorkspace.active_location_count],
                          ["SKUs", selectedWorkspace.active_sku_count],
                          ["Approvals", selectedWorkspace.pending_approval_count],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-sm border border-border-system bg-background px-3 py-2"
                          >
                            <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                              {label}
                            </p>
                            <p className="mt-1 text-lg font-extrabold">
                              {Number(value).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 rounded-sm border border-status-info-border bg-status-info-bg px-4 py-3 text-sm leading-6 text-status-info-text">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-foreground">
                              Operating model readiness
                            </p>
                            <p className="mt-1">
                              Standard entities can run recipe depletion. QSR /
                              fast-food entities also need a sales outlet and
                              manufactured final-product SKUs for 1-to-1 counter
                              depletion.
                            </p>
                          </div>
                          {!selectedHasSalesOutlet ? (
                            <button
                              type="button"
                              onClick={handleEnsureFrontCounter}
                              disabled={frontCounterEnsuring}
                              className="inline-flex rounded-sm border border-status-info-border bg-card px-3 py-2 text-xs font-bold text-foreground shadow-sm transition hover:border-border-system-hover disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {frontCounterEnsuring
                                ? "Creating..."
                                : "Ensure Front Counter"}
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          <div
                            className={`rounded-sm border px-3 py-2 ${
                              selectedHasSalesOutlet
                                ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                                : "border-status-attention-border bg-status-attention-bg text-status-attention-text"
                            }`}
                          >
                            <p className="font-mono text-[9px] font-bold uppercase tracking-widest">
                              Sales outlets
                            </p>
                            <p className="mt-1 text-lg font-extrabold">
                              {selectedSalesOutletCount.toLocaleString()}
                            </p>
                          </div>
                          <div
                            className={`rounded-sm border px-3 py-2 ${
                              selectedFinalProductCount > 0
                                ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                              : "border-status-info-border bg-card text-status-info-text"
                            }`}
                          >
                            <p className="font-mono text-[9px] font-bold uppercase tracking-widest">
                              Final-product SKUs
                            </p>
                            <p className="mt-1 text-lg font-extrabold">
                              {selectedFinalProductCount.toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-text-muted">
                          Super Admin can ensure the counter here. Recipes,
                          production runs, and finished-good SKUs are still
                          created inside the restaurant workspace by an assigned
                          workspace user.
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-3 rounded-sm border border-border-system bg-card p-4 sm:grid-cols-2">
                      <label className="grid gap-1">
                        <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                          System status
                        </span>
                        <select
                          value={selectedSystemStatus}
                          onChange={(event) =>
                            setSelectedSystemStatus(event.target.value)
                          }
                          className="h-11 rounded-sm border border-border-system bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                        >
                          <option value="implementation_mode">
                            Implementation mode
                          </option>
                          <option value="live_operations">
                            Live operations
                          </option>
                        </select>
                      </label>
                      <label className="grid gap-1">
                        <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                          Subscription tier
                        </span>
                        <select
                          value={selectedSubscriptionTier}
                          onChange={(event) =>
                            setSelectedSubscriptionTier(event.target.value)
                          }
                          className="h-11 rounded-sm border border-border-system bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                        >
                          <option value="solo">Solo</option>
                          <option value="multi_unit">Multi Unit</option>
                          <option value="enterprise_grid">
                            Enterprise Grid
                          </option>
                        </select>
                      </label>
                      <label className="grid gap-1">
                        <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                          Currency
                        </span>
                        <input
                          value={selectedCurrency}
                          onChange={(event) =>
                            setSelectedCurrency(
                              event.target.value.toUpperCase(),
                            )
                          }
                          maxLength={3}
                          className="h-11 rounded-sm border border-border-system bg-background px-3 text-sm font-semibold uppercase text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                          aria-label="Workspace currency"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={managementSaving}
                        className="h-11 self-end rounded-sm bg-accent px-4 text-sm font-bold text-background transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {managementSaving ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                  </form>
                ) : null}

                <div className="grid gap-3 p-4 md:hidden">
                  {filteredWorkspaces.length > 0 ? (
                    filteredWorkspaces.map((workspace) => (
                      <article
                        key={workspace.organization_id}
                        className="rounded-sm border border-border-system bg-background p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-extrabold">
                              {workspace.organization_name}
                            </h3>
                            <p className="mt-1 text-xs capitalize text-text-muted">
                              {formatLabel(workspace.subscription_tier)} /{" "}
                              {workspace.local_currency}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-sm border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest ${
                              statusClass[workspace.system_status] ??
                              "border-border-system bg-card text-text-muted"
                            }`}
                          >
                            {formatLabel(workspace.system_status)}
                          </span>
                        </div>

                        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                          {[
                            ["Users", workspace.profile_count],
                            ["Locations", workspace.active_location_count],
                            ["SKUs", workspace.active_sku_count],
                            ["Approvals", workspace.pending_approval_count],
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              className="rounded-sm border border-border-system bg-card px-3 py-2"
                            >
                              <dt className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                                {label}
                              </dt>
                              <dd className="mt-1 font-extrabold">
                                {Number(value).toLocaleString()}
                              </dd>
                            </div>
                          ))}
                        </dl>

                        <div className="mt-4 flex items-end justify-between gap-3 border-t border-border-system pt-3">
                          <div>
                            <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                              Latest day
                            </p>
                            <p className="mt-1 text-sm font-bold">
                              {workspace.latest_operating_date ?? "No day"}
                            </p>
                            <p className="text-xs capitalize text-text-muted">
                              {formatLabel(workspace.latest_operating_status)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => beginManageWorkspace(workspace)}
                            className="rounded-sm border border-border-system bg-card px-3 py-2 text-xs font-bold text-foreground shadow-sm transition hover:border-border-system-hover"
                          >
                            Manage
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="rounded-sm border border-border-system bg-background px-4 py-3 text-sm font-semibold text-text-muted">
                      No restaurant entities match this filter.
                    </p>
                  )}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-border-system bg-background font-mono text-[10px] uppercase tracking-widest text-text-ghost">
                        <th className="px-5 py-3">Entity</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Users</th>
                        <th className="px-5 py-3">Locations</th>
                        <th className="px-5 py-3">SKUs</th>
                        <th className="px-5 py-3">Approvals</th>
                        <th className="px-5 py-3">Latest day</th>
                        <th className="px-5 py-3">Manage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredWorkspaces.map((workspace) => (
                        <tr
                          key={workspace.organization_id}
                          className="border-b border-border-system last:border-b-0"
                        >
                          <td className="px-5 py-4">
                            <p className="font-bold">
                              {workspace.organization_name}
                            </p>
                            <p className="mt-1 text-xs capitalize text-text-muted">
                              {formatLabel(workspace.subscription_tier)} /{" "}
                              {workspace.local_currency}
                            </p>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex rounded-sm border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest ${
                                statusClass[workspace.system_status] ??
                                "border-border-system bg-background text-text-muted"
                              }`}
                            >
                              {formatLabel(workspace.system_status)}
                            </span>
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {workspace.profile_count.toLocaleString()}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {workspace.active_location_count.toLocaleString()}
                          </td>
                          <td className="px-5 py-4 font-bold">
                            {workspace.active_sku_count.toLocaleString()}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`font-bold ${
                                workspace.pending_approval_count > 0
                                  ? "text-status-attention-text"
                                  : "text-accent"
                              }`}
                            >
                              {workspace.pending_approval_count.toLocaleString()}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <p className="font-bold">
                              {workspace.latest_operating_date ?? "No day"}
                            </p>
                            <p className="mt-1 text-xs capitalize text-text-muted">
                              {formatLabel(workspace.latest_operating_status)}
                            </p>
                          </td>
                          <td className="px-5 py-4">
                            <button
                              type="button"
                              onClick={() => beginManageWorkspace(workspace)}
                              className="rounded-sm border border-border-system bg-card px-3 py-2 text-xs font-bold text-foreground shadow-sm transition hover:border-border-system-hover"
                            >
                              Manage
                            </button>
                          </td>
                        </tr>
                      ))}
                      {filteredWorkspaces.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-5 py-8 text-center text-sm font-semibold text-text-muted"
                          >
                            No restaurant entities match this filter.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
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
