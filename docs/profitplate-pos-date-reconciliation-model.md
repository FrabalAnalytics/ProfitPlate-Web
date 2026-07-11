# ProfitPlate POS date reconciliation model

ProfitPlate treats POS imports as revenue evidence for an operating period, not
as proof that the upload date is the sales date.

## Core rule

Each POS row should carry the best available date evidence:

- `business_date` when the POS export provides a business, trading, sales, or
  operating date.
- `transaction_timestamp` when the export provides transaction time but not a
  separate business date.
- `source_transaction_id` or `source_check_id` when the POS provides receipt,
  ticket, order, invoice, or check identifiers.

If a row has no usable date evidence, ProfitPlate can still import it, but the
financial day remains provisional until Finance confirms the period.

## Supported cadences

Import cadence is not hardcoded. A restaurant may operate any of these policies:

- Continuous sync.
- Daily import.
- Weekly import.
- Selected-day import.
- Manual import.

The POS import policy defines what is expected. The import rows define what
period the uploaded file actually covers.

## Reconciliation statuses

Operational close and financial reconciliation are separate.

- An operating day can be operationally closed after kitchen, inventory,
  procurement, waste, and stock controls are satisfied.
- POS reconciliation can remain `awaiting_data`, `provisional`, `reconciled`,
  `exception`, or `not_required`.

This avoids blocking a kitchen close only because a business has chosen weekly
POS imports.

## AvT readiness

Actual-vs-theoretical analysis should use:

- actual sales revenue from POS rows by `business_date`;
- theoretical ingredient usage from recipe depletion by `operating_date`;
- production, waste, stock variance, and yield events from their own operating
  evidence.

When POS rows lack business dates, AvT should be labelled provisional because
revenue cannot yet be trusted against the correct operating day.

## Duplicate protection

Migration `036` adds transaction and fingerprint fields so repeated uploads can
be detected using:

- organization;
- location where available;
- business date;
- POS transaction/check identity;
- POS item key.

This protects the business from double-counting revenue during re-imports.
