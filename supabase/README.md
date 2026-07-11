# ProfitPlate Supabase Engine

This folder contains database migrations for the ProfitPlate margin intelligence
engine.

## Current Migration

`migrations/001_profitplate_engine_core.sql`

This migration is designed to preserve the tables already created in Supabase
and expand them into the required engine shape.

It adds:

- Foundational organization, profile, subscription, and system status tables
- Engine enums for tiers, routing models, transaction statuses, event types, and variance types
- Missing columns for existing `locations`, `inventory_items`, `recipes`, `requisitions`, and `transformation_events`
- Missing engine tables for unit conversions, recipe components, purchase orders, transfers, production runs, stock counts, variance attributions, and cost recalculation events
- Guardrail triggers for subscription location limits, Model 2 access, inter-store transfer access, circular recipe prevention, append-only transformation events, sub-recipe inventory coupling, and manual recipe cost blocking

## Before Applying

The current project does not include a Supabase CLI config or exported schema.
The hosted project was inspected with the anon key, which confirmed these tables
exist:

- `locations`
- `inventory_items`
- `recipes`
- `requisitions`
- `transformation_events`

Because the anon key cannot list full schema metadata, review this migration in
the Supabase SQL editor before applying it to production data.

## Recommended Apply Path

1. Open the Supabase SQL editor for the project.
2. Paste `001_profitplate_engine_core.sql`.
3. Run it against a development database first.
4. Confirm the trigger guards behave as expected.
5. Export the updated schema back into source control.

