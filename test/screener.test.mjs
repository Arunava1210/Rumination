import test from "node:test";
import assert from "node:assert/strict";
import { sortRows, filterRows, formatPercent, formatMarketCap, formatPe } from "../src/screener.js";

const rows = [
  { symbol: "BETA", oneDay: -1.2, marketCap: 1000000000, pe: 22 },
  { symbol: "ALPHA", oneDay: 2.5, marketCap: 4000000000, pe: 18 },
  { symbol: "GAMMA", oneDay: null, marketCap: null, pe: null }
];

test("sorts numeric metrics in both directions and leaves missing values last", () => {
  assert.deepEqual(sortRows(rows, "oneDay", "desc").map(x => x.symbol), ["ALPHA", "BETA", "GAMMA"]);
  assert.deepEqual(sortRows(rows, "marketCap", "asc").map(x => x.symbol), ["BETA", "ALPHA", "GAMMA"]);
});

test("sorts ticker names alphabetically", () => {
  assert.deepEqual(sortRows(rows, "symbol", "asc").map(x => x.symbol), ["ALPHA", "BETA", "GAMMA"]);
});

test("search matches ticker and company name", () => {
  const named = [{ symbol: "RELIANCE", name: "Reliance Industries" }, { symbol: "TCS", name: "Tata Consultancy Services" }];
  assert.deepEqual(filterRows(named, "tata").map(x => x.symbol), ["TCS"]);
  assert.deepEqual(filterRows(named, "rel").map(x => x.symbol), ["RELIANCE"]);
});

test("formats percentages, market cap and valuation", () => {
  assert.equal(formatPercent(2.345), "+2.35%");
  assert.equal(formatPercent(-1.2), "-1.20%");
  assert.equal(formatPercent(null), "—");
  assert.equal(formatMarketCap(1000000000), "₹100 Cr");
  assert.equal(formatPe(22.35), "22.4x");
  assert.equal(formatPe(-4), "—");
});
