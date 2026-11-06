import fs from "node:fs/promises";
import path from "node:path";
import { asyncBufferFromUrl, parquetReadObjects, parquetRead } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { unzipSync, strFromU8 } from "fflate";
import { parseMarketCapCsv, parsePeCsv, nseDateParts } from "./nse-reports.mjs";

const HF_ROOT = "https://huggingface.co/datasets/tejhq/indian-markets/resolve/main/";
const TEJ_API = "https://api.tejhq.dev/v1/";
const NSE_PR_ROOTS = [
  "https://nsearchives.nseindia.com/content/historical/EQUITIES/",
  "https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/"
];
const NSE_PE_ROOT = "https://nsearchives.nseindia.com/archives/equities/mkt/";
const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  "Accept": "application/json,text/csv,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nseindia.com/"
};
const CURRENT_COLUMNS = [
  "date", "symbol", "isin", "adj_close",
  "ret_1d", "ret_5d", "ret_21d", "ret_63d",
  "ret_126d", "ret_252d", "ret_ytd"
];
const HISTORY_COLUMNS = ["date", "symbol", "isin", "adj_close"];
const HISTORY_START = { NSE: 2010, BSE: 2024 };

function text(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function dateString(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1000000000 ? value * 86400000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  const valueText = String(value ?? "").trim();
  const match = valueText.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function objectField(object, candidates) {
  if (!object || typeof object !== "object") return undefined;
  const normalized = new Map(Object.entries(object).map(([key, value]) => [normalizeKey(key), value]));
  for (const candidate of candidates) {
    if (normalized.has(normalizeKey(candidate))) return normalized.get(normalizeKey(candidate));
  }
  return undefined;
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "rows", "results", "items", "records"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (payload?.[key] && typeof payload[key] === "object") {
      for (const nested of ["data", "rows", "items", "records"]) {
        if (Array.isArray(payload[key][nested])) return payload[key][nested];
      }
    }
  }
  return [];
}

async function fetchJson(url, headers = REQUEST_HEADERS) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(response.status + " " + response.statusText + " from " + new URL(url).hostname);
  return response.json();
}

async function fetchText(url, headers = REQUEST_HEADERS) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(response.status + " " + response.statusText + " from " + new URL(url).hostname);
  return response.text();
}

async function fetchBytes(url, headers = REQUEST_HEADERS) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(40000) });
  if (!response.ok) throw new Error(response.status + " " + response.statusText + " from " + new URL(url).hostname);
  return new Uint8Array(await response.arrayBuffer());
}

async function readParquet(url, columns) {
  const file = await asyncBufferFromUrl({ url, requestInit: { headers: REQUEST_HEADERS } });
  return parquetReadObjects({ file, columns, compressors });
}

function maxDate(rows) {
  let latest = "";
  for (const row of rows) {
    const d = dateString(row.date);
    if (d > latest) latest = d;
  }
  return latest || null;
}

function snapshotMap(rows, exchange) {
  const map = new Map();
  for (const row of rows) {
    const symbol = text(objectField(row, ["symbol", "ticker", "security_id", "scrip_code", "code"])).toUpperCase();
    if (!symbol) continue;
    map.set(exchange + ":" + symbol, {
      name: text(objectField(row, ["company_name", "name", "scrip_name", "security_name", "company"]), symbol),
      isin: text(objectField(row, ["isin", "isin_number"])),
      series: text(objectField(row, ["series"])).toUpperCase()
    });
  }
  return map;
}

function seriesRank(series) {
  return ({ EQ: 5, A: 5, BE: 4, B: 4, BZ: 3, T: 3 })[series] || 0;
}

