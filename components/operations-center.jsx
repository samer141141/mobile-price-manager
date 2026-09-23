"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { blank, money } from "../lib/inventory.mjs";
import {
  buildDailyActions,
  globalSearch,
  monthlyAccounting,
  supplierAnalytics,
  TEST_ITEMS,
  testProgress,
  workflowSummary,
} from "../lib/operations.mjs";
import {
  marketRecommendations,
  smartBuyAnalysis,
} from "../lib/business-intelligence.mjs";
import {
  deviceCodePayload,
  extractImeiFromText,
  findPhoneFromCode,
  parseDeviceCode,
} from "../lib/device-codes.mjs";
import { parseThreeUToolsText } from "../lib/threeutools.mjs";

const OPS_KEY = "lager-ops-v2";
const AUDIT_KEY = "lager-audit-v2";

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function downloadJson(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lager-iphone-media", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("photos")) {
        const store = db.createObjectStore("photos", { keyPath: "id" });
        store.createIndex("phoneId", "phoneId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPhotos(phoneId) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("photos", "readonly");
    const request = tx.objectStore("photos").index("phoneId").getAll(String(phoneId));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function idbPutPhoto(photo) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("photos", "readwrite");
    tx.objectStore("photos").put(photo);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDeletePhoto(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("photos", "readwrite");
    tx.objectStore("photos").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.78);
}

async function preprocessScanImage(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const max = 1800;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      const boosted = gray > 185 ? 255 : gray < 75 ? 0 : Math.min(255, Math.max(0, (gray - 128) * 1.75 + 128));
      d[i] = d[i + 1] = d[i + 2] = boosted;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    bitmap.close?.();
  }
}

async function decodeBarcodeFile(file) {
  if ("BarcodeDetector" in window) {
    try {
      const detector = new window.BarcodeDetector({
        formats: ["code_128", "code_39", "ean_13", "qr_code", "data_matrix"],
      });
      const bitmap = await createImageBitmap(file);
      try {
        const codes = await detector.detect(bitmap);
        if (codes?.length) return String(codes[0].rawValue || "").trim();
      } finally {
        bitmap.close?.();
      }
    } catch {}
  }

  try {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader();
    const url = URL.createObjectURL(file);
    try {
      const result = await reader.decodeFromImageUrl(url);
      const raw = result?.getText?.() || result?.text || "";
      if (raw) return String(raw).trim();
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {}

  return "";
}

async function scanDeviceFile(file, onProgress) {
  onProgress?.("Looking for QR / barcode…");
  const code = await decodeBarcodeFile(file);
  if (code) return { raw: code, method: "barcode" };

  onProgress?.("No barcode found. Reading printed IMEI digits…");
  const processed = await preprocessScanImage(file);
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789",
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "11",
    });

    const sources = [processed, file];
    for (let i = 0; i < sources.length; i += 1) {
      onProgress?.(i === 0 ? "Reading enhanced IMEI image…" : "Trying original image…");
      const result = await worker.recognize(sources[i]);
      const text = result?.data?.text || "";
      const imei = extractImeiFromText(text);
      if (imei) return { raw: imei, imei, method: "ocr", text };
    }
  } finally {
    await worker.terminate();
  }

  throw new Error(
    "Could not read an IMEI. Fill most of the frame with the 15-digit IMEI, keep it sharp, avoid glare, and try again.",
  );
}

async function scanImeiFile(file, onProgress) {
  const result = await scanDeviceFile(file, onProgress);
  const parsed = parseDeviceCode(result.raw);
  const imei = parsed.imei || result.imei || extractImeiFromText(result.raw);
  if (!imei) {
    throw new Error("A code was found, but it did not contain a 15-digit IMEI.");
  }
  return { imei, method: result.method, raw: result.raw };
}

async function generateDeviceImages(phone) {
  const [{ default: QRCode }, { default: JsBarcode }] = await Promise.all([
    import("qrcode"),
    import("jsbarcode"),
  ]);
  const payload = deviceCodePayload(phone);
  const qr = await QRCode.toDataURL(payload, {
    width: 420,
    margin: 1,
    errorCorrectionLevel: "M",
  });

  const barcodeCanvas = document.createElement("canvas");
  const barcodeValue =
    String(phone?.imei || "").replace(/\D/g, "") ||
    ("ID" + String(phone?.id || "").replace(/[^A-Za-z0-9]/g, "")).slice(0, 40);
  JsBarcode(barcodeCanvas, barcodeValue, {
    format: "CODE128",
    displayValue: true,
    fontSize: 18,
    height: 68,
    margin: 8,
  });
  return {
    payload,
    qr,
    barcode: barcodeCanvas.toDataURL("image/png"),
    barcodeValue,
  };
}

