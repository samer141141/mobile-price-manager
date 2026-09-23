import { extractImeiFromText } from "./device-codes.mjs";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function pick(text, labels) {
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp("^\\s*" + escaped + "\\s*[:：-]\\s*(.+?)\\s*$", "i");
      const match = line.match(re);
      if (match?.[1]) return clean(match[1]);
    }
  }
  return "";
}

function numberFrom(value) {
  const match = String(value ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeStorage(value) {
  const n = numberFrom(value);
  if (!Number.isFinite(n)) return "";
  if (/tb/i.test(String(value))) return Math.round(n * 1024);
  return Math.round(n);
}

function normalizeBattery(value) {
  const n = numberFrom(value);
  if (!Number.isFinite(n)) return "";
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function parseThreeUToolsText(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) throw new Error("The 3uTools report is empty.");

  const productName = pick(raw, [
    "Product Name",
    "Device Name",
    "Model Name",
    "Marketing Name",
    "Model",
    "Product Type",
  ]);

  const storage = pick(raw, [
    "Storage Capacity",
    "Hard Disk Capacity",
    "Capacity",
    "Storage",
    "Disk Capacity",
  ]);

  const color = pick(raw, [
    "Device Color",
    "Housing Color",
    "Color",
  ]);

  const battery = pick(raw, [
    "Battery Health",
    "Battery Life",
    "Battery Efficiency",
    "Maximum Capacity",
  ]);

  const serial = pick(raw, ["Serial Number", "Serial"]);
  const ios = pick(raw, ["Product Version", "iOS Version", "System Version"]);
  const region = pick(raw, ["Sales Region", "Region"]);
  const imei = extractImeiFromText(raw);

  const notes = [
    serial ? "Serial: " + serial : "",
    ios ? "iOS: " + ios : "",
    region ? "Region: " + region : "",
  ].filter(Boolean).join(" · ");

  const parsed = {
    model: productName.replace(/^Apple\s+/i, ""),
    storage_gb: normalizeStorage(storage),
    color,
    imei,
    battery_health: normalizeBattery(battery),
    notes,
  };

  if (!parsed.model && !parsed.imei && !parsed.storage_gb) {
    throw new Error("Could not recognize this as a 3uTools device report.");
  }

  return parsed;
}
