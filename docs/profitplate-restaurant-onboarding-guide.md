# ProfitPlate Restaurant Onboarding Guide

Last updated: July 12, 2026

## Purpose

This guide is the operating onboarding document for a restaurant workspace in ProfitPlate. It is written for owners, managers, kitchen leads, storekeepers, finance/cost control, and front-house supervisors who need to move from informal daily habits into reliable operating discipline.

ProfitPlate is not only a database for stock and recipes. It is an accountability system. The goal of onboarding is to make the restaurant run on clear roles, clean master data, controlled stock movement, auditable daily routines, and management attention on exceptions.

## Onboarding Outcome

By the end of onboarding, the restaurant should be able to:

| Area | Outcome |
| --- | --- |
| Workspace setup | The restaurant has one active workspace, correct currency, implementation mode, and default operating locations. |
| Users and roles | Each user has the correct role and department ownership. Pastry, kitchen, bar, store, finance, procurement, and front-house users understand what they can declare. |
| Master data | Locations, suppliers, SKUs, recipe units, yields, costs, menu items, and POS mappings are imported or created. |
| Inventory discipline | Receiving, requisitions, kitchen-to-front-house transfers, waste, stock counts, and adjustments have an audit trail. |
| Kitchen discipline | Production planning can become an editable requisition. Kitchen can issue to front house and receiving users must accept or reject. |
| Daily controls | Each operating day has daily register completion, exception capture, and management review. |
| Cost control | Purchase price changes, yield updates, waste, and recipe cost cascades are visible to management. |
| Go-live readiness | The restaurant can complete a sample day from purchase receipt to production, transfer, sales depletion, waste, and day close. |

## Implementation Mode

Use the simplest mode that fits the restaurant.

| Mode | Use when | Notes |
| --- | --- | --- |
| Solo | One restaurant, one owner/operator team, simple branch structure. | Best for a single standalone restaurant. |
| Multi Unit | Multiple branches or outlets under one operator. | Use when locations need branch-level operational separation. |
| Enterprise Grid | Larger group, central oversight, more complex reporting. | Use only when governance complexity requires it. |

For a single restaurant such as Tangibles Restaurant, Solo is usually the right starting point. A solo workspace can still have departments, kitchen, pastry, bar, store, front counter, and management roles.

## Phase 1: Workspace And Owner Setup

### Owner Account

Create or invite the owner user in Supabase Auth before assigning ownership inside the workspace. The owner email should exist in Auth so the profile can be linked cleanly to the workspace and role.

Recommended sequence:

1. Create or invite the owner email in Supabase Auth.
2. Confirm the user profile exists.
3. Assign the profile to the restaurant workspace.
4. Set role to `owner`.
5. Confirm the owner can log in and see the correct restaurant.

If the user has already been invited, wait for acceptance unless you need immediate manual setup. Use direct create only when you are intentionally provisioning the account yourself.

### Workspace Settings

Confirm these before importing operational data:

| Setting | Recommended value |
| --- | --- |
| Restaurant name | Legal or operating name used by management. |
| Currency | Local reporting currency, for example NGN. |
| Implementation mode | Solo for one restaurant. |
| Default sales outlet | Front counter or primary POS outlet. |
| Operating departments | Kitchen, pastry, store/inventory, front house, bar if applicable, finance, procurement, management. |

## Phase 2: Location Model

Locations determine where stock lives, where it is issued from, and where it is consumed.

### Required Locations

| Location | Type | Purpose |
| --- | --- | --- |
| Main Store | Main store or stock holding | Receives purchases and issues raw materials. |
| Kitchen | Department stock | Holds issued ingredients, prep output, and production stock. |
| Pastry | Department stock | Holds pastry-specific ingredients and production stock. |
| Front Counter / Front House | Sales outlet | Receives finished goods or sellable items for counter depletion. |
| Bar | Department stock or sales outlet | Use if bar operates separate stock control. |

For QSR or counter-service operations, front counter should exist as a sales outlet. Finished products that are sold from counter should be available at the sales outlet or transferred there through a requisition/acceptance workflow.

### Kitchen To Front-House Transfer Discipline

Kitchen can transfer finished or semi-finished items to front house using the requisition workflow.

Expected flow:

1. Kitchen creates or converts a production plan into a requisition.
2. Kitchen edits the list, removing items not required and adding missing SKUs.
3. The issuing location is selected, for example Kitchen or Main Store.
4. The receiving location is selected, for example Front Counter.
5. The issuing user dispatches the approved quantities.
6. A different receiving user accepts or rejects the receipt.
7. Stock movement posts only after acceptance.

This gives management a clean audit trail: who requested, who issued, who received, what quantity moved, and when.

## Phase 3: User Roles And Department Ownership

Each user should be assigned according to actual responsibility, not job title alone.

