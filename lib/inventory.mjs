export const sensitive = [
  "purchase_price",
  "repair_cost",
  "other_cost",
  "profit",
];
export const columns = [
  ["model", "Model"],
  ["storage_gb", "Storage"],
  ["color", "Color"],
  ["battery_health", "Battery Health"],
  ["condition", "Condition"],
  ["imei", "IMEI"],
  ["status", "Status"],
  ["purchase_price", "Purchase Price"],
  ["repair_cost", "Repair Cost"],
  ["other_cost", "Other Cost"],
  ["selling_price", "Selling Price"],
  ["profit", "Profit"],
  ["purchase_source", "Purchase Source"],
  ["notes", "Notes"],
];
export const blank = {
  model: "",
  storage_gb: 128,
  color: "",
  battery_health: "",
  condition: "Good",
  imei: "",
  status: "In Stock",
  purchase_price: 0,
  repair_cost: 0,
  other_cost: 0,
  selling_price: 0,
  purchase_source: "",
  notes: "",
};
export const cost = (p) =>
  Number(p.purchase_price || 0) +
  Number(p.repair_cost || 0) +
  Number(p.other_cost || 0);
export const profit = (p) => Number(p.selling_price || 0) - cost(p);
export const isSold = (p) => String(p.status).trim().toLowerCase() === "sold";
export const matches = (p, q) =>
  q
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every((t) =>
      ["model", "imei", "storage_gb", "color", "condition", "status"]
        .map((k) => String(p[k] ?? ""))
        .join(" ")
        .toLowerCase()
        .includes(t),
    );
export const money = (n) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));
export function marketStats(records, phone, percentage, expenses = 0) {
  const norm = (v) =>
    String(v ?? "")
      .trim()
      .toLowerCase();
  const prices = records
    .filter(
      (r) =>
        norm(r.model) === norm(phone.model) &&
        Number(r.storage_gb) === Number(phone.storage_gb) &&
        norm(r.condition) === norm(phone.condition),
    )
    .map((r) => Number(r.market_price))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!prices.length) return null;
  const average = prices.reduce((a, b) => a + b, 0) / prices.length,
    buy = (average * percentage) / 100;
  return {
    count: prices.length,
    average,
    min: Math.min(...prices),
    max: Math.max(...prices),
    buy,
    expected: average - buy - Number(expenses || 0),
  };
}
export function payload(form, financial) {
  return Object.fromEntries(
    columns
      .filter(([k]) => k !== "profit" && (financial || !sensitive.includes(k)))
      .map(([k]) => [
        k,
        [
          "storage_gb",
          "battery_health",
          "purchase_price",
          "repair_cost",
          "other_cost",
          "selling_price",
        ].includes(k)
          ? k === "battery_health" && form[k] === ""
            ? null
            : Number(form[k] || 0)
          : String(form[k] ?? "").trim(),
      ]),
  );
}
export function editPayload(form, original, financial) {
  const values = payload(form, financial);
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key]) => String(form[key] ?? "") !== String(original[key] ?? ""),
    ),
  );
}