async function fetchNseMarketCapReport(tradingDate) {
  if (!tradingDate) return { reportDate: null, marketCaps: new Map(), error: "No NSE trading date." };

  for (let offset = 0; offset <= 8; offset += 1) {
    const reportDate = new Date(tradingDate + "T00:00:00Z");
    reportDate.setUTCDate(reportDate.getUTCDate() - offset);
    const date = reportDate.toISOString().slice(0, 10);
    let tokens;
    try {
      tokens = nseDateParts(date);
    } catch {
      continue;
    }

    const urls = [
      NSE_PR_ROOTS[0] + tokens.year + "/" + tokens.month + "/PR" + tokens.ddmmyy + ".zip",
      NSE_PR_ROOTS[1] + "PR" + tokens.ddmmyy + ".zip"
    ];

    for (const url of urls) {
      try {
        const zipBytes = await fetchBytes(url);
        const archive = unzipSync(zipBytes);
        const entries = Object.entries(archive);
        const expectedName = new RegExp("mcap" + tokens.ddmmyyyy + "\\.csv$", "i");
        const member = entries.find(([name]) => expectedName.test(name))
          || entries.find(([name]) => /(^|\\/)mcap\\d{8}\\.csv$/i.test(name));
        if (!member) throw new Error("The PR archive did not contain its dated MCAP CSV.");

        const marketCaps = parseMarketCapCsv(strFromU8(member[1]));
        if (!marketCaps.size) throw new Error("The MCAP CSV did not contain recognised market-cap rows.");
        return { reportDate: date, marketCaps, count: marketCaps.size };
      } catch (error) {
        // Try the alternate official archive path, then the previous trading day.
      }
    }
  }

  return { reportDate: null, marketCaps: new Map(), count: 0, error: "NSE PR/MCAP reports were not available for the recent sessions." };
}

async function fetchPeReport(tradingDate) {
  if (!tradingDate) return { reportDate: null, priceEarnings: new Map() };
  for (let offset = 0; offset <= 8; offset += 1) {
    const d = new Date(tradingDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - offset);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yy = String(d.getUTCFullYear()).slice(-2);
    const reportDate = d.toISOString().slice(0, 10);
    try {
      const csv = await fetchText(NSE_PE_ROOT + "PE_" + dd + mm + yy + ".csv");
      const priceEarnings = parsePeCsv(csv);
      if (priceEarnings.size) return { reportDate, priceEarnings };
    } catch {}
  }
  return { reportDate: null, priceEarnings: new Map() };
}

function buildRows(exchangeRows, meta, valuations) {
  const byInstrument = new Map();
  for (const item of exchangeRows) {
    const exchange = item.exchange;
    const symbol = text(item.symbol).toUpperCase();
    if (!symbol) continue;
    const metaRow = meta.get(exchange + ":" + symbol) || {};
    const isin = text(item.isin, metaRow.isin);
    const series = text(item.series, metaRow.series).toUpperCase();
    if (series && !["EQ", "BE", "BZ", "A", "B", "T"].includes(series)) continue;

    const key = isin ? "ISIN:" + isin : exchange + ":" + symbol;
    const row = {
      exchange,
      symbol,
      name: text(metaRow.name, item.name, symbol),
      isin: isin || null,
      series,
      adjClose: asNumber(item.adj_close),
      allTime: null,
      oneYear: asNumber(item.ret_252d) === null ? null : asNumber(item.ret_252d) * 100,
      ytd: asNumber(item.ret_ytd) === null ? null : asNumber(item.ret_ytd) * 100,
      sixMonth: asNumber(item.ret_126d) === null ? null : asNumber(item.ret_126d) * 100,
      threeMonth: asNumber(item.ret_63d) === null ? null : asNumber(item.ret_63d) * 100,
      oneMonth: asNumber(item.ret_21d) === null ? null : asNumber(item.ret_21d) * 100,
      oneWeek: asNumber(item.ret_5d) === null ? null : asNumber(item.ret_5d) * 100,
      oneDay: asNumber(item.ret_1d) === null ? null : asNumber(item.ret_1d) * 100,
      marketCap: exchange === "NSE" ? (valuations.marketCaps.get(symbol) ?? null) : null,
      pe: exchange === "NSE" ? (valuations.priceEarnings.get(symbol) ?? null) : null,
      _rank: seriesRank(series)
    };

    const existing = byInstrument.get(key);
    if (!existing) {
      byInstrument.set(key, row);
      continue;
    }

    if (existing.exchange !== exchange) {
      if (existing.exchange === "NSE" || exchange === "NSE") {
        const preferred = exchange === "NSE" ? row : existing;
        preferred.exchange = "NSE+BSE";
        byInstrument.set(key, preferred);
      }
    } else if (row._rank > existing._rank) {
      byInstrument.set(key, row);
    }
  }

  return [...byInstrument.values()].map(({ _rank, ...row }) => row);
}

