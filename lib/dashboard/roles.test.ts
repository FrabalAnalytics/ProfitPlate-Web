import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDashboardRoles,
  costingRoles,
  normalizeRole,
  operationsRoles,
  roleLabels,
} from "./roles.ts";

test("consolidates removed roles into their new owners", () => {
  assert.equal(normalizeRole("general_manager"), "operations_manager");
  assert.equal(normalizeRole("cost_controller"), "finance_manager");
  assert.equal(normalizeRole("production_supervisor"), "kitchen_manager");
  assert.equal(normalizeRole("pos_supervisor"), "finance_manager");
});

test("preserves useful legacy aliases", () => {
  assert.equal(normalizeRole("GM"), "operations_manager");
  assert.equal(normalizeRole("restaurant-manager"), "operations_manager");
  assert.equal(normalizeRole("sales supervisor"), "finance_manager");
  assert.equal(normalizeRole("receiving_officer"), "storekeeper");
});

test("keeps consolidated responsibilities in the destination access sets", () => {
  assert.equal(costingRoles.has("operations_manager"), true);
  assert.equal(costingRoles.has("finance_manager"), true);
  assert.equal(operationsRoles.has("finance_manager"), true);
  assert.equal(operationsRoles.has("kitchen_manager"), true);
});

test("removed roles are absent from selectable roles and labels", () => {
  const removedRoles = [
    "general_manager",
    "cost_controller",
    "production_supervisor",
    "pos_supervisor",
  ];

  for (const role of removedRoles) {
    assert.equal(activeDashboardRoles.includes(role as never), false);
    assert.equal(role in roleLabels, false);
  }
});

test("unknown roles remain read-only", () => {
  assert.equal(normalizeRole("unknown"), "viewer");
  assert.equal(normalizeRole(null), "viewer");
});
