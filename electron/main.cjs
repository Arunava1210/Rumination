const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

const TEJ = "https://api.tejhq.dev/v1";
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
let windowRef;
let symbolCache = [];
let lastSymbolRefresh = 0;
let refreshPromise;

const FALLBACK = [
  ["NSE","RELIANCE","Reliance Industries"],["NSE","HDFCBANK","HDFC Bank"],["NSE","ICICIBANK","ICICI Bank"],
  ["NSE","INFY","Infosys"],["NSE","TCS","Tata Consultancy Services"],["NSE","SBIN","State Bank of India"],
  ["NSE","BHARTIARTL","Bharti Airtel"],["NSE","ITC","ITC"],["NSE","LT","Larsen & Toubro"],
  ["NSE","KOTAKBANK","Kotak Mahindra Bank"],["NSE","AXISBANK","Axis Bank"],["NSE","BAJFINANCE","Bajaj Finance"],
  ["NSE","HINDUNILVR","Hindustan Unilever"],["NSE","MARUTI","Maruti Suzuki"],["NSE","TITAN","Titan Company"],
  ["NSE","SUNPHARMA","Sun Pharma"],["NSE","NTPC","NTPC"],["NSE","ONGC","ONGC"],
  ["NSE","POWERGRID","Power Grid"],["NSE","TATASTEEL","Tata Steel"],["NSE","JSWSTEEL","JSW Steel"],
  ["NSE","HCLTECH","HCL Technologies"],["NSE","WIPRO","Wipro"],["NSE","TECHM","Tech Mahindra"],
  ["NSE","ADANIENT","Adani Enterprises"],["NSE","ADANIPORTS","Adani Ports"],["NSE","COALINDIA","Coal India"],
  ["NSE","ASIANPAINT","Asian Paints"],["NSE","ULTRACEMCO","UltraTech Cement"],["NSE","NESTLEIND","Nestle India"],
  ["NSE","DIVISLAB","Divi's Laboratories"],["NSE","DRREDDY","Dr. Reddy's Laboratories"],["NSE","CIPLA","Cipla"],
  ["NSE","EICHERMOT","Eicher Motors"],["NSE","HEROMOTOCO","Hero MotoCorp"],["NSE","BAJAJ-AUTO","Bajaj Auto"],
  ["NSE","M&M","Mahindra & Mahindra"],["NSE","NIFTY 50","NIFTY 50"],["BSE","SENSEX","S&P BSE SENSEX"]
].map(([exchange,symbol,name]) => ({
  exchange,symbol,name,kind:symbol === "NIFTY 50" || symbol === "SENSEX" ? "INDEX" : "EQUITY",
  yahooTicker:symbol === "NIFTY 50" ? "^NSEI" : symbol === "SENSEX" ? "^BSESN" : `${symbol}.${exchange === "NSE" ? "NS" : "BO"}`
}));