function baselineKey(exchange, isin, symbol, mode) {
  return exchange + "|" + mode + ":" + (mode === "I" ? isin : symbol);
}

function addAllTime(rows, firstPrices) {
  return rows.map(row => {
    const exchanges = row.exchange === "BSE" ? ["BSE", "NSE"] : ["NSE", "BSE"];
    let first = null;
    for (const exchange of exchanges) {
      if (row.isin) first = firstPrices[baselineKey(exchange, row.isin, row.symbol, "I")] || first;
      if (!first) first = firstPrices[baselineKey(exchange, row.isin, row.symbol, "S")];
      if (first) break;
    }

    let allTime = null;
    if (first && Number.isFinite(Number(first.close)) && Number(first.close) > 0 &&
        Number.isFinite(Number(row.adjClose)) && Number(row.adjClose) > 0) {
      allTime = (Number(row.adjClose) / Number(first.close) - 1) * 100;
    }
    const { adjClose, isin, series, ...publicRow } = row;
    return { ...publicRow, allTime };
  });
}

export class ScreenerDataEngine {
  constructor(userDataDirectory, callbacks = {}) {
    this.userDataDirectory = userDataDirectory;
    this.onProgress = callbacks.onProgress || (() => {});
    this.onHistoryReady = callbacks.onHistoryReady || (() => {});
    this.onHistoryError = callbacks.onHistoryError || (() => {});
    this.firstPrices = null;
    this.historyPromise = null;
    this.lastData = null;
  }

  async ensureDirectory() {
    await fs.mkdir(this.userDataDirectory, { recursive: true });
  }

  async readCache(fileName) {
    try {
      return JSON.parse(await fs.readFile(path.join(this.userDataDirectory, fileName), "utf8"));
    } catch {
      return null;
    }
  }

  async writeCache(fileName, value) {
    await this.ensureDirectory();
    const destination = path.join(this.userDataDirectory, fileName);
    const temporary = destination + ".tmp";
    await fs.writeFile(temporary, JSON.stringify(value));
    await fs.rename(temporary, destination);
  }

  async readLatestMetrics(exchange) {
    const url = HF_ROOT + "metrics/" + exchange.toLowerCase() + "_latest.parquet";
    const rows = await readParquet(url, CURRENT_COLUMNS);
    if (!rows.length) throw new Error("No latest " + exchange + " metrics were published.");
    return rows;
  }

  async readSnapshot(exchange, date) {
    try {
      const payload = await fetchJson(TEJ_API + "snapshot/" + exchange.toLowerCase() + "/" + date);
      return snapshotMap(rowsFromPayload(payload), exchange);
    } catch {
      return new Map();
    }
  }

