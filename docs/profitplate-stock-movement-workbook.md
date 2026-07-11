# ProfitPlate Stock Movement & AvT Workbook

This workbook documents the operating model for inventory, production, sales depletion, POS imports, waste, and Actual-vs-Theoretical reporting in ProfitPlate.

The guiding question is:

> Based on what we sold, what should we have consumed, and what did we actually consume?

ProfitPlate is not just a sales revenue tracker. The business already has POS/ERP revenue data. ProfitPlate uses that sales data to calculate expected ingredient consumption, compare it against physical stock counts, and explain variance.

---

## 1. Core operating principle

Every movement must answer four questions:

1. What item moved?
2. From which location?
3. Why did it move?
4. Who owns the action?

ProfitPlate separates stock into two major worlds:

| Stock layer | Meaning | Main owner | Examples |
| --- | --- | --- | --- |
| Main store stock | Purchased inventory controlled by store/procurement | Inventory / Procurement | Food Main Store, Drink Main Store |
| Department stock | Stock issued to operating areas for production, sales, and waste | Kitchen / Bar / Operations | Kitchen, Bar |

The same SKU can exist in both layers. That is expected.

Example:

| Item | Location | Meaning |
| --- | --- | --- |
| Salt | Food Main Store | Store balance available for issue |
| Salt | Kitchen | Department balance available for cooking/sale consumption |

The department item should retain traceability to its main-store origin through `origin_inventory_item_id`.

---

## 2. Role ownership

| Role | Owns | Can do | Should not own |
| --- | --- | --- | --- |
| Procurement Manager | Purchase creation and supplier ordering | Raise PO, choose receiving store, confirm supplier/order details | Department consumption |
| Inventory Manager / Storekeeper | Store stock control | Receive PO, issue stock to departments, perform store counts | Recipe costing or sales import ownership |
| Kitchen Manager | Food production and kitchen stock usage | Request items, receive department stock, produce sub-recipes, record kitchen waste | Main store purchasing control |
| Bar Manager | Beverage production and bar stock usage | Request items, receive bar stock, produce bar sub-recipes, record bar waste | Food store control |
| Finance / Cost Control | Sales import, menu costing, variance review | Import POS, review theoretical usage, approve AvT reports | Physical stock custody |
| Admin / Owner | Configuration and governance | Set operating mode, approve roles, review exceptions | Daily transaction entry |

---

## 3. Location model

### Main store locations

Main stores hold purchased stock before it is issued to departments.

Examples:

- Food Main Store
- Drink Main Store
- Central Warehouse

Main-store stock is depleted by:

- Approved issue to a department
- Store waste or damage
- Store stock-count adjustment
- Transfer to another store or location

Main-store stock is replenished by:

- PO receipt
- Transfer in
- Stock-count adjustment gain

### Department locations

Departments hold operating stock used for prep, production, sales, and waste.

Examples:

- Kitchen
- Bar
- Production Kitchen
- Sales Outlet

Department stock is depleted by:

- Sales depletion
- POS import depletion
- Waste
- Production input consumption
- Department stock-count adjustment

Department stock is replenished by:

- Store issue / department receipt
- Sub-recipe production output
- Department transfer in
- Stock-count adjustment gain

---

## 4. Workflow A: Purchasing and receiving

Purpose: bring purchased stock into the correct main store.

| Step | Owner | System action | Stock effect |
| --- | --- | --- | --- |
| 1. Create PO | Procurement Manager | Select supplier, item, quantity, receiving location | No stock movement yet |
| 2. Approve / confirm PO | Procurement / Finance, depending on policy | Locks expected receipt | No stock movement yet |
| 3. Receive goods | Inventory Manager | Confirm actual quantity received | Increases receiving main-store stock |
| 4. Cost update | Finance / Inventory | Update latest purchase cost | Updates SKU cost basis |

Control rule:

PO receiving should normally go to main stores, not Kitchen or Bar. Kitchen and Bar should receive stock through internal issue/requisition flows.

---

## 5. Workflow B: Store issue to department

Purpose: move stock from main store into department stock.

| Step | Owner | System action | Stock effect |
| --- | --- | --- | --- |
| 1. Department request | Kitchen / Bar Manager | Request item and quantity | No stock movement yet |
| 2. Store approval / issue | Inventory Manager | Issue from Food/Drink Main Store | Main store decreases |
| 3. Department receipt | Kitchen / Bar Manager | Confirm received quantity | Department stock increases |