async function getJson(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json,text/csv,*/*", ...extraHeaders },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${new URL(url).hostname}`);
  return response.json();
}
function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  for (const k of ["data","rows","results","items"]) {
    if (Array.isArray(payload?.[k])) return payload[k];
    if (payload?.[k] && typeof payload[k] === "object") {
      for (const n of ["data","rows","items"]) if (Array.isArray(payload[k][n])) return payload[k][n];
    }
  }
  return [];
}
function textOf(...values) {
  return values.find(v => v !== undefined && v !== null && String(v).trim())?.toString().trim() || "";
}
function latestDate(status) {
  const values = [status?.trading_date,status?.latest_date,status?.date,status?.data?.trading_date,status?.data?.latest_date];
  return values.find(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v))?.slice(0,10);
}
function parseCsvLine(line) {
  const out=[]; let value=""; let quoted=false;
  for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'&&quoted&&line[i+1]==='"'){value+='"';i++;}else if(ch==='"'){quoted=!quoted;}else if(ch===","&&!quoted){out.push(value);value="";}else value+=ch;}
  out.push(value); return out;
}
async function nseCsvFallback() {
  for (const url of ["https://archives.nseindia.com/content/equities/EQUITY_L.csv","https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"]) {
    try {
      const response=await fetch(url,{headers:{"User-Agent":UA,"Accept":"text/csv,*/*","Referer":"https://www.nseindia.com/"},signal:AbortSignal.timeout(12000)});
      if(!response.ok) continue;
      const lines=(await response.text()).split(/\r?\n/).filter(Boolean); if(lines.length<2) continue;
      const headers=parseCsvLine(lines[0]).map(x=>x.trim().toUpperCase());
      const si=headers.indexOf("SYMBOL"), ni=headers.indexOf("NAME OF COMPANY"), qi=headers.indexOf("SERIES");
      if(si<0) continue;
      return lines.slice(1).map(line=>{const cells=parseCsvLine(line);const symbol=(cells[si]||"").trim();const series=qi<0?"EQ":(cells[qi]||"").trim();if(!symbol||!["EQ","BE","BZ"].includes(series))return null;return{exchange:"NSE",symbol,name:(cells[ni]||symbol).trim(),kind:"EQUITY",yahooTicker:`${symbol}.NS`};}).filter(Boolean);
    } catch {}
  }
  return [];
}
async function snapshot(exchange,date) {
  const payload=await getJson(`${TEJ}/snapshot/${exchange}/${date}`);
  return rowsOf(payload).map(row=>{
    const symbol=textOf(row.symbol,row.ticker,row.security_id,row.scrip_code,row.code);
    if(!symbol)return null;
    const name=textOf(row.company_name,row.name,row.scrip_name,row.security_name,row.company,symbol);
    const yahoo=textOf(row.yahoo_ticker,row.yahoo_symbol,row.yahoo);
    return {exchange:exchange.toUpperCase(),symbol,name,kind:"EQUITY",yahooTicker:yahoo||(exchange==="nse"?`${symbol}.NS`:/^\d+$/.test(symbol)?`${symbol}.BO`:"")};
  }).filter(Boolean);
}
async function readCache() {
  try {const raw=await fs.readFile(path.join(app.getPath("userData"),"symbols.json"),"utf8");const json=JSON.parse(raw);return Array.isArray(json.symbols)?json.symbols:[];} catch{return[];}
}
async function refreshSymbols() {
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{
    try {
      let date;
      try{date=latestDate(await getJson(`${TEJ}/status`));}catch{}
      date ||= new Date().toISOString().slice(0,10);
      const [nse,bse]=await Promise.allSettled([snapshot("nse",date),snapshot("bse",date)]);
      let all=[];
      if(nse.status==="fulfilled")all.push(...nse.value);
      if(bse.status==="fulfilled")all.push(...bse.value);
      if(nse.status!=="fulfilled"||!all.some(x=>x.exchange==="NSE"))all.push(...await nseCsvFallback());
      const unique=new Map();
      for(const item of [...all,...FALLBACK])unique.set(`${item.exchange}:${item.symbol}`.toUpperCase(),item);
      symbolCache=[...unique.values()].sort((a,b)=>a.exchange.localeCompare(b.exchange)||a.symbol.localeCompare(b.symbol));
      lastSymbolRefresh=Date.now();
      try{await fs.mkdir(app.getPath("userData"),{recursive:true});await fs.writeFile(path.join(app.getPath("userData"),"symbols.json"),JSON.stringify({savedAt:new Date().toISOString(),symbols:symbolCache}));}catch{}
      return symbolCache;
    }catch(error){console.error("Directory refresh failed",error);if(!symbolCache.length)symbolCache=await readCache();if(!symbolCache.length)symbolCache=FALLBACK;return symbolCache;}
    finally{refreshPromise=null;}
  })();
  return refreshPromise;
}
function daysFor(range){return({"1D":1,"5D":5,"1M":30,"3M":90,"6M":180,"1Y":365,"5Y":1825,"MAX":10000})[range]||365;}
function cleanDaily(rows){return rows.map(row=>{const time=textOf(row.date,row.time);const open=Number(row.open??row.Open),high=Number(row.high??row.High),low=Number(row.low??row.Low),close=Number(row.close??row.Close),volume=Number(row.volume??row.Volume??0);if(!time||![open,high,low,close].every(Number.isFinite))return null;return{time:time.slice(0,10),open,high,low,close,volume:Number.isFinite(volume)?volume:0};}).filter(Boolean).sort((a,b)=>a.time.localeCompare(b.time));}
function aggregate(rows,interval){if(interval==="1D")return rows;const groups=new Map();for(const bar of rows){const d=new Date(`${bar.time}T00:00:00Z`);let key;if(interval==="1W"){d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));key=d.toISOString().slice(0,10);}else key=bar.time.slice(0,7);const old=groups.get(key);if(!old)groups.set(key,{time:interval==="1W"?key:`${key}-01`,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume});else{old.high=Math.max(old.high,bar.high);old.low=Math.min(old.low,bar.low);old.close=bar.close;old.volume+=bar.volume;}}return[...groups.values()];}
async function tejDaily(exchange,symbol,range){const start=exchange==="BSE"?"2024-07-08":"2010-01-04";const days=daysFor(range);const date=new Date();date.setUTCDate(date.getUTCDate()-days-10);const from=range==="MAX"?start:days>=3650?start:date.toISOString().slice(0,10);const to=new Date().toISOString().slice(0,10);const body=await getJson(`${TEJ}/ohlcv/${exchange.toLowerCase()}/${encodeURIComponent(symbol)}?from=${from}&to=${to}`);const bars=cleanDaily(rowsOf(body));if(!bars.length)throw new Error(`No EOD history for ${exchange}:${symbol}`);return bars;}
async function yahooIntraday(ticker,interval,range){if(!ticker)throw new Error("No Yahoo Finance ticker is mapped for this listing.");const days=Math.min(daysFor(range),interval==="1m"?7:60);const end=Math.floor(Date.now()/1000),start=end-days*86400;const yahooInterval=interval==="1h"?"60m":interval;const url=`${YAHOO}/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=${yahooInterval}&includePrePost=false&events=div%2Csplits`;const body=await getJson(url);const result=body?.chart?.result?.[0];if(!result)throw new Error(body?.chart?.error?.description||`No intraday bars for ${ticker}`);const q=result.indicators?.quote?.[0]||{};const bars=(result.timestamp||[]).map((time,i)=>{const vals=[q.open?.[i],q.high?.[i],q.low?.[i],q.close?.[i]];if(!vals.every(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))))return null;return{time:Number(time),open:Number(vals[0]),high:Number(vals[1]),low:Number(vals[2]),close:Number(vals[3]),volume:Number(q.volume?.[i]||0)};}).filter(Boolean);if(!bars.length)throw new Error(`Yahoo Finance returned no ${interval} bars for ${ticker}`);return{candles:bars,source:"Yahoo Finance · intraday",note:"Intraday availability and delays depend on Yahoo Finance and the exchange."};}
async function getCandles(req){const exchange=String(req.exchange||"NSE").toUpperCase(),symbol=String(req.symbol||"").trim(),interval=String(req.interval||"1D"),range=String(req.range||"1Y").toUpperCase(),ticker=String(req.yahooTicker||"");if(!symbol)throw new Error("Choose a symbol first.");if(["1m","5m","15m","30m","1h"].includes(interval))return yahooIntraday(ticker,interval,range);try{const bars=await tejDaily(exchange,symbol,range);return{candles:aggregate(bars,interval),source:"TejHQ · exchange bhavcopy EOD",note:exchange==="BSE"?"BSE daily history in this feed starts 08 Jul 2024.":"NSE daily history in this feed starts 04 Jan 2010."};}catch(error){if(ticker){const fallback=await yahooIntraday(ticker,"1d",range);fallback.source="Yahoo Finance · daily fallback";fallback.note=`TejHQ unavailable: ${error.message}`;return fallback;}throw error;}}

ipcMain.handle("market:get-symbols",async(_event,{refresh=false}={})=>{if(symbolCache.length&&!refresh){if(Date.now()-lastSymbolRefresh>6*60*60*1000)refreshSymbols().catch(()=>{});return symbolCache;}if(!symbolCache.length)symbolCache=await readCache();if(symbolCache.length&&!refresh){refreshSymbols().catch(()=>{});return symbolCache;}return refreshSymbols();});
ipcMain.handle("market:get-candles",async(_event,req)=>getCandles(req));
function createWindow(){windowRef=new BrowserWindow({width:1440,height:920,minWidth:970,minHeight:640,backgroundColor:"#0b0f14",title:"BharatChart",autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});if(!app.isPackaged)windowRef.loadURL("http://127.0.0.1:5173");else windowRef.loadFile(path.join(__dirname,"..","dist","index.html"));windowRef.webContents.setWindowOpenHandler(()=>({action:"deny"}));windowRef.on("closed",()=>{windowRef=null;});}
app.whenReady().then(()=>{app.setAppUserModelId("in.bharatchart.desktop");createWindow();app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
