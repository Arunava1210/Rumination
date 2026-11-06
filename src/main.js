import "./style.css";

const $ = id => document.getElementById(id);
const state = {
  rows: [],
  filtered: [],
  sortKey: "marketCap",
  sortDirection: "desc",
  page: 1,
  pageSize: 150,
  syncing: false,
  cache: null
};

const pctKeys = new Set(["allTime", "oneYear", "ytd", "sixMonths", "threeMonths", "oneMonth", "oneWeek", "oneDay"]);

function formatRatio(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(2);
}
function setStatus(message, offline = false) {
  $("sync-status").querySelector("span").textContent = message;
  $("sync-status").querySelector(".status-dot").classList.toggle("offline", offline);
}
function visibleRows() {
  const term = $("search").value.trim().toLocaleLowerCase();
  const rows = term
    ? state.rows.filter(row => row.symbol.toLocaleLowerCase().includes(term) || row.companyName.toLocaleLowerCase().includes(term))
    : state.rows.slice();
  rows.sort((a, b) => compareRows(a, b, state.sortKey, state.sortDirection));
  return rows;
}
function renderHeaderSort() {
  document.querySelectorAll("th[data-sort]").forEach(th => {
    const key = th.dataset.sort;
    th.classList.toggle("sorted", key === state.sortKey);
    const button = th.querySelector("button");
    const original = button.dataset.label || button.textContent.replace(/[▲▼]\s*$/, "").trim();
    button.dataset.label = original;
    button.textContent = key === state.sortKey ? original + (state.sortDirection === "asc" ? " ▲" : " ▼") : original;
  });
}
function createCell(value, className = "") {
  const td = document.createElement("td");
  td.className = className;
  td.textContent = value;
  return td;
}
function createCompanyCell(row) {
  const td = document.createElement("td");
  td.className = "company-cell";
  const top = document.createElement("div");
  top.className = "company-top";
  const ticker = document.createElement("strong");
  ticker.textContent = row.symbol;
  const exchange = document.createElement("span");
  exchange.className = "exchange-tag " + row.exchange.toLowerCase();
  exchange.textContent = row.exchange;
  top.append(ticker, exchange);
  const name = document.createElement("div");
  name.className = "company-name";
  name.textContent = row.companyName;
  td.append(top, name);
  return td;
}
function valueCell(value, key, type) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return createCell("—", "numeric missing");
  let content;
  let cls = "numeric";
  if (type === "percent") {
    content = formatPercent(value);
    cls += Number(value) > 0 ? " positive" : Number(value) < 0 ? " negative" : "";
  } else if (type === "marketCap") {
    content = formatMarketCap(value);
  } else {
    content = formatRatio(value);
  }
  return createCell(content, cls);
}
function renderTable() {
  state.filtered = visibleRows();
  const total = state.filtered.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.pageSize;
  const shown = state.filtered.slice(start, start + state.pageSize);
  const body = $("table-body");
  body.replaceChildren();
  if (shown.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 12;
    td.className = "empty-state";
    td.textContent = state.rows.length ? "No companies match this search." : "Enter your API key to load the stock universe.";
    tr.append(td);
    body.append(tr);
  } else {
    for (const row of shown) {
      const tr = document.createElement("tr");
      tr.append(createCompanyCell(row));
      tr.append(valueCell(row.allTime, "allTime", "percent"));
      tr.append(valueCell(row.oneYear, "oneYear", "percent"));
      tr.append(valueCell(row.ytd, "ytd", "percent"));
      tr.append(valueCell(row.sixMonths, "sixMonths", "percent"));
      tr.append(valueCell(row.threeMonths, "threeMonths", "percent"));
      tr.append(valueCell(row.oneMonth, "oneMonth", "percent"));
      tr.append(valueCell(row.oneWeek, "oneWeek", "percent"));
      tr.append(valueCell(row.oneDay, "oneDay", "percent"));
      tr.append(valueCell(row.marketCap, "marketCap", "marketCap"));
      tr.append(valueCell(row.pe, "pe", "ratio"));
      tr.append(valueCell(row.pb, "pb", "ratio"));
      body.append(tr);
    }
  }
  $("stock-count").textContent = total.toLocaleString("en-IN") + " stocks";
  $("page-info").textContent = total ? "Showing " + (start + 1).toLocaleString("en-IN") + "–" + Math.min(start + shown.length, total).toLocaleString("en-IN") + " of " + total.toLocaleString("en-IN") : "0 stocks";
  $("page-number").textContent = state.page + " / " + pages;
  $("prev-page").disabled = state.page <= 1;
  $("next-page").disabled = state.page >= pages;
  renderHeaderSort();
}
function renderCache(cache) {
  if (!cache || !Array.isArray(cache.rows)) return;
  state.cache = cache;
  state.rows = cache.rows;
  state.page = 1;
  $("price-asof").textContent = "Price data: " + (cache.priceAsOf || "—");
  $("valuation-asof").textContent = "Valuation data: " + (cache.valuationAsOf || "—");
  renderTable();
  setStatus("Cached data available");
}
function showError(message) {
  $("key-error").textContent = message;
  $("key-error").classList.remove("hidden");
}
function updateProgress(p) {
  $("progress-area").classList.remove("hidden");
  $("progress-message").textContent = p.message || "Updating screener…";
  if (p.current && p.total) {
    const pct = Math.max(2, Math.min(100, p.current / p.total * 100));
    $("progress-fill").style.width = pct + "%";
    $("progress-count").textContent = p.current + " / " + p.total;
  } else {
    $("progress-fill").style.width = "6%";
    $("progress-count").textContent = "";
  }
  setStatus(p.message || "Updating");
}
function setProgressDone() {
  $("progress-area").classList.add("hidden");
  $("progress-fill").style.width = "0";
}
async function sync() {
  if (state.syncing) return;
  state.syncing = true;
  $("refresh").disabled = true;
  $("save-key").disabled = true;
  $("key-error").classList.add("hidden");
  $("progress-area").classList.remove("hidden");
  $("progress-message").textContent = "Starting daily update…";
  $("progress-fill").style.width = "3%";
  try {
    const cache = await window.screener.sync();
    renderCache(cache);
    setStatus(cache.rows.length.toLocaleString("en-IN") + " stocks updated");
    $("key-setup").classList.add("hidden");
  } catch (error) {
    setStatus("Update failed", true);
    showError(error.message || "Unable to update the screener.");
    if (!state.rows.length) {
      const body = $("table-body");
      body.replaceChildren();
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 12;
      td.className = "empty-state error-state";
      td.textContent = error.message || "Screener data could not be loaded.";
      tr.append(td);
      body.append(tr);
    }
  } finally {
    setProgressDone();
    state.syncing = false;
    $("refresh").disabled = false;
    $("save-key").disabled = false;
  }
}
function events() {
  $("search").addEventListener("input", () => { state.page = 1; renderTable(); });
  $("refresh").addEventListener("click", sync);
  $("save-key").addEventListener("click", async () => {
    const key = $("api-key").value.trim();
    try {
      await window.screener.setKey(key);
      $("api-key").value = "";
      await sync();
    } catch (error) {
      showError(error.message || "Unable to save the API key.");
    }
  });
  $("api-key").addEventListener("keydown", event => {
    if (event.key === "Enter") $("save-key").click();
  });
  $("get-key").addEventListener("click", event => {
    event.preventDefault();
    window.screener.openUrl("https://bharatstockapi.com/");
  });
  $("prev-page").addEventListener("click", () => { state.page = Math.max(1, state.page - 1); renderTable(); });
  $("next-page").addEventListener("click", () => { state.page += 1; renderTable(); });
  document.querySelectorAll("th[data-sort]").forEach(th => {
    th.querySelector("button").addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDirection = state.sortDirection === "desc" ? "asc" : "desc";
      else { state.sortKey = key; state.sortDirection = "desc"; }
      state.page = 1;
      renderTable();
    });
  });
  document.addEventListener("keydown", event => {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      $("search").focus();
    }
  });
}
async function boot() {
  events();
  window.screener.onProgress(updateProgress);
  try {
    const [cache, hasKey] = await Promise.all([window.screener.getCache(), window.screener.hasKey()]);
    if (cache) renderCache(cache);
    if (!hasKey) {
      $("key-setup").classList.remove("hidden");
      if (cache) setStatus("Showing saved data · add a key to refresh");
    } else {
      const age = cache?.lastSyncedAt ? Date.now() - new Date(cache.lastSyncedAt).getTime() : Infinity;
      if (!cache || age > 26 * 60 * 60 * 1000) await sync();
      else setStatus("Saved daily data · as of " + (cache.priceAsOf || "—"));
    }
  } catch (error) {
    setStatus("Unable to read local cache", true);
    showError(error.message || "Unable to initialize the screener.");
  }
}
boot();