Recommended accounting logic:

- Main-store stock decreases when store issues.
- Department stock increases when department receives.
- Variance can exist between issued and received quantities if the business wants to capture transit loss, short delivery, or rejection.

Control rule:

This workflow is the normal bridge between store stock and operating stock.

---

## 6. Workflow C: Sub-recipe creation and production

Purpose: turn raw ingredients into a manufactured ingredient.

Sub-recipes should become inventory items after production.

Example:

- Pepper Sauce_SFG is a sub-recipe.
- After production, Pepper Sauce_SFG becomes a manufactured inventory item under Kitchen.
- It can then be used as an ingredient in final menu items.

| Step | Owner | System action | Stock effect |
| --- | --- | --- | --- |
| 1. Create sub-recipe | Kitchen / Bar Manager | Define name, output UOM, batch size | No stock movement yet |
| 2. Attach ingredients | Kitchen / Bar Manager | Add raw material components | No stock movement yet |
| 3. Record production | Kitchen / Bar Manager | Enter actual output and actual input usage | Department ingredients decrease; manufactured sub-recipe increases |
| 4. Use sub-recipe in menu item | Costing / Finance | Add sub-recipe as component | No stock movement yet |

Control rule:

Sub-recipe production output should land in the producing department, not the main store. A canonical main-store row may exist for traceability, but sellable/usable produced stock belongs to the department that produced it.

---

## 7. Workflow D: Sales depletion

Purpose: convert sales into theoretical ingredient consumption.

When a menu item is sold, ProfitPlate should deplete the department stock based on the recipe.

Example:

Selling 1 Asun from Kitchen should deplete:

- Goat Meat from Kitchen
- Pepper Sauce_SFG from Kitchen
- Unsalted Butter from Kitchen

| Step | Owner | System action | Stock effect |
| --- | --- | --- | --- |
| 1. Sale is captured | POS import, or manual fallback | Menu item and quantity are identified | No stock effect until processed |
| 2. Recipe is resolved | System | Find menu recipe and components | No stock effect |
| 3. Depletion is posted | System | Consume component quantities from selected department | Department stock decreases |
| 4. Theoretical usage is stored | System | Keep sales-based expected consumption | Feeds AvT |

Control rule:

Sales should deplete department stock only. Sales should not deplete Food Main Store or Drink Main Store directly.

---

## 8. Workflow E: POS import

Purpose: use the business POS/ERP sales file as the normal sales source.

Recommended operating mode: POS import.

| Step | Owner | System action | Stock effect |
| --- | --- | --- | --- |
| 1. Export POS file | Business / Finance | Export daily sales from POS/ERP | No stock movement |
| 2. Import into ProfitPlate | Finance / Cost Control | Upload file | No stock movement until validated |
| 3. Map POS item to menu item | Finance / Cost Control | Confirm item mapping | No stock movement |
| 4. Process import | System | Post sales depletion by department/location | Department stock decreases |
| 5. Review exceptions | Finance + Operations | Resolve unmapped items or missing stock | May require correction |

The import should be idempotent. The same POS transaction/file row should not deplete stock twice.

Required import fields should include:

- Business date
- POS transaction ID or stable row reference
- Menu item name or code
- Quantity sold
- Revenue or unit price, if available
- Outlet / department / sales location, if available

If outlet/location is missing, ProfitPlate should apply a configured default sales depletion location.

---

## 9. Workflow F: Manual sales recording

Purpose: testing, demos, emergency fallback, or very small businesses without POS import.

Manual sales recording can deplete stock, but it should not be used together with POS import for the same business day unless there is a clear exception process.

Recommended policy:

| Sales capture mode | Manual sale button | POS import | Risk |
| --- | --- | --- | --- |
| POS import mode | Disabled or test-only | Enabled | Low |
| Manual sales mode | Enabled | Disabled or review-only | Low |
| Both enabled | Enabled | Enabled | High double-depletion risk |

Control rule:

At onboarding, the business should choose one sales capture mode:

1. POS import mode, recommended.
2. Manual sales mode, fallback.

ProfitPlate should avoid allowing both modes to post depletion for the same operating period without explicit admin override.

