import type { ReactNode } from "react";

export type SemanticTone = "healthy" | "attention" | "critical" | "info";
export type FinancialTrendKey =
  | "revenue"
  | "waste"
  | "priceImpact"
  | "stockVariance";
export type FinancialTrendPoint = {
  dateKey: string;
  label: string;
  revenue: number;
  waste: number;
  priceImpact: number;
  stockVariance: number;
};

export function TrendBadge({
  trend,
}: {
  trend: { symbol: string; label: string; tone: SemanticTone };
  inverse?: boolean;
}) {
  const toneClass =
    trend.tone === "healthy"
      ? "border-accent-muted-border bg-accent-muted-bg text-accent"
      : trend.tone === "attention"
        ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
        : trend.tone === "critical"
          ? "border-status-critical-border bg-status-critical-bg text-status-critical-text"
          : "border-status-info-border bg-status-info-bg text-status-info-text";

  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-sm border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider ${toneClass}`}
    >
      <span>{trend.symbol}</span>
      <span>{trend.label}</span>
    </span>
  );
}

export function ExecutiveKpiCard({
  metric,
  inverse = false,
}: {
  metric: {
    label: string;
    value: string;
    detail: string;
    priority: "hero" | "large" | "medium";
    tone: SemanticTone;
    trend: { symbol: string; label: string; tone: SemanticTone };
  };
  inverse?: boolean;
}) {
  const toneClass =
    metric.tone === "healthy"
      ? inverse
        ? "border-accent-muted-border/70 bg-accent-muted-bg/35"
        : "border-accent-muted-border bg-accent-muted-bg"
      : metric.tone === "attention"
        ? inverse
          ? "border-status-attention-border/70 bg-status-attention-bg/45"
          : "border-status-attention-border bg-status-attention-bg"
        : metric.tone === "critical"
          ? inverse
            ? "border-status-critical-border/70 bg-status-critical-bg/45"
            : "border-status-critical-border bg-status-critical-bg"
          : inverse
            ? "border-border-system bg-background/70"
            : "border-status-info-border bg-status-info-bg";
  const valueClass =
    metric.priority === "hero"
      ? "text-4xl"
      : metric.priority === "large"
        ? "text-3xl"
        : "text-2xl";

  return (
    <article
      className={`flex min-h-[168px] min-w-0 flex-col justify-between rounded-sm border p-5 shadow-inner shadow-black/10 ${toneClass}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={`font-mono text-[10px] font-bold uppercase tracking-widest ${
              inverse ? "text-text-ghost" : "text-text-muted"
            }`}
          >
            {metric.label}
          </p>
          <p
            className={`mt-4 max-w-full whitespace-nowrap font-mono font-semibold leading-tight tracking-tight text-foreground ${valueClass}`}
          >
            {metric.value}
          </p>
        </div>
        <TrendBadge trend={metric.trend} inverse={inverse} />
      </div>
      <p className="mt-4 text-sm text-text-muted">{metric.detail}</p>
    </article>
  );
}

