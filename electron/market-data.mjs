import fs from "node:fs/promises";
import path from "node:path";

const BASE = "https://bharatstockapi.com/v1";
const HF = "https://huggingface.co/datasets/tejhq/indian-markets/resolve/main";
const PAGE_SIZE = 200;
const CURRENT_YEAR = new Date().getUTCFullYear();
const NSE_FIRST_YEAR = 2010;
const BSE_FIRST_YEAR = 2024;

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function metricPercent(value) {
  const n = numberOrNull(value);
  return n === null ? null : n * 100;
}

export function allTimePercent(currentAdjustedClose, earliestAdjustedClose) {
  const current = numberOrNull(currentAdjustedClose);
  const first = numberOrNull(earliestAdjustedClose);
  if (current === null || first === null || first === 0) return null;
  return (current / first - 1) * 100;
}

export function formatPercent(value) {
  const n = numberOrNull(value);
  if (n === null) return "—";
  return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
}

export function formatMarketCap(value) {
  const n = numberOrNull(value);
  if (n === null) return "—";
  const fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
  return n >= 100000 ? "₹" + fmt.format(n / 100000) + " L Cr" : "₹" + fmt.format(n) + " Cr";
}

export function compareRows(a, b, key, direction = "desc") {
  const av = numberOrNull(a[key]);
  const bv = numberOrNull(b[key]);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  const result = av === bv ? 0 : av < bv ? -1 : 1;
  return direction === "asc" ? result : -result;
}

function dateString(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = value > 1000000000 ? new Date(value) : new Date(value * 86400000);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
  }
  const text = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return "";
}

function keyOf(exchange, symbol) {
  return String(exchange || "").toUpperCase() + ":" + String(symbol || "").trim().toUpperCase();
}

async function readJson(url, apiKey) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-API-Key": apiKey, "User-Agent": "IndiaStockScreener/1.0" },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body.detail || body.message || JSON.stringify(body);
    } catch {
      detail = response.statusText;
    }
    if (response.status === 401) throw new Error("The BharatStock API key was rejected. Check the key and try again.");
    if (response.status === 429) throw new Error("BharatStock daily request limit reached. Your saved screener data is still available.");
    throw new Error("BharatStock returned HTTP " + response.status + ": " + detail);
  }
  return response.json();
}

async function readParquet(url, columns) {
  const { asyncBufferFromUrl, parquetReadObjects } = await import("hyparquet");
  const { compressors } = await import("hyparquet-compressors");
  const file = await asyncBufferFromUrl({
    url,
    requestInit: { headers: { "User-Agent": "IndiaStockScreener/1.0" } }
  });
  return parquetReadObjects({ file, columns, compressors });
}

async function fetchUniverse(apiKey, onProgress) {
  let page = 1;
  let totalPages = 1;
  const all = [];
  while (page <= totalPages) {
    onProgress({ phase: "universe", message: "Loading Indian stock directory", current: page, total: totalPages });
    const url = new URL(BASE + "/screener");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(PAGE_SIZE));
    url.searchParams.set("sort_by", "market_cap");
    url.searchParams.set("sort_order", "desc");
    const payload = await readJson(url.toString(), apiKey);
    const batch = Array.isArray(payload.data) ? payload.data : [];
    all.push(...batch);
    const pages = Number(payload.pagination?.total_pages);
    if (Number.isFinite(pages) && pages > 0) totalPages = pages;
    else if (batch.length < PAGE_SIZE) totalPages = page;
    if (batch.length === 0) break;
    page += 1;
  }
  const unique = new Map();
  for (const item of all) {
    const exchange = String(item.exchange || "").toUpperCase();
    const symbol = String(item.symbol || "").trim();
    if (!symbol || !["NSE", "BSE"].includes(exchange)) continue;
    unique.set(keyOf(exchange, symbol), item);
  }
  return [...unique.values()];
}

async function fetchPriceMetrics(onProgress) {
  onProgress({ phase: "prices", message: "Loading daily adjusted price changes", current: 0, total: 2 });
  const [nse, bse] = await Promise.all([
    readParquet(HF + "/metrics/nse_latest.parquet", [
      "date", "symbol", "isin", "adj_close", "ret_1d", "ret_5d", "ret_21d",
      "ret_63d", "ret_126d", "ret_252d", "ret_ytd"
    ]),
    readParquet(HF + "/metrics/bse_latest.parquet", [
      "date", "symbol", "isin", "adj_close", "ret_1d", "ret_5d", "ret_21d",
      "ret_63d", "ret_126d", "ret_252d", "ret_ytd"
    ])
  ]);
  const map = new Map();
  let asOf = "";
  for (const [exchange, records] of [["NSE", nse], ["BSE", bse]]) {
    for (const row of records) {
      const symbol = String(row.symbol || "").trim();
      if (!symbol) continue;
      const date = dateString(row.date);
      if (date > asOf) asOf = date;
      map.set(keyOf(exchange, symbol), row);
    }
  }
  return { map, asOf };
}