async function printDeviceLabel(phone) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Allow pop-ups to print the device label.");
  popup.document.write("<p style='font-family:system-ui;padding:24px'>Preparing label…</p>");
  const images = await generateDeviceImages(phone);
  const title = [phone.model, phone.storage_gb ? phone.storage_gb + "GB" : ""]
    .filter(Boolean)
    .join(" ");
  popup.document.open();
  popup.document.write(`<!doctype html>
<html>
<head>
  <title>${title} · Lager iPhone</title>
  <style>
    @page { size: 62mm 40mm; margin: 2mm; }
    body { margin:0; font-family:Arial,sans-serif; color:#111; }
    .label { width:58mm; min-height:36mm; display:grid; grid-template-columns:1fr 22mm; gap:2mm; align-items:center; }
    h1 { font-size:12pt; margin:0 0 2mm; }
    p { font-size:7.5pt; margin:1mm 0; }
    .barcode { width:34mm; max-height:14mm; object-fit:contain; }
    .qr { width:21mm; height:21mm; }
    .muted { color:#555; font-size:6.5pt; }
  </style>
</head>
<body>
  <div class="label">
    <div>
      <h1>${title}</h1>
      <p>IMEI: ${phone.imei || "Not recorded"}</p>
      <p>${phone.color || ""} ${phone.grade ? "· Grade " + phone.grade : ""}</p>
      <img class="barcode" src="${images.barcode}" alt="Barcode">
      <p class="muted">Scan in Lager iPhone to open this device.</p>
    </div>
    <img class="qr" src="${images.qr}" alt="QR code">
  </div>
  <script>window.onload=()=>setTimeout(()=>window.print(),150)</script>
</body>
</html>`);
  popup.document.close();
}

function nowId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function stageClass(stage) {
  return String(stage || "").toLowerCase().replace(/\s+/g, "-");
}

