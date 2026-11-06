function normalize(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/,/g, "").replace(/₹/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(input).replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' && quoted && source[i + 1] === '"') {
      field += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some(value => String(value).trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some(value => String(value).trim() !== "")) rows.push(row);
  return rows;
}

function findColumn(header, names) {
  const normalized = header.map(normalize);
  for (const name of names) {
    const index = normalized.indexOf(normalize(name));
    if (index >= 0) return index;
  }
  return -1;
}

function equitySeriesRank(value) {
  return ({ EQ: 5, A: 4, BE: 3, B: 2, BZ: 1, T: 1 })[String(value ?? "").trim().toUpperCase()] || 0;
}

export function parseMarketCapCsv(input) {
  const rows = parseCsv(input);
  const marketCaps = new Map();

  for (let headerRow = 0; headerRow < Math.min(rows.length, 12); headerRow += 1) {
    const header = rows[headerRow];
    const symbolIndex = findColumn(header, ["SYMBOL"]);
    const capIndex = findColumn(header, ["MARKET CAP(RS.)", "MARKETCAPRS", "MARKET CAP", "MARKETCAP"]);
    if (symbolIndex < 0 || capIndex < 0) continue;

    const seriesIndex = findColumn(header, ["SERIES"]);
    const categoryIndex = findColumn(header, ["CATEGORY"]);
    const ranked = new Map();

    for (const cells of rows.slice(headerRow + 1)) {
      const symbol = String(cells[symbolIndex] ?? "").trim().toUpperCase();
      if (!symbol) continue;

      const category = categoryIndex >= 0 ? normalize(cells[categoryIndex]) : "LISTED";
      if (category && category !== "LISTED") continue;

      const cap = numberOrNull(cells[capIndex]);
      if (cap === null || cap <= 0) continue;

      const series = seriesIndex >= 0 ? String(cells[seriesIndex] ?? "").trim().toUpperCase() : "";
      const previous = ranked.get(symbol);
      if (!previous || equitySeriesRank(series) > previous.rank) {
        ranked.set(symbol, { cap, rank: equitySeriesRank(series) });
      }
    }

    for (const [symbol, value] of ranked) marketCaps.set(symbol, value.cap);
    return marketCaps;
  }

  return marketCaps;
}

export function parsePeCsv(input) {
  const rows = parseCsv(input);
  const priceEarnings = new Map();

  for (let headerRow = 0; headerRow < Math.min(rows.length, 12); headerRow += 1) {
    const header = rows[headerRow];
    const symbolIndex = findColumn(header, ["SYMBOL"]);
    const peIndex = findColumn(header, ["SYMBOL P/E", "SYMBOLPE", "P/E"]);
    if (symbolIndex < 0 || peIndex < 0) continue;

    for (const cells of rows.slice(headerRow + 1)) {
      const symbol = String(cells[symbolIndex] ?? "").trim().toUpperCase();
      if (!symbol) continue;
      const pe = numberOrNull(cells[peIndex]);
      if (pe !== null && pe > 0) priceEarnings.set(symbol, pe);
    }
    return priceEarnings;
  }

  return priceEarnings;
}

export function nseDateParts(date) {
  const parsed = new Date(date + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid NSE report date: " + date);
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(parsed.getUTCFullYear());
  return {
    ddmmyy: dd + mm + yyyy.slice(-2),
    ddmmyyyy: dd + mm + yyyy,
    year: yyyy,
    month: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][parsed.getUTCMonth()]
  };
}
