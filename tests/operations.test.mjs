import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDailyActions,
  globalSearch,
  monthlyAccounting,
  supplierAnalytics,
  testProgress,
  workflowSummary,
} from "../lib/operations.mjs";

test("testProgress reports failures and completion", () => {
  const record = {
    tests: {
      "Face ID / Touch ID": "Pass",
      "Display & touch": "Fail",
    },
  };
  const result = testProgress(record);
  assert.equal(result.completed, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.ready, false);
});

test("globalSearch matches partial IMEI and model tokens", () => {
  const phones = [
    {
      id: 1,
      model: "iPhone 15 Pro",
      storage_gb: 256,
      imei: "123456789012345",
      status: "In Stock",
    },
    {
      id: 2,
      model: "iPhone 14",
      storage_gb: 128,
      imei: "999999999999999",
      status: "Sold",
    },
  ];
  assert.equal(globalSearch(phones, "15 pro 2345")[0].id, 1);
});

test("monthlyAccounting totals financials", () => {
  const result = monthlyAccounting(
    [
      {
        sold_at: "2026-09-15T12:00:00Z",
        selling_price: 5000,
        purchase_price: 3000,
        repair_cost: 400,
        other_cost: 100,
        realized_profit: 1500,
      },
      {
        sold_at: "2026-09-20T12:00:00Z",
        selling_price: 6000,
        purchase_price: 4000,
        repair_cost: 0,
        other_cost: 100,
        realized_profit: 1900,
      },
    ],
    2026,
    8,
  );
  assert.equal(result.units, 2);
  assert.equal(result.revenue, 11000);
  assert.equal(result.totalCost, 7600);
  assert.equal(result.profit, 3400);
});

test("supplierAnalytics joins sale to phone purchase source", () => {
  const rows = supplierAnalytics(
    [
      { id: "p1", purchase_source: "Tradera" },
      { id: "p2", purchase_source: "Facebook" },
    ],
    [
      { phone_id: "p1", selling_price: 5000, purchase_price: 3000, repair_cost: 0, other_cost: 0, realized_profit: 2000 },
      { phone_id: "p2", selling_price: 5000, purchase_price: 4000, repair_cost: 0, other_cost: 0, realized_profit: 1000 },
    ],
  );
  assert.equal(rows[0].source, "Tradera");
  assert.equal(rows[0].avgProfit, 2000);
});

test("daily action center flags repairs and old ads", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  const phones = [
    {
      id: "p1",
      model: "iPhone 15",
      storage_gb: 128,
      status: "Repairing",
      purchase_date: "2026-09-01",
    },
    {
      id: "p2",
      model: "iPhone 14",
      storage_gb: 128,
      status: "Listed",
      purchase_date: "2026-08-01",
      selling_price: 5000,
    },
  ];
  const actions = buildDailyActions({
    phones,
    ops: {},
    adRecords: [
      {
        phoneId: "p2",
        status: "Published",
        createdAt: "2026-09-10T12:00:00Z",
      },
    ],
    priceHistory: [],
    now,
  });
  assert.ok(actions.some((x) => x.type === "repair" && x.phone.id === "p1"));
  assert.ok(actions.some((x) => x.type === "relist" && x.phone.id === "p2"));
});

test("workflowSummary respects sold status", () => {
  const result = workflowSummary({ id: "p1", status: "Sold" }, {
    p1: { stage: "Testing" },
  });
  assert.equal(result.stage, "Sold");
});