| Role | Typical owner | Main responsibility |
| --- | --- | --- |
| Owner | Business owner | Final control, workspace ownership, exception review. |
| Admin | Trusted administrator | Workspace setup and user support. |
| Operations Manager | GM or restaurant manager | Daily operating discipline, day close, exceptions. |
| Finance Manager | Cost controller or finance lead | Costs, margins, POS, variances, purchase price impact. |
| Procurement Manager | Buyer or procurement lead | Supplier and purchase planning controls. |
| Inventory Manager | Store control lead | Stock counts, store accuracy, receiving supervision. |
| Storekeeper | Store user | Receipts, issues, store movement accuracy. |
| Kitchen Manager | Kitchen lead | Production planning, kitchen requisitions, yield tests, kitchen waste. |
| Chef | Kitchen user | Production entries, recipe execution, waste capture. |
| Quality Assurance | QA or hygiene lead | Yield exceptions, supplier quality, process exceptions. |
| Bar Manager | Bar lead | Bar stock, bar requisitions, bar waste. |
| Bartender | Bar user | Bar activity and stock requests. |
| Auditor | Internal reviewer | Read and review audit trail. |
| Viewer | Passive user | Read-only access. |

Pastry and kitchen are user departments. If pastry operates separately, use a pastry department location and assign the relevant users to kitchen or department-facing roles based on how the work is controlled.

### Finance Role Page Reference

The Finance role is served through the main dashboard page, not a separate active route. The extracted reference file for the Finance role page logic is kept at `docs/finance-role-page.tsx`. Use it as documentation for how the Finance dashboard focus connects back to `app/dashboard/page.tsx`.

## Phase 4: Raw Data Workbook Preparation

Before import, collect the workbook in a clean, structured format.

### Required Tabs

| Tab | Required fields |
| --- | --- |
| Locations | Location name, type, department, active status. |
| Suppliers | Supplier name, contact details, payment terms if available. |
| Raw SKUs | SKU name, category, base UOM, recipe UOM, purchase UOM, conversion, current cost, opening quantity, location. |
| High-value SKUs | SKU name, yield percentage, test frequency, perishability, protein/perishable flag. |
| Recipes | Recipe name, recipe type, batch output, yield, selling item flag. |
| Recipe Components | Parent recipe, component SKU or sub-recipe, quantity, UOM. |
| Menu Items | Menu item name, recipe link, selling price, sales outlet. |
| POS Mappings | POS item code/name, menu item or recipe link. |
| Opening Stock | SKU, location, quantity, unit cost, count date. |
| Users | Name, email, role, department. |

### Import Rules

- Do not import duplicate SKUs with slightly different spelling.
- Use one base unit per SKU.
- Record yield as a decimal percentage, for example 0.85 for 85 percent.
- Separate raw ingredients, sub-recipes, manufactured finished goods, and final menu items.
- Map every POS item that should deplete stock.
- Keep old restaurants or test workspaces out of production imports unless intentionally migrated.

## Phase 5: Inventory And Purchasing Workflow

### Purchase Receipt

Purchase receipt should be independent from purchase creation.

Expected flow:

1. Procurement or management creates the purchase order.
2. Store or inventory confirms received quantities.
3. The PO creator should not confirm receipt.
4. Partial delivery requires a short supply reason.
5. Received quantity updates on-hand stock.
6. Landed cost updates weighted average cost.
7. Cost changes trigger recipe cost cascade reporting.

### Append-Only Movement History

Stock movement and transformation events should not be edited or deleted after posting. If a mistake is made, create a correcting adjustment or reversal workflow instead of mutating history. This protects the audit trail.

## Phase 6: Requisitions, Issues, And Acceptance

Requisition is the preferred workflow for moving stock between departments.

| Step | Responsible user | Control |
| --- | --- | --- |
| Request | Department user or kitchen manager | States item, source, destination, quantity, and reason. |
| Issue | Store, kitchen, or authorized issuer | Confirms actual issued quantity. |
| Acceptance | Receiving department user | Accepts or rejects the receipt. |
| Posting | System | Posts stock movement after acceptance. |

Kitchen-to-front-house transfers should follow this model. It prevents informal handoff, missing stock, and blame shifting at the end of the day.

## Phase 7: Production Planning And Kitchen Requisition

Production planning should not be a static list. It should be operationally editable.

The kitchen should be able to:

- Convert a production plan into a requisition.
- Choose whether to request full required quantity or shortage only.
- Add SKUs that are missing from the generated list.
- Remove SKUs that are not required today.
- Select issuing and receiving locations.
- Submit for the normal issue and acceptance workflow.

This encourages planning discipline without making the system rigid.

## Phase 8: Yield Tests And Cost Impact

High-value proteins and perishables should have periodic yield tests.

Expected controls:

1. Record starting weight.
2. Record usable weight.
3. System calculates measured yield.
4. If measured yield is below the current master yield, the test is flagged.
5. The master yield updates using the rolling average of the latest tests.
6. Recipe costs cascade through sub-recipes and final menu items.
7. Management receives visibility on impacted recipes, SKUs, and declared impact.