export default function OperationsCenter({
  phones,
  saleHistory,
  financial,
  adRecords,
  priceHistory,
  onCreatePhone,
  onSavePhone,
  onTransition,
  onOpenAd,
  onOpenDeal,
  onReplaceAdRecords,
  onReplacePriceHistory,
  onPhotoCountChange,
  setNotice,
  setError,
}) {
  const [ops, setOps] = useState({});
  const [audit, setAudit] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [panel, setPanel] = useState("quick");
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseStep, setPurchaseStep] = useState(1);
  const [purchase, setPurchase] = useState({
    ...blank,
    purchase_date: new Date().toISOString().slice(0, 10),
    inventory_scope: "business",
  });
  const [purchaseMarket, setPurchaseMarket] = useState(null);
  const [purchaseMarketLoading, setPurchaseMarketLoading] = useState(false);
  const [repair, setRepair] = useState({
    description: "",
    part: "",
    cost: "",
    technician: "",
  });
  const [saleForm, setSaleForm] = useState({
    buyer: "",
    contact: "",
    payment: "Swish",
    channel: "Direct",
    orderRef: "",
    price: "",
  });
  const [photos, setPhotos] = useState([]);
  const [scanStatus, setScanStatus] = useState("");
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const restoreRef = useRef(null);
  const scannerRef = useRef(null);
  const inventoryScannerRef = useRef(null);
  const photoRef = useRef(null);
  const threeURef = useRef(null);

  useEffect(() => {
    setOps(readJson(OPS_KEY, {}));
    setAudit(readJson(AUDIT_KEY, []));
  }, []);

  useEffect(() => {
    if (!selected?.id) {
      setPhotos([]);
      return;
    }
    idbPhotos(selected.id).then(setPhotos).catch(() => setPhotos([]));
    const record = readJson(OPS_KEY, {})[String(selected.id)] || {};
    setSaleForm((current) => ({
      ...current,
      price: String(selected.selling_price || current.price || ""),
      ...(record.sale || {}),
    }));
  }, [selected?.id]);

  function persistOps(next) {
    setOps(next);
    localStorage.setItem(OPS_KEY, JSON.stringify(next));
  }

  function logAction(action, phone, detail = "") {
    const entry = {
      id: nowId("audit"),
      at: new Date().toISOString(),
      action,
      phoneId: phone?.id ? String(phone.id) : "",
      phone: phone ? [phone.model, phone.storage_gb ? phone.storage_gb + "GB" : ""].filter(Boolean).join(" ") : "",
      detail,
    };
    const next = [entry, ...audit].slice(0, 600);
    setAudit(next);
    localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
  }

  function patchOps(phoneId, patch) {
    const id = String(phoneId);
    const current = ops[id] || {};
    const next = {
      ...ops,
      [id]: {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    };
    persistOps(next);
    return next[id];
  }

  const actions = useMemo(
    () =>
      buildDailyActions({
        phones,
        ops,
        adRecords,
        priceHistory,
      }),
    [phones, ops, adRecords, priceHistory],
  );

  const searchResults = useMemo(() => globalSearch(phones, query), [phones, query]);
  const suppliers = useMemo(() => supplierAnalytics(phones, saleHistory), [phones, saleHistory]);
  const accounting = useMemo(
    () => monthlyAccounting(saleHistory, year, month),
    [saleHistory, year, month],
  );

  const selectedSummary = selected ? workflowSummary(selected, ops) : null;
  const selectedRecord = selected ? ops[String(selected.id)] || {} : {};
  const testState = selectedSummary?.tests || { completed: 0, total: TEST_ITEMS.length, failed: 0, percent: 0 };

  const purchaseAnalysis = useMemo(() => {
    if (!purchaseMarket?.market_summary) return null;
    return smartBuyAnalysis({
      summary: purchaseMarket.market_summary,
      askingPrice: purchase.purchase_price,
      expenses: Number(purchase.repair_cost || 0) + Number(purchase.other_cost || 0),
      buyPercentage: 75,
      batteryHealth: purchase.battery_health || 100,
    });
  }, [purchaseMarket, purchase]);

  async function checkPurchaseMarket() {
    if (!purchase.model || !purchase.storage_gb) return;
    setPurchaseMarketLoading(true);
    try {
      const params = new URLSearchParams({
        model: String(purchase.model),
        storage: String(purchase.storage_gb),
      });
      const response = await fetch("/api/market/compare?" + params.toString(), {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Market check failed.");
      setPurchaseMarket(body);
    } catch (e) {
      setError(e.message);
    } finally {
      setPurchaseMarketLoading(false);
    }
  }

  async function createPurchase() {
    try {
      await onCreatePhone(purchase);
      logAction("New purchase", purchase, money(purchase.purchase_price));
      setPurchaseOpen(false);
      setPurchaseStep(1);
      setPurchaseMarket(null);
      setPurchase({
        ...blank,
        purchase_date: new Date().toISOString().slice(0, 10),
        inventory_scope: "business",
      });
      setNotice("Phone added. Next step: run the device test checklist.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleImeiScan(file) {
    if (!file) return;
    setScanStatus("Starting scan…");
    try {
      const result = await scanImeiFile(file, setScanStatus);
      setPurchase((p) => ({ ...p, imei: result.imei }));
      setNotice(
        result.method === "ocr"
          ? "IMEI read from printed digits."
          : "IMEI scanned from barcode / QR.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setScanStatus("");
    }
  }

  async function handleThreeUToolsFile(file) {
    if (!file) return;
    try {
      const parsed = parseThreeUToolsText(await file.text());
      setPurchase((current) => ({
        ...current,
        ...(parsed.model ? { model: parsed.model } : {}),
        ...(parsed.storage_gb ? { storage_gb: parsed.storage_gb } : {}),
        ...(parsed.color ? { color: parsed.color } : {}),
        ...(parsed.imei ? { imei: parsed.imei } : {}),
        ...(parsed.battery_health !== "" ? { battery_health: parsed.battery_health } : {}),
        ...(parsed.notes
          ? { notes: [current.notes, parsed.notes].filter(Boolean).join(" · ") }
          : {}),
      }));
      setNotice("3uTools data imported into the purchase form.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleInventoryScan(file) {
    if (!file) return;
    setScanStatus("Starting scan…");
    try {
      const result = await scanDeviceFile(file, setScanStatus);
      const found = findPhoneFromCode(phones, result.raw);
      if (!found.phone) {
        const parsed = found.parsed;
        throw new Error(
          parsed.imei
            ? "IMEI was read, but this phone is not in Lager iPhone."
            : "The scanned code is not a Lager iPhone device code.",
        );
      }
      setSelected(found.phone);
      setPanel("quick");
      setQuery("");
      setNotice(
        result.method === "ocr"
          ? "Phone opened from IMEI text."
          : "Phone opened from barcode / QR.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setScanStatus("");
    }
  }

  function updateTest(item, value) {
    if (!selected) return;
    const record = ops[String(selected.id)] || {};
    const tests = { ...(record.tests || {}), [item]: value };
    patchOps(selected.id, {
      tests,
      stage: value === "Fail" ? "Testing" : record.stage || "Testing",
    });
    logAction("Device test", selected, item + ": " + value);
  }

  async function sendToRepair() {
    if (!selected) return;
    try {
      await onSavePhone(selected, { status: "Repairing" });
      patchOps(selected.id, { stage: "Repair" });
      logAction("Workflow", selected, "Sent to repair");
      setNotice("Phone moved to Repair.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function markReady() {
    if (!selected) return;
    try {
      await onSavePhone(selected, { status: "In Stock" });
      patchOps(selected.id, { stage: "Ready" });
      logAction("Workflow", selected, "Ready for sale");
      setNotice("Phone marked Ready.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function markListed() {
    if (!selected) return;
    try {
      await onSavePhone(selected, { status: "Listed" });
      patchOps(selected.id, { stage: "Listed" });
      logAction("Workflow", selected, "Listed");
      setNotice("Phone marked Listed.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function addRepair() {
    if (!selected || !repair.description.trim()) return;
    const item = {
      id: nowId("repair"),
      description: repair.description.trim(),
      part: repair.part.trim(),
      cost: Number(repair.cost || 0),
      technician: repair.technician.trim(),
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    const repairs = [...(selectedRecord.repairs || []), item];
    patchOps(selected.id, { repairs, stage: "Repair" });
    try {
      const patch = { status: "Repairing" };
      if (financial && item.cost > 0) {
        patch.repair_cost = Number(selected.repair_cost || 0) + item.cost;
      }
      await onSavePhone(selected, patch);
      setRepair({ description: "", part: "", cost: "", technician: "" });
      logAction("Repair added", selected, item.description + (item.cost ? " · " + money(item.cost) : ""));
      setNotice("Repair added.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function completeRepair(id) {
    if (!selected) return;
    const repairs = (selectedRecord.repairs || []).map((r) =>
      r.id === id ? { ...r, completedAt: new Date().toISOString() } : r,
    );
    patchOps(selected.id, { repairs, stage: "Testing" });
    try {
      await onSavePhone(selected, { status: "In Stock" });
      logAction("Repair completed", selected);
      setNotice("Repair completed. Run the test checklist again.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function addPhoto(file) {
    if (!selected || !file) return;
    try {
      if (photos.length >= 6) throw new Error("Maximum 6 photos per phone.");
      const dataUrl = await compressImage(file);
      const photo = {
        id: nowId("photo"),
        phoneId: String(selected.id),
        dataUrl,
        createdAt: new Date().toISOString(),
      };
      await idbPutPhoto(photo);
      const next = await idbPhotos(selected.id);
      setPhotos(next);
      onPhotoCountChange?.(selected.id, next.length);
      logAction("Photo added", selected);
      setNotice("Photo saved on this device.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function removePhoto(id) {
    await idbDeletePhoto(id);
    if (selected) {
      const next = await idbPhotos(selected.id);
      setPhotos(next);
      onPhotoCountChange?.(selected.id, next.length);
    }
  }

  async function saveSale() {
    if (!selected) return;
    try {
      const price = Number(saleForm.price || selected.selling_price || 0);
      if (price <= 0) throw new Error("Enter the final selling price.");
      if (Number(selected.selling_price || 0) !== price) {
        await onSavePhone(selected, { selling_price: price });
      }
      await onTransition(selected, "Sold");
      patchOps(selected.id, {
        stage: "Sold",
        sale: {
          ...saleForm,
          price,
          soldAt: new Date().toISOString(),
        },
      });
      logAction("Phone sold", selected, money(price) + " · " + saleForm.payment + " · " + saleForm.channel);
      setNotice("Sale saved. Receipt is ready.");
      setPanel("receipt");
    } catch (e) {
      setError(e.message);
    }
  }

  async function generateReceipt(phone, sale) {
    try {
      const [mod, images] = await Promise.all([
        import("jspdf"),
        generateDeviceImages(phone),
      ]);
      const jsPDF = mod.jsPDF || mod.default;
      const doc = new jsPDF();
      let y = 20;
      doc.setFontSize(18);
      doc.text("Lager iPhone", 18, y);
      y += 9;
      doc.setFontSize(12);
      doc.text("Sales receipt / försäljningsunderlag", 18, y);
      y += 14;
      const lines = [
        ["Date", new Date(sale?.soldAt || Date.now()).toLocaleDateString("sv-SE")],
        ["Device", [phone.model, phone.storage_gb ? phone.storage_gb + " GB" : ""].filter(Boolean).join(" ")],
        ["Color", phone.color || "—"],
        ["IMEI", phone.imei || "Not recorded"],
        ["Condition", phone.condition || "—"],
        ["Buyer", sale?.buyer || "—"],
        ["Contact", sale?.contact || "—"],
        ["Payment", sale?.payment || "—"],
        ["Sales channel", sale?.channel || "—"],
        ["Order / reference", sale?.orderRef || "—"],
        ["Price", money(sale?.price || phone.selling_price)],
      ];
      doc.setFontSize(10);
      for (const [label, value] of lines) {
        doc.setFont(undefined, "bold");
        doc.text(label + ":", 18, y);
        doc.setFont(undefined, "normal");
        doc.text(String(value), 58, y);
        y += 8;
      }

      y += 5;
      doc.setFontSize(9);
      doc.text(
        "Scan the QR code in Lager iPhone to open this device record.",
        18,
        y,
        { maxWidth: 120 },
      );
      doc.addImage(images.qr, "PNG", 154, Math.max(18, y - 16), 34, 34);
      y += 18;
      if (phone.imei) {
        doc.addImage(images.barcode, "PNG", 18, y, 92, 23);
        y += 27;
      }
      doc.setFontSize(8);
      doc.text(
        "Generated by Lager iPhone. Add company/VAT details separately if this document is used for accounting.",
        18,
        y,
        { maxWidth: 170 },
      );
      doc.save("lager-iphone-receipt-" + (phone.imei || phone.id) + ".pdf");
      logAction("Receipt created", phone);
    } catch (e) {
      setError(e.message);
    }
  }

  async function exportAccounting(format) {
    try {
      const label = year + "-" + String(month + 1).padStart(2, "0");
      if (format === "pdf") {
        const mod = await import("jspdf");
        const jsPDF = mod.jsPDF || mod.default;
        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text("Lager iPhone · Monthly Accounting Summary", 18, 20);
        doc.setFontSize(11);
        const lines = [
          ["Period", label],
          ["Units sold", accounting.units],
          ["Revenue", money(accounting.revenue)],
          ["Purchase cost", money(accounting.purchaseCost)],
          ["Repair cost", money(accounting.repairCost)],
          ["Other cost", money(accounting.otherCost)],
          ["Total cost", money(accounting.totalCost)],
          ["Realized profit", money(accounting.profit)],
        ];
        let y = 38;
        for (const [name, value] of lines) {
          doc.text(String(name), 18, y);
          doc.text(String(value), 90, y);
          y += 9;
        }
        doc.save("lager-accounting-" + label + ".pdf");
      } else {
        const ExcelJS = (await import("exceljs")).default;
        const book = new ExcelJS.Workbook();
        const sheet = book.addWorksheet("Summary");
        sheet.addRow(["Metric", "Value"]);
        sheet.addRows([
          ["Period", label],
          ["Units sold", accounting.units],
          ["Revenue", accounting.revenue],
          ["Purchase cost", accounting.purchaseCost],
          ["Repair cost", accounting.repairCost],
          ["Other cost", accounting.otherCost],
          ["Total cost", accounting.totalCost],
          ["Realized profit", accounting.profit],
        ]);
        sheet.columns = [{ width: 24 }, { width: 20 }];
        const buffer = await book.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "lager-accounting-" + label + ".xlsx";
        a.click();
        URL.revokeObjectURL(url);
      }
      setNotice("Accounting summary exported.");
    } catch (e) {
      setError(e.message);
    }
  }

  function backupAll() {
    downloadJson(
      "lager-iphone-backup-" + new Date().toISOString().slice(0, 10) + ".json",
      {
        version: 2,
        exportedAt: new Date().toISOString(),
        inventorySnapshot: phones,
        ops,
        audit,
        adRecords,
        priceHistory,
      },
    );
    logAction("Backup created", null, phones.length + " inventory rows");
    setNotice("Backup downloaded.");
  }

  async function restoreBackup(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || Number(parsed.version) < 1) throw new Error("Unsupported backup file.");
      const nextOps = parsed.ops && typeof parsed.ops === "object" ? parsed.ops : {};
      const nextAudit = Array.isArray(parsed.audit) ? parsed.audit : [];
      persistOps(nextOps);
      setAudit(nextAudit);
      localStorage.setItem(AUDIT_KEY, JSON.stringify(nextAudit));
      if (Array.isArray(parsed.adRecords)) onReplaceAdRecords(parsed.adRecords);
      if (Array.isArray(parsed.priceHistory)) onReplacePriceHistory(parsed.priceHistory);
      setNotice("Operational backup restored. Inventory itself remains protected in Supabase.");
    } catch (e) {
      setError(e.message);
    }
  }

  const monthOptions = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(2026, i, 1)),
  );

  return (
    <section className="operations-center">
      <div className="ops-hero">
        <div>
          <span className="section-kicker">Daily command center</span>
          <h2>Operations</h2>
          <p>Buy → Test → Repair → Price → Advertise → Sell → Receipt.</p>
        </div>
        <div className="actions ops-hero-actions">
          <button type="button" onClick={backupAll}>Backup</button>
          <button type="button" onClick={() => restoreRef.current?.click()}>Restore</button>
          <button type="button" className="scan-device-button" onClick={() => inventoryScannerRef.current?.click()}>
            ▣ Scan Device
          </button>
          <button type="button" className="primary" onClick={() => setPurchaseOpen(true)}>＋ New Purchase</button>
          <input
            ref={restoreRef}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              restoreBackup(file);
            }}
          />
          <input
            ref={inventoryScannerRef}
            hidden
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              handleInventoryScan(file);
            }}
          />
        </div>
      </div>

      {scanStatus && (
        <div className="scan-status" role="status">
          <span className="scan-spinner" aria-hidden="true" />
          {scanStatus}
        </div>
      )}

      <div className="ops-search">
        <span>⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Quick search: model, IMEI, storage, color, status…"
        />
        {query && <button type="button" onClick={() => setQuery("")}>Clear</button>}
      </div>

      {query && (
        <div className="ops-search-results">
          {searchResults.length ? searchResults.map((phone) => (
            <button
              type="button"
              key={phone.id}
              onClick={() => {
                setSelected(phone);
                setPanel("quick");
                setQuery("");
              }}
            >
              <strong>{phone.model} {phone.storage_gb}GB</strong>
              <span>{phone.imei || "No IMEI"} · {phone.status}</span>
            </button>
          )) : <p>No phone found.</p>}
        </div>
      )}

      <div className="ops-grid">
        <section className="panel daily-actions-panel">
          <div className="title">
            <div>
              <span className="section-kicker">Today</span>
              <h3>Action Center</h3>
              <p>The tasks most likely to move stock or prevent mistakes.</p>
            </div>
            <span className="action-count">{actions.length}</span>
          </div>
          <div className="daily-action-list">
            {actions.slice(0, 14).map((item) => (
              <article className="daily-action" key={item.id}>
                <div>
                  <strong>{item.phone.model} {item.phone.storage_gb}GB</strong>
                  <span>{item.title}</span>
                  <small>{item.detail}</small>
                </div>
                <div className="actions">
                  {["ad", "relist"].includes(item.type) && (
                    <button type="button" onClick={() => onOpenAd(item.phone)}>Create / Relist</button>
                  )}
                  {item.type === "price" && (
                    <button type="button" onClick={() => onOpenDeal(item.phone)}>Review price</button>
                  )}
                  {!["ad", "relist", "price"].includes(item.type) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(item.phone);
                        setPanel(item.type === "repair" ? "repair" : item.type === "test" ? "test" : "quick");
                      }}
                    >
                      Open
                    </button>
                  )}
                </div>
              </article>
            ))}
            {!actions.length && <p className="empty">Nothing urgent. Inventory workflow is clean.</p>}
          </div>
        </section>

        <section className="panel workflow-overview-panel">
          <div className="title">
            <div>
              <span className="section-kicker">Workflow</span>
              <h3>Device pipeline</h3>
            </div>
          </div>
          <div className="pipeline-stats">
            {["Purchased", "Testing", "Repair", "Ready", "Listed", "Sold"].map((stage) => {
              const count = phones.filter((phone) => workflowSummary(phone, ops).stage === stage).length;
              return (
                <button
                  type="button"
                  key={stage}
                  className={"pipeline-stat " + stageClass(stage)}
                  onClick={() => {
                    const phone = phones.find((p) => workflowSummary(p, ops).stage === stage);
                    if (phone) {
                      setSelected(phone);
                      setPanel("quick");
                    }
                  }}
                >
                  <strong>{count}</strong>
                  <span>{stage}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {financial && (
        <div className="ops-grid lower">
          <section className="panel supplier-panel">
            <div className="title">
              <div>
                <span className="section-kicker">Purchasing</span>
                <h3>Supplier / Source Performance</h3>
              </div>
            </div>
            <div className="supplier-table">
              <div className="supplier-head">
                <span>Source</span><span>Sold</span><span>Avg Profit</span><span>ROI</span>
              </div>
              {suppliers.slice(0, 8).map((row) => (
                <div className="supplier-row" key={row.source}>
                  <strong>{row.source}</strong>
                  <span>{row.units}</span>
                  <span>{money(row.avgProfit)}</span>
                  <span>{row.roi.toFixed(1)}%</span>
                </div>
              ))}
              {!suppliers.length && <p className="empty">Sales data will appear here after completed sales.</p>}
            </div>
          </section>

          <section className="panel accounting-panel">
            <div className="title">
              <div>
                <span className="section-kicker">Accounting</span>
                <h3>Monthly Summary</h3>
              </div>
            </div>
            <div className="accounting-period">
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {monthOptions.map((label, i) => <option value={i} key={label}>{label}</option>)}
              </select>
              <input type="number" min="2020" max="2100" value={year} onChange={(e) => setYear(Number(e.target.value))} />
            </div>
            <div className="accounting-kpis">
              <div><span>Revenue</span><strong>{money(accounting.revenue)}</strong></div>
              <div><span>Total cost</span><strong>{money(accounting.totalCost)}</strong></div>
              <div><span>Profit</span><strong>{money(accounting.profit)}</strong></div>
              <div><span>Units</span><strong>{accounting.units}</strong></div>
            </div>
            <div className="actions">
              <button type="button" onClick={() => exportAccounting("xlsx")}>Export Excel</button>
              <button type="button" onClick={() => exportAccounting("pdf")}>Export PDF</button>
            </div>
          </section>
        </div>
      )}

      <section className="panel audit-panel">
        <div className="title">
          <div>
            <span className="section-kicker">Control</span>
            <h3>Audit Log</h3>
            <p>Recent operational actions performed in this browser.</p>
          </div>
        </div>
        <div className="audit-list">
          {audit.slice(0, 12).map((row) => (
            <div key={row.id}>
              <span>{new Date(row.at).toLocaleString()}</span>
              <strong>{row.action}</strong>
              <span>{row.phone || "System"}</span>
              <small>{row.detail}</small>
            </div>
          ))}
          {!audit.length && <p className="empty">No operational actions logged yet.</p>}
        </div>
      </section>

      {purchaseOpen && (
        <div className="ops-modal-backdrop" role="presentation">
          <section className="ops-modal" role="dialog" aria-modal="true" aria-label="New Purchase">
            <div className="title">
              <div>
                <span className="section-kicker">New Purchase</span>
                <h2>Add purchased phone</h2>
                <p>Step {purchaseStep} of 3</p>
              </div>
              <button type="button" onClick={() => setPurchaseOpen(false)}>×</button>
            </div>

            <div className="purchase-steps">
              {[1,2,3].map((step) => <span className={purchaseStep >= step ? "active" : ""} key={step}>{step}</span>)}
            </div>

            {purchaseStep === 1 && (
              <div className="grid">
                <label className="wide">
                  <span>3uTools device data</span>
                  <div className="inline-input-action">
                    <button type="button" onClick={() => threeURef.current?.click()}>Import 3uTools</button>
                    <small className="scan-help">In 3uTools use View iDevice Details → Open in Notepad, save the text file, then import it here.</small>
                  </div>
                  <input
                    ref={threeURef}
                    hidden
                    type="file"
                    accept=".txt,.log,text/plain"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      handleThreeUToolsFile(file);
                    }}
                  />
                </label>
                <label>
                  <span>Model</span>
                  <input value={purchase.model} onChange={(e) => setPurchase({ ...purchase, model: e.target.value })} placeholder="iPhone 15 Pro" />
                </label>
                <label>
                  <span>Storage (GB)</span>
                  <input type="number" min="1" value={purchase.storage_gb} onChange={(e) => setPurchase({ ...purchase, storage_gb: Number(e.target.value) })} />
                </label>
                <label>
                  <span>Color</span>
                  <input value={purchase.color} onChange={(e) => setPurchase({ ...purchase, color: e.target.value })} />
                </label>
                <label>
                  <span>IMEI</span>
                  <div className="inline-input-action">
                    <input inputMode="numeric" maxLength="15" value={purchase.imei} onChange={(e) => setPurchase({ ...purchase, imei: e.target.value.replace(/\D/g, "").slice(0, 15) })} />
                    <button type="button" onClick={() => scannerRef.current?.click()}>Scan IMEI</button>
                  </div>
                  <small className="scan-help">Works with a barcode/QR or the 15 printed IMEI digits shown on another phone.</small>
                  <input
                    ref={scannerRef}
                    hidden
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      handleImeiScan(file);
                    }}
                  />
                </label>
              </div>
            )}

            {purchaseStep === 2 && (
              <div className="grid">
                <label>
                  <span>Condition</span>
                  <select value={purchase.condition} onChange={(e) => setPurchase({ ...purchase, condition: e.target.value })}>
                    {["Excellent","Good","Fair","Damaged"].map((x) => <option key={x}>{x}</option>)}
                  </select>
                </label>
                <label>
                  <span>Grade</span>
                  <input value={purchase.grade || ""} onChange={(e) => setPurchase({ ...purchase, grade: e.target.value })} placeholder="A / B / C" />
                </label>
                <label>
                  <span>Battery health (%)</span>
                  <input type="number" min="0" max="100" value={purchase.battery_health} onChange={(e) => setPurchase({ ...purchase, battery_health: e.target.value })} />
                </label>
                <label>
                  <span>Purchase date</span>
                  <input type="date" value={purchase.purchase_date} onChange={(e) => setPurchase({ ...purchase, purchase_date: e.target.value })} />
                </label>
              </div>
            )}

            {purchaseStep === 3 && (
              <>
                <div className="grid">
                  <label>
                    <span>Purchase price (SEK)</span>
                    <input type="number" min="0" value={purchase.purchase_price} onChange={(e) => setPurchase({ ...purchase, purchase_price: Number(e.target.value) })} />
                  </label>
                  <label>
                    <span>Expected repair cost</span>
                    <input type="number" min="0" value={purchase.repair_cost} onChange={(e) => setPurchase({ ...purchase, repair_cost: Number(e.target.value) })} />
                  </label>
                  <label>
                    <span>Other cost</span>
                    <input type="number" min="0" value={purchase.other_cost} onChange={(e) => setPurchase({ ...purchase, other_cost: Number(e.target.value) })} />
                  </label>
                  <label>
                    <span>Purchase source</span>
                    <input value={purchase.purchase_source} onChange={(e) => setPurchase({ ...purchase, purchase_source: e.target.value })} placeholder="Tradera / Facebook / Supplier…" />
                  </label>
                </div>
                <button type="button" disabled={purchaseMarketLoading || !purchase.model} onClick={checkPurchaseMarket}>
                  {purchaseMarketLoading ? "Checking market…" : "Check Market Before Saving"}
                </button>
                {purchaseAnalysis && (
                  <div className={"purchase-analysis " + purchaseAnalysis.level}>
                    <strong>{purchaseAnalysis.decision}</strong>
                    <span>Max safe buy {money(purchaseAnalysis.safeBuy)}</span>
                    <span>Recommended sell {money(purchaseAnalysis.recommended)}</span>
                    <span>Expected profit {money(purchaseAnalysis.expectedProfit)}</span>
                  </div>
                )}
              </>
            )}

            <div className="actions purchase-actions">
              {purchaseStep > 1 && <button type="button" onClick={() => setPurchaseStep(purchaseStep - 1)}>Back</button>}
              <span />
              {purchaseStep < 3 ? (
                <button
                  type="button"
                  className="primary"
                  disabled={purchaseStep === 1 && (!purchase.model || !purchase.storage_gb)}
                  onClick={() => setPurchaseStep(purchaseStep + 1)}
                >
                  Continue
                </button>
              ) : (
                <button type="button" className="primary" disabled={!purchase.model || !purchase.storage_gb} onClick={createPurchase}>
                  Save Purchase
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {selected && (
        <div className="ops-modal-backdrop" role="presentation">
          <section className="ops-modal ops-phone-sheet" role="dialog" aria-modal="true" aria-label="Phone operations">
            <div className="title">
              <div>
                <span className="section-kicker">Quick Actions</span>
                <h2>{selected.model} {selected.storage_gb}GB</h2>
                <p>{selected.imei || "No IMEI"} · {selected.status}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)}>×</button>
            </div>

            <div className="phone-stage-row">
              <span className={"workflow-stage " + stageClass(selectedSummary.stage)}>{selectedSummary.stage}</span>
              <span>{testState.percent}% tested · {testState.failed} failed</span>
            </div>

            <div className="quick-action-grid">
              <button type="button" className={panel === "test" ? "active" : ""} onClick={() => setPanel("test")}>✓ Test</button>
              <button type="button" className={panel === "repair" ? "active" : ""} onClick={() => setPanel("repair")}>⌁ Repair</button>
              <button type="button" className={panel === "photos" ? "active" : ""} onClick={() => setPanel("photos")}>▣ Photos</button>
              <button type="button" onClick={() => onOpenAd(selected, photos)}>✦ Create Ad</button>
              <button type="button" onClick={() => onOpenDeal(selected)}>↗ Price</button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await printDeviceLabel(selected);
                    logAction("Device label printed", selected);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                ▦ Label
              </button>
              <button type="button" className={panel === "sale" ? "active" : ""} onClick={() => setPanel("sale")}>$ Sell</button>
              {String(selected.status).toLowerCase() === "sold" && (
                <button type="button" className={panel === "receipt" ? "active" : ""} onClick={() => setPanel("receipt")}>Receipt</button>
              )}
            </div>

            {panel === "quick" && (
              <div className="quick-overview">
                <div><span>Stage</span><strong>{selectedSummary.stage}</strong></div>
                <div><span>Testing</span><strong>{testState.completed}/{testState.total}</strong></div>
                <div><span>Repairs</span><strong>{selectedSummary.repairs.length}</strong></div>
                <div><span>Selling price</span><strong>{money(selected.selling_price)}</strong></div>
                <div className="wide actions">
                  <button type="button" onClick={markReady}>Mark Ready</button>
                  <button type="button" onClick={markListed}>Mark Listed</button>
                  <button type="button" onClick={() => onOpenAd(selected, photos)}>Relist</button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await printDeviceLabel(selected);
                        logAction("Device label printed", selected);
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Print Barcode Label
                  </button>
                </div>
              </div>
            )}

            {panel === "test" && (
              <div className="test-checklist">
                <div className="test-progress">
                  <div><span style={{ width: testState.percent + "%" }} /></div>
                  <strong>{testState.percent}% complete</strong>
                </div>
                {TEST_ITEMS.map((item) => {
                  const value = selectedRecord.tests?.[item] || "Pending";
                  return (
                    <div className="test-row" key={item}>
                      <strong>{item}</strong>
                      <div className="test-options">
                        {["Pass","Fail","N/A"].map((option) => (
                          <button
                            type="button"
                            key={option}
                            className={value === option ? "active " + option.toLowerCase().replace("/", "") : ""}
                            onClick={() => updateTest(item, option)}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="actions">
                  {testState.failed > 0 && <button type="button" className="danger" onClick={sendToRepair}>Send to Repair</button>}
                  {testState.completed === testState.total && testState.failed === 0 && <button type="button" className="primary" onClick={markReady}>Mark Ready</button>}
                </div>
              </div>
            )}

            {panel === "repair" && (
              <div className="repair-workflow">
                <div className="grid">
                  <label className="wide">
                    <span>Problem / work</span>
                    <input value={repair.description} onChange={(e) => setRepair({ ...repair, description: e.target.value })} placeholder="Battery replacement, screen, charging port…" />
                  </label>
                  <label>
                    <span>Part</span>
                    <input value={repair.part} onChange={(e) => setRepair({ ...repair, part: e.target.value })} />
                  </label>
                  {financial && (
                    <label>
                      <span>Cost (SEK)</span>
                      <input type="number" min="0" value={repair.cost} onChange={(e) => setRepair({ ...repair, cost: e.target.value })} />
                    </label>
                  )}
                  <label>
                    <span>Technician / supplier</span>
                    <input value={repair.technician} onChange={(e) => setRepair({ ...repair, technician: e.target.value })} />
                  </label>
                </div>
                <button type="button" className="primary" disabled={!repair.description.trim()} onClick={addRepair}>Add Repair</button>
                <div className="repair-list">
                  {(selectedRecord.repairs || []).slice().reverse().map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>{item.description}</strong>
                        <span>{item.part || "No part"} · {item.technician || "—"}</span>
                        <small>{new Date(item.startedAt).toLocaleDateString()} {item.cost ? "· " + money(item.cost) : ""}</small>
                      </div>
                      {item.completedAt ? (
                        <span className="completed-badge">Completed</span>
                      ) : (
                        <button type="button" onClick={() => completeRepair(item.id)}>Complete</button>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )}

            {panel === "photos" && (
              <div className="phone-photos">
                <div className="actions">
                  <button type="button" className="primary" onClick={() => photoRef.current?.click()}>＋ Add Photo</button>
                  <input
                    ref={photoRef}
                    hidden
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      addPhoto(file);
                    }}
                  />
                </div>
                <p>Up to 6 compressed photos. Stored in this browser for quick ad preparation.</p>
                <div className="photo-grid">
                  {photos.map((photo) => (
                    <figure key={photo.id}>
                      <button
                        type="button"
                        className="photo-preview-button"
                        title="Open photo"
                        onClick={() => window.open(photo.dataUrl, "_blank", "noopener,noreferrer")}
                      >
                        <img src={photo.dataUrl} alt={selected.model + " inventory"} />
                      </button>
                      <button type="button" onClick={() => removePhoto(photo.id)}>×</button>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            {panel === "sale" && String(selected.status).toLowerCase() !== "sold" && (
              <div className="sale-form">
                <div className="grid">
                  <label><span>Final price (SEK)</span><input type="number" min="0" value={saleForm.price} onChange={(e) => setSaleForm({ ...saleForm, price: e.target.value })} /></label>
                  <label><span>Buyer name (optional)</span><input value={saleForm.buyer} onChange={(e) => setSaleForm({ ...saleForm, buyer: e.target.value })} /></label>
                  <label><span>Buyer contact</span><input value={saleForm.contact} onChange={(e) => setSaleForm({ ...saleForm, contact: e.target.value })} /></label>
                  <label>
                    <span>Payment</span>
                    <select value={saleForm.payment} onChange={(e) => setSaleForm({ ...saleForm, payment: e.target.value })}>
                      {["Swish","Card","Cash","Bank transfer","Blocket","Tradera","Other"].map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Sales channel</span>
                    <select value={saleForm.channel} onChange={(e) => setSaleForm({ ...saleForm, channel: e.target.value })}>
                      {["Direct","Facebook","Blocket","Tradera","Website","Other"].map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </label>
                  <label><span>Order / reference</span><input value={saleForm.orderRef} onChange={(e) => setSaleForm({ ...saleForm, orderRef: e.target.value })} /></label>
                </div>
                <button type="button" className="primary" onClick={saveSale}>Complete Sale</button>
              </div>
            )}

            {(panel === "receipt" || (panel === "sale" && String(selected.status).toLowerCase() === "sold")) && (
              <div className="receipt-panel">
                <p>Create a simple sales receipt using the device details and saved buyer information.</p>
                <button type="button" className="primary" onClick={() => generateReceipt(selected, selectedRecord.sale)}>Download Receipt PDF</button>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
