"use client";

import type { FormEvent } from "react";
import { roleLabels, type AppRole } from "@/lib/dashboard/roles";

const inlineSignalClass = "inline-flex max-w-full align-baseline rounded-sm border px-2 py-0.5 font-mono text-sm font-bold leading-6 whitespace-normal break-words";
const inlineSignalToneStyles = { info: "border-status-info-border bg-status-info-bg text-status-info-text", healthy: "border-accent-muted-border bg-accent-muted-bg text-accent" };
function NoticeBanner({ message }: { message: string }) {
  const success =
    /\b(recorded|updated|cleaned|created|depleted|received|issued|submitted|complete|completed|dispatched)\b/i.test(
      message,
    );
  const tone = success
    ? "border-accent-muted-border bg-accent-muted-bg text-accent"
    : "border-status-critical-border bg-status-critical-bg text-status-critical-text";

  return (
    <p className={`rounded-sm border px-4 py-3 text-sm font-semibold ${tone}`}>
      {message}
    </p>
  );
}

export function WorkspaceOnboarding({
  email,
  message,
  saving,
  onSubmit,
}: {
  email: string;
  message: string;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-sm border border-border-system bg-card px-6 py-10 shadow-2xl shadow-black/40 sm:px-8">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
          Workspace setup
        </p>
        <h1 className="mt-3 max-w-2xl font-serif text-4xl font-normal leading-tight text-foreground sm:text-5xl">
          Set up your restaurant workspace.
        </h1>
        <p className="mt-4 max-w-xl text-lg leading-8 text-text-muted">
          This links{" "}
          <span
            className={`${inlineSignalClass} ${inlineSignalToneStyles.info} break-all`}
          >
            {email}
          </span>{" "}
          to{" "}
          <span
            className={`${inlineSignalClass} ${inlineSignalToneStyles.healthy}`}
          >
            one organization
          </span>{" "}
          so inventory, recipes, purchases, and margin activity stay connected
          in one place.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="grid content-start gap-5 rounded-sm border border-border-system bg-card p-6 shadow-2xl shadow-black/30"
      >
        <label className="grid gap-2 text-sm font-semibold text-text-muted">
          Business name
          <input
            name="name"
            placeholder="Main Street Kitchen"
            required
            className="h-12 rounded-sm border border-border-system bg-background px-4 font-normal text-foreground outline-none transition placeholder:text-text-ghost focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <label className="grid gap-2 text-sm font-semibold text-text-muted">
          Subscription plan
          <select
            name="subscription_tier"
            defaultValue="solo"
            className="h-12 rounded-sm border border-border-system bg-background px-4 font-normal text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="solo">Solo Operator</option>
            <option value="multi_unit">Multi-Unit Group</option>
            <option value="enterprise_grid">Enterprise Grid</option>
          </select>
        </label>

        <label className="grid gap-2 text-sm font-semibold text-text-muted">
          Currency
          <input
            name="local_currency"
            defaultValue="NGN"
            maxLength={3}
            className="h-12 rounded-sm border border-border-system bg-background px-4 font-normal uppercase text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        {message ? <NoticeBanner message={message} /> : null}

        <button
          type="submit"
          disabled={saving}
          className="rounded-sm bg-accent px-5 py-3 text-xs font-bold uppercase tracking-wider text-background transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {saving ? "Creating workspace..." : "Create Workspace"}
        </button>
      </form>
    </section>
  );
}

export function WorkspaceAssignmentPending({
  email,
  role,
  message,
}: {
  email: string;
  role: AppRole;
  message: string;
}) {
  return (
    <section className="mx-auto grid max-w-5xl gap-6 px-5 py-10 sm:px-8">
      <div className="rounded-sm border border-border-system bg-card p-8 shadow-2xl shadow-black/30">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-status-attention-text">
          Workspace Assignment Pending
        </p>
        <h1 className="mt-3 max-w-3xl font-serif text-4xl font-normal leading-tight text-foreground">
          This user is registered but not attached to an organization.
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-text-muted">
          Link{" "}
          <span
            className={`${inlineSignalClass} ${inlineSignalToneStyles.info} break-all`}
          >
            {email}
          </span>{" "}
          as{" "}
          <span
            className={`${inlineSignalClass} ${inlineSignalToneStyles.healthy}`}
          >
            {roleLabels[role]}
          </span>{" "}
          to the existing owner workspace, then sign out and sign back in.
        </p>
        {message ? <div className="mt-5"><NoticeBanner message={message} /></div> : null}
      </div>
    </section>
  );
}