---

## 10. Workflow G: Waste

Purpose: capture known operational losses separately from sales.

Waste should deplete the location where the waste happened.

| Waste location | Stock effect |
| --- | --- |
| Food Main Store | Depletes main-store stock |
| Drink Main Store | Depletes main-store stock |
| Kitchen | Depletes Kitchen department stock |
| Bar | Depletes Bar department stock |

Examples:

- Spoiled tomatoes in Kitchen: deplete Kitchen stock.
- Broken bottle in Drink Main Store: deplete Drink Main Store stock.
- Burnt pepper sauce after production: deplete Kitchen manufactured sub-recipe stock.

Waste should be classified separately from sales depletion because it explains variance.

---

## 11. Workflow H: Physical stock count and AvT

Purpose: compare what should remain against what physically remains.

ProfitPlate’s AvT model:

```text
Opening stock
+ Receipts / transfers in / production output
- Store issues / transfers out
- Sales theoretical consumption
- Recorded waste
= Theoretical closing stock

Physical count
- Theoretical closing stock
= Variance
```

Interpretation:

| Result | Meaning |
| --- | --- |
| Physical count equals theoretical | Expected usage matches actual stock |
| Physical count is lower than theoretical | Possible unrecorded waste, over-portioning, theft, missing transfer, incorrect recipe quantity |
| Physical count is higher than theoretical | Possible under-portioning, missed sale reversal, recipe too high, unrecorded receipt |

The count should be done by location:

- Store count explains store control.
- Kitchen count explains kitchen usage.
- Bar count explains bar usage.

Do not mix store and department balances when calculating AvT.

---

## 12. Recommended onboarding decisions

Each business should configure these before going live:

| Decision | Recommended default | Why it matters |
| --- | --- | --- |
| Sales capture mode | POS import | Avoids duplicate revenue entry and aligns to existing POS/ERP |
| Default food sales depletion location | Kitchen | Food menu sales consume Kitchen stock |
| Default beverage sales depletion location | Bar | Beverage sales consume Bar stock |
| Main food receiving location | Food Main Store | Keeps procurement separate from operations |
| Main beverage receiving location | Drink Main Store | Keeps bar stock flow clean |
| Sub-recipe production location | Kitchen or Bar based on recipe/domain | Produced items should be usable where made |
| Stock count frequency | Weekly for stores, daily/shift for high-value departments | Better variance visibility |

---

## 13. Exceptions workbook

Use this section to define exception handling before go-live.

| Exception | Recommended handling |
| --- | --- |
| POS item is unmapped | Import as exception; do not deplete until mapped |
| Menu item has no recipe | Import revenue if needed, but flag no theoretical usage |
| Recipe component has no department stock | Flag shortage; do not silently deplete main store |
| Manual sale recorded before POS import | Import should detect duplicate or require exclusion |
| Department received less than store issued | Record received quantity and variance/transit loss |
| Produced sub-recipe output differs from target | Use actual output; variance is captured through actual input/output |
| Physical count is below zero/theoretical impossible | Require manager review before closing count |
| Transfer to wrong department | Reverse or correction movement; do not edit historical events directly |

---

## 14. Control matrix

| Control | Owner | Frequency | Evidence |
| --- | --- | --- | --- |
| PO receipts match supplier delivery | Inventory Manager | Every delivery | Goods received record |
| Store issues match department receipts | Inventory + Kitchen/Bar | Daily | Issue and receipt logs |
| POS import is complete | Finance / Cost Control | Daily | POS import batch summary |
| Unmapped POS items are resolved | Finance / Cost Control | Daily | Exception list |
| Recipes are current | Costing + Operations | Weekly or after menu change | Recipe version/cost review |
| Waste is recorded by location | Operations | Daily | Waste log |
| Stock counts are completed | Inventory + Operations | Per count schedule | Count sheets |
| AvT variances are reviewed | Finance + Operations | Weekly/monthly | Variance report |

---

## 15. Recommended product behavior

The clean product model is:

1. POS import is the preferred sales capture mode.
2. Manual sale is available only as:
   - test/demo tool,
   - emergency fallback,
   - or when the business chooses manual sales mode during onboarding.
