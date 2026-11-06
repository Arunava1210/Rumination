import test from "node:test";
import assert from "node:assert/strict";
import { metricPercent, allTimePercent, formatPercent, formatMarketCap, compareRows } from "../electron/market-data.mjs";

test("decimal returns convert to percentages", () => {
  assert.equal(metricPercent(0.125), 12.5);
  assert.equal(metricPercent(-0.031), -3.1);
  assert.equal(metricPercent(null), null);
});
test("all-time return uses adjusted closes", () => {
  assert.equal(allTimePercent(150, 100), 50);
  assert.equal(allTimePercent(80, 100), -20);
  assert.equal(allTimePercent(80, null), null);
  assert.equal(allTimePercent(80, 0), null);
});
test("percentage formatting preserves sign", () => {
  assert.equal(formatPercent(8.2), "+8.20%");
  assert.equal(formatPercent(-3.5), "-3.50%");
  assert.equal(formatPercent(null), "—");
});
test("market cap uses INR crores", () => {
  assert.equal(formatMarketCap(25000), "₹25,000 Cr");
  assert.equal(formatMarketCap(250000), "₹2.5 L Cr");
  assert.equal(formatMarketCap(null), "—");
});
test("numeric sort orders both ways and leaves null last", () => {
  const rows = [{value: 2}, {value: null}, {value: 10}];
  assert.deepEqual(rows.slice().sort((a,b) => compareRows(a,b,"value","desc")), [{value:10},{value:2},{value:null}]);
  assert.deepEqual(rows.slice().sort((a,b) => compareRows(a,b,"value","asc")), [{value:2},{value:10},{value:null}]);
});