async function fetchFirstPrices(universe, previous, onProgress) {
  const firstPrices = { ...(previous || {}) };
  const wanted = new Set(universe.map(row => keyOf(row.exchange, row.symbol)));
  const missing = new Set([...wanted].filter(key => !firstPrices[key]));
  if (missing.size === 0) return firstPrices;

  const startYears = { NSE: NSE_FIRST_YEAR, BSE: BSE_FIRST_YEAR };
  for (const exchange of ["NSE", "BSE"]) {
    const keys = [...missing].filter(key => key.startsWith(exchange + ":"));
    if (keys.length === 0) continue;
    const symbolSet = new Set(keys.map(key => key.slice(exchange.length + 1)));
    const firstYear = startYears[exchange];
    const years = Array.from({ length: CURRENT_YEAR - firstYear + 1 }, (_, i) => firstYear + i);
    for (let index = 0; index < years.length; index += 1) {
      const year = years[index];
      onProgress({
        phase: "history",
        message: "Building all-time history cache — " + exchange + " " + year,
        current: index + 1,
        total: years.length
      });
      const url = HF + "/prices_adjusted/" + exchange.toLowerCase() + "_" + year + ".parquet";
      const rows = await readParquet(url, ["symbol", "date", "adj_close"]);
      for (const row of rows) {
        const symbol = String(row.symbol || "").trim().toUpperCase();
        if (!symbol || !symbolSet.has(symbol)) continue;
        const key = keyOf(exchange, symbol);
        const price = numberOrNull(row.adj_close);
        const date = dateString(row.date);
        if (price === null || !date) continue;
        const old = firstPrices[key];
        if (!old || date < old.date) firstPrices[key] = { date, price };
      }
    }
  }
  return firstPrices;
}

function mergeRows(universe, priceMetrics, firstPrices) {
  return universe.map(item => {
    const exchange = String(item.exchange || "").toUpperCase();
    const symbol = String(item.symbol || "").trim();
    const metric = priceMetrics.map.get(keyOf(exchange, symbol));
    const first = firstPrices[keyOf(exchange, symbol)];
    const current = metric ? numberOrNull(metric.adj_close) : null;
    const result = {
      id: keyOf(exchange, symbol),
      symbol,
      exchange,
      companyName: String(item.company_name || item.name || symbol),
      allTime: allTimePercent(current, first?.price),
      oneYear: metricPercent(metric?.ret_252d),
      ytd: metricPercent(metric?.ret_ytd),
      sixMonths: metricPercent(metric?.ret_126d),
      threeMonths: metricPercent(metric?.ret_63d),
      oneMonth: metricPercent(metric?.ret_21d),
      oneWeek: metricPercent(metric?.ret_5d),
      oneDay: metricPercent(metric?.ret_1d),
      marketCap: numberOrNull(item.market_cap),
      pe: numberOrNull(item.pe_ratio),
      pb: numberOrNull(item.pb_ratio),
      historyFrom: first?.date || null
    };
    return result;
  });
}

export async function readCache(userDataPath) {
  try {
    const raw = await fs.readFile(path.join(userDataPath, "screener-cache.json"), "utf8");
    const cache = JSON.parse(raw);
    return cache.version === 1 ? cache : null;
  } catch {
    return null;
  }
}

async function writeCache(userDataPath, cache) {
  await fs.mkdir(userDataPath, { recursive: true });
  const target = path.join(userDataPath, "screener-cache.json");
  const temporary = target + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
}

export async function syncScreener(apiKey, userDataPath, onProgress = () => {}) {
  if (!apiKey || typeof apiKey !== "string") throw new Error("Enter your free BharatStock API key to load the screener.");
  const previous = await readCache(userDataPath);
  onProgress({ phase: "start", message: "Starting daily screener update" });
  const universe = await fetchUniverse(apiKey, onProgress);
  if (universe.length === 0) throw new Error("The stock directory returned no NSE/BSE listings.");
  const prices = await fetchPriceMetrics(onProgress);
  const firstPrices = await fetchFirstPrices(universe, previous?.firstPrices, onProgress);
  onProgress({ phase: "merge", message: "Combining price changes and valuation data" });
  const rows = mergeRows(universe, prices, firstPrices);
  const computedDates = universe.map(x => String(x.computed_at || "")).filter(Boolean).sort();
  const cache = {
    version: 1,
    rows,
    firstPrices,
    stockCount: rows.length,
    priceAsOf: prices.asOf || null,
    valuationAsOf: computedDates.at(-1) || null,
    lastSyncedAt: new Date().toISOString()
  };
  await writeCache(userDataPath, cache);
  onProgress({ phase: "done", message: "Screener updated", current: rows.length, total: rows.length });
  return cache;
}