  async fetchCurrent() {
    const [nseMetrics, bseMetrics] = await Promise.all([
      this.readLatestMetrics("NSE"),
      this.readLatestMetrics("BSE")
    ]);
    const nseDate = maxDate(nseMetrics);
    const bseDate = maxDate(bseMetrics);
    const dataDate = [nseDate, bseDate].filter(Boolean).sort().pop() || null;
    if (!dataDate) throw new Error("The market-data source did not provide a trading date.");

    const [nseMeta, bseMeta, marketCapReport, peReport] = await Promise.all([
      this.readSnapshot("NSE", nseDate || dataDate),
      this.readSnapshot("BSE", bseDate || dataDate),
      fetchNseMarketCapReport(nseDate || dataDate).catch(error => ({
        reportDate: null, marketCaps: new Map(), count: 0, error: error.message
      })),
      fetchPeReport(nseDate || dataDate).catch(error => ({
        reportDate: null, priceEarnings: new Map(), error: error.message
      }))
    ]);

    const valuationCache = await this.readCache("valuation-cache.json");
    const cachedCaps = new Map(Object.entries(valuationCache?.marketCaps || {}).map(([symbol, value]) => [symbol, asNumber(value)]));
    const cachedPe = new Map(Object.entries(valuationCache?.priceEarnings || {}).map(([symbol, value]) => [symbol, asNumber(value)]));
    const marketCaps = marketCapReport.marketCaps.size ? marketCapReport.marketCaps : cachedCaps;
    const priceEarnings = peReport.priceEarnings.size ? peReport.priceEarnings : cachedPe;

    const rows = buildRows(
      [
        ...nseMetrics.map(row => ({ ...row, exchange: "NSE" })),
        ...bseMetrics.map(row => ({ ...row, exchange: "BSE" }))
      ],
      new Map([...nseMeta, ...bseMeta]),
      { marketCaps, priceEarnings }
    );

    const result = {
      rows,
      dataDate,
      reportDate: peReport.reportDate || marketCapReport.reportDate || valuationCache?.reportDate || null,
      allTimeReady: false,
      marketCapCoverage: marketCaps.size,
      peCoverage: priceEarnings.size,
      note: null
    };

    const missing = [];
    if (!marketCaps.size) missing.push("NSE market-cap report unavailable");
    else if (!marketCapReport.marketCaps.size) missing.push("using saved market-cap snapshot");
    if (!priceEarnings.size) missing.push("NSE P/E report unavailable");
    else if (!peReport.priceEarnings.size) missing.push("using saved P/E snapshot");
    if (missing.length) result.note = missing.join("; ") + ".";
    
    if (marketCaps.size || priceEarnings.size) {
      await this.writeCache("valuation-cache.json", {
        marketCaps: Object.fromEntries(marketCaps),
        priceEarnings: Object.fromEntries(priceEarnings),
        reportDate: result.reportDate,
        marketCapDate: marketCapReport.reportDate || valuationCache?.marketCapDate || null,
        peDate: peReport.reportDate || valuationCache?.peDate || null,
        updatedAt: new Date().toISOString()
      });
    }
    return result;
  }

  async load() {
    try {
      const data = await this.fetchCurrent();
      this.lastData = data;
      this.firstPrices = this.firstPrices || (await this.readCache("first-prices.json"))?.firstPrices || null;
      if (this.firstPrices) {
        data.rows = addAllTime(data.rows, this.firstPrices);
        data.allTimeReady = true;
      }
      await this.writeCache("screener-cache.json", data);
      if (!data.allTimeReady) this.startHistoryBuild(data);
      return data;
    } catch (error) {
      const cached = await this.readCache("screener-cache.json");
      if (cached && Array.isArray(cached.rows)) {
        cached.note = "Using saved data; refresh unavailable: " + error.message;
        this.lastData = cached;
        return cached;
      }
      throw error;
    }
  }

  async refresh() {
    const data = await this.fetchCurrent();
    this.lastData = data;
    this.firstPrices = this.firstPrices || (await this.readCache("first-prices.json"))?.firstPrices || null;
    if (this.firstPrices) {
      data.rows = addAllTime(data.rows, this.firstPrices);
      data.allTimeReady = true;
    }
    await this.writeCache("screener-cache.json", data);
    if (!data.allTimeReady) this.startHistoryBuild(data);
    return data;
  }

  startHistoryBuild(data) {
    if (this.historyPromise) return;
    this.historyPromise = this.buildFirstPrices(data)
      .then(firstPrices => {
        this.firstPrices = firstPrices;
        const latest = this.lastData || data;
        const completed = {
          ...latest,
          rows: addAllTime(latest.rows.map(row => ({
            ...row,
            adjClose: row.adjClose ?? null,
            isin: row.isin ?? null
          })), firstPrices),
          allTimeReady: true
        };
        this.lastData = completed;
        this.writeCache("screener-cache.json", completed).catch(() => {});
        this.onHistoryReady(completed);
      })
      .catch(error => {
        this.onHistoryError("All-time history could not be completed: " + error.message);
      })
      .finally(() => {
        this.historyPromise = null;
      });
  }

