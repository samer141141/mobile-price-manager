export function roundTo50(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n / 50) * 50);
}

export function daysBetween(start, end = new Date()) {
  if (!start) return null;
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
}

export function inventoryAgeDays(phone, now = new Date()) {
  return daysBetween(phone?.purchase_date || phone?.created_at, now);
}

export function inventoryAgeMeta(phone, now = new Date()) {
  const days = inventoryAgeDays(phone, now);
  if (days == null) {
    return { days: null, level: "unknown", label: "No date", action: "Add purchase date" };
  }
  if (days <= 14) {
    return { days, level: "fresh", label: "Fresh", action: "No action" };
  }
  if (days <= 30) {
    return { days, level: "watch", label: "Watch", action: "Watch demand" };
  }
  if (days <= 45) {
    return { days, level: "slow", label: "Slow", action: "Refresh ad / review price" };
  }
  return { days, level: "action", label: "Action", action: "Consider 3–7% price cut" };
}

export function marketRecommendations(summary) {
  const typical = Number(summary?.typical_price || 0);
  if (!typical) return null;
  const min = Number(summary?.min_price || typical);
  const max = Number(summary?.max_price || typical);
  const quick = roundTo50(Math.max(min, typical * 0.94));
  const recommended = roundTo50(typical);
  const maxProfit = roundTo50(Math.max(recommended, Math.min(max || typical * 1.06, typical * 1.06)));
  return { quick, recommended, maxProfit, typical, min, max };
}

export function smartBuyAnalysis({
  summary,
  askingPrice,
  expenses = 0,
  buyPercentage = 75,
  batteryHealth = 100,
}) {
  const recs = marketRecommendations(summary);
  if (!recs) return null;

  const ask = Number(askingPrice || 0);
  const extra = Number(expenses || 0);
  const safeBuy = Math.max(0, roundTo50((recs.typical * Number(buyPercentage || 0)) / 100 - extra));
  const totalCost = ask + extra;
  const expectedProfit = recs.recommended - totalCost;
  const marginPct = totalCost > 0 ? (expectedProfit / totalCost) * 100 : 0;

  let decision = "Enter a purchase price";
  let level = "neutral";
  if (ask > 0) {
    if (ask <= safeBuy && expectedProfit > 0) {
      decision = "Good deal";
      level = "good";
    } else if (expectedProfit > 0 && marginPct >= 8) {
      decision = "Tight margin";
      level = "tight";
    } else {
      decision = "Avoid";
      level = "avoid";
    }
  }

  const battery = Number(batteryHealth);
  const batteryNote =
    Number.isFinite(battery) && battery < 80
      ? "Battery below 80%: leave extra repair margin."
      : Number.isFinite(battery) && battery < 85
        ? "Battery is borderline: keep some repair buffer."
        : "";

  return {
    ...recs,
    safeBuy,
    askingPrice: ask,
    expenses: extra,
    totalCost,
    expectedProfit,
    marginPct,
    decision,
    level,
    batteryNote,
  };
}

export function businessInsights(phones = [], saleHistory = [], now = new Date()) {
  const businessPhones = phones.filter((p) => (p.inventory_scope || "business") === "business");
  const available = businessPhones.filter((p) => String(p.status || "").toLowerCase() !== "sold");
  const activeSales = saleHistory.filter((s) => !s.returned_at);
  const month = now.getMonth();
  const year = now.getFullYear();

  const monthlySales = activeSales.filter((s) => {
    const d = new Date(s.sold_at);
    return !Number.isNaN(d.getTime()) && d.getMonth() === month && d.getFullYear() === year;
  });

  const monthRevenue = monthlySales.reduce((n, s) => n + Number(s.selling_price || 0), 0);
  const monthProfit = monthlySales.reduce((n, s) => n + Number(s.realized_profit || 0), 0);
  const allProfit = activeSales.reduce((n, s) => n + Number(s.realized_profit || 0), 0);
  const avgProfit = activeSales.length ? allProfit / activeSales.length : 0;
  const capital = available.reduce(
    (n, p) =>
      n +
      Number(p.purchase_price || 0) +
      Number(p.repair_cost || 0) +
      Number(p.other_cost || 0),
    0,
  );

  const byId = new Map(businessPhones.map((p) => [String(p.id), p]));
  const daySamples = activeSales
    .map((s) => {
      const phone = byId.get(String(s.phone_id));
      return daysBetween(phone?.purchase_date || phone?.created_at, s.sold_at);
    })
    .filter((n) => Number.isFinite(n));
  const avgDaysToSell = daySamples.length
    ? daySamples.reduce((a, b) => a + b, 0) / daySamples.length
    : null;

  const profitByModel = new Map();
  for (const sale of activeSales) {
    const model = sale.model || "Unknown";
    const row = profitByModel.get(model) || { profit: 0, units: 0 };
    row.profit += Number(sale.realized_profit || 0);
    row.units += 1;
    profitByModel.set(model, row);
  }
  const bestModel = [...profitByModel.entries()]
    .sort((a, b) => b[1].profit - a[1].profit)[0] || null;

  const aging = available
    .map((phone) => ({ phone, ...inventoryAgeMeta(phone, now) }))
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

  return {
    monthRevenue,
    monthProfit,
    soldThisMonth: monthlySales.length,
    avgProfit,
    avgDaysToSell,
    capital,
    bestModel: bestModel
      ? { model: bestModel[0], profit: bestModel[1].profit, units: bestModel[1].units }
      : null,
    aging,
    slowCount: aging.filter((x) => x.level === "slow" || x.level === "action").length,
  };
}

export function historyFor(history, model, storage, days = 30, now = new Date()) {
  const cutoff = now.getTime() - Number(days) * 86400000;
  const norm = (v) => String(v ?? "").trim().toLowerCase();
  return (history || [])
    .filter(
      (x) =>
        norm(x.model) === norm(model) &&
        Number(x.storage_gb) === Number(storage) &&
        new Date(x.at).getTime() >= cutoff,
    )
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}
