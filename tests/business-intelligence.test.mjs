import test from "node:test";
import assert from "node:assert/strict";
import {
  businessInsights,
  historyFor,
  inventoryAgeMeta,
  marketRecommendations,
  smartBuyAnalysis,
} from "../lib/business-intelligence.mjs";

test("marketRecommendations produces three sell strategies", () => {
  const r = marketRecommendations({
    typical_price: 5000,
    min_price: 4500,
    max_price: 5600,
  });
  assert.equal(r.quick, 4700);
  assert.equal(r.recommended, 5000);
  assert.equal(r.maxProfit, 5300);
});

test("smartBuyAnalysis identifies a strong margin", () => {
  const r = smartBuyAnalysis({
    summary: { typical_price: 5000, min_price: 4500, max_price: 5600 },
    askingPrice: 3300,
    expenses: 200,
    buyPercentage: 75,
    batteryHealth: 90,
  });
  assert.equal(r.safeBuy, 3550);
  assert.equal(r.decision, "Good deal");
  assert.ok(r.expectedProfit > 0);
});

test("inventoryAgeMeta flags old inventory", () => {
  const r = inventoryAgeMeta(
    { purchase_date: "2026-07-01" },
    new Date("2026-09-01T12:00:00Z"),
  );
  assert.equal(r.level, "action");
  assert.ok(r.days >= 60);
});

test("businessInsights calculates monthly performance and aging", () => {
  const phones = [
    {
      id: "1",
      model: "iPhone 14",
      inventory_scope: "business",
      status: "Sold",
      purchase_date: "2026-08-01",
      purchase_price: 2500,
      repair_cost: 0,
      other_cost: 0,
    },
    {
      id: "2",
      model: "iPhone 15",
      inventory_scope: "business",
      status: "In Stock",
      purchase_date: "2026-08-01",
      purchase_price: 4000,
      repair_cost: 100,
      other_cost: 50,
    },
  ];
  const sales = [
    {
      phone_id: "1",
      model: "iPhone 14",
      selling_price: 3500,
      realized_profit: 1000,
      sold_at: "2026-09-10T12:00:00Z",
      returned_at: null,
    },
  ];
  const r = businessInsights(phones, sales, new Date("2026-09-23T12:00:00Z"));
  assert.equal(r.monthProfit, 1000);
  assert.equal(r.monthRevenue, 3500);
  assert.equal(r.capital, 4150);
  assert.equal(r.bestModel.model, "iPhone 14");
  assert.equal(r.aging.length, 1);
});

test("historyFor filters by device and period", () => {
  const history = [
    { model: "iPhone 14", storage_gb: 128, price: 4000, at: "2026-09-20T00:00:00Z" },
    { model: "iPhone 14", storage_gb: 256, price: 4500, at: "2026-09-20T00:00:00Z" },
    { model: "iPhone 14", storage_gb: 128, price: 3900, at: "2026-08-01T00:00:00Z" },
  ];
  const r = historyFor(history, "iPhone 14", 128, 7, new Date("2026-09-23T00:00:00Z"));
  assert.equal(r.length, 1);
  assert.equal(r[0].price, 4000);
});
