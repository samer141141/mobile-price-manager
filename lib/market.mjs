export const normalizeMarketValue = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function cleanMarketPrices(values) {
  const sorted = values
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (sorted.length < 4) return sorted;

  const percentile = (p) => {
    const index = (sorted.length - 1) * p;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    if (low === high) return sorted[low];
    const weight = index - low;
    return sorted[low] * (1 - weight) + sorted[high] * weight;
  };

  const q1 = percentile(0.25);
  const q3 = percentile(0.75);
  const iqr = q3 - q1;
  if (!Number.isFinite(iqr) || iqr <= 0) return sorted;
  return sorted.filter((n) => n >= q1 - 1.5 * iqr && n <= q3 + 1.5 * iqr);
}

export function sourceCategory(source) {
  const value = normalizeMarketValue(source);
  if (["tradera", "blocket"].includes(value)) return "used_marketplace";
  if (["swappie", "back market"].includes(value)) return "refurbished_retail";
  return "other";
}