  async buildFirstPrices(data) {
    const cache = await this.readCache("first-prices.json");
    const firstPrices = cache?.firstPrices && typeof cache.firstPrices === "object" ? cache.firstPrices : {};
    const completed = new Set(Array.isArray(cache?.completed) ? cache.completed : []);
    const year = Number((data.dataDate || new Date().toISOString().slice(0, 10)).slice(0, 4));
    const exchanges = ["NSE", "BSE"];
    const tasks = [];

    for (const exchange of exchanges) {
      for (let y = HISTORY_START[exchange]; y <= year; y += 1) {
        const taskKey = exchange + ":" + y;
        if (!completed.has(taskKey)) tasks.push({ exchange, year: y, taskKey });
      }
    }

    const total = tasks.length;
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      const url = HF_ROOT + "metrics/" + task.exchange.toLowerCase() + "_" + task.year + ".parquet";
      this.onProgress({
        current: index,
        total,
        message: "Building all-time baseline · " + task.exchange + " " + task.year
      });
      try {
        await this.scanHistoryFile(url, task.exchange, firstPrices);
        completed.add(task.taskKey);
      } catch (error) {
        this.onProgress({
          current: index + 1,
          total,
          message: "History file unavailable: " + task.exchange + " " + task.year
        });
      }
      await this.writeCache("first-prices.json", {
        version: 1,
        firstPrices,
        completed: [...completed],
        updatedAt: new Date().toISOString()
      });
    }

    this.onProgress({ current: total, total, message: "All-time baseline ready" });
    return firstPrices;
  }

  async scanHistoryFile(url, exchange, firstPrices) {
    const file = await asyncBufferFromUrl({ url, requestInit: { headers: REQUEST_HEADERS } });
    const wanted = new Set(HISTORY_COLUMNS);
    const pending = new Map();
    let processed = 0;

    await parquetRead({
      file,
      columns: HISTORY_COLUMNS,
      compressors,
      onChunk: chunk => {
        if (!wanted.has(chunk.columnName)) return;
        const groupKey = chunk.rowStart + ":" + chunk.rowEnd;
        const group = pending.get(groupKey) || {};
        group[chunk.columnName] = chunk.columnData;
        pending.set(groupKey, group);
        if (![...wanted].every(column => group[column] !== undefined)) return;

        const length = Math.min(...[...wanted].map(column => group[column].length));
        for (let i = 0; i < length; i += 1) {
          const symbol = text(group.symbol[i]).toUpperCase();
          const isin = text(group.isin[i]);
          const close = asNumber(group.adj_close[i]);
          const date = dateString(group.date[i]);
          if (!symbol || !date || close === null || close <= 0) continue;

          const instrumentKey = isin
            ? baselineKey(exchange, isin, symbol, "I")
            : null;
          const symbolKey = baselineKey(exchange, isin, symbol, "S");
          for (const key of [instrumentKey, symbolKey].filter(Boolean)) {
            const previous = firstPrices[key];
            if (!previous || date < previous.date) firstPrices[key] = { date, close };
          }
          processed += 1;
        }
        pending.delete(groupKey);
      }
    });

    if (processed === 0) {
      const rows = await parquetReadObjects({ file, columns: HISTORY_COLUMNS, compressors });
      for (const row of rows) {
        const symbol = text(row.symbol).toUpperCase();
        const isin = text(row.isin);
        const close = asNumber(row.adj_close);
        const date = dateString(row.date);
        if (!symbol || !date || close === null || close <= 0) continue;
        const keys = [
          isin ? baselineKey(exchange, isin, symbol, "I") : null,
          baselineKey(exchange, isin, symbol, "S")
        ].filter(Boolean);
        for (const key of keys) {
          const previous = firstPrices[key];
          if (!previous || date < previous.date) firstPrices[key] = { date, close };
        }
        processed += 1;
      }
    }
    if (processed === 0) throw new Error("No usable historical price rows were read.");
  }
}
