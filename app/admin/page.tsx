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
  active_sku_count: number;
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
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.organization_id === selectedWorkspaceId,
  );

  function beginManageWorkspace(workspace: PlatformWorkspaceSummary) {
    setSelectedWorkspaceId(workspace.organization_id);
    setSelectedSystemStatus(workspace.system_status);
    setSelectedSubscriptionTier(workspace.subscription_tier);
    setSelectedCurrency(workspace.local_currency);
    setMessage("");
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

    const { error } = await supabase.rpc(
      "update_platform_admin_workspace_settings",
      {
        target_organization_id: selectedWorkspaceId,
        system_status_value: selectedSystemStatus,
        subscription_tier_value: selectedSubscriptionTier,
        local_currency_value: selectedCurrency,
      },
    );

    if (error) {
      setMessage(error.message);
      setManagementSaving(false);
      return;
    }

    await loadPlatformAdminDashboard();
    setMessage("Restaurant workspace settings updated.");
    setManagementSaving(false);
  }

  return (
    <main className="min-h-screen bg-background font-sans text-foreground [--accent-hover:#0d5d3d] [--accent-muted-bg:#e6f3eb] [--accent-muted-border:#c9e2d3] [--accent-primary:#126b46] [--background:#f5f8f6] [--card-bg:#ffffff] [--card-border:#d9e2dd] [--card-border-hover:#aebdb5] [--critical-bg:#fff0ed] [--critical-border:#efc6be] [--critical-text:#bd3b2c] [--foreground:#10261c] [--text-ghost:#71877c] [--text-muted:#4f665b]">
      <header className="border-b border-border-system bg-white/90 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-accent/15 bg-white shadow-sm">
              <Image
                src="/ProfitPlate logo.png.png"
                alt="ProfitPlate Logo"
                width={72}
                height={72}
                priority
                className="h-8 w-8 object-contain"
              />
            </span>
            <span>
              <span className="block text-sm font-extrabold leading-none tracking-tight">
                ProfitPlate
              </span>
              <span className="mt-1 hidden font-mono text-[9px] uppercase tracking-widest text-text-ghost sm:block">
                Platform command
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="rounded-md border border-border-system bg-white px-4 py-2.5 text-xs font-bold text-foreground shadow-sm transition hover:border-border-system-hover"
            >
              Workspace dashboard
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md border border-border-system bg-white px-4 py-2.5 text-xs font-bold text-foreground shadow-sm transition hover:border-border-system-hover"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <section className="rounded-lg border border-border-system bg-white p-6 shadow-[0_24px_70px_rgba(25,65,45,0.10)] sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-end">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
                Super admin dashboard
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
                ProfitPlate entity command.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-text-muted">
                Monitor distinct restaurant workspaces, onboarding posture,
                open approvals, and operating-day hygiene from one privileged
                platform vantage point.
              </p>
              {adminRole ? (
                <span className="mt-5 inline-flex rounded-full border border-accent-muted-border bg-accent-muted-bg px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
                  {formatLabel(adminRole)}
                </span>
              ) : null}
            </div>

            <div className="grid overflow-hidden rounded-md border border-border-system bg-background sm:grid-cols-2">
              {[
                ["Entities", totals.entities],
                ["Users", totals.users],
                ["Pending approvals", totals.approvals],
                ["Open operating days", totals.openDays],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="border-b border-border-system p-5 even:sm:border-l sm:[&:nth-child(n+3)]:border-b-0"
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
          <p className="mt-6 rounded-md border border-border-system bg-white px-5 py-4 text-sm font-semibold text-text-muted">
            Loading platform dashboard...
          </p>
        ) : message ? (
          <p className="mt-6 rounded-md border border-status-critical-border bg-status-critical-bg px-5 py-4 text-sm font-semibold text-status-critical-text">
            {message}
          </p>
        ) : (
          <>
            <section className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="rounded-lg border border-border-system bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-border-system pb-4">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                      Attention queue
                    </p>
                    <h2 className="mt-1 text-xl font-extrabold">
                      Entities needing review
                    </h2>
                  </div>
                  <span className="rounded-full border border-status-attention-border bg-status-attention-bg px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-attention-text">
                    {attentionWorkspaces.length.toLocaleString()} open
                  </span>
                </div>

                <div className="mt-4 grid gap-2">
                  {attentionWorkspaces.length > 0 ? (
                    attentionWorkspaces.slice(0, 6).map((workspace) => (
                      <div
                        key={workspace.organization_id}
                        className="rounded-md border border-border-system bg-background px-4 py-3"
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
                            className={`rounded-full border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest ${
                              statusClass[workspace.system_status] ??
                              "border-border-system bg-white text-text-muted"
                            }`}
                          >
                            {formatLabel(workspace.system_status)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-md border border-accent-muted-border bg-accent-muted-bg px-4 py-3 text-sm font-semibold text-accent">
                      No workspace needs platform attention right now.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border-system bg-white shadow-sm">
                <div className="border-b border-border-system px-5 py-4">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                    Workspace estate
                  </p>
                  <h2 className="mt-1 text-xl font-extrabold">
                    Restaurant entities
                  </h2>
                </div>

                {selectedWorkspace ? (
                  <form
                    onSubmit={handleUpdateWorkspaceSettings}
                    className="grid gap-3 border-b border-border-system bg-background px-5 py-4 lg:grid-cols-[minmax(180px,1fr)_180px_180px_110px_auto]"
                  >
                    <div>
                      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                        Managing
                      </p>
                      <p className="mt-1 font-bold">
                        {selectedWorkspace.organization_name}
                      </p>
                    </div>
                    <select
                      value={selectedSystemStatus}
                      onChange={(event) =>
                        setSelectedSystemStatus(event.target.value)
                      }
                      className="h-11 rounded-md border border-border-system bg-white px-3 text-sm font-semibold text-foreground outline-none"
                    >
                      <option value="implementation_mode">
                        Implementation mode
                      </option>
                      <option value="live_operations">Live operations</option>
                    </select>
                    <select
                      value={selectedSubscriptionTier}
                      onChange={(event) =>
                        setSelectedSubscriptionTier(event.target.value)
                      }
                      className="h-11 rounded-md border border-border-system bg-white px-3 text-sm font-semibold text-foreground outline-none"
                    >
                      <option value="solo">Solo</option>
                      <option value="multi_unit">Multi Unit</option>
                      <option value="enterprise_grid">Enterprise Grid</option>
                    </select>
                    <input
                      value={selectedCurrency}
                      onChange={(event) =>
                        setSelectedCurrency(event.target.value.toUpperCase())
                      }
                      maxLength={3}
                      className="h-11 rounded-md border border-border-system bg-white px-3 text-sm font-semibold uppercase text-foreground outline-none"
                      aria-label="Workspace currency"
                    />
                    <button
                      type="submit"
                      disabled={managementSaving}
                      className="h-11 rounded-md bg-accent px-4 text-sm font-bold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {managementSaving ? "Saving..." : "Save"}
                    </button>
                  </form>
                ) : null}

                <div className="overflow-x-auto">
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
                      {workspaces.map((workspace) => (
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
                              className={`inline-flex rounded-full border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest ${
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
                              className="rounded-md border border-border-system bg-white px-3 py-2 text-xs font-bold text-foreground shadow-sm transition hover:border-border-system-hover"
                            >
                              Manage
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
