# ProfitPlate Actual-vs-Theoretical model

Actual-vs-Theoretical (AvT) compares what should have happened according to
recipes and POS sales against what actually happened in operations.

## Foundation

AvT depends on three controls already introduced:

1. POS business-date reconciliation.
2. Sales depletion location routing.
3. Operating-day close and reconciliation status.

Without those, AvT can produce attractive but misleading numbers.

## Evidence used

The first AvT read model uses:

- POS/menu sales by `operating_date`.
- `sales_depletion` transformation events as theoretical food cost.
- Production variance from `variance_attributions`.
- Waste cost from `waste_events`.
- Stock variance from approved stock variance attributions.
- Operating-day financial reconciliation status.

## Status labels

Each AvT row has a readiness status:

- `ready`: sales, depletion, and reconciliation evidence are present.
- `provisional`: the operating day exists but financial reconciliation is not
  complete.
- `missing_pos`: no POS/menu revenue exists for that date/location.
- `missing_depletion`: sales exist, but recipe depletion did not post.
- `exception`: reserved for later explicit AvT review exceptions.

## Owners

- Finance Manager owns AvT review and margin interpretation.
- Operations Manager owns operating-day readiness and unresolved controls.
- Inventory Manager owns stock variance and location stock accuracy.
- Kitchen Manager owns production variance explanations.
- Owner receives escalated exposure and unresolved exceptions.

## How it should be used

AvT should not only say “variance exists.” It should tell the manager why the
number can or cannot be trusted:

- missing POS means revenue is incomplete;
- missing depletion means recipes/components/routing are incomplete;
- provisional means Finance has not reconciled the POS period;
- ready means the number is suitable for management review.

## Migration 038

Migration `038_actual_vs_theoretical_foundation.sql` adds:

- `avt_daily_snapshots`
- `get_dashboard_avt_summary`
- `refresh_dashboard_avt_snapshots`

The dashboard reads AvT live from `get_dashboard_avt_summary`. Snapshots can be
refreshed later for audit, reporting, or month-end close.