3. Both POS import and manual sales should not post depletion for the same business period unless an admin explicitly overrides.
4. Sales and waste deplete department stock.
5. Store issues deplete main-store stock.
6. Production consumes department ingredients and increases department manufactured stock.
7. Physical counts are used to measure actual usage and explain variance.

This keeps ProfitPlate focused on its real job: turning operational activity into trusted usage, cost, and variance insight.

---

## 16. Daily operational checklists

Accurate AvT depends on daily discipline. If the daily operational data is weak, the variance report will still calculate, but it will not explain reality.

The goal of these checklists is simple:

> Every team closes the day with their movements complete, their exceptions visible, and their stock position believable.

### 16.1 Procurement Manager daily checklist

Purpose: make sure ordered items, suppliers, and expected receipts are clean.

| Check | Done by | Why it matters |
| --- | --- | --- |
| Review open POs | Procurement Manager | Prevents forgotten or duplicate orders |
| Confirm each PO has the correct receiving location | Procurement Manager | Prevents stock landing directly in Kitchen/Bar by mistake |
| Confirm item names, UOMs, and supplier prices | Procurement Manager | Prevents costing and quantity conversion errors |
| Flag delayed supplier deliveries | Procurement Manager | Explains stock-out risk before operations are affected |
| Close or cancel stale POs | Procurement Manager | Prevents false expected stock |

Daily close question:

> Are all expected deliveries for today either received, delayed, cancelled, or still genuinely pending?

### 16.2 Inventory Manager / Storekeeper daily checklist

Purpose: make sure main-store stock is complete and trustworthy.

| Check | Done by | Why it matters |
| --- | --- | --- |
| Receive all delivered POs before end of day | Inventory Manager | Keeps main-store stock current |
| Confirm actual received quantity vs PO quantity | Inventory Manager | Captures supplier short delivery or over delivery |
| Confirm received UOM and cost | Inventory Manager | Prevents stock and cost distortion |
| Issue approved requisitions to Kitchen/Bar | Inventory Manager | Moves stock out of main store correctly |
| Confirm pending department receipts | Inventory + Department Manager | Prevents stock being issued but not received |
| Record main-store waste/damage | Inventory Manager | Separates known loss from unexplained variance |
| Review negative or unusual main-store balances | Inventory Manager | Catches posting mistakes early |
| Count high-value or fast-moving store items | Inventory Manager | Improves variance accuracy |

Daily close question:

> Does Food Main Store / Drink Main Store stock reflect what is physically still under store control?

### 16.3 Kitchen Manager daily checklist

Purpose: make sure food department usage is captured correctly.

| Check | Done by | Why it matters |
| --- | --- | --- |
| Review requested items not yet received | Kitchen Manager | Prevents production using unposted stock |
| Confirm received quantities from store | Kitchen Manager | Makes Kitchen stock increase correctly |
| Record sub-recipe production output | Kitchen Manager | Makes manufactured ingredients available for sales depletion |
| Enter actual raw material usage for production | Kitchen Manager | Captures true production consumption and yield |
| Record kitchen waste immediately | Kitchen Manager | Separates known loss from unexplained variance |
| Review Kitchen stock for negative balances | Kitchen Manager | Catches missing receipts, wrong recipes, or over-depletion |
| Confirm menu components are available in Kitchen stock | Kitchen + Costing | Prevents sales showing zero stock for real ingredients |
| Count high-value/critical Kitchen items | Kitchen Manager | Supports accurate department AvT |

Daily close question:

> Can today’s Kitchen stock movement explain what was cooked, wasted, produced, and sold?

### 16.4 Bar Manager daily checklist

Purpose: make sure beverage stock usage is captured correctly.

| Check | Done by | Why it matters |
| --- | --- | --- |
| Review requested beverage items not yet received | Bar Manager | Prevents bar usage from happening outside system stock |
| Confirm received quantities from Drink Main Store | Bar Manager | Makes Bar stock increase correctly |
| Record bar sub-recipe or batch production | Bar Manager | Captures syrups, juices, cocktails, mixes, and prep outputs |
| Record breakages, spills, comps, and spoilage | Bar Manager | Separates known loss from unexplained variance |
| Review Bar stock for negative balances | Bar Manager | Catches recipe, POS mapping, or receipt issues |
| Count high-value beverage items | Bar Manager | Improves beverage AvT accuracy |

