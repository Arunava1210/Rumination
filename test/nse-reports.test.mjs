import test from "node:test";
import assert from "node:assert/strict";
import { parseMarketCapCsv, parsePeCsv, nseDateParts } from "../electron/nse-reports.mjs";

test("parses NSE market-cap report values in rupees and filters permitted securities", () => {
  const csv = [
    "Trade Date,Symbol,Series,Security Name,Category,Last Trade Date,Face Value(Rs.),Issue Size,Close Price/Paid up value(Rs.),Market Cap(Rs.)",
    "06 NOV 2026,RELIANCE,EQ,RELIANCE INDUSTRIES LIMITED,Listed,06 NOV 2026,10,1353000000,1450,1961850000000",
    "06 NOV 2026,RELIANCE,BE,RELIANCE INDUSTRIES LIMITED,Permitted,06 NOV 2026,10,1353000000,1450,1961850000000",
    "06 NOV 2026,ABC,EQ,ABC LIMITED,Permitted,06 NOV 2026,10,100000,10,1000000"
  ].join("\n");
  const result = parseMarketCapCsv(csv);
  assert.equal(result.size, 1);
  assert.equal(result.get("RELIANCE"), 1961850000000);
  assert.equal(result.has("ABC"), false);
});

test("finds market-cap header after report preamble", () => {
  const csv = [
    "NATIONAL STOCK EXCHANGE OF INDIA LIMITED",
    "Market Capitalisation Report",
    "Trade Date,Symbol,Series,Security Name,Category,Last Trade Date,Face Value(Rs.),Issue Size,Close Price/Paid up value(Rs.),Market Cap(Rs.)",
    "06 NOV 2026,TCS,EQ,TATA CONSULTANCY SERVICES,Listed,06 NOV 2026,1,3600000000,3000,10800000000000"
  ].join("\n");
  assert.equal(parseMarketCapCsv(csv).get("TCS"), 10800000000000);
});

test("parses the official NSE P/E fields and ignores non-positive values", () => {
  const csv = [
    "Symbol,Symbol P/E,Adjusted P/E",
    "RELIANCE,24.5,23.9",
    "TCS,31.2,30.1",
    "BANKRUPT,0,0",
    "LOSSCO,-5,-4"
  ].join("\n");
  const result = parsePeCsv(csv);
  assert.equal(result.get("RELIANCE"), 24.5);
  assert.equal(result.get("TCS"), 31.2);
  assert.equal(result.has("BANKRUPT"), false);
  assert.equal(result.has("LOSSCO"), false);
});

test("builds PR archive and MCAP member dates with the NSE four-digit inner filename", () => {
  assert.deepEqual(nseDateParts("2026-11-06"), {
    ddmmyy: "061126",
    ddmmyyyy: "06112026",
    year: "2026",
    month: "NOV"
  });
});
