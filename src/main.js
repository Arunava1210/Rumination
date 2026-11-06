import { filterRows, sortRows, formatPercent, formatMarketCap, formatPe, SORTABLE_COLUMNS } from "./screener.js";
import "./style.css";

const $ = id => document.getElementById(id);
const state = {
  rows: [],
  sortKey: "marketCap",
  sortDirection: "desc",
  query: "",
  loading: false,
  allTimeReady: false,
  dataDate: null,
  reportDate: null
};

function status(text, kind = "ready") {
  $("data-status").textContent = text;
  $("status-dot").className = "status-dot " + kind;
}

function formatDate(value) {
  if (!value) return "date unavailable";
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function visibleRows() {
  return sortRows(filterRows(state.rows, state.query), state.sortKey, state.sortDirection);
}

function updateSortHeaders() {
  document.querySelectorAll("th button[data-sort]").forEach(button => {
    const active = button.dataset.sort === state.sortKey;
    button.classList.toggle("sorted", active);
    const indicator = button.querySelector(".sort-indicator");
    indicator.textContent = active ? (state.sortDirection === "asc" ? "↑" : "↓") : "";
    button.setAttribute("aria-sort", active ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none");
  });
}

function percentCell(value) {
  const td = document.createElement("td");
  td.className = "numeric percent-cell";
  td.textContent = formatPercent(value);
  if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
    td.classList.add(Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : "neutral");
  }
  return td;
}

function render() {
  const rows = visibleRows();
  const body = $("table-body");
  const fragment = document.createDocumentFragment();

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.className = "empty-state";
    td.textContent = state.rows.length ? "No stocks match your search." : "No market data is currently available. Check your connection and refresh.";
    tr.append(td);
    fragment.append(tr);
  } else {
    for (const row of rows) {
      const tr = document.createElement("tr");

      const stock = document.createElement("td");
      stock.className = "stock-column";
      const stockWrap = document.createElement("div");
      stockWrap.className = "stock-cell";
      const identity = document.createElement("div");
      identity.className = "stock-identity";
      const symbol = document.createElement("strong");
      symbol.textContent = row.symbol || "—";
      const name = document.createElement("span");
      name.textContent = row.name && row.name !== row.symbol ? row.name : "";
      const exchange = document.createElement("small");
      exchange.textContent = row.exchange || "—";
      identity.append(symbol, name);
      stockWrap.append(identity, exchange);
      stock.append(stockWrap);
      tr.append(stock);

      if (row.allTime === null && !state.allTimeReady) {
        const td = document.createElement("td");
        td.className = "numeric loading-cell";
        td.textContent = "…";
        td.title = "All-time baseline is still being prepared.";
        tr.append(td);
      } else {
        tr.append(percentCell(row.allTime));
      }

      tr.append(
        percentCell(row.oneYear),
        percentCell(row.ytd),
        percentCell(row.sixMonth),
        percentCell(row.threeMonth),
        percentCell(row.oneMonth),
        percentCell(row.oneWeek),
        percentCell(row.oneDay)
      );

      const cap = document.createElement("td");
      cap.className = "numeric valuation-cell";
      cap.textContent = formatMarketCap(row.marketCap);
      tr.append(cap);

      const pe = document.createElement("td");
      pe.className = "numeric valuation-cell";
      pe.textContent = formatPe(row.pe);
      if (row.pe !== null && row.pe !== undefined && Number(row.pe) <= 0) pe.title = "Negative or zero earnings: P/E is not meaningful.";
      tr.append(pe);

      fragment.append(tr);
    }
  }

  body.replaceChildren(fragment);
  $("result-count").textContent = rows.length.toLocaleString("en-IN") + " of " + state.rows.length.toLocaleString("en-IN") + " stocks";
  updateSortHeaders();
}

function setData(data) {
  if (!data || !Array.isArray(data.rows)) throw new Error("The data source returned an invalid screener response.");
  state.rows = data.rows;
  state.dataDate = data.dataDate || null;
  state.reportDate = data.reportDate || null;
  state.allTimeReady = Boolean(data.allTimeReady);
  const dateText = state.dataDate ? "EOD · " + formatDate(state.dataDate) : "EOD data";
  status(dateText, "ready");
  render();
}

function showHistoryProgress(progress) {
  $("history-progress").classList.remove("hidden");
  const current = Number(progress.current || 0);
  const total = Math.max(1, Number(progress.total || 1));
  const percent = Math.max(0, Math.min(100, Math.round(current / total * 100)));
  $("history-message").textContent = progress.message || ("Building all-time price baseline · " + current + "/" + total);
  $("history-percent").textContent = percent + "%";
  $("history-progress-bar").style.width = percent + "%";
  status("Preparing all-time returns", "working");
}

function showAllTimeReady(data) {
  state.rows = data.rows;
  state.allTimeReady = true;
  state.dataDate = data.dataDate || state.dataDate;
  state.reportDate = data.reportDate || state.reportDate;
  $("history-progress").classList.add("hidden");
  status(state.dataDate ? "EOD · " + formatDate(state.dataDate) : "EOD data", "ready");
  render();
}

async function loadData(force = false) {
  if (state.loading) return;
  state.loading = true;
  $("refresh").disabled = true;
  $("refresh").classList.add("spinning");
  status(force ? "Refreshing market data…" : "Loading market data…", "working");

  try {
    const data = force ? await window.screener.refresh() : await window.screener.load();
    setData(data);
    if (!data.allTimeReady) {
      $("history-progress").classList.remove("hidden");
      $("history-message").textContent = "Preparing all-time price history in the background…";
    } else {
      $("history-progress").classList.add("hidden");
    }
    if (data.note) status(data.note, "warning");
  } catch (error) {
    status(error.message || "Unable to load market data", "error");
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.className = "empty-state";
    td.textContent = error.message || "Market data unavailable.";
    tr.append(td);
    $("table-body").replaceChildren(tr);
    $("result-count").textContent = "No data";
  } finally {
    state.loading = false;
    $("refresh").disabled = false;
    $("refresh").classList.remove("spinning");
  }
}

function wireEvents() {
  $("search").addEventListener("input", event => {
    state.query = event.target.value;
    render();
  });

  $("refresh").addEventListener("click", () => loadData(true));

  document.querySelectorAll("th button[data-sort]").forEach(button => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (!SORTABLE_COLUMNS.includes(key)) return;
      if (state.sortKey === key) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDirection = key === "symbol" ? "asc" : "desc";
      }
      render();
    });
  });

  window.screener.onProgress(showHistoryProgress);
  window.screener.onHistoryReady(showAllTimeReady);
  window.screener.onHistoryError(message => {
    $("history-progress").classList.add("hidden");
    status(message || "All-time history unavailable", "warning");
    state.allTimeReady = true;
    render();
  });
}

wireEvents();
loadData();
