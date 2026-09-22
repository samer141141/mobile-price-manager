import test from "node:test";
import assert from "node:assert/strict";
import { median, cleanMarketPrices, sourceCategory, normalizeMarketValue } from "../lib/market.mjs";

test("median handles odd and even samples", () => {
  assert.equal(median([100, 300, 200]), 200);
  assert.equal(median([100, 200, 300, 400]), 250);
});

test("market cleaner rejects obvious IQR outliers", () => {
  assert.deepEqual(cleanMarketPrices([4000, 4100, 4200, 4300, 20000]), [4000, 4100, 4200, 4300]);
});

test("sources stay in separate market categories", () => {
  assert.equal(sourceCategory("Tradera"), "used_marketplace");
  assert.equal(sourceCategory("Blocket"), "used_marketplace");
  assert.equal(sourceCategory("Swappie"), "refurbished_retail");
  assert.equal(sourceCategory("Back Market"), "refurbished_retail");
});

test("normalization is stable", () => {
  assert.equal(normalizeMarketValue("  iPhone   16 Pro "), "iphone 16 pro");
});
