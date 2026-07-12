import Image from "next/image";
import Link from "next/link";

const currentSystemStatus: "implementation_mode" | "live_operations" =
  "live_operations";

type Trend = "positive" | "negative" | "neutral";

const trendTextClass: Record<Trend, string> = {
  positive: "text-accent",
  negative: "text-status-critical-text",
  neutral: "text-text-muted",
};

const liveKPIs: {
  label: string;
  value: string;
  change: string;
  status: string;
  size: "medium" | "large";
  trend: Trend;
}[] = [
  {
    label: "Net POS Revenue",
    value: "NGN 2.18m",
    change: "after promos and voids",
    status: "POS import reconciled to recipes",
    size: "medium",
    trend: "positive",
  },
  {
    label: "Yield Loss at Risk",
    value: "NGN 184,200",
    change: "protein tests due",
    status: "Supplier quality and trimming visible",
    size: "medium",
    trend: "negative",
  },
  {
    label: "Open Daily Registers",
    value: "2",
    change: "production, stock count",
    status: "Immutable log: Errors require adjustment entry",
    size: "medium",
    trend: "negative",
  },
  {
    label: "POS Import",
    value: "Synced",
    change: "updated 8 min ago",
    status: "Sales reconciled to recipes",
    size: "medium",
    trend: "positive",
  },
  {
    label: "System Status",
    value: "LIVE",
    change: "Data current",
    status: "Last operating sync: 8 minutes ago",
    size: "large",
    trend: "positive",
  },
];

const priorityAlerts = [
  {
    type: "Immutable Guard",
    title: "Zero-Edit Protocol Active",
    detail:
      "All entries are locked instantly upon submission. Modifying or erasing logs is strictly disabled. Submit a fresh adjustment entry to correct discrepancies.",
    style:
      "border-status-critical-border bg-status-critical-bg text-status-critical-text",
  },
  {
    type: "Daily Register",
    title: "Production register still open",
    detail:
      "No production activity has been recorded or declared clear for today's operating date.",
    style:
      "border-status-critical-border bg-status-critical-bg text-status-critical-text",
  },
  {
    type: "POS Import",
    title: "14 POS items need mapping",
    detail:
      "Map item codes once, then future sales imports will match ProfitPlate recipes automatically.",
    style:
      "border-status-attention-border bg-status-attention-bg text-status-attention-text",
  },
];

const setupSteps = [
  {
    step: "01",
    title: "Standardize ingredients",
    desc: "List each ingredient once, with clear purchase, recipe, and stock units.",
  },
  {
    step: "02",
    title: "Confirm recipe yields",
    desc: "Define batch output and expected yield so waste can be measured properly.",
  },
  {
    step: "03",
    title: "Link recipes to menu",
    desc: "Connect final menu items to recipes so cost, waste, and sales margin flow together.",
  },
  {
    step: "04",
    title: "Map POS sales",
    desc: "Match POS item names or codes to ProfitPlate menu items once, then reuse the mapping.",
  },
  {
    step: "05",
    title: "Test high-value yields",
    desc: "Run periodic yield tests for proteins and perishables so recipe costing reflects usable weight.",
  },
  {
    step: "06",
    title: "Run daily registers",
    desc: "Require teams to confirm activity, no activity, or exceptions. Zero overrides allowed post-submission.",
  },
];

const locationMetrics = [
  {
    name: "Lagos Mainland (HQ Kitchen)",
    yieldVar: "NGN 12,400",
    wasteVar: "NGN 8,100",
    priceVar: "NGN 0 Safe",
    status: "Optimal",
    rowStyle: "border-border-system",
  },
  {
    name: "Lagos Island Outlet",
    yieldVar: "NGN 84,200",
    wasteVar: "NGN 41,500",
    priceVar: "NGN 18,900 Leak",
    status: "Critical",
    rowStyle: "border-status-critical-border/30 bg-status-critical-bg/10",
  },
  {
    name: "Lekki Hub Kitchen",
    yieldVar: "NGN 22,100",
    wasteVar: "NGN 16,400",
    priceVar: "NGN 4,200 Attn",
    status: "Attention",
    rowStyle: "border-status-attention-border/30 bg-status-attention-bg/10",
  },
];

