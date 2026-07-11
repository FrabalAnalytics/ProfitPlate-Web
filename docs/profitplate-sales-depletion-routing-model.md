# ProfitPlate sales depletion routing model

Sales depletion decides where recipe/component stock is reduced when a menu item
is sold.

## Why this exists

POS revenue answers: “What did we sell?”

Depletion routing answers: “Which department/location stock should be reduced
because of that sale?”

Without this routing layer, a sale can deduct the stock item attached to the
recipe component even when the actual operating stock sits in Bar, Kitchen, an
outlet, or a user department.

## Current rule after migration 037

When a sale is recorded, ProfitPlate receives an optional selling/depletion
location.

For each recipe component, the database resolves the depletion item in this
order:

1. An explicit `sales_depletion_routes` rule.
2. A matching inventory item in the selling location using the same origin SKU.
3. A matching inventory item in the selling location using the same SKU.
4. The original recipe component item as a fallback.

Every depletion event records `transformation_events.location_id`, so AvT can
later compare sales depletion, production, waste, and stock variance by
location.

## Supported operating models

ProfitPlate should support more than one restaurant behavior:

- POS-first / cook-to-order: sale is punched first; theoretical ingredients
  deplete from the department that fulfilled the order.
- Production-first / batch service: kitchen produces finished stock; POS
  depletes finished/menu stock from the outlet or kitchen.
- Bar / direct retail: POS depletes bottles, portions, mixers, or bar stock
  directly from the bar location.
- Central kitchen + outlets: central kitchen transfers prepared items to outlets;
  POS depletes outlet stock, not central stock.
- Catering / preorder: order may reserve stock first, then fulfillment depletes
  stock later.

## Ownership

- Operations Manager owns the default depletion model.
- Inventory Manager owns SKU/location setup and matching stock copies.
- Kitchen Manager owns production-stock behavior for prepared food.
- Finance Manager owns margin impact and AvT review.
- Owner approves exceptions where routing affects reported margin materially.

## What must be configured

At minimum:

- Active selling/user department locations.
- Inventory items assigned to those locations.
- Recipe components linked to their source stock item.

For complex locations:

- Add `sales_depletion_routes` rules per recipe, component, selling location, or
  depletion location.

## What this unlocks

Actual-vs-theoretical analysis can now be built against:

- POS sales by business date and selling location.
- Theoretical recipe depletion by depletion location.
- Production, waste, stock count, and transfer events by location.

This is the safe foundation for AvT because location is no longer guessed after
the fact.
