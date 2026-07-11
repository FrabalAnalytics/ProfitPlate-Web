import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeCsvValue,
  extractUuid,
  formatCurrencyAmount,
  formatShortDate,
  formatSignedCurrencyAmount,
  getDateFilterStart,
  getDateKey,
  getDateMs,
  getLocalDateInputValue,
  isWithinDateFilter,
} from "./formatting.ts";

test("extracts UUIDs from noisy Supabase values", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  assert.equal(extractUuid(`inventory:${uuid}:active`), uuid);
  assert.equal(extractUuid(null), "");
  assert.equal(extractUuid("not-an-id"), "");
});

test("formats unsigned and signed currency consistently", () => {
  assert.equal(formatCurrencyAmount("NGN", 1234.5), "NGN\u00a01,234.5");
  assert.equal(formatSignedCurrencyAmount("NGN", 250), "+NGN\u00a0250");
  assert.equal(formatSignedCurrencyAmount("NGN", -250), "-NGN\u00a0250");
  assert.equal(formatSignedCurrencyAmount("NGN", 0), "NGN\u00a00");
});

test("builds local date input values without UTC date drift", () => {
  assert.equal(getLocalDateInputValue(new Date(2026, 6, 9, 23, 30)), "2026-07-09");
});

test("calculates inclusive rolling-day filter boundaries", () => {
  const referenceDate = new Date(2026, 6, 9, 18, 30);

  assert.equal(
    getDateFilterStart("7d", referenceDate),
    new Date(2026, 6, 3, 0, 0).getTime(),
  );
  assert.equal(
    getDateFilterStart("30d", referenceDate),
    new Date(2026, 5, 10, 0, 0).getTime(),
  );
  assert.equal(
    isWithinDateFilter(new Date(2026, 6, 3, 0, 0).toISOString(), "7d", referenceDate),
    true,
  );
  assert.equal(
    isWithinDateFilter(new Date(2026, 6, 2, 23, 59).toISOString(), "7d", referenceDate),
    false,
  );
  assert.equal(isWithinDateFilter("invalid", "all", referenceDate), true);
});

test("handles valid and invalid activity dates", () => {
  const timestamp = new Date(2026, 6, 9, 12, 0).getTime();

  assert.notEqual(getDateKey(new Date(timestamp).toISOString()), "");
  assert.equal(getDateKey("invalid"), "");
  assert.equal(getDateMs("invalid"), 0);
  assert.match(formatShortDate(timestamp), /2026/);
  assert.equal(formatShortDate(0), "No activity yet");
});

test("escapes CSV delimiters, quotes, and blank values", () => {
  assert.equal(escapeCsvValue("plain"), "plain");
  assert.equal(escapeCsvValue("Lagos, Island"), '"Lagos, Island"');
  assert.equal(escapeCsvValue('Chef "A"'), '"Chef ""A"""');
  assert.equal(escapeCsvValue(null), "");
});
