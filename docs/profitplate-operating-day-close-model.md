# ProfitPlate Operating Day and Close Control

## Purpose

ProfitPlate treats day close as an operational control, not a date change or a
dashboard calculation. A closed operating day confirms that required restaurant
behaviours were performed, declared as having no activity, or escalated as an
exception.

## Operating-day configuration

Each workspace has organization defaults:

- An IANA operating timezone, defaulting to `Africa/Lagos`.
- A business-day cutoff, defaulting to `04:00`.
- An expected close time, defaulting to `23:59`.
- A close grace period, defaulting to 60 minutes.

The operating date is the restaurant's trading date. It must eventually be used
by POS sales, production, requisitions, receiving, waste, and stock counts.
Upload timestamps and database timestamps are audit timestamps; they are not
substitutes for the operating date.

Migration `034_configurable_operating_policies.sql` adds effective-dated
overrides at organization, location, and department level. A location or
department schedule may have different hours, overnight shifts, closed days,
and special-date overrides without changing historical schedules.

Deadlines should be anchored to an operational event or schedule, such as
dispatch time, department opening, department closing, or operating-day close.
Controls may pause their escalation clock while the responsible department is
outside its active schedule.

## State model

An operating day moves through:

1. `open`: teams can record normal operating activity.
2. `closing_review`: ProfitPlate has evaluated the blocking controls.
3. `closed`: an authorized approver confirmed that all blockers were resolved.
4. `locked`: the accounting period is immutable through normal operations.

A closed day may return to `open` only through an authorized reopen action with
a mandatory reason. A locked day cannot be reopened through the normal
dashboard workflow.

Operational closure and financial reconciliation are separate:

- Operational status confirms daily restaurant behaviours.
- Reconciliation status shows whether POS and financial data are awaiting
  data, provisional, reconciled, excepted, or not required.

A restaurant may therefore be operationally closed while POS reconciliation is
legitimately pending under an approved weekly import policy.

## Blocking controls

The first release requires explicit declarations for:

- Opening readiness
- Sales
- Procurement
- Open or pending purchase-order review
- Requisitions
- Production
- Waste
- Stock count

An absent declaration blocks close only when the effective control policy marks
that declaration as required. Recorded activity and accountable review remain
different controls.

Any register exception also blocks close. A requisition dispatched but not
acknowledged by its receiving department remains in transit and blocks close.

Control outcomes are:

- `satisfied`
- `deferred`
- `exception`
- `waived`
- `not_applicable`

Deferments require an active policy that permits them and a future deadline.
Waivers require approval authority, a reason, and a policy that permits them.

## POS import cadence

POS import policies support continuous, daily, weekly, selected-day, and manual
cadences. Each policy has a timezone, due time, applicable weekdays or weekly
period end, and an effective date range.

Weekly import does not mean weekly attribution. Imported rows must still be
split into their source business dates and locations. Until that import is
posted, relevant AvT results remain provisional. If a POS export contains only
a weekly aggregate, ProfitPlate must limit AvT reporting to that weekly period
rather than invent daily precision.

## Authority and separation of duties

- Users with operations-entry access may update registers and run the close
  review.
- Users with operations-approval access may close or reopen an operating day.
- Dispatching stock does not authorize the dispatcher to acknowledge receipt
  on behalf of the destination department.
- Every review, close, lock, and reopen creates an append-only audit event.

## Reopen behaviour

Reopening:

- Requires a reason.
- Records the actor and timestamp.
- Marks closing readiness as an exception.
- Recalculates current blockers.
- Does not delete the original close record or audit event.

## Rollout sequence

1. Apply migration `033_operating_day_close_control.sql`.
2. Confirm organization timezone and close settings.
3. Train department owners to submit explicit daily declarations.
4. Enable close review and audited close actions.
5. Apply migration `034_configurable_operating_policies.sql`.
6. Configure schedules, control policies, and POS cadence.
7. Add schedule-aware requisition escalation.
8. Add POS business-date reconciliation.
9. Add unified yield disposition and linked waste handling.
