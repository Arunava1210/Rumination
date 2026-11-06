import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries,
  HistogramSeries, CrosshairMode, LineStyle
} from "lightweight-charts";
import "./style.css";

const $ = id => document.getElementById(id);
const priceFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const volumeFmt = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 2 });
const state = {
  exchange: "NSE", symbol: "RELIANCE", name: "Reliance Industries", yahooTicker: "RELIANCE.NS",
  kind: "EQUITY", interval: "1D", range: "1Y", chartType: "candles", symbols: [], bars: [],
  chart: null, priceSeries: null, volumeSeries: null, drawing: false, priceLines: [], requestId: 0
};
const labels = {"1m":"1 minute","5m":"5 minutes","15m":"15 minutes","30m":"30 minutes","1h":"1 hour","1D":"1 day","1W":"1 week","1M":"1 month"};
const price = value => Number.isFinite(Number(value)) ? `₹${priceFmt.format(Number(value))}` : "—";

function status(text, ok = true) {
  $("connection-status").textContent = text;
  $("connection-status").parentElement.querySelector(".live-dot").classList.toggle("offline", !ok);
}
function overlay(message, error = false) {
  const node = $("chart-state");
  node.textContent = message;
  node.classList.remove("hidden");
  node.classList.toggle("error", error);
}
function clearOverlay() { $("chart-state").classList.add("hidden"); $("chart-state").classList.remove("error"); }
function activeButtons() {
  document.querySelectorAll("[data-interval]").forEach(b => b.classList.toggle("active", b.dataset.interval === state.interval));
  document.querySelectorAll("[data-range]").forEach(b => b.classList.toggle("active", b.dataset.range === state.range));
  document.querySelectorAll(".exchange-btn").forEach(b => b.classList.toggle("active", b.dataset.exchange === state.exchange));
}
function instrument() {
  $("instrument-name").textContent = state.name;
  $("instrument-symbol").textContent = state.symbol;
  $("instrument-exchange").textContent = state.exchange;
  $("instrument-market").textContent = state.kind === "INDEX" ? "Index" : "Equity";
  $("ticker-avatar").textContent = state.symbol.replace(/[^a-z]/gi, "").slice(0, 1) || "₹";
  $("chart-symbol").textContent = `${state.exchange}:${state.symbol}`;
  $("chart-interval-label").textContent = `· ${labels[state.interval]}`;
}
function setQuote(bars) {
  if (!bars.length) return;
  const last = bars[bars.length - 1], first = bars[0];
  const change = last.close - first.close, pct = first.close ? change / first.close * 100 : 0;
  $("quote-price").textContent = price(last.close);
  $("quote-change").textContent = `${change >= 0 ? "+" : ""}${priceFmt.format(change)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%) · visible range`;
  $("quote-change").className = `quote-change ${change > 0 ? "positive" : change < 0 ? "negative" : "neutral"}`;
  $("meta-open").textContent = priceFmt.format(last.open);
  $("meta-high").textContent = priceFmt.format(last.high);
  $("meta-low").textContent = priceFmt.format(last.low);
  $("meta-volume").textContent = volumeFmt.format(last.volume || 0);
  $("ohlc-line").textContent = `O ${priceFmt.format(last.open)}   H ${priceFmt.format(last.high)}   L ${priceFmt.format(last.low)}   C ${priceFmt.format(last.close)}`;
}
function chartRows() {
  if (state.chartType === "line" || state.chartType === "area") return state.bars.map(x => ({ time: x.time, value: x.close }));
  return state.bars.map(x => ({ time: x.time, open: x.open, high: x.high, low: x.low, close: x.close }));
}
function makePriceSeries() {
  if (state.priceSeries) state.chart.removeSeries(state.priceSeries);
  const colors = { upColor: "#16b887", downColor: "#ef5b6b", borderUpColor: "#16b887", borderDownColor: "#ef5b6b", wickUpColor: "#16b887", wickDownColor: "#ef5b6b" };
  if (state.chartType === "bar") state.priceSeries = state.chart.addSeries(BarSeries, colors);
  else if (state.chartType === "line") state.priceSeries = state.chart.addSeries(LineSeries, { color: "#4b9cff", lineWidth: 2 });
  else if (state.chartType === "area") state.priceSeries = state.chart.addSeries(AreaSeries, { lineColor: "#4b9cff", topColor: "rgba(75,156,255,.28)", bottomColor: "rgba(75,156,255,.015)", lineWidth: 2 });
  else state.priceSeries = state.chart.addSeries(CandlestickSeries, colors);
  state.priceSeries.setData(chartRows());
  state.priceLines = [];
}
function initChart() {
  state.chart = createChart($("chart"), {
    autoSize: true,
    layout: { background: { type: "solid", color: "#0d1219" }, textColor: "#8d9aaa", fontFamily: "Inter, system-ui, sans-serif", fontSize: 12, attributionLogo: true },
    grid: { vertLines: { color: "rgba(140,155,174,.075)" }, horzLines: { color: "rgba(140,155,174,.075)" } },
    crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(151,173,198,.55)", labelBackgroundColor: "#26384e" }, horzLine: { color: "rgba(151,173,198,.55)", labelBackgroundColor: "#26384e" } },
    rightPriceScale: { borderColor: "rgba(140,155,174,.16)", scaleMargins: { top: .08, bottom: .22 } },
    timeScale: { borderColor: "rgba(140,155,174,.16)", timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 8, minBarSpacing: 2 },
    localization: { locale: "en-IN", priceFormatter: p => priceFmt.format(p) },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true }
  });
  state.volumeSeries = state.chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", priceLineVisible: false, lastValueVisible: false, base: 0 });
  state.chart.priceScale("volume").applyOptions({ scaleMargins: { top: .82, bottom: .02 }, visible: false });
  makePriceSeries();
  state.chart.subscribeClick(param => {
    if (!state.drawing || !param.point || !state.priceSeries) return;
    const value = state.priceSeries.coordinateToPrice(param.point.y);
    if (!Number.isFinite(value)) return;
    state.priceLines.push(state.priceSeries.createPriceLine({ price: value, color: "#f3b64b", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Price" }));
    state.drawing = false;
    $("draw-line").classList.remove("active");
    $("draw-line").textContent = "＋ Price line";
    $("chart").style.cursor = "";
  });
}
function displayBars(bars) {
  state.bars = bars;
  makePriceSeries();
  state.volumeSeries.setData(bars.map(x => ({ time: x.time, value: x.volume || 0, color: x.close >= x.open ? "rgba(22,184,135,.42)" : "rgba(239,91,107,.42)" })));
  state.chart.timeScale().fitContent();
  setQuote(bars);
}
function matches(query) {
  const term = query.trim().toLowerCase();
  const available = state.symbols.filter(x => x.exchange === state.exchange);
  if (!term) return available.slice(0, 14);
  return available.filter(x => x.symbol.toLowerCase().includes(term) || x.name.toLowerCase().includes(term)).slice(0, 30);
}
function hideResults() { $("symbol-results").classList.add("hidden"); }
function showResults(query) {
  const panel = $("symbol-results");
  panel.innerHTML = "";
  const list = matches(query);
  if (!list.length) panel.innerHTML = `<div class="no-results">No matches in ${state.exchange}</div>`;
  for (const item of list) {
    const button = document.createElement("button"); button.className = "symbol-result";
    const left = document.createElement("span"); left.className = "result-main";
    const ticker = document.createElement("b"); ticker.textContent = item.symbol;
    const name = document.createElement("small"); name.textContent = item.name;
    left.append(ticker, name);
    const exchange = document.createElement("span"); exchange.className = "result-exchange"; exchange.textContent = item.kind === "INDEX" ? "INDEX" : item.exchange;
    button.append(left, exchange); button.addEventListener("click", () => selectSymbol(item)); panel.append(button);
  }
  panel.classList.remove("hidden");
}
async function selectSymbol(item) {
  state.exchange = item.exchange; state.symbol = item.symbol; state.name = item.name; state.yahooTicker = item.yahooTicker || ""; state.kind = item.kind || "EQUITY";
  $("symbol-search").value = ""; hideResults(); instrument(); activeButtons(); await loadChart();
}
async function loadChart() {
  const requestId = ++state.requestId;
  overlay("Loading market data…"); status("Fetching data"); $("data-provider").textContent = "Loading market data";
  try {
    const result = await window.bharat.getCandles({ exchange: state.exchange, symbol: state.symbol, yahooTicker: state.yahooTicker, interval: state.interval, range: state.range });
    if (requestId !== state.requestId) return;
    const bars = result.candles || [];
    if (!bars.length) throw new Error("The provider returned an empty series.");
    displayBars(bars); $("data-provider").textContent = result.source || "Market data"; $("data-note").textContent = result.note || "Market data can be delayed; check the displayed bar time.";
    clearOverlay(); status(`${bars.length.toLocaleString("en-IN")} bars loaded`);
  } catch (error) {
    if (requestId !== state.requestId) return;
    overlay(`${error.message}\n\nTry a different interval or symbol.`, true);
    $("data-provider").textContent = "Data unavailable"; $("data-note").textContent = "Daily history: TejHQ · Intraday: Yahoo Finance. Coverage varies by ticker.";
    $("quote-price").textContent = "—"; $("quote-change").textContent = "No data returned";
    for (const id of ["meta-open","meta-high","meta-low","meta-volume"]) $(id).textContent = "—";
    status("Data unavailable", false);
  }
}
async function initializeSymbols() {
  try {
    state.symbols = await window.bharat.getSymbols();
    if (!Array.isArray(state.symbols)) state.symbols = [];
    if (!state.symbols.some(x => x.exchange === "NSE" && x.symbol === "RELIANCE")) state.symbols.unshift({ exchange: "NSE", symbol: "RELIANCE", name: "Reliance Industries", yahooTicker: "RELIANCE.NS", kind: "EQUITY" });
    status(`${state.symbols.length.toLocaleString("en-IN")} instruments indexed`);
  } catch { state.symbols = []; status("Limited symbol directory", false); }
}
function events() {
  $("symbol-search").addEventListener("focus", () => showResults($("symbol-search").value));
  $("symbol-search").addEventListener("input", e => showResults(e.target.value));
  $("symbol-search").addEventListener("keydown", e => { if (e.key === "Escape") hideResults(); if (e.key === "Enter") { const item = matches(e.target.value)[0]; if (item) selectSymbol(item); } });
  document.addEventListener("click", e => { if (!e.target.closest(".search-area")) hideResults(); });
  document.querySelectorAll(".exchange-btn").forEach(b => b.addEventListener("click", () => { state.exchange = b.dataset.exchange; activeButtons(); showResults($("symbol-search").value); }));
  document.querySelectorAll("[data-interval]").forEach(b => b.addEventListener("click", () => { state.interval = b.dataset.interval; activeButtons(); $("chart-interval-label").textContent = `· ${labels[state.interval]}`; loadChart(); }));
  document.querySelectorAll("[data-range]").forEach(b => b.addEventListener("click", () => { state.range = b.dataset.range; activeButtons(); loadChart(); }));
  $("chart-type").addEventListener("change", e => { state.chartType = e.target.value; if (state.bars.length) { makePriceSeries(); state.chart.timeScale().fitContent(); } });
  $("fit-chart").addEventListener("click", () => state.chart.timeScale().fitContent());
  $("draw-line").addEventListener("click", () => { state.drawing = !state.drawing; $("draw-line").classList.toggle("active", state.drawing); $("draw-line").textContent = state.drawing ? "Click chart…" : "＋ Price line"; $("chart").style.cursor = state.drawing ? "crosshair" : ""; });
  $("clear-lines").addEventListener("click", () => { if (state.priceSeries) state.priceLines.forEach(line => state.priceSeries.removePriceLine(line)); state.priceLines = []; });
  $("refresh").addEventListener("click", async () => { $("refresh").classList.add("spinning"); try { state.symbols = await window.bharat.getSymbols(true); status(`${state.symbols.length.toLocaleString("en-IN")} instruments refreshed`); await loadChart(); } catch { status("Refresh failed", false); } finally { $("refresh").classList.remove("spinning"); } });
  document.addEventListener("keydown", e => { if (e.key === "/" && !["INPUT","TEXTAREA"].includes(document.activeElement.tagName)) { e.preventDefault(); $("symbol-search").focus(); } });
}

async function boot() {
  initChart(); events(); instrument(); activeButtons(); await initializeSymbols();
  const def = state.symbols.find(x => x.exchange === "NSE" && x.symbol === "RELIANCE");
  if (def) { state.name = def.name; state.yahooTicker = def.yahooTicker || "RELIANCE.NS"; }
  instrument(); await loadChart();
}
boot();
