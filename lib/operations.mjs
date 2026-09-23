import { inventoryAgeDays } from "./business-intelligence.mjs";

const norm = (value) => String(value ?? "").trim().toLowerCase();

export const TEST_ITEMS = [
  "Face ID / Touch ID",
  "Display & touch",
  "True Tone",
  "Front camera",
  "Rear cameras",
  "Microphone",
  "Speakers",
  "Charging",
  "Wi-Fi & Bluetooth",
  "Buttons & vibration",
];

export const WORKFLOW_STAGES = [
  "Purchased",
  "Testing",
  "Repair",
  "Ready",
  "Listed",
  "Sold",
];

export function operationalStage(phone, record = {}) {
  if (norm(phone?.status) === "sold") return "Sold";
  if (norm(phone?.status) === "repairing") return "Repair";
  if (norm(phone?.status) === "listed") return "Listed";
  if (record.stage && WORKFLOW_STAGES.includes(record.stage)) return record.stage;
  const tests = record.tests || {};
  const values = TEST_ITEMS.map((item) => tests[item]).filter(Boolean);
  if (values.length && values.every((v) => v === "Pass" || v === "N/A")) return "Ready";
  if (values.length) return "Testing";
  return "Purchased";
}

export function testProgress(record = {}) {
  const tests = record.tests || {};
  const values = TEST_ITEMS.map((item) => tests[item] || "Pending");
  const completed = values.filter((v) => v !== "Pending").length;
  const failed = values.filter((v) => v === "Fail").length;
  const passed = values.filter((v) => v === "Pass").length;
  return {
    total: TEST_ITEMS.length,
    completed,
    failed,
    passed,
    percent: Math.round((completed / TEST_ITEMS.length) * 100),
    ready: completed === TEST_ITEMS.length && failed === 0,
  };
}

export function latestMarketFor(priceHistory = [], phone) {
  const matching = priceHistory
    .filter(
      (x) =>
        norm(x.model) === norm(phone?.model) &&
        Number(x.storage_gb) === Number(phone?.storage_gb),
    )
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  return matching[0] || null;
}

export function priceAlert(phone, priceHistory = [], now = new Date()) {
  if (!phone || norm(phone.status) === "sold") return null;
  const latest = latestMarketFor(priceHistory, phone);
  const age = inventoryAgeDays(phone, now);
  const selling = Number(phone.selling_price || 0);

  if (latest?.price && selling > latest.price * 1.07) {
    const target = Math.round((latest.price * 0.99) / 50) * 50;
    return {
      level: "high",
      label: "Above market",
      message: `Listed price is above the latest market reference. Consider about ${target} kr.`,
      target,
    };
  }
  if (age != null && age >= 45) {
    return {
      level: "high",
      label: "Aging stock",
      message: "45+ days in stock. Review price and relist today.",
    };
  }
  if (age != null && age >= 30) {
    return {
      level: "medium",
      label: "Price review",
      message: "30+ days in stock. Compare market price before another week passes.",
    };
  }
  return null;
}

