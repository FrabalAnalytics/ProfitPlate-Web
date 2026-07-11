# ProfitPlate Role, Responsibility, and Access Matrix

Last updated: July 9, 2026

## Purpose

This document defines the current main restaurant roles in ProfitPlate, what each role is responsible for operationally, and the level of system access each role should have. It is based on the current role model added in `supabase/migrations/025_restaurant_role_model_expansion.sql`.

## Access Legend

| Access area | Meaning |
| --- | --- |
| Workspace Admin | Can manage workspace-level settings and role administration. |
| Costing | Can manage recipe costing, ingredient costs, yield impact, and margin controls. |
| Operations Entry | Can record daily operational activity such as receiving, production, requisitions, waste, sales operations, or yield tests. |
| Operations Approval | Can approve or acknowledge operational exceptions, stock issues, receiving, and controls. |
| Procurement | Can prepare or manage purchase-related workflows. |
| Inventory | Can access inventory movement, receiving, stock counts, and store controls. |
| Kitchen Production | Can access production planning, production ledger, kitchen requisitions, yield tests, and kitchen waste workflows. |
| Bar Operations | Can access bar stock, bar requisitions, bar waste, and beverage movement workflows. |
| Sales/POS Control | Can review sales imports, POS mappings, voids, promos, discounts, and sales register accuracy. |
| Reports/Audit | Can review reports, exceptions, audit trails, and management attention items. |

## Role Matrix

| Role | Operational responsibility | Main access |
| --- | --- | --- |
| Owner | Owns the business, final accountability, role control, approvals, financial oversight, and exception review. | Workspace Admin, Costing, Operations Entry, Operations Approval, Procurement, Inventory, Kitchen Production, Bar Operations, Sales/POS Control, Reports/Audit |
| Admin | Supports owner with workspace setup, user administration, high-level operations, and system configuration. | Workspace Admin, Costing, Operations Entry, Operations Approval, Reports/Audit |
| Manager | General management role for operational oversight, approvals, and daily variance review. | Costing, Operations Entry, Operations Approval, Reports/Audit |
| Operations Manager | Runs daily restaurant operations across departments and controls inventory discipline, production variance, waste, day close, exceptions, and team accountability. | Costing, Operations Entry, Operations Approval, Procurement, Inventory, Kitchen Production, Bar Operations, Reports/Audit |
| Procurement Manager | Manages supplier relationships, purchase planning, supplier price movement, procurement accuracy, and sourcing risks. | Costing, Operations Entry, Operations Approval, Procurement, Reports/Audit |
| Finance Manager | Owns recipe costing, yield and food-cost variance, selling-price and margin controls, POS imports and mappings, discounts, voids, sales-register accuracy, financial exposure, and management reporting. | Costing, Operations Entry, Operations Approval, Sales/POS Control, Reports/Audit |
| Inventory Manager | Owns store control, inventory accuracy, stock counts, reorder exposure, stock variance, and receiving supervision. | Operations Entry, Operations Approval, Inventory, Reports/Audit |
| Storekeeper | Receives fresh supplies, confirms purchase receipts, issues stock to departments, attends stock requisitions, and keeps store movement records accurate. | Operations Entry, Operations Approval, Inventory |
| Kitchen Manager | Owns kitchen planning, coordinates prep runs and production records, manages yield tests, kitchen requisitions, recipe output, waste review, production variance, and kitchen team accountability. | Operations Entry, Operations Approval, Kitchen Production |
| Chef | Records kitchen production activity, recipe execution, waste, and ingredient usage under kitchen leadership. | Operations Entry, Kitchen Production |
| Quality Assurance | Reviews supplier quality, yield tests, over-trimming, hygiene/process exceptions, production quality, and compliance alerts. | Operations Entry, Operations Approval, Kitchen Production, Reports/Audit |
| Bar Manager | Owns bar stock, bar requisitions, beverage waste, bar inventory discipline, and bar operating controls. | Operations Entry, Operations Approval, Bar Operations |
| Bartender | Records bar activity, requests stock, logs bar waste, and maintains bar stock usage under bar manager supervision. | Operations Entry, Bar Operations |
| Auditor | Reviews registers, approvals, exceptions, yield/cost events, and audit trails without routine operational entry. | Operations Approval, Reports/Audit |
| Viewer | Can review permitted dashboard information without changing records. | Limited read-only access |

## Department View

| Department | Lead role | Supporting role(s) | Key workflows |
| --- | --- | --- | --- |
| Ownership / Executive | Owner | Operations Manager, Finance Manager, Auditor | Management attention, approvals, financial review, audit trail, exception escalation |
| General Operations | Operations Manager | Department Heads | Daily execution, day close, cross-department accountability, risk escalation |
| Stores / Inventory | Inventory Manager | Storekeeper | Receiving, stock requisitions, stock counts, reorder control, inventory variance |
| Kitchen | Kitchen Manager | Chef, Quality Assurance | Production planning, production ledger, yield tests, kitchen requisitions, waste |
| Bar | Bar Manager | Bartender | Bar requisitions, beverage stock, bar waste, bar stock usage |
| Procurement | Procurement Manager | Inventory Manager, Storekeeper | Purchase planning, supplier pricing, PO receiving handoff |
| Finance / Cost Control | Finance Manager | Owner | Menu margin, recipe costing, price/yield impact, cost movement review |
| Sales / POS | Finance Manager | Operations Manager | POS imports, sales mapping, voids, promos, discounts |
| Compliance / Audit | Auditor | Owner, Operations Manager, Quality Assurance | Exceptions, approvals, register completeness, audit trail |

## Important Notes

- General Manager responsibilities are consolidated into `operations_manager`.
- Cost Controller and POS Supervisor responsibilities are consolidated into `finance_manager`.
- Production Supervisor responsibilities are consolidated into `kitchen_manager`.
- Storekeeper replaces the separate Receiving Officer role for now. This keeps receiving and stock issue responsibility in one practical store role.
- Chef sub-roles can be introduced later under the Kitchen Manager / Chef structure without disturbing the main role model.
- Bar has two levels for now: `bar_manager` as department head and `bartender` as the lower-authority operating role.
- Quality Assurance is intentionally separate from Kitchen Manager because QA should be able to challenge supplier quality, trimming/yield outcomes, and process exceptions without being treated as only a kitchen production role.
- Sub-roles should be added after workflows and screens are stabilized, so the access model follows real work rather than creating confusing permissions too early.
