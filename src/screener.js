export const SORTABLE_COLUMNS = [
  "symbol", "allTime", "oneYear", "ytd", "sixMonth", "threeMonth",
  "oneMonth", "oneWeek", "oneDay", "marketCap", "pe"
];

export function sortRows(rows, key, direction = "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];

    if (key === "symbol") {
      return String(av ?? "").localeCompare(String(bv ?? ""), "en", { sensitivity: "base" }) * multiplier;
    }

    const aMissing = av === null || av === undefined || !Number.isFinite(Number(av));
    const bMissing = bv === null || bv === undefined || !Number.isFinite(Number(bv));
    if (aMissing && bMissing) return String(a.symbol).localeCompare(String(b.symbol));
    if (aMissing) return 1;
    if (bMissing) return -1;

    const diff = Number(av) - Number(bv);
    if (diff === 0) return String(a.symbol).localeCompare(String(b.symbol));
    return diff * multiplier;
  });
}

export function filterRows(rows, query) {
  const term = String(query ?? "").trim().toLocaleLowerCase();
  if (!term) return rows;
  return rows.filter(row =>
    String(row.symbol ?? "").toLocaleLowerCase().includes(term) ||
    String(row.name ?? "").toLocaleLowerCase().includes(term)
  );
}

export function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(2) + "%";
}

export function formatMarketCap(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const crore = Number(value) / 1e7;
  if (crore >= 100000) return "₹" + (crore / 100000).toFixed(2) + "L Cr";
  return "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(crore) + " Cr";
}

export function formatPe(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) <= 0) return "—";
  return Number(value).toFixed(1) + "x";
}
