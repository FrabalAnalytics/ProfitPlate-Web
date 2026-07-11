# ProfitPlate Location and Routing Model

Last updated: July 8, 2026

## Current Operating Model

For the current restaurant setup, ProfitPlate should treat locations this way:

| Location | Correct type | Purpose |
| --- | --- | --- |
| Food Main Store | Main store / stockroom | Holds food inventory received from suppliers. |
| Drink Main Store | Main store / stockroom | Holds drink/bar inventory received from suppliers. |
| Kitchen | User department | Requests and consumes food stock from Food Main Store. |
| Bar | User department | Requests and consumes drink stock from Drink Main Store. |

Kitchen and Bar are not main stores. They are operating departments. They should receive stock through requisitions or transfers from the relevant main store.

Each location has an explicit inventory domain:

- `food`: Food Main Store and Kitchen.
- `beverage`: Drink Main Store and Bar.
- `shared`: A warehouse or store allowed to hold both categories.

A department can also identify its `supplying_location_id`. Kitchen can
therefore point to Food Main Store, while Bar points to Drink Main Store,
without relying on names during normal transactions.

## SKU Linking Rule

The same SKU can exist in more than one place, but department copies must link back to a main-store origin SKU.

Example:

| SKU | Location | Meaning |
| --- | --- | --- |
| Flour | Food Main Store | Origin stock balance. Supplier receipts increase this row. |
| Flour | Kitchen | Department balance. Requisitions from Food Main Store increase this row. |
| Lemon Juice | Food Main Store | Food-side origin balance. |
| Lemon Juice | Drink Main Store | Drink-side origin balance. |
| Lemon Juice | Bar | Bar department balance linked to the relevant origin. |

This prevents Kitchen or Bar from becoming disconnected stock islands.

## Receiving Controls

- Supplier POs can be received only into a main store or warehouse.
- Every PO line must use an SKU balance assigned to that exact receiving store.
- Changing the receiving store clears previously selected PO items.
- Kitchen and Bar receive stock through approved requisitions or transfers.
- Procurement can reopen and edit any PO that is still awaiting receipt.
- Every PO receives a short organization-scoped reference such as `PO-000001`.
- Inventory confirmation completes the receipt and assigns an immutable
  reference such as `GRN-000001`.

These rules are enforced in both the dashboard and Supabase, so another client
cannot bypass them.

## Management Visibility

Owner, GM, operations, finance, cost control, and audit views calculate current
stock value from all active balances across main stores and departments.
Operational department views remain scoped to their relevant locations.

## Current Tiers

| Tier | Current intent | Location behavior |
| --- | --- | --- |
| Solo Operator | One restaurant or simple operation. | Main store plus user departments. |
| Multi-Unit Group | Multiple outlets or departments needing transfer controls. | Multiple store/department locations and inter-store transfers. |
| Enterprise Grid | Larger network with centralized distribution. | Central warehouse can feed outlet stores, which then feed departments. |

## Recommended Routing Models

| Routing model | When to use |
| --- | --- |
| Single restaurant | Food Main Store and Drink Main Store feed Kitchen and Bar. |
| Central warehouse network | Central warehouse feeds outlet main stores, then outlet stores feed departments. |

## Future-Proofing Rules

- Do not create Kitchen or Bar as a main store unless they physically control stock as a store.
- Do not receive supplier POs directly into Kitchen or Bar unless the restaurant intentionally bypasses stores.
- Use requisitions to move stock from main stores to user departments.
- Keep Food Main Store and Drink Main Store separate when food and beverage stock need different controls.
- If an item is used by both Kitchen and Bar, keep separate balances by location and link each department copy to its correct origin stock row.
