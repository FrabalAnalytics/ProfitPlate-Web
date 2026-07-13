# ProfitPlate POS And Menu Mapping Guide

Last updated: July 13, 2026

## Purpose

This guide explains how a restaurant should connect its POS sales file to
ProfitPlate menu items so that revenue, recipe depletion, food cost, gross
margin, and Actual-vs-Theoretical (AvT) variance can be trusted.

The simple rule is:

> POS tells ProfitPlate what was sold. Menu mapping tells ProfitPlate what that
> sale means operationally.

If the POS item is not mapped to a ProfitPlate final menu item, ProfitPlate may
see revenue, but it cannot reliably calculate ingredient usage or menu margin.

## Core Terms

| Term | Meaning |
| --- | --- |
| POS item | The item name or code exported from the POS system. Example: Jollof Rice Large, POS code 1023. |
| POS item key | The stable matching identity built from POS item name/code. This is what future imports use to remember the mapping. |
| ProfitPlate final menu item | The sellable menu recipe inside ProfitPlate. Example: Jollof Rice Large. |
| Recipe components | Raw ingredients, sub-recipes, or manufactured items attached to a final menu item. |
| Mapping | A saved connection between one POS item key and one ProfitPlate final menu item. |
| Unmapped row | A POS sale row that has no saved mapping and cannot yet drive theoretical depletion. |
| Business date | The sales/trading date from the POS report. This is preferred over upload date. |
| Depletion location | The stock location where sold items should consume stock, such as Kitchen, Bar, Pastry, or Front Counter. |

## Why Mapping Matters

POS mapping controls five important outcomes:

| Outcome | What goes wrong without mapping |
| --- | --- |
| Revenue accuracy | Sales may import but remain incomplete or provisional. |
| Food cost accuracy | The system cannot calculate the ingredient cost of the sale. |
| Stock accuracy | Kitchen, bar, pastry, or front-counter stock will not reduce correctly. |
| AvT reliability | Theoretical consumption cannot be compared to actual physical stock. |
| Management confidence | Margin and loss reports become questionable. |

## Recommended Setup Sequence

### 1. Confirm the restaurant model

Choose the operating model before importing POS data.

| Restaurant model | Recommended sales workflow |
| --- | --- |
| Single dine-in restaurant | POS import maps to final menu items; depletion usually comes from Kitchen and Bar. |
| QSR or fast-food counter | POS import maps to final menu items or manufactured finished goods; depletion may come from Front Counter if finished goods are stocked there. |
| Bakery or pastry-led outlet | POS items map to pastry menu items or manufactured pastry stock; depletion can be from Pastry or Front Counter. |
| Bar-heavy restaurant | POS drink items map to bar recipes or bar inventory SKUs; depletion should route to Bar stock. |
| Central kitchen with outlet sales | Production creates finished goods; outlet POS depletes the outlet or front-counter stock. |
| Multi-unit restaurant group | Each branch imports its own POS file or synced feed; mapping should be reviewed per branch when POS codes differ. |

### 2. Create the final menu item in ProfitPlate

Before mapping any POS item, the sellable item must exist in ProfitPlate.

Required fields:

- Menu item name.
- Recipe type: final menu item or final dish.
- Selling price where applicable.
- Standard output quantity.
- Output UOM.
- Active status.
- Correct recipe components.

Finance or cost control should confirm that the item has a usable recipe before
it is mapped. Mapping a POS item to a menu item without recipe components creates
revenue with weak or zero theoretical food cost.

### 3. Attach recipe components

A final menu item should consume one of these:

- Raw ingredients, such as tomatoes, rice, flour, beef, oil.
- Sub-recipes, such as tomato sauce, pepper mix, dough, cream filling.
- Manufactured finished goods, such as packaged pastry, cooked rice batch, bottled juice.

Use sub-recipes when the kitchen prepares an intermediate item before sale. Use
manufactured finished goods when the business physically produces and stores
sellable units before the POS sale.

### 4. Confirm sales capture mode

ProfitPlate supports:

| Mode | Use when |
| --- | --- |
| POS import | The POS file/feed is the normal sales source. This is recommended for disciplined operations. |
| Manual sales | The restaurant has no POS export or is in emergency fallback. |
| Test mode | Demo, validation, or onboarding training only. |

Do not allow POS import and manual sales to post for the same business period
unless an admin intentionally controls the exception. Double posting causes
double depletion and false food-cost loss.

## POS Import Workflow

### Step 1: Export POS sales

Finance or the POS supervisor exports sales for the correct period.

The best POS file includes:

- Business date.
- Transaction timestamp.
- Receipt, check, invoice, or transaction ID.
- POS item name.
- POS item code.
- Quantity sold.
- Net sales amount.
- Discounts, voids, and refunds where available.
- Outlet, terminal, or revenue center where available.

### Step 2: Import into ProfitPlate

ProfitPlate reads the POS rows and tries to match each row to a saved mapping.

Rows become:

| Import state | Meaning |
| --- | --- |
| Matched | POS item key already maps to a ProfitPlate final menu item. |
| Needs mapping | POS item key is new or has no saved menu connection. |
| Provisional | Date or transaction evidence is incomplete, so Finance must review. |
| Error | Quantity, date, menu, or duplicate protection failed. |

### Step 3: Resolve unmapped POS rows

For every row marked Needs mapping:

1. Read the POS item name and code.
2. Choose the correct ProfitPlate final menu item.
3. Confirm the recipe exists and is active.
4. Save the mapping.
5. Re-import or post the row after mapping is saved.

Once saved, the mapping is reused for future imports with the same POS item key.

### Step 4: Post matched sales

When sales are posted, ProfitPlate should:

1. Record the revenue.
2. Link the sale to the POS import batch and row identity.
3. Deplete the mapped menu item based on its recipe.
4. Reduce the correct stock location.
5. Protect against duplicate posting using transaction identity or row fingerprint.

### Step 5: Finance confirms daily POS controls

Finance should complete:

- POS import completed or no-sales declared.
- Unmapped POS items reviewed.
- Sales register checked.
- AvT exception reviewed where applicable.

These controls make management comfortable that sales-based theoretical usage is
not just imported, but reviewed.

## Mapping Rules By Restaurant Model

### Dine-In Restaurant

Typical model:

- POS item maps directly to a final menu item.
- The final menu item consumes raw ingredients and sub-recipes.
- Stock depletion usually happens from Kitchen for food and Bar for drinks.

Example:

| POS item | ProfitPlate item | Depletion location |
| --- | --- | --- |
| Seafood Pasta | Seafood Pasta final menu item | Kitchen |
| Chapman | Chapman drink recipe | Bar |

Best practice:

- Keep POS names and ProfitPlate names similar where possible.
- Do not map a combo meal to one recipe unless the combo recipe truly contains all components.

### QSR Or Fast-Food Counter

Typical model:

- Kitchen produces finished goods.
- Front Counter receives sellable units.
- POS sales deplete Front Counter finished goods.

Example:

| POS item | ProfitPlate item | Depletion location |
| --- | --- | --- |
| Meat Pie | Meat Pie finished good | Front Counter |
| Chicken Burger | Chicken Burger final menu item or finished good | Front Counter or Kitchen |

Best practice:

- If items are produced ahead and counted at the counter, use manufactured finished goods.
- If items are assembled on demand, use final menu item recipe depletion from Kitchen.

### Bakery Or Pastry Model

Typical model:

- Pastry department produces batches.
- Front Counter sells pieces.
- POS sales should deplete the sellable pastry stock or the pastry recipe.

Example:

| POS item | ProfitPlate item | Depletion location |
| --- | --- | --- |
| Croissant | Croissant finished good | Front Counter |
| Chocolate Cake Slice | Chocolate Cake Slice final menu item | Pastry or Front Counter |

Best practice:

- Separate Pastry as a user department and stock location.
- Use production output when pastry creates counted sellable units.

### Bar Model

Typical model:

- Simple drinks may map directly to bar inventory SKUs.
- Cocktails should map to final drink recipes.
- Bottle sales can deplete bottled stock.

Example:

| POS item | ProfitPlate item | Depletion location |
| --- | --- | --- |
| Mojito | Mojito recipe | Bar |
| Coke Bottle | Coke inventory SKU or final menu item | Bar |

Best practice:

- Do not map every drink to a generic Beverage Sales item.
- Use recipes for cocktails and direct SKU-style depletion for simple packaged items where supported.

### Central Kitchen Or Commissary

Typical model:

- Central Kitchen produces finished goods.
- Branches or outlets receive stock.
- Branch POS depletes branch stock.

Example:

| POS item | ProfitPlate item | Depletion location |
| --- | --- | --- |
| Packaged Jollof Bowl | Jollof Bowl finished good | Branch Front Counter |
| Puff Puff Pack | Puff Puff finished good | Branch Front Counter |

Best practice:

- Keep production and sales as separate events.
- Do not let branch sales deplete central kitchen stock unless that is truly where stock is held.