const strategicIndexes = [
  {
    title: "Daily Activity to Financial Visibility",
    body: "Connect what teams buy, receive, trim, prepare, waste, sell, discount, void, and approve to the margin impact.",
    tracking: "1. Overview",
  },
  {
    title: "Data Setup & Checks",
    body: "Ingredient, recipe, supplier, and menu data must be standardized before live controls switch on.",
    tracking: "2. Setup",
  },
  {
    title: "Procurement & Requisitions",
    body: "Track supplier pricing, purchase orders, stock requisitions, and confirmed receipt before cost leaks reach recipes.",
    tracking: "3. Procurement",
  },
  {
    title: "Recipe Costing & Production",
    body: "Compare recipe standards against actual usage, production variance, poor yield, and over-trimming.",
    tracking: "4. Recipes",
  },
  {
    title: "POS Sales & Net Revenue",
    body: "Import POS files, map item codes to recipes, and preserve discounts, promos, voids, gross sales, and net sales.",
    tracking: "5. POS",
  },
  {
    title: "Daily Operations Compliance",
    body: "Make sales, procurement, production, waste, stock count, opening, and closing checks completely unalterable and auditable.",
    tracking: "6. Compliance",
  },
  {
    title: "Periodic Yield Testing",
    body: "Track supplier quality and over-trimming for proteins and perishables before costing assumptions go stale.",
    tracking: "7. Yield",
  },
];

const posImportRows = [
  {
    pos: "JOL-LRG",
    item: "Jollof Rice Large",
    mapped: "Jollof Rice - Large Plate",
    qty: "12",
    net: "NGN 57,000",
  },
  {
    pos: "ASUN-001",
    item: "Asun",
    mapped: "Asun Portion",
    qty: "8",
    net: "NGN 44,000",
  },
  {
    pos: "COMBO-22",
    item: "Lunch Combo Jollof",
    mapped: "Jollof Rice - Large Plate",
    qty: "5",
    net: "NGN 21,500",
  },
];

const complianceRegisters = [
  { label: "Sales register", status: "Locked", tone: "positive" as Trend },
  { label: "Procurement register", status: "Locked", tone: "positive" as Trend },
  { label: "Production register", status: "Open", tone: "negative" as Trend },
  { label: "Waste register", status: "No activity declared", tone: "neutral" as Trend },
  { label: "Stock count register", status: "Open", tone: "negative" as Trend },
  { label: "Closing readiness", status: "Pending", tone: "neutral" as Trend },
];

const yieldTestRows = [
  {
    sku: "BEEF-FILLET",
    test: "Test 1",
    yield: "79%",
    note: "Heavy trim",
  },
  {
    sku: "BEEF-FILLET",
    test: "Test 2",
    yield: "82%",
    note: "Normal trim",
  },
  {
    sku: "BEEF-FILLET",
    test: "Test 3",
    yield: "80%",
    note: "Master yield updated",
  },
];

