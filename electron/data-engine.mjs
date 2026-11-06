import fs from "node:fs/promises";
import path from "node:path";
import { asyncBufferFromUrl, parquetReadObjects, parquetRead } from "hyparquet";
import { compressors } from "hyparquet-compressors";

const HF_ROOT = "https://huggingface.co/datasets/tejhq/indian-markets/resolve/main/";
const TEJ_API = "https://api.tejhq.dev/v1/";
const NSE_HOME = "https://www.nseindia.com/";
const NSE_STOCKS_TRADED = "https://www.nseindia.com/api/live-analysis-stocksTraded";
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

function parseCsv(input) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const source = String(input).replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' && quoted && source[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(value);
      if (row.some(cell => String(cell).trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += ch;
    }
  }
  row.push(value);
  if (row.some(cell => String(cell).trim() !== "")) rows.push(row);
  return rows;
}

function headerIndex(header, candidates) {
  const normalized = header.map(normalizeKey);
  for (const candidate of candidates) {
    const found = normalized.indexOf(normalizeKey(candidate));
    if (found >= 0) return found;
  }
  return -1;
}

function parsePeCsv(csv) {
  const rows = parseCsv(csv);
  const result = new Map();
  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const header = rows[i];
    const symbolIndex = headerIndex(header, ["SYMBOL", "SYMBOLCODE"]);
    const peIndex = headerIndex(header, ["SYMBOLPE", "PE", "PRICEEARNING", "PRICEEARNINGRATIO"]);
    if (symbolIndex < 0 || peIndex < 0) continue;
    for (const row of rows.slice(i + 1)) {
      const symbol = text(row[symbolIndex]).toUpperCase();
      const pe = asNumber(row[peIndex]);
      if (symbol && pe !== null) result.set(symbol, pe > 0 ? pe : null);
    }
    break;
  }
  return result;
}

function seriesRank(series) {
  return ({ EQ: 5, A: 5, BE: 4, B: 4, BZ: 3, T: 3 })[series] || 0;
}

async function fetchNseBulkData() {
  const home = await fetch(NSE_HOME, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(20000)
  });
  if (!home.ok) throw new Error("NSE session could not be opened (" + home.status + ").");

  let cookie = "";
  if (typeof home.headers.getSetCookie === "function") {
    cookie = home.headers.getSetCookie().map(part => part.split(";")[0]).filter(Boolean).join("; ");
  } else {
    cookie = (home.headers.get("set-cookie") || "").split(/,(?=[^;,]+=)/).map(part => part.split(";")[0]).filter(Boolean).join("; ");
  }
  const headers = { ...REQUEST_HEADERS, Accept: "application/json, text/plain, */*" };
  if (cookie) headers.Cookie = cookie;

  const payload = await fetchJson(NSE_STOCKS_TRADED, headers);
  const rows = payload?.total?.data || payload?.data || payload?.stocks || [];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("NSE Stocks Traded returned no rows.");
  }

  const marketCaps = new Map();
  let marketCapCount = 0;
  for (const item of rows) {
    const symbol = text(objectField(item, ["symbol", "SYMBOL"])).toUpperCase();
    const marketCapCrore = asNumber(objectField(item, [
      "marketCap", "marketCapital", "marketCapitalization", "market_cap",
      "marketCapitalisation", "marketCapitalValue"
    ]));
    if (symbol && marketCapCrore !== null && marketCapCrore > 0) {
      marketCaps.set(symbol, marketCapCrore * 1e7);
      marketCapCount += 1;
    }
  }

  return { marketCaps, count: rows.length, marketCapCount };
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

    const [nseMeta, bseMeta, bulkResult, peReport] = await Promise.all([
      this.readSnapshot("NSE", nseDate || dataDate),
      this.readSnapshot("BSE", bseDate || dataDate),
      fetchNseBulkData().catch(error => ({
        marketCaps: new Map(), marketCapCount: 0, error: error.message
      })),
      fetchPeReport(nseDate || dataDate).catch(error => ({
        reportDate: null, priceEarnings: new Map(), error: error.message
      }))
    ]);

    const valuationCache = await this.readCache("valuation-cache.json");
    const cachedCaps = new Map(Object.entries(valuationCache?.marketCaps || {}).map(([symbol, value]) => [symbol, asNumber(value)]));
    const cachedPe = new Map(Object.entries(valuationCache?.priceEarnings || {}).map(([symbol, value]) => [symbol, asNumber(value)]));
    const marketCaps = bulkResult.marketCaps.size ? bulkResult.marketCaps : cachedCaps;
    const priceEarnings = peReport.priceEarnings.size ? peReport.priceEarnings : cachedPe;
    const valuations = { marketCaps, priceEarnings };
    const rows = buildRows(
      [
        ...nseMetrics.map(row => ({ ...row, exchange: "NSE" })),
        ...bseMetrics.map(row => ({ ...row, exchange: "BSE" }))
      ],
      new Map([...nseMeta, ...bseMeta]),
      valuations
    );

    const result = {
      rows,
      dataDate,
      reportDate: peReport.reportDate || valuationCache?.reportDate || null,
      allTimeReady: false,
      marketCapCoverage: bulkResult.marketCapCount || marketCaps.size,
      peCoverage: priceEarnings.size,
      note: null
    };
    if (!bulkResult.marketCapCount && !marketCaps.size) result.note = "NSE market-cap feed unavailable; those cells are blank.";
    else if (!bulkResult.marketCapCount) result.note = "Using the last saved NSE market-cap snapshot.";
    if (!peReport.priceEarnings.size && priceEarnings.size) result.note = "Using the last saved NSE P/E snapshot.";
    else if (!peReport.priceEarnings.size && !priceEarnings.size) result.note = "NSE P/E report unavailable; those cells are blank.";
    if (marketCaps.size || priceEarnings.size) {
      await this.writeCache("valuation-cache.json", {
        marketCaps: Object.fromEntries(marketCaps),
        priceEarnings: Object.fromEntries(priceEarnings),
        reportDate: result.reportDate,
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
