import test from "node:test";
import assert from "node:assert/strict";
import {
  matches,
  isSold,
  cost,
  profit,
  marketStats,
  payload,
  blank,
  sensitive,
  editPayload,
} from "../lib/inventory.mjs";
test("editing preserves untouched nulls, legacy values and concurrent fields", () => {
  const original = {
    ...blank,
    purchase_price: null,
    battery_health: null,
    imei: "legacy identifier",
    condition: "Legacy condition",
  };
  const form = {
    ...original,
    purchase_price: "",
    battery_health: "",
    color: "Green",
  };
  assert.deepEqual(editPayload(form, original, true), { color: "Green" });
  assert.deepEqual(
    editPayload({ ...form, purchase_price: 999 }, original, false),
    { color: "Green" },
  );
});
test("search matches all requested fields and combined terms", () => {
  const p = {
    model: "iPhone 15",
    imei: "001234567890123",
    storage_gb: 256,
    color: "Blue",
    condition: "Good",
    status: "Listed",
  };
  for (const q of [
    "iphone",
    "001234",
    "256",
    "blue",
    "good",
    "listed",
    "IPHONE 256 blue",
  ])
    assert.equal(matches(p, q), true);
  assert.equal(matches(p, "512"), false);
});
test("sold records are excluded from available inventory without deleting them", () => {
  const phones = [
    { status: "Sold" },
    { status: "In Stock" },
    { status: " sold " },
    { status: "Repairing" },
  ];
  assert.equal(phones.filter(isSold).length, 2);
  assert.equal(phones.filter((p) => !isSold(p)).length, 2);
  assert.equal(phones.length, 4);
});
test("financial totals handle null legacy costs and actual losses", () => {
  const p = {
    purchase_price: 100,
    repair_cost: null,
    other_cost: 20,
    selling_price: 110,
  };
  assert.equal(cost(p), 120);
  assert.equal(profit(p), -10);
});
test("restricted edits omit financial fields instead of overwriting them", () => {
  const result = payload(
    { ...blank, imei: "001234567890123", purchase_price: 999 },
    false,
  );
  sensitive.forEach((k) => assert.equal(Object.hasOwn(result, k), false));
  assert.equal(result.imei, "001234567890123");
  assert.equal(result.battery_health, null);
});
test("market estimates match model/storage/condition and honor configurable percentage and costs", () => {
  const phone = { model: "iPhone 15", storage_gb: 128, condition: "Good" };
  const records = [
    { ...phone, market_price: 1000 },
    { ...phone, model: " iphone 15 ", market_price: 2000 },
    { ...phone, storage_gb: 256, market_price: 5000 },
    { ...phone, condition: "Fair", market_price: 4000 },
  ];
  assert.deepEqual(marketStats(records, phone, 80, 100), {
    count: 2,
    average: 1500,
    min: 1000,
    max: 2000,
    buy: 1200,
    expected: 200,
  });
  assert.equal(marketStats(records, { ...phone, model: "other" }, 80), null);
  assert.equal(marketStats(records, phone, 0).buy, 0);
});
