export const normalizeMarketValue = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function cleanMarketPrices(values) {
  const sorted = values.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (sorted.length < 4) return sorted;
  const lower = sorted.slice(0, Math.floor(sorted.length / 2));
  const upper = sorted.slice(Math.ceil(sorted.length / 2));
  const q1 = median(lower), q3 = median(upper), iqr = q3 - q1;
  return sorted.filter((n) => n >= q1 - 1.5 * iqr && n <= q3 + 1.5 * iqr);
}

export function sourceCategory(source) {
  const value = normalizeMarketValue(source);
  if (["tradera", "blocket"].includes(value)) return "used_marketplace";
  if (["swappie", "back market"].includes(value)) return "refurbished_retail";
  return "other";
}