## Combo, Modifier, And Add-On Rules

### Combo meals

Use one of these approaches:

| POS structure | Recommended mapping |
| --- | --- |
| POS exports combo as one line only | Create a ProfitPlate combo final menu item with all components. |
| POS exports combo parent and child items | Map the child items if they carry quantity/revenue detail; avoid double depletion. |
| POS exports zero-priced sides inside combo | Decide whether the zero-priced side should deplete stock. Usually yes. |

### Modifiers

Modifiers should be mapped when they change stock or cost.

| Modifier | Mapping rule |
| --- | --- |
| Extra cheese | Map or include as a recipe modifier because it changes food cost. |
| No onions | Usually no separate mapping unless negative component logic is supported. |
| Spicy | No mapping if it is only preparation instruction. |
| Add protein | Map because it changes stock and margin. |

### Discounts, voids, and refunds

Finance should review these separately from menu mapping.

- Discounts reduce revenue and margin.
- Voids should not deplete stock if the item was not produced.
- Refunds need review because the food may already have been consumed.
- Wastage after a void should be recorded as waste, not hidden in POS mapping.

## Daily Operating Workflow

### Before service

1. Confirm active menu items.
2. Confirm new POS items or seasonal menu changes.
3. Confirm Kitchen, Bar, Pastry, and Front Counter stock locations.
4. Confirm sales capture mode.

### During service

1. POS records sales.
2. Kitchen/Bar/Pastry records production, waste, and transfers.
3. Store confirms requisitions and receipts.
4. Front House or Counter accepts issued finished goods where applicable.

### After service

1. Finance imports POS file.
2. Finance maps unmapped rows.
3. ProfitPlate posts sales depletion.
4. Inventory or department users complete physical counts where required.
5. Finance reviews AvT, stock variance, and POS exceptions.
6. Management reviews day close blockers and exceptions.

## Responsibility Matrix

| Task | Owner | Reviewer |
| --- | --- | --- |
| Create final menu item | Finance or Cost Control | Operations Manager |
| Attach recipe components | Kitchen lead and Finance | Owner or Operations Manager |
| Export POS report | POS Supervisor or Finance | Finance Manager |
| Import POS file | Finance Manager | Owner or Operations Manager |
| Save POS mapping | Finance Manager | Cost Control or Operations Manager |
| Resolve unmapped rows | Finance Manager | Kitchen/Bar/Pastry lead if item identity is unclear |
| Confirm no-sales day | Finance Manager | Owner or Operations Manager |
| Review AvT exceptions | Finance Manager | Owner or Operations Manager |

## Go-Live Checklist

Before live POS import:

- All active POS menu items are exported from the POS.
- All active ProfitPlate final menu items exist.
- Recipes are attached to every sellable menu item.
- Sales capture mode is set correctly.
- Default depletion locations are understood.
- Finance can import a sample POS file.
- Unmapped rows can be resolved.
- Duplicate import protection is tested.
- Finance daily checklist includes POS import and unmapped POS review.
- Management understands that unmapped sales make AvT provisional.

## Common Exceptions And Fixes

| Exception | Likely cause | Fix |
| --- | --- | --- |
| POS row says Needs mapping | New POS code or spelling difference | Map the POS item key to the correct final menu item. |
| Sale posted but no food cost | Final menu item has no recipe components | Add recipe components, then correct or repost the sale if needed. |
| Wrong stock location depleted | Depletion route is wrong | Correct location routing and post adjustment if already affected. |
| Combo double-depleted | Parent and child lines both mapped | Map only the depletion-bearing rows. |
| Revenue date looks wrong | POS export used upload date instead of business date | Use business date field or mark period provisional until Finance confirms. |
| Duplicate sales blocked | Same transaction/check/fingerprint already posted | Confirm whether this is a re-import or true separate sale. |
| Margin looks too good | Missing recipe, missing modifier, or unmapped item | Review unmapped rows and menu recipes. |
| Margin looks too bad | Wrong recipe quantity, wrong yield, duplicate import, or wrong UOM | Review recipe, yield, UOM, and POS duplicate evidence. |

## Practical Rule For Management

Management should not treat AvT as final until:

1. POS import is completed or no-sales is declared.
2. Unmapped POS items are resolved or listed as exceptions.
3. Menu items have valid recipes.
4. Stock receipts, transfers, production, waste, and physical counts are confirmed.
5. Finance has reviewed POS and stock variance controls.

When these steps are complete, ProfitPlate can explain not only what was sold,
but what should have been consumed, what physically remains, and where the
variance or loss came from.