Daily close question:

> Can today’s Bar stock movement explain what was mixed, wasted, transferred, and sold?

### 16.5 Finance / Cost Control daily checklist

Purpose: make sure sales-based theoretical consumption is complete and clean.

| Check | Done by | Why it matters |
| --- | --- | --- |
| Import daily POS file | Finance / Cost Control | Brings actual sales into ProfitPlate |
| Confirm POS import total against POS/ERP report | Finance / Cost Control | Ensures no missing sales file or partial upload |
| Resolve unmapped POS items | Finance / Cost Control | Prevents sales without theoretical consumption |
| Review menu items without recipes | Finance / Cost Control | Prevents revenue with zero food cost |
| Review components with missing department stock | Finance + Operations | Prevents silent depletion errors |
| Review unusually high or low food cost items | Finance / Cost Control | Catches recipe/costing mistakes |
| Lock or mark the sales day as reviewed | Finance / Cost Control | Creates a clean daily control point |

Daily close question:

> Does today’s imported sales data fully explain what should have been consumed?

### 16.6 Admin / Owner daily or weekly checklist

Purpose: make sure configuration and governance remain clean.

| Check | Done by | Why it matters |
| --- | --- | --- |
| Review users and roles | Admin / Owner | Prevents wrong people posting sensitive movements |
| Confirm sales capture mode is followed | Admin / Owner | Prevents manual/POS double depletion |
| Review unresolved exceptions | Admin / Owner | Keeps operational issues visible |
| Review high-value variance items | Admin / Owner | Focuses management attention on material losses |
| Approve correction movements where required | Admin / Owner | Prevents uncontrolled history changes |

Daily/weekly close question:

> Are exceptions being resolved, or are they becoming normal operating behavior?

---

## 17. Daily close sequence

The best daily close order is:

1. Procurement confirms open and expected supplier deliveries.
2. Inventory receives delivered POs into main stores.
3. Inventory issues approved stock to departments.
4. Kitchen/Bar confirms department receipts.
5. Kitchen/Bar records production and waste.
6. Finance imports POS sales.
7. System posts sales depletion against department stock.
8. Teams review exceptions: negative stock, unmapped POS items, missing recipes, missing stock.
9. High-value or critical stock counts are entered.
10. Finance reviews AvT and flags material variances.

This sequence matters because sales depletion depends on clean recipes, clean department stock, and clean POS mapping.

---

## 18. Daily exception report

Each day should end with an exception report, not just a dashboard total.

Minimum daily exceptions:

| Exception | Owner to resolve | Reason |
| --- | --- | --- |
| POS item not mapped to menu item | Finance / Cost Control | No theoretical usage can be calculated |
| Menu item has no recipe | Finance / Cost Control | Food cost and depletion are incomplete |
| Recipe component has no stock item | Finance + Operations | Depletion cannot find the ingredient |
| Component stock is zero or negative | Operations + Inventory | May indicate missing receipt, wrong location, or overuse |
| Store issue not received by department | Inventory + Department Manager | Stock is stuck between control points |
| PO received into wrong location | Inventory / Procurement | Main-store vs department stock becomes distorted |
| Sub-recipe produced but not visible as inventory | Kitchen + System Admin | Final menu depletion will show zero stock |
| Waste not classified by location | Operations | Variance explanation becomes weak |
| Physical count not submitted | Responsible location owner | AvT cannot compare actual to theoretical |

Exception close rule:

> Do not hide exceptions by forcing stock numbers. Resolve the cause, then post a clear correction movement if needed.

---

## 19. Department daily sign-off

Each operating team should be able to sign off in plain language.

### Inventory sign-off

> I confirm all supplier receipts, store issues, store waste, and high-value store counts for today have been recorded.

### Kitchen sign-off

> I confirm all Kitchen receipts, production runs, raw material usage, sales-impacting prep items, waste, and critical counts for today have been recorded.

### Bar sign-off

> I confirm all Bar receipts, production/prep, spills/breakages/waste, and critical counts for today have been recorded.

### Finance sign-off

> I confirm today’s POS import matches the POS/ERP report, unmapped items are resolved or listed as exceptions, and theoretical usage is ready for AvT review.

### Admin / Owner sign-off

> I confirm material exceptions are visible, assigned, and not being ignored as normal variance.