export function FinancialTrendChart({
  points,
  currency,
}: {
  points: FinancialTrendPoint[];
  currency: string;
}) {
  const series: Array<{
    key: FinancialTrendKey;
    label: string;
    stroke: string;
    toneClass: string;
  }> = [
    {
      key: "revenue",
      label: "Revenue",
      stroke: "var(--accent-primary)",
      toneClass: "border-accent-muted-border bg-accent-muted-bg text-accent",
    },
    {
      key: "waste",
      label: "Waste",
      stroke: "var(--critical-text)",
      toneClass:
        "border-status-critical-border bg-status-critical-bg text-status-critical-text",
    },
    {
      key: "priceImpact",
      label: "Price impact",
      stroke: "var(--attention-text)",
      toneClass:
        "border-status-attention-border bg-status-attention-bg text-status-attention-text",
    },
    {
      key: "stockVariance",
      label: "Stock variance",
      stroke: "var(--info-text)",
      toneClass:
        "border-status-info-border bg-status-info-bg text-status-info-text",
    },
  ];
  const width = 720;
  const height = 240;
  const paddingX = 36;
  const paddingTop = 28;
  const paddingBottom = 38;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingTop - paddingBottom;
  const safePoints =
    points.length > 0
      ? points
      : [
          {
            dateKey: "",
            label: "No data",
            revenue: 0,
            waste: 0,
            priceImpact: 0,
            stockVariance: 0,
          },
        ];
  const xForIndex = (index: number) =>
    safePoints.length === 1
      ? paddingX + plotWidth / 2
      : paddingX + (index / (safePoints.length - 1)) * plotWidth;
  const yForValue = (value: number, key: FinancialTrendKey) => {
    const values = safePoints.map((point) => point[key]);
    const minValue = Math.min(0, ...values);
    const maxValue = Math.max(0, ...values);
    const range = maxValue - minValue || 1;

    return paddingTop + ((maxValue - value) / range) * plotHeight;
  };
  const linePathFor = (key: FinancialTrendKey) =>
    safePoints
      .map((point, index) => {
        const command = index === 0 ? "M" : "L";

        return `${command} ${xForIndex(index).toFixed(2)} ${yForValue(
          point[key],
          key,
        ).toFixed(2)}`;
      })
      .join(" ");
  const latestPoint = safePoints[safePoints.length - 1];

  return (
    <div className="mt-5 overflow-hidden rounded-sm border border-border-system bg-background">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border-system px-5 py-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
            Trend intelligence
          </p>
          <h3 className="mt-1 text-lg font-semibold text-foreground">
            Revenue, Waste, Price Impact
          </h3>
        </div>
        <span className="rounded-full border border-border-system bg-card px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
          {safePoints.length.toLocaleString()} point
          {safePoints.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Financial trend line chart"
            className="min-h-[240px] w-full min-w-[620px]"
          >
            {[0, 1, 2, 3].map((line) => {
              const y = paddingTop + (line / 3) * plotHeight;

              return (
                <line
                  key={line}
                  x1={paddingX}
                  x2={width - paddingX}
                  y1={y}
                  y2={y}
                  stroke="var(--card-border)"
                  strokeDasharray={line === 3 ? "0" : "4 8"}
                  strokeWidth="1"
                />
              );
            })}
            {series.map((item) => (
              <path
                key={item.key}
                d={linePathFor(item.key)}
                fill="none"
                stroke={item.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
              />
            ))}
            {series.flatMap((item) =>
              safePoints.map((point, index) => (
                <circle
                  key={`${item.key}-${point.dateKey || index}`}
                  cx={xForIndex(index)}
                  cy={yForValue(point[item.key], item.key)}
                  r="3.5"
                  fill="var(--background)"
                  stroke={item.stroke}
                  strokeWidth="2"
                />
              )),
            )}
            {safePoints.map((point, index) => (
              <text
                key={point.dateKey || index}
                x={xForIndex(index)}
                y={height - 10}
                textAnchor="middle"
                fill="var(--text-ghost)"
                fontSize="11"
                fontWeight="700"
              >
                {point.label}
              </text>
            ))}
          </svg>
        </div>

        <div className="grid content-start gap-3">
          {series.map((item) => (
            <div
              key={item.key}
              className={`rounded-sm border px-3 py-2 ${item.toneClass}`}
            >
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest">
                {item.label}
              </p>
              <p className="mt-1 font-mono text-lg font-semibold">
                {currency}{" "}
                {latestPoint[item.key].toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ActionCard({
  item,
  actionLabel,
  onOpen,
}: {
  item: {
    priority: string;
    action: string;
    detail: string;
    tone: "critical" | "attention" | "info";
  };
  actionLabel?: string;
  onOpen?: () => void;
}) {
  const toneClass =
    item.tone === "critical"
      ? "border-status-critical-border bg-status-critical-bg"
      : item.tone === "attention"
        ? "border-status-attention-border bg-status-attention-bg"
        : "border-status-info-border bg-status-info-bg";
  const badgeClass =
    item.tone === "critical"
      ? "border-status-critical-border bg-status-critical-bg text-status-critical-text"
      : item.tone === "attention"
        ? "border-status-attention-border bg-status-attention-bg text-status-attention-text"
        : "border-status-info-border bg-status-info-bg text-status-info-text";

  return (
    <article className={`rounded-sm border p-5 ${toneClass}`}>
      <span
        className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${badgeClass}`}
      >
        {item.priority}
      </span>
      <h3 className="mt-3 text-base font-semibold text-foreground">
        {item.action}
      </h3>
      <p className="mt-2 text-sm leading-6 text-text-muted">{item.detail}</p>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="mt-4 h-9 rounded-sm border border-border-system bg-card px-3 text-xs font-bold uppercase tracking-wider text-text-muted transition hover:border-border-system-hover hover:text-foreground"
        >
          {actionLabel ?? "Open"}
        </button>
      ) : null}
    </article>
  );
}

export function MetricPill({
  label,
  value,
  detail,
  valueClassName = "font-semibold text-foreground",
}: {
  label: string;
  value: string;
  detail?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-sm border border-border-system bg-background px-3 py-2">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost">
        {label}
      </p>
      <p className={`mt-1 whitespace-nowrap ${valueClassName}`}>{value}</p>
      {detail ? (
        <p className="mt-1 text-xs leading-4 text-text-muted">{detail}</p>
      ) : null}
    </div>
  );
}

export function Cell({
  label,
  children,
  strong = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className="grid gap-1 lg:block">
      <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-ghost lg:hidden">
        {label}
      </span>
      <span
        className={`${strong ? "font-semibold text-current" : ""} ${className}`}
      >
        {children}
      </span>
    </div>
  );
}
