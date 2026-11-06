import test from "node:test";
import assert from "node:assert/strict";
import { calculateADR, calculateRSI, calculateASI } from "../src/indicators.js";

const bars = [
  { time: "2026-01-01", open: 10, high: 11, low: 9, close: 10 },
  { time: "2026-01-02", open: 11, high: 13, low: 10, close: 12 },
  { time: "2026-01-05", open: 12, high: 14, low: 12, close: 13 },
  { time: "2026-01-06", open: 12, high: 13, low: 10, close: 11 }
];

test("ADR is the mean daily high-low range", () => {
  const result = calculateADR(bars, 2);
  assert.equal(result.length, 3);
  assert.equal(result[0].time, "2026-01-02");
  assert.equal(result[0].value, 2.5);
  assert.equal(result[1].value, 2.5);
});

test("RSI uses Wilder smoothing and is bounded from 0 to 100", () => {
  const result = calculateRSI(bars, 2);
  assert.equal(result.length, 2);
  assert.ok(result.every(point => point.value >= 0 && point.value <= 100));
  assert.equal(result[0].value, 100);
});

test("ASI starts at zero and accumulates swing-index values", () => {
  const result = calculateASI(bars, 12);
  assert.equal(result.length, bars.length);
  assert.equal(result[0].value, 0);
  assert.ok(result.every(point => Number.isFinite(point.value)));
  assert.notEqual(result.at(-1).value, 0);
});

test("invalid indicator parameters are rejected", () => {
  assert.throws(() => calculateADR(bars, 0), RangeError);
  assert.throws(() => calculateRSI(bars, 1.5), RangeError);
  assert.throws(() => calculateASI(bars, 0), RangeError);
});