export default function Home() {
  return (
    <div id="top" className="max-w-full overflow-x-hidden flex min-h-screen flex-col bg-background font-sans antialiased text-foreground [--accent-hover:#0d5d3d] [--accent-muted-bg:#e6f3eb] [--accent-muted-border:#c9e2d3] [--accent-primary:#126b46] [--attention-bg:#fff6dc] [--attention-border:#eedca8] [--attention-text:#9a6500] [--background:#f5f8f6] [--card-bg:#ffffff] [--card-border:#d9e2dd] [--card-border-hover:#aebdb5] [--critical-bg:#fff0ed] [--critical-border:#efc6be] [--critical-text:#bd3b2c] [--foreground:#10261c] [--info-bg:#eef5f7] [--info-border:#cbdde2] [--info-text:#356b78] [--text-ghost:#71877c] [--text-muted:#4f665b]">
      <header className="sticky top-0 z-50 border-b border-border-system/80 bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-8">
          <Link href="/" className="flex min-w-0 shrink items-center gap-2 sm:gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-accent/15 bg-white shadow-sm">
              <Image
                src="/ProfitPlate logo.png.png"
                alt="ProfitPlate Logo"
                width={72}
                height={72}
                priority
                className="h-8 w-8 object-contain"
              />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-extrabold leading-none text-foreground tracking-tight">
                ProfitPlate
              </span>
              <span className="mt-1 hidden font-mono text-[9px] uppercase tracking-widest text-text-ghost sm:block">
                Daily margin control for restaurants
              </span>
            </span>
          </Link>

          <nav
            className="flex shrink-0 items-center gap-1 sm:gap-3"
            aria-label="Public navigation"
          >
            <span
              className={`hidden items-center rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider md:inline-flex ${
                currentSystemStatus === "live_operations"
                  ? "border-accent/30 bg-accent-muted-bg text-accent"
                  : "border-status-attention-border bg-status-attention-bg text-status-attention-text"
              }`}
            >
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
              {currentSystemStatus === "live_operations" ? "Live Control" : "Setup"}
            </span>
            <Link
              href="/login"
              className="whitespace-nowrap px-2 py-2 text-xs font-semibold text-text-muted transition hover:text-foreground sm:px-3"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="whitespace-nowrap rounded-md bg-accent px-2.5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-accent-hover sm:px-5"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* MAIN BODY CONTENT WRAPPER */}
      <main className="flex-1">
        {/* CORE HERO VALUE PROPOSITION */}
        <section className="border-b border-border-system bg-background">
          <div className="mx-auto max-w-7xl px-5 pb-8 pt-10 sm:px-8 sm:pt-14 lg:pb-10 lg:pt-16">
            <div className="grid min-w-0 gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center xl:gap-16">
              <div className="min-w-0 max-w-2xl">
                <span className="inline-flex max-w-full rounded-full border border-accent-muted-border bg-white px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-accent shadow-sm">
                  Operational Discipline Protocol
                </span>

                <h1 className="mt-6 max-w-[15ch] font-sans font-extrabold tracking-tight text-[2.35rem] leading-[1.08] text-foreground sm:text-5xl lg:text-[3.65rem]">
                  Turn restaurant activity into financial visibility.
                </h1>

                <p className="mt-6 max-w-xl text-sm leading-7 text-text-muted sm:text-base">
                  Eliminate kitchen assumptions. See exactly where profit leaks through{" "}
                  <strong className="font-semibold text-foreground">supplier pricing</strong>
                  , poor yield, over-trimming, waste, stock movement, recipe
                  costing, production variance, POS discounts, voids, and weak
                  approval controls.
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/signup"
                    className="rounded-md bg-accent px-6 py-3.5 text-center text-xs font-bold text-white shadow-sm transition hover:bg-accent-hover"
                  >
                    Get started
                  </Link>
                  <a
                    href="#live-preview"
                    className="rounded-md border border-border-system bg-white px-6 py-3.5 text-center text-xs font-bold text-foreground shadow-sm transition hover:border-border-system-hover"
                  >
                    See operating dashboard
                  </a>
                </div>
              </div>

              {/* LIVE PREVIEW MODULE */}
              <div
                id="live-preview"
                className="relative min-w-0 rounded-lg border border-border-system bg-white p-4 shadow-[0_24px_70px_rgba(25,65,45,0.12)] sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-system pb-4">
                  <div>
                    <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                      Live operating example
                    </span>
                    <h2 className="mt-1 font-sans font-extrabold tracking-tight text-xl text-foreground sm:text-2xl">
                      Today&apos;s margin control
                    </h2>
                  </div>
                  <span className="rounded-full border border-accent-muted-border bg-accent-muted-bg px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-widest text-accent">
                    Updated 8m ago
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {liveKPIs.map((kpi) => (
                    <div
                      key={kpi.label}
                      className={`relative flex min-h-28 flex-col overflow-hidden rounded-md border border-border-system p-4 ${
                        kpi.size === "large"
                          ? "min-h-0 border-accent-muted-border bg-accent-muted-bg sm:col-span-2"
                          : "bg-background"
                      }`}
                    >
                      <span
                        className={`absolute inset-y-0 left-0 w-0.5 ${
                          kpi.trend === "negative"
                            ? "bg-status-critical-text"
                            : kpi.trend === "positive"
                              ? "bg-accent"
                              : "bg-text-ghost"
                        }`}
                      />
                      <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                        {kpi.label}
                      </span>
                      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p
                          className={`font-mono font-semibold ${
                            kpi.size === "large"
                              ? "text-2xl text-accent"
                              : "text-xl text-foreground"
                          }`}
                        >
                          {kpi.value}
                        </p>
                        <span
                          className={`font-mono text-[10px] font-semibold ${trendTextClass[kpi.trend]}`}
                        >
                          {kpi.change}
                        </span>
                      </div>
                      <p
                        className={`mt-auto pt-2 text-[11px] leading-4 ${
                          kpi.size === "large"
                            ? "text-accent"
                            : "text-text-muted"
                        }`}
                      >
                        {kpi.status}
                      </p>
                    </div>
                  ))}
                </div>

                {/* DYNAMIC ATTENTION REGISTRY */}
                <div className="mt-4 rounded-md border border-border-system bg-white p-4">
                  <div className="flex items-center justify-between gap-4 border-b border-border-system pb-3">
                    <h3 className="text-sm font-bold text-foreground">
                      What needs your attention
                    </h3>
                    <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-text-ghost">
                      Today&apos;s priorities
                    </span>
                  </div>

                  <div className="divide-y divide-border-system">
                    {priorityAlerts.slice(0, 3).map((alert) => (
                      <div key={alert.title} className="py-3 last:pb-0">
                        <span
                          className={`inline-flex rounded-sm border px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider ${alert.style}`}
                        >
                          {alert.type}
                        </span>
                        <p className="mt-1.5 text-xs font-bold text-foreground">
                          {alert.title}
                        </p>
                        <p className="mt-1 text-[11px] leading-4 text-text-muted">
                          {alert.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 grid border-y border-border-system bg-white sm:grid-cols-3">
              {[
                ["Purchasing to plate", "Costs cascade automatically into recipes"],
                ["Immutable accountability", "Logs lock instantly; adjustments form clear audit trails"],
                ["Location visibility", "Stock and margins stay perfectly comparable across Lagos outlets"],
              ].map(([title, detail]) => (
                <div
                  key={title}
                  className="border-b border-border-system px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
                >
                  <p className="text-xs font-bold text-foreground">{title}</p>
                  <p className="mt-1 text-[11px] leading-4 text-text-muted">
                    {detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* IMPLEMENTATION ROADMAP ARCHITECTURE */}
      <section className="border-b border-border-system bg-card/10">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
          <div className="mb-20">
            <div className="mb-8 border-b border-border-system pb-4">
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
                Implementation Path
              </span>
              <h2 className="mt-1 font-sans font-extrabold tracking-tight text-2xl text-foreground">
                Get clean data, then run the day with unyielding controls.
              </h2>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {setupSteps.map((step) => (
                <div
                  key={step.step}
                  className="relative rounded-sm border border-border-system bg-card p-5"
                >
                  <span className="absolute right-4 top-4 font-mono text-xs font-bold text-text-ghost">
                    {step.step}
                  </span>
                  <h3 className="pr-6 text-xs font-bold text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-text-muted">
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* GEOGRAPHIC MARGIN SPILLS BREAKDOWN */}
          <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:items-start">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-accent">
                See Where Margin Is Leaking
              </span>
              <h2 className="mt-3 font-sans font-extrabold tracking-tight text-2xl leading-tight text-foreground">
                Every controllable loss, broken down clearly.
              </h2>
              <p className="mt-4 text-xs leading-relaxed text-text-muted">
                ProfitPlate clarifies exactly whether a localized margin drop stems from volatile supplier pricing,
                poor kitchen yield, unapproved over-trimming, structural waste, unrecorded store movement, or raw production variance.
              </p>
            </div>

            <div className="overflow-hidden rounded-sm border border-border-system bg-background shadow-xl">
              <div className="flex items-center justify-between border-b border-border-system bg-card px-5 py-4">
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Actual vs Standard, By Location
                </span>
                <span className="h-2 w-2 rounded-full bg-accent" />
              </div>
              <div>
                <div className="divide-y divide-border-system font-mono text-[11px]">
                  {locationMetrics.map((location) => (
                    <div
                      key={location.name}
                      className={`grid gap-3 px-4 py-4 transition hover:bg-card/30 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5 ${location.rowStyle}`}
                    >
                      <div className="min-w-0">
                        <p className="font-sans text-xs font-bold text-foreground">
                          {location.name}
                        </p>
                        <p className="mt-0.5 text-[10px] text-text-ghost">
                          Price vs contract: {location.priceVar}
                        </p>
                      </div>
                      <div className="space-y-0.5 sm:text-right">
                        <p className="text-foreground">
                          Yield loss:{" "}
                          <span className="font-bold text-status-critical-text">
                            {location.yieldVar}
                          </span>
                        </p>
                        <p className="text-[10px] text-text-muted">
                          Waste loss: {location.wasteVar}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STRATEGIC CONTROL INDEX */}
      <section id="platform" className="mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-accent">
            What ProfitPlate Controls
          </span>
          <h2 className="mt-3 font-sans font-extrabold tracking-tight text-3xl text-foreground sm:text-4xl">
            Everything that affects restaurant margin, connected to accountability.
          </h2>
          <p className="mt-4 text-sm text-text-muted">
            Purchasing, storage requisitions, recipes, production, yield tests,
            waste logs, and POS tracking unify seamlessly. The system calculates and explains real margin outcomes instead of merely observing them.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {strategicIndexes.map((index) => (
            <div
              key={index.title}
              className="group relative flex flex-col justify-between border border-border-system bg-card/40 p-5 transition hover:border-border-system-hover hover:bg-card sm:p-8"
            >
              <div className="absolute left-0 top-0 h-0.5 w-0 bg-accent transition-all duration-300 group-hover:w-12" />
              <div>
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-accent">
                  {index.tracking}
                </span>
                <h3 className="font-sans font-bold text-xl text-foreground transition group-hover:text-accent">
                  {index.title}
                </h3>
                <p className="mt-3 text-xs leading-relaxed text-text-muted">
                  {index.body}
                </p>
              </div>
              <div className="mt-6 flex justify-end">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-text-ghost transition group-hover:text-foreground">
                  Learn more
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* WORKFLOW VERIFICATION ENGINES */}
      <section id="workflows" className="border-y border-border-system bg-card/20">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-8 sm:py-24 lg:grid-cols-2">
          
          {/* INTERACTION DECK 1: POS CODES */}
          <div className="rounded-sm border border-border-system bg-card p-4 sm:p-6">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              POS Import & Mapping
            </span>
            <h2 className="mt-2 font-sans font-extrabold tracking-tight text-2xl text-foreground">
              One recipe can match many POS item names or codes.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-text-muted">
              Upload daily POS exports, map unmatched item names or PLU codes to
              ProfitPlate menu items, and lock those parameters. Gross sales, promotions, voids, and true net sales are preserved cleanly across every calculation.
            </p>

            <div className="mt-6 overflow-hidden rounded-sm border border-border-system bg-background">
              <div>
                <div>
                  <div className="hidden grid-cols-[0.7fr_1fr_1fr_0.45fr_0.8fr] gap-3 border-b border-border-system bg-card px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost sm:grid">
                    <span>POS</span>
                    <span>Export item</span>
                    <span>Maps to</span>
                    <span>Qty</span>
                    <span>Net</span>
                  </div>
                  {posImportRows.map((row) => (
                    <div
                      key={`${row.pos}-${row.item}`}
                      className="grid gap-2 border-t border-border-system px-4 py-3 text-xs text-text-muted sm:grid-cols-[0.7fr_1fr_1fr_0.45fr_0.8fr]"
                    >
                      <span className="font-mono text-text-ghost">
                        <span className="mr-2 font-bold uppercase tracking-widest sm:hidden">
                          POS
                        </span>
                        {row.pos}
                      </span>
                      <span className="font-semibold text-foreground">
                        {row.item}
                      </span>
                      <span>
                        <span className="mr-2 font-bold uppercase tracking-widest sm:hidden">
                          Maps to
                        </span>
                        {row.mapped}
                      </span>
                      <span>
                        <span className="mr-2 font-bold uppercase tracking-widest sm:hidden">
                          Qty
                        </span>
                        {row.qty}
                      </span>
                      <span className="font-semibold text-foreground">
                        {row.net}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* INTERACTION DECK 2: ZERO-EDIT COMPLIANCE RUNNER */}
          <div className="rounded-sm border border-border-system bg-card p-4 sm:p-6">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
              Daily Operations Compliance
            </span>
            <h2 className="mt-2 font-sans font-extrabold tracking-tight text-2xl text-foreground">
              No activity is a validation, never missing data.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-text-muted">
              Teams confirm complete metrics, zero activity, or explicit discrepancies. Once a register is committed, it is structurally frozen. Human error requires a counterbalancing reconciliation log, completely eliminating ghost alterations.
            </p>

            <div className="mt-6 grid gap-3">
              {complianceRegisters.map((register) => (
                <div
                  key={register.label}
                  className="flex items-center justify-between rounded-sm border border-border-system bg-background px-4 py-3"
                >
                  <span className="text-sm font-semibold text-foreground">
                    {register.label}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                      register.tone === "positive"
                        ? "border-accent-muted-border bg-accent-muted-bg text-accent"
                        : register.tone === "negative"
                          ? "border-status-critical-border bg-status-critical-bg text-status-critical-text"
                          : "border-status-info-border bg-status-info-bg text-status-info-text"
                    }`}
                  >
                    {register.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CONTINUOUS YIELD ENGINE METRICS */}
      <section className="border-b border-border-system bg-background">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-accent">
              Periodic Yield Testing
            </span>
            <h2 className="mt-3 font-sans font-extrabold tracking-tight text-3xl leading-tight text-foreground">
              Supplier quality and kitchen trimming now impact pricing directly.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-text-muted">
              High-value proteins and fresh perishables are monitored systematically. Following three standalone, immutable verification tests, ProfitPlate locks down the averaged outcome directly into the master SKU registry—preventing variance analysis from lagging behind changes in market supply.
            </p>
          </div>

          <div className="rounded-sm border border-border-system bg-card p-4 sm:p-6">
            <div className="flex items-start justify-between gap-4 border-b border-border-system pb-4">
              <div>
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
                  Example: Beef Fillet
                </span>
                <h3 className="mt-1 font-sans font-bold text-xl text-foreground">
                  Three tests before master yield changes
                </h3>
              </div>
              <span className="rounded-sm border border-status-attention-border bg-status-attention-bg px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-attention-text">
                30 day control
              </span>
            </div>

            <div className="mt-5 grid gap-3">
              {yieldTestRows.map((row) => (
                <div
                  key={`${row.sku}-${row.test}`}
                  className="grid gap-3 rounded-sm border border-border-system bg-background p-4 sm:grid-cols-[0.9fr_0.5fr_0.4fr_1fr] sm:items-center"
                >
                  <span className="font-mono text-[11px] font-bold text-text-ghost">
                    {row.sku}
                  </span>
                  <span className="text-xs font-semibold text-foreground">
                    {row.test}
                  </span>
                  <span className="font-mono text-sm font-bold text-accent">
                    {row.yield}
                  </span>
                  <span className="text-xs text-text-muted">{row.note}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-sm border border-accent-muted-border bg-accent-muted-bg p-4">
              <p className="text-xs font-semibold leading-relaxed text-accent">
                New master yield: 80.3%. Management,
                Inventory, and the Kitchen receive the confirmation alert.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CALL TO ACCOUNTABILITY */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
        <div className="relative overflow-hidden rounded-sm border border-border-system bg-card px-5 py-12 sm:px-12 sm:py-16 lg:flex lg:items-center lg:justify-between lg:gap-12">
          <div className="absolute left-0 top-0 h-full w-0.5 bg-accent" />

          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-widest text-accent">
              Ready When You Are
            </span>
            <h2 className="mt-3 font-sans font-extrabold tracking-tight text-3xl leading-snug text-foreground sm:text-4xl">
              Stop finding out about margin problems at month-end.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-text-muted">
              Turn daily shifts into dynamic management oversight before unexpected trimming variances, unnotified supplier spikes, or missing logs distort your bottom line.
            </p>
          </div>
          <div className="mt-8 shrink-0 lg:mt-0">
            <Link
              href="/signup"
              className="inline-block rounded-md bg-accent px-6 py-4 text-center text-xs font-bold text-white shadow-sm transition hover:bg-accent-hover"
            >
              Secure Your Margins Now
            </Link>
          </div>
        </div>
      </section>
    </main>

    {/* GLOBAL ROOT FOOTER */}
    <footer className="mt-auto border-t border-border-system bg-white">
      <div className="mx-auto max-w-7xl px-6 py-12 sm:px-8 lg:py-16">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4 lg:gap-12">
          
          {/* BRANDING SECTION */}
          <div className="sm:col-span-2 md:col-span-1">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-accent/15 bg-white shadow-sm">
                <Image
                  src="/ProfitPlate logo.png.png"
                  alt="ProfitPlate Logo"
                  width={48}
                  height={48}
                  className="h-5 w-5 object-contain"
                />
              </span>
              <span className="font-sans font-extrabold text-sm tracking-tight text-foreground">
                ProfitPlate
              </span>
            </div>
            <p className="mt-4 text-[11px] leading-5 text-text-muted">
              Turn volatile daily activities into structural financial visibility. Unyielding margin intelligence built exclusively for modern culinary operations.
            </p>
          </div>

          {/* PLATFORM MODULES LINKS */}
          <div>
            <h4 className="font-mono text-[10px] font-bold uppercase tracking-wider text-text-ghost">
              Platform Controls
            </h4>
            <ul className="mt-4 space-y-2 text-[11px]">
              {[
                ["Procurement & Requisitions", "/procurement"],
                ["Recipe Costing & Yields", "/recipes"],
                ["POS Import Mapping", "/pos-sales"],
                ["Daily Compliance Logs", "/compliance"],
              ].map(([label, route]) => (
                <li key={label}>
                  <Link href={route} className="text-text-muted hover:text-accent transition">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* INTEGRITY & SYSTEM RESOURCES */}
          <div>
            <h4 className="font-mono text-[10px] font-bold uppercase tracking-wider text-text-ghost">
              System Framework
            </h4>
            <ul className="mt-4 space-y-2 text-[11px]">
              {[
                ["Zero-Edit Protocol Specs", "/docs/immutable-protocol"],
                ["Master SKU Framework", "/docs/sku-standards"],
                ["Yield Test Workflows", "/docs/yield-methodology"],
                ["Operational Auditing", "/docs/audit-trails"],
              ].map(([label, route]) => (
                <li key={label}>
                  <Link href={route} className="text-text-muted hover:text-accent transition">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* CORPORATE AND LEGAL COMPLIANCE */}
          <div>
            <h4 className="font-mono text-[10px] font-bold uppercase tracking-wider text-text-ghost">
              Governance
            </h4>
            <ul className="mt-4 space-y-2 text-[11px]">
              {[
                ["Security & Access Tiers", "/security"],
                ["Terms of Operation", "/terms"],
                ["Data Integrity Policy", "/privacy"],
                ["Contact Systems Desk", "/support"],
              ].map(([label, route]) => (
                <li key={label}>
                  <Link href={route} className="text-text-muted hover:text-accent transition">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

        </div>

        {/* ATTRIBUTION BOTTOM PANEL */}
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border-system pt-6 font-mono text-[10px] text-text-ghost sm:flex-row sm:items-center">
          <p>
            &copy; {new Date().getFullYear()} ProfitPlate. All operational rights reserved.
          </p>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            <span className="uppercase tracking-widest text-text-muted">
              System Status: Immutable Audit Active
            </span>
          </div>
        </div>
      </div>
    </footer>
    <a
      href="#top"
      className="fixed bottom-5 right-5 z-50 rounded-full border border-accent-muted-border bg-white/95 px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-accent shadow-[0_12px_36px_rgba(25,65,45,0.20)] backdrop-blur transition hover:bg-accent-muted-bg"
      aria-label="Back to top"
    >
      ↑ Top
    </a>
  </div>
  );
}