export function buildDailyActions({
  phones = [],
  ops = {},
  adRecords = [],
  priceHistory = [],
  now = new Date(),
}) {
  const actions = [];
  for (const phone of phones) {
    if (norm(phone.status) === "sold") continue;
    const id = String(phone.id);
    const record = ops[id] || {};
    const progress = testProgress(record);
    const age = inventoryAgeDays(phone, now);
    const published = adRecords
      .filter((ad) => String(ad.phoneId) === id && ad.status === "Published")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    if (norm(phone.status) === "repairing") {
      actions.push({
        id: `repair-${id}`,
        type: "repair",
        priority: 100,
        phone,
        title: "Repair in progress",
        detail: "Check repair status and cost.",
      });
    }
    if (progress.failed > 0) {
      actions.push({
        id: `test-${id}`,
        type: "test",
        priority: 95,
        phone,
        title: `${progress.failed} failed test(s)`,
        detail: "Review failed checks before listing.",
      });
    } else if (progress.completed < progress.total && age != null && age >= 2) {
      actions.push({
        id: `test-${id}`,
        type: "test",
        priority: 70,
        phone,
        title: "Testing incomplete",
        detail: `${progress.completed}/${progress.total} checks completed.`,
      });
    }

    if (!phone.imei) {
      actions.push({
        id: `imei-${id}`,
        type: "details",
        priority: 50,
        phone,
        title: "IMEI missing",
        detail: "Add IMEI for safer tracking and receipts.",
      });
    }

    if (!published && age != null && age >= 2 && norm(phone.status) !== "repairing") {
      actions.push({
        id: `ad-${id}`,
        type: "ad",
        priority: age >= 14 ? 85 : 60,
        phone,
        title: "Not published",
        detail: "Create or publish an ad.",
      });
    } else if (published) {
      const adAge = Math.floor((now.getTime() - new Date(published.createdAt).getTime()) / 86400000);
      if (adAge >= 7) {
        actions.push({
          id: `relist-${id}`,
          type: "relist",
          priority: adAge >= 14 ? 88 : 65,
          phone,
          title: "Ad needs relisting",
          detail: `Last published ${adAge} days ago.`,
        });
      }
    }

    const alert = priceAlert(phone, priceHistory, now);
    if (alert) {
      actions.push({
        id: `price-${id}`,
        type: "price",
        priority: alert.level === "high" ? 90 : 68,
        phone,
        title: alert.label,
        detail: alert.message,
        target: alert.target,
      });
    }
  }
  return actions.sort((a, b) => b.priority - a.priority);
}

export function supplierAnalytics(phones = [], saleHistory = []) {
  const phoneMap = new Map(phones.map((p) => [String(p.id), p]));
  const groups = new Map();
  for (const sale of saleHistory.filter((s) => !s.returned_at)) {
    const phone = phoneMap.get(String(sale.phone_id));
    const source = phone?.purchase_source || "Unknown";
    const row = groups.get(source) || {
      source,
      units: 0,
      revenue: 0,
      profit: 0,
      cost: 0,
    };
    row.units += 1;
    row.revenue += Number(sale.selling_price || 0);
    row.profit += Number(sale.realized_profit || 0);
    row.cost +=
      Number(sale.purchase_price || 0) +
      Number(sale.repair_cost || 0) +
      Number(sale.other_cost || 0);
    groups.set(source, row);
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      avgProfit: row.units ? row.profit / row.units : 0,
      roi: row.cost ? (row.profit / row.cost) * 100 : 0,
    }))
    .sort((a, b) => b.profit - a.profit);
}

export function monthlyAccounting(saleHistory = [], year, month) {
  const rows = saleHistory.filter((s) => {
    if (s.returned_at) return false;
    const d = new Date(s.sold_at);
    return d.getFullYear() === Number(year) && d.getMonth() === Number(month);
  });
  return rows.reduce(
    (acc, sale) => {
      const purchase = Number(sale.purchase_price || 0);
      const repair = Number(sale.repair_cost || 0);
      const other = Number(sale.other_cost || 0);
      const revenue = Number(sale.selling_price || 0);
      acc.units += 1;
      acc.revenue += revenue;
      acc.purchaseCost += purchase;
      acc.repairCost += repair;
      acc.otherCost += other;
      acc.totalCost += purchase + repair + other;
      acc.profit += Number(sale.realized_profit ?? revenue - purchase - repair - other);
      return acc;
    },
    {
      units: 0,
      revenue: 0,
      purchaseCost: 0,
      repairCost: 0,
      otherCost: 0,
      totalCost: 0,
      profit: 0,
    },
  );
}

export function globalSearch(phones = [], query = "") {
  const q = norm(query);
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  return phones
    .filter((p) => {
      const haystack = [
        p.model,
        p.storage_gb,
        p.imei,
        p.color,
        p.grade,
        p.condition,
        p.status,
        p.purchase_source,
      ]
        .map(norm)
        .join(" ");
      return tokens.every((token) => haystack.includes(token));
    })
    .slice(0, 15);
}

export function workflowSummary(phone, ops = {}) {
  const record = ops[String(phone.id)] || {};
  return {
    stage: operationalStage(phone, record),
    tests: testProgress(record),
    repairs: record.repairs || [],
    sale: record.sale || null,
  };
}
