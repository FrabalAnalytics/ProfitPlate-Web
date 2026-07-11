# ProfitPlate Requisition Receipt Escalation

## Control objective

A stock transfer is not complete when the issuing store dispatches it. It is
complete only when a different authorized user in the receiving department
acknowledges receipt.

## Clock behaviour

The acknowledgement clock measures active receiving-department minutes, not
ordinary elapsed time. It uses the effective organization, location, and
department schedules introduced by migration 034.

- Time outside the receiving schedule is paused.
- Overnight shifts and dated schedule exceptions are respected.
- Changing a schedule does not rewrite historical policy periods.
- If no schedule is configured, the timer remains unrestricted for backward
  compatibility.

## Default escalation

Unless a workspace configures another escalation policy:

1. Receiver owns the action immediately.
2. Department manager receives escalation after 30 active minutes.
3. Operations manager receives escalation after 60 active minutes.
4. Owner receives escalation after 120 active minutes.

Each level is recorded once in `requisition_escalation_events`.

## Separation of duties

By default, the user who dispatched the transfer cannot acknowledge its
receipt. The receiving user completes the second side of the stock movement.
This setting is held on the organization and may be disabled only as an
explicit workspace policy for businesses that cannot staff separate users.

## Dashboard context

For every dispatched requisition, the dashboard shows:

- Current action owner
- Active waiting time
- Stock value in transit
- Active minutes until the next escalation

Unreceived transfers continue to appear as day-close blockers under the
effective requisition-receipt control policy.

## Evaluation

`refresh_dashboard_requisition_escalations` advances clocks and creates
escalation events. The dashboard invokes it during workspace refresh. A
production deployment may additionally schedule the same idempotent function
at a regular interval so notifications advance even when no dashboard is open.