Yield loss already built into master yield should not also be recorded as prep waste. True waste should be classified as spoilage, damaged, expired, overproduction, or another real operating loss.

## Phase 9: Waste, Variance, And Exceptions

Waste must be recorded as close to the event as possible.

| Waste type | Meaning |
| --- | --- |
| Spoilage | Item became unusable before production or sale. |
| Damaged | Item was physically damaged. |
| Expired | Item passed safe or approved use period. |
| Overproduction | Prepared more than could be sold or used. |
| Process exception | Operational mistake requiring management review. |

Every waste event should capture item, quantity, unit cost, location, reason, stage, notes where needed, and user.

## Phase 10: Daily Checklist And Operating Discipline

The daily checklist should make the work easy to complete on mobile and hard to ignore.

### Daily Register Ownership

| Department | Typical owner | Example register |
| --- | --- | --- |
| Inventory | Storekeeper or inventory manager | Receiving, stock issue, stock count exceptions. |
| Kitchen | Kitchen manager or chef | Production, yield tests, kitchen waste, kitchen requisitions. |
| Pastry | Kitchen/pastry lead | Pastry production and pastry waste. |
| Front House | Operations manager or front-house lead | Sales outlet readiness, transfer acceptance, POS issues. |
| Finance | Finance manager | Sales import, POS mapping, margin exceptions. |
| Procurement | Procurement manager | Supplier price movement and PO exceptions. |
| Management | Owner or operations manager | Day close and exception review. |

Users should only declare registers they own, unless they are owner, admin, manager, or operations manager.

### Daily Close Minimum Standard

Before the day is considered closed:

- Purchase receipts are confirmed or flagged.
- Open requisitions are issued, accepted, rejected, or escalated.
- Kitchen production is recorded.
- Kitchen-to-front-house transfers are acknowledged.
- Waste is recorded.
- POS sales are imported or sales capture is marked as pending with reason.
- Stock count exceptions are reviewed.
- Yield exceptions are acknowledged.
- Management attention list is reviewed.

## Phase 11: Front-House And POS Discipline

Front house is where operational discipline becomes financial truth.

Required controls:

- Every sellable item should map to a recipe, finished SKU, or depletion rule.
- Front counter stock should receive transfers through accepted requisitions.
- POS imports should use the correct business date.
- Voids, promos, discounts, and unmapped sales should be reviewed by finance or management.
- Sales depletion should affect the correct sales outlet.

## Phase 12: Management Review Rhythm

### Daily

- Review open exceptions.
- Confirm daily registers.
- Check unaccepted transfers.
- Check waste entries.
- Check production versus plan.
- Check POS import status.

### Weekly

- Review food cost movement.
- Review top waste items.
- Review yield-test exceptions.
- Review supplier price increases.
- Review stock count variance.
- Review slow-moving or high-risk inventory.

### Monthly

- Review menu margin.
- Review recipe cost updates.
- Review role access.
- Review audit trail completeness.
- Review operating discipline by department.

## Go-Live Readiness Checklist

Do not go live until these are true:

| Check | Ready when |
| --- | --- |
| Owner login | Owner can log in and manage the correct workspace. |
| Roles | Each user has the correct role and department. |
| Locations | Main store, kitchen, pastry if needed, front house, and sales outlet exist. |
| SKUs | Raw SKUs and opening stock are clean. |
| Recipes | Core recipes and sub-recipes calculate costs. |
| POS | Major selling items are mapped. |
| Purchasing | A test PO can be received independently. |
| Requisition | Store-to-kitchen and kitchen-to-front-house transfers can be requested, issued, and accepted. |
| Production | A production plan can become an editable requisition. |
| Waste | Waste can be recorded and reported. |
| Yield | High-value SKU yield test can be submitted and flagged if below master. |
| Day close | Management can review the daily checklist and exceptions. |

## First Week Operating Plan

### Day 1

- Confirm users and roles.
- Confirm locations.
- Import opening stock.
- Test one purchase receipt.
- Test one requisition from store to kitchen.

### Day 2

- Test production planning.
- Convert production plan to requisition.
- Transfer one finished item from kitchen to front house.
- Receiver accepts the transfer.

### Day 3

- Import or enter POS sales.
- Confirm depletion behavior.
- Record one waste event.
- Submit one yield test for a high-value SKU.

### Day 4

- Run daily close.
- Review exceptions.
- Correct master data gaps.

### Day 5

- Management reviews food cost, transfer discipline, waste, and open actions.
- Decide whether the restaurant can operate live without parallel manual sheets.

## Success Principle

ProfitPlate should not make the team feel policed. It should make the right operating habit the easiest habit. The system works when users can quickly do the real work, management sees exceptions early, and the audit trail explains what happened without argument.
