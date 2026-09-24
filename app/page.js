"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import {
  blank,
  columns,
  sensitive,
  cost,
  profit,
  isSold,
  matches,
  money,
  marketStats,
  payload,
  editPayload,
} from "../lib/inventory.mjs";
import {
  businessInsights,
  historyFor,
  marketRecommendations,
  smartBuyAnalysis,
} from "../lib/business-intelligence.mjs";
import {
  AdCenterPanel,
  DealCalculatorContent,
  InsightsPanel,
  PriceHistoryPanel,
  SmartBuyPanel,
  SuggestedPricePanel,
} from "../components/business-tools";
import OperationsCenter from "../components/operations-center";
import {
  listPhoneIdsWithPhotos,
  loadPhonePhotos,
  photoToFile,
} from "../lib/phone-photos";
const conditions = ["Excellent", "Good", "Fair", "Damaged"],
  marketConditions = ["Used", "Renewed", "Refurbished", "New"],
  statuses = ["In Stock", "Repairing", "Listed", "Sold"],
  sources = ["Apple Trade In", "Elgiganten Trade-In", "Tradera", "Blocket", "Swappie", "Back Market", "PhoneHero", "Other"];
async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

function buildMarketplaceAd(phone, platform = "Facebook") {
  const model = phone.model || "iPhone";
  const storage = phone.storage_gb ? phone.storage_gb + "GB" : "";
  const color = phone.color || "";
  const battery = phone.battery_health != null ? phone.battery_health + "%" : "";
  const condition = phone.condition || (phone.grade ? "Grade " + phone.grade : "fint skick");
  const price = Number(phone.selling_price || 0) > 0 ? money(phone.selling_price) : "";
  const title = [model, storage, color].filter(Boolean).join(" – ");

  const base = [
    "📱 " + title,
    "",
    "Säljer en " + model + (storage ? " med " + storage + " lagring" : "") + ".",
    "Skick: " + condition + ".",
    battery ? "🔋 Batterihälsa: " + battery : "",
    color ? "🎨 Färg: " + color : "",
    "🔓 Olåst",
    "✅ Testad och fungerar som den ska",
    price ? "💰 Pris: " + price : "",
    "📦 Kan skickas med post eller hämtas enligt överenskommelse.",
  ].filter(Boolean);

  if (platform === "Blocket") {
    return [
      title,
      "",
      ...base.slice(2),
      "",
      "Trygg affär: köp kan göras via Blocket för säker betalning.",
      "📩 Skicka meddelande vid intresse.",
    ].join("\n");
  }

  if (platform === "Tradera") {
    return [
      title,
      "",
      ...base.slice(2),
      "",
      "Enheten är testad professionellt och fungerar som den ska.",
      "Skickas väl emballerad.",
      "Lycka till i auktionen!",
    ].join("\n");
  }

  if (platform === "TikTok") {
    return [
      "📱 " + [model, storage].filter(Boolean).join(" "),
      battery ? "🔋 Batteri " + battery : "",
      price ? "💰 " + price : "",
      "📦 Kan skickas",
      "📩 DM vid intresse",
      "",
      "#iphone #apple #begagnat #sverige #mobil #iphoneforsale",
    ].filter(Boolean).join("\n");
  }

  return [
    ...base,
    "",
    "📩 Skicka PM vid intresse.",
    "⚡ Först till kvarn!",
    "",
    "#iphone #apple #begagnat #sverige #mobil",
  ].join("\n");
}
const AD_PLATFORM_URLS = {
  Facebook: "https://www.facebook.com/marketplace/create/item",
  Blocket: "https://www.blocket.se/",
  Tradera: "https://www.tradera.com/sell",
  TikTok: "https://www.tiktok.com/upload",
};


function phoneEditorState(phone) {
  return {
    id: phone.id,
    original: phone,
    form: {
      ...Object.fromEntries(
        Object.keys(blank).map((key) => [key, phone[key] ?? ""]),
      ),
      inventory_scope: phone.inventory_scope || "business",
    },
  };
}

function controlDate(value, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return includeTime
    ? date.toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleDateString("sv-SE", { dateStyle: "medium" });
}

function buildPhoneTimeline(phone, saleHistory, adRecords) {
  const phoneId = String(phone?.id ?? "");
  const entries = [];
  const push = (at, title, detail, tone = "default") => {
    if (!at) return;
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return;
    entries.push({
      at: date.toISOString(),
      title,
      detail,
      tone,
    });
  };

  push(
    phone.purchase_date,
    "Purchased",
    phone.purchase_source ? "Source · " + phone.purchase_source : "Phone added to stock",
    "purchase",
  );
  push(phone.created_at, "Added to Lager iPhone", "Inventory record created", "default");

  (adRecords || [])
    .filter((record) => String(record.phoneId ?? "") === phoneId)
    .forEach((record) =>
      push(
        record.createdAt,
        record.status === "Published" ? "Ad published" : "Ad prepared",
        [record.platform, record.status].filter(Boolean).join(" · "),
        "ad",
      ),
    );

  (saleHistory || [])
    .filter((sale) => String(sale.phone_id ?? sale.phoneId ?? "") === phoneId)
    .forEach((sale) => {
      push(
        sale.sold_at,
        "Sold",
        sale.selling_price != null ? "Sale price · " + money(sale.selling_price) : "Sale completed",
        "sold",
      );
      push(sale.returned_at, "Returned to stock", "Sale history preserved", "return");
    });

  if (phone.updated_at && phone.updated_at !== phone.created_at) {
    push(phone.updated_at, "Inventory updated", "Latest saved phone changes", "default");
  }

  return entries
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 10);
}

function controlStatusIndex(status) {
  const value = String(status || "In Stock").toLowerCase();
  if (value === "sold") return 3;
  if (value === "listed") return 2;
  if (value === "repairing") return 1;
  return 0;
}

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState("available"),
    [search, setSearch] = useState(""),
    [filters, setFilters] = useState({
      model: "",
      storage: "",
      grade: "",
      condition: "",
      status: "",
    }),
    [editor, setEditor] = useState(null),
    [details, setDetails] = useState(null),
    [operationsTargetId, setOperationsTargetId] = useState(null),
    [deleting, setDeleting] = useState(null),
    [exporting, setExporting] = useState(false),
    [importing, setImporting] = useState(false),
    [importRows, setImportRows] = useState([]),
    [selected, setSelected] = useState(
      columns.filter(([k]) => !sensitive.includes(k)).map(([k]) => k),
    ),
    [format, setFormat] = useState("xlsx"),
    [marketForm, setMarketForm] = useState({
      model: "",
      storage_gb: 128,
      condition: "Good",
      source: "Tradera",
      market_price: "",
      listing_url: "",
    }),
    [percentage, setPercentage] = useState(75),
    [expenses, setExpenses] = useState(0),
    [dealPrice, setDealPrice] = useState(""),
    [dealBattery, setDealBattery] = useState(85),
    [liveMarket, setLiveMarket] = useState(null),
    [checkingMarket, setCheckingMarket] = useState(false),
    [adBuilder, setAdBuilder] = useState(null),
    [photoCounts, setPhotoCounts] = useState({}),
    [photoViewer, setPhotoViewer] = useState(null),
    [controlPhotos, setControlPhotos] = useState([]),
    [controlLoading, setControlLoading] = useState(false),
    [priceHistory, setPriceHistory] = useState([]),
    [historyRange, setHistoryRange] = useState(30),
    [adRecords, setAdRecords] = useState([]),
    [dealCalculator, setDealCalculator] = useState(null),
    [members, setMembers] = useState([]),
    [member, setMember] = useState({
      email: "",
      role: "employee",
      can_view_financials: false,
      can_delete: false,
    });
  const access = data?.access,
    financial = !!access?.can_view_financials,
    phones = data?.phones || [],
    market = data?.market_prices || [];
  useEffect(() => {
    let active = true;
    const list = data?.phones || [];
    if (!list.length) {
      setPhotoCounts({});
      return () => { active = false; };
    }

    const validPhoneIds = new Set(list.map((phone) => String(phone.id)));
    listPhoneIdsWithPhotos()
      .then((phoneIds) => {
        if (!active) return;
        const entries = phoneIds
          .filter((phoneId) => validPhoneIds.has(String(phoneId)))
          .map((phoneId) => [String(phoneId), 1]);
        setPhotoCounts(Object.fromEntries(entries));
      })
      .catch(() => {
        if (active) setPhotoCounts({});
      });

    return () => { active = false; };
  }, [data?.phones]);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await rpc("lager_dashboard"));
    } catch (e) {
      setData(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let live = true;
    if (!supabase) {
      setError(
        "Configure the existing Supabase URL and publishable key in .env.local, then restart.",
      );
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!live) return;
      if (!session) router.replace("/login");
      else load();
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setData(null);
        router.replace("/login");
      }
    });
    const saved = localStorage.getItem("lager-buy-percentage");
    if (saved !== null && Number(saved) >= 0 && Number(saved) <= 100)
      setPercentage(Number(saved));
    try {
      setPriceHistory(JSON.parse(localStorage.getItem("lager-price-history") || "[]"));
    } catch {
      setPriceHistory([]);
    }
    try {
      setAdRecords(JSON.parse(localStorage.getItem("lager-ad-center") || "[]"));
    } catch {
      setAdRecords([]);
    }
    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, [router, load]);
  async function act(work, message) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(message);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function persistPriceHistory(next) {
    const trimmed = next.slice(-500);
    setPriceHistory(trimmed);
    localStorage.setItem("lager-price-history", JSON.stringify(trimmed));
  }
  function persistAdRecords(next) {
    const trimmed = next.slice(0, 250);
    setAdRecords(trimmed);
    localStorage.setItem("lager-ad-center", JSON.stringify(trimmed));
  }
  async function openAdBuilder(phone, platform = "Facebook", text = "", suppliedPhotos = null) {
    let photos = Array.isArray(suppliedPhotos) ? suppliedPhotos : null;
    if (!photos) {
      try {
        photos = await loadPhonePhotos(phone.id);
      } catch {
        photos = [];
      }
    }
    setPhotoCounts((current) => ({ ...current, [String(phone.id)]: photos.length }));
    setAdBuilder({
      phone,
      platform,
      text: text || buildMarketplaceAd(phone, platform),
      photos,
    });
  }

  async function openControlCenter(phone) {
    setDetails(phone);
    setControlPhotos([]);
    setControlLoading(true);
    try {
      const photos = await loadPhonePhotos(phone.id);
      setControlPhotos(photos);
      setPhotoCounts((current) => ({
        ...current,
        [String(phone.id)]: photos.length,
      }));
    } catch {
      setControlPhotos([]);
    } finally {
      setControlLoading(false);
    }
  }

  async function openPhotoViewer(phone) {
    try {
      const photos = await loadPhonePhotos(phone.id);
      if (!photos.length) {
        setNotice("No saved photos for this phone.");
        return;
      }
      setPhotoCounts((current) => ({ ...current, [String(phone.id)]: photos.length }));
      setPhotoViewer({ phone, photos });
    } catch (e) {
      setError(e.message);
    }
  }

  async function publishAdToPlatform() {
    if (!adBuilder) return;
    const platform = adBuilder.platform || "Facebook";
    const url = AD_PLATFORM_URLS[platform] || AD_PLATFORM_URLS.Facebook;
    window.open(url, "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(adBuilder.text);
    } catch {}
    saveAdRecord("Published");
    setNotice(
      platform +
        " opened. The ad text was copied" +
        (adBuilder.photos?.length ? " and " + adBuilder.photos.length + " phone photo(s) are ready in Lager iPhone." : "."),
    );
  }

  async function shareAdWithPhotos() {
    if (!adBuilder) return;
    const files = await Promise.all(
      (adBuilder.photos || []).map((photo, index) => photoToFile(photo, index)),
    );
    try {
      if (files.length && navigator.canShare?.({ files })) {
        await navigator.share({
          title: [adBuilder.phone.model, adBuilder.phone.storage_gb ? adBuilder.phone.storage_gb + "GB" : ""].filter(Boolean).join(" "),
          text: adBuilder.text,
          files,
        });
        return;
      }
      await navigator.clipboard.writeText(adBuilder.text);
      setNotice("Photo sharing is not supported by this browser. Ad text copied instead.");
    } catch (e) {
      if (e?.name !== "AbortError") setError(e.message);
    }
  }

  function saveAdRecord(status = "Draft") {
    if (!adBuilder) return;
    const record = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      phoneId: String(adBuilder.phone.id ?? ""),
      model: adBuilder.phone.model,
      storage_gb: adBuilder.phone.storage_gb,
      platform: adBuilder.platform,
      text: adBuilder.text,
      status,
      createdAt: new Date().toISOString(),
    };
    persistAdRecords([record, ...adRecords]);
    setNotice(status === "Published" ? "Ad marked as published." : "Ad saved to Ad Center.");
  }
  function updateAdRecordStatus(id, status) {
    persistAdRecords(
      adRecords.map((record) => (record.id === id ? { ...record, status } : record)),
    );
  }
  function deleteAdRecord(id) {
    persistAdRecords(adRecords.filter((record) => record.id !== id));
  }
  async function openDealCalculator(phone) {
    setDealCalculator({ phone, loading: true, error: "", analysis: null });
    try {
      const params = new URLSearchParams({
        model: phone.model || "",
        storage: String(phone.storage_gb || ""),
      });
      const response = await fetch("/api/market/compare?" + params.toString(), {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Market comparison failed.");
      setDealCalculator({
        phone,
        loading: false,
        error: "",
        analysis: marketRecommendations(body.market_summary),
        market: body,
      });
    } catch (e) {
      setDealCalculator({
        phone,
        loading: false,
        error: e.message,
        analysis: null,
      });
    }
  }
  const business = phones.filter(
      (p) => (p.inventory_scope || "business") === "business",
    ),
    samer = phones.filter((p) => p.inventory_scope === "samer"),
    available = business.filter((p) => !isSold(p)),
    sold = business.filter(isSold),
    visiblePhones = tab === "samer" ? samer : tab === "sold" ? sold : available,
    filtered = visiblePhones.filter(
      (p) =>
        matches(p, search) &&
        (!filters.model || p.model === filters.model) &&
        (!filters.storage || String(p.storage_gb) === filters.storage) &&
        (!filters.grade || String(p.grade || "") === filters.grade) &&
        (!filters.condition || p.condition === filters.condition) &&
        (!filters.status || p.status === filters.status),
    ),
    saleHistory = data?.sale_history || [],
    activeSales = saleHistory.filter((s) => !s.returned_at),
    totalSales = activeSales.reduce(
      (n, s) => n + Number(s.selling_price || 0),
      0,
    ),
    realizedProfit = activeSales.reduce(
      (n, s) => n + Number(s.realized_profit || 0),
      0,
    ),
    stats = marketStats(
      market,
      marketForm,
      Number(percentage),
      Number(expenses),
    );
  const insights = businessInsights(phones, saleHistory),
    recommendations = marketRecommendations(liveMarket?.market_summary),
    smartBuy = smartBuyAnalysis({
      summary: liveMarket?.market_summary,
      askingPrice: dealPrice,
      expenses,
      buyPercentage: percentage,
      batteryHealth: dealBattery,
    }),
    historyPoints = historyFor(
      priceHistory,
      marketForm.model,
      marketForm.storage_gb,
      historyRange,
    );
  async function readImportFile(file) {
    setError("");
    setNotice("");
    try {
      if (!file) return;
      if (!/\.xlsx$/i.test(file.name)) throw new Error("Please choose an Excel .xlsx file.");
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("The Excel file has no worksheet.");
      const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
      const aliases = {
        model: ["model","modell","phone","telefon"],
        storage_gb: ["storage","storagegb","lagring","gb","minne"],
        color: ["color","colour","farg","färg"],
        grade: ["grade","gradering"],
        battery_health: ["battery","batteryhealth","batteri","batterihalsa","batterihälsa"],
        condition: ["condition","skick"],
        imei: ["imei"],
        status: ["status"],
        purchase_price: ["purchaseprice","inkopspris","inköpspris","buyprice"],
        repair_cost: ["repaircost","reparation","reparationskostnad"],
        other_cost: ["othercost","othercosts","ovrigkostnad","övrigkostnad"],
        selling_price: ["sellingprice","saleprice","forsaljningspris","försäljningspris","pris"],
        purchase_source: ["purchasesource","source","kalla","källa","inkopsstalle","inköpsställe"],
        notes: ["notes","note","anteckning","anteckningar"]
      };
      const header = [];
      sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { header[col] = norm(cell.text); });
      const mapping = {};
      Object.entries(aliases).forEach(([key, names]) => {
        const found = header.findIndex((h) => names.map(norm).includes(h));
        if (found > 0) mapping[key] = found;
      });
      if (!mapping.model || !mapping.storage_gb) throw new Error("Excel needs Model and Storage columns.");
      const numeric = new Set(["storage_gb","battery_health","purchase_price","repair_cost","other_cost","selling_price"]);
      const rows = [];
      for (let r = 2; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r);
        const item = { ...blank, inventory_scope: tab === "samer" ? "samer" : "business" };
        Object.entries(mapping).forEach(([key, col]) => {
          let value = row.getCell(col).value;
          if (value && typeof value === "object") value = value.text ?? value.result ?? "";
          value = String(value ?? "").trim();
          if (numeric.has(key)) value = value === "" ? (key === "battery_health" ? "" : 0) : Number(value.replace(/[^0-9.,-]/g, "").replace(",", "."));
          item[key] = value;
        });
        if (String(item.model).trim()) rows.push(item);
      }
      if (!rows.length) throw new Error("No phones found in the Excel file.");
      setImportRows(rows);
      setImporting(true);
    } catch (e) {
      setError(e.message);
    }
  }
  async function importPhones() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let added = 0;
      for (const row of importRows) {
        await rpc("lager_save_phone", { phone_id: null, payload: payload(row, financial) });
        added++;
      }
      setImporting(false);
      setImportRows([]);
      setNotice(added + " phones imported successfully.");
      await load();
    } catch (e) {
      setError("Import stopped: " + e.message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function exportPhones() {
    setBusy(true);
    setError("");
    try {
      const { exportInventory } = await import("../lib/export");
      await exportInventory(
        filtered,
        columns.filter(
          ([k]) =>
            selected.includes(k) && (financial || !sensitive.includes(k)),
        ),
        format,
        tab,
      );
      setExporting(false);
      setNotice("Export downloaded.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="app-shell">
      <header className="dashboard-header">
        <div className="brand">
          <span className="brand-icon">LI</span>
          <div className="brand-copy">
            <span className="brand-kicker">Inventory command center</span>
            <h1>Lager iPhone</h1>
            <p>Inventory · Market intelligence · Sales</p>
          </div>
        </div>
        <div className="actions header-actions">
          <span className="badge role-badge">{access?.role || "Connecting"}</span>
          <button
            disabled={loading || busy}
            onClick={() => {
              setError("");
              load();
            }}
          >
            Refresh
          </button>
          <button onClick={() => supabase?.auth.signOut()}>Sign Out</button>
        </div>
      </header>
      {error && (
        <div role="alert" className="alert">
          {error}
          {!data && (
            <p>
              Database setup may be required. See README.md and
              migrations/20260921_lager_iphone.sql. An Admin must assign your
              account access. No records have been reset.
            </p>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {loading && !data ? (
        <section className="panel">Loading your inventory…</section>
      ) : (
        data && (
          <>
            <div className="overview-heading">
              <div>
                <span className="section-kicker">Dashboard</span>
                <h2>Business overview</h2>
                <p>Everything important at a glance.</p>
              </div>
              <span className="live-status"><i />Live data</span>
            </div>
            <section className="cards kpi-grid">
              <Card title="Available Phones" value={available.length} />
              <Card title="Sold Phones" value={sold.length} />
              {financial ? (
                <>
                  <Card
                    title="Total Inventory Cost"
                    value={money(available.reduce((n, p) => n + cost(p), 0))}
                  />
                  <Card
                    title="Total Sales"
                    value={money(
                      saleHistory.length
                        ? totalSales
                        : sold.reduce(
                            (n, p) => n + Number(p.selling_price || 0),
                            0,
                          ),
                    )}
                  />
                  <Card
                    title="Total Realized Profit"
                    value={money(
                      saleHistory.length
                        ? realizedProfit
                        : sold.reduce((n, p) => n + profit(p), 0),
                    )}
                  />
                  <Card
                    title="Capital in Stock"
                    value={money(available.reduce((n,p)=>n+cost(p),0))}
                    detail="Money currently tied up in available inventory"
                  />
                </>
              ) : (
                <Card
                  title="Access"
                  value="Employee"
                  detail="Financial information is restricted"
                />
              )}
            </section>
            <nav className="workspace-nav" aria-label="Dashboard sections">
              {[
                ["available", "Available Phones", "Available"],
                ["operations", "Operations", "Operations"],
                ["sold", "Sold Phones", "Sold"],
                ["samer", "Samer", "Samer"],
                ["market", "Market Prices", "Market"],
                ...(financial ? [["insights", "Insights", "Insights"]] : []),
                ["ads", "Ad Center", "Ads"],
                ...(access.role === "admin"
                  ? [["team", "Team Permissions", "Team"]]
                  : []),
              ].map(([key, label, mobileLabel]) => (
                <button
                  aria-current={tab === key ? "page" : undefined}
                  className={tab === key ? "active" : ""}
                  key={key}
                  onClick={() => {
                    if (key === "operations") setOperationsTargetId(null);
                    setTab(key);
                    if (key === "team")
                      rpc("lager_members")
                        .then(setMembers)
                        .catch((e) => setError(e.message));
                  }}
                >
                  <span className="nav-label-full">{label}</span>
                  <span className="nav-label-short">{mobileLabel}</span>
                </button>
              ))}
            </nav>
            {["available", "sold", "samer"].includes(tab) && (
              <section className="panel workspace-panel">
                <div className="title">
                  <div>
                    <h2>
                      {tab === "samer"
                        ? "Samer"
                        : tab === "sold"
                          ? "Sold Phones"
                          : "Available Phones"}
                    </h2>
                    <p>
                      {filtered.length} phones
                      {search ? " matching your search" : ""}
                    </p>
                  </div>
                  <div className="actions inventory-toolbar">
                    <label className="import-button tool-button import-tool">
                      <span className="tool-icon" aria-hidden="true">↑</span>
                      <span>Import Excel</span>
                      <input
                        type="file"
                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          readImportFile(file);
                        }}
                      />
                    </label>
                    <button
                      className="tool-button export-tool"
                      disabled={busy || !filtered.length}
                      onClick={() => {
                        setSelected(
                          columns
                            .filter(([k]) => !sensitive.includes(k))
                            .map(([k]) => k),
                        );
                        setExporting(true);
                      }}
                    >
                      <span className="tool-icon" aria-hidden="true">↓</span>
                      <span>Export</span>
                    </button>
                    <button
                      className="primary tool-button add-phone-button"
                      onClick={() =>
                        setEditor({
                          id: null,
                          form: {
                            ...blank,
                            inventory_scope:
                              tab === "samer" ? "samer" : "business",
                          },
                        })
                      }
                    >
                      <span className="tool-icon" aria-hidden="true">＋</span>
                      <span>Add Phone</span>
                    </button>
                  </div>
                </div>
                <Field
                  label="Search inventory"
                  type="search"
                  placeholder="Model, IMEI, storage, color, grade, condition or status"
                  value={search}
                  onChange={setSearch}
                />
                <div className="filter-bar">
                  {[
                    [
                      "model",
                      "Model",
                      [
                        ...new Set(
                          visiblePhones.map((p) => p.model).filter(Boolean),
                        ),
                      ],
                    ],
                    [
                      "storage",
                      "Storage",
                      [
                        ...new Set(
                          visiblePhones
                            .map((p) => String(p.storage_gb))
                            .filter(Boolean),
                        ),
                      ],
                    ],
                    [
                      "grade",
                      "Grade",
                      [
                        ...new Set(
                          visiblePhones.map((p) => p.grade).filter(Boolean),
                        ),
                      ],
                    ],
                    ["condition", "Condition", conditions],
                    ["status", "Status", statuses],
                  ].map(([key, label, options]) => (
                    <label key={key}>
                      <span>Filter by {label}</span>
                      <select
                        value={filters[key]}
                        onChange={(e) =>
                          setFilters({ ...filters, [key]: e.target.value })
                        }
                      >
                        <option value="">All</option>
                        {options.map((o) => (
                          <option key={o} value={o}>
                            {key === "storage" ? `${o} GB` : o}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div
                  className={
                    "inventory-table" + (financial ? " financial" : "")
                  }
                >
                  <div
                    className="inventory-row inventory-head"
                    aria-hidden="true"
                  >
                    <span>Model</span>
                    <span>Storage</span>
                    <span>Color</span>
                    <span>Grade</span>
                    <span>Battery</span>
                    {financial && (
                      <>
                        <span>Purchase</span>
                        <span>Costs</span>
                        <span>Selling</span>
                        <span>Profit</span>
                      </>
                    )}
                    <span>Status</span>
                    <span>Actions</span>
                  </div>
                  {filtered.map((p) => (
                    <article
                      className="phone inventory-row"
                      key={p.id}
                      onClick={() => openControlCenter(p)}
                    >
                      <strong>{p.model}</strong>
                      <span>{p.storage_gb} GB</span>
                      <span>{p.color || "—"}</span>
                      <span>{p.grade || "—"}</span>
                      <span>
                        {p.battery_health == null
                          ? "—"
                          : `${p.battery_health}%`}
                      </span>
                      {financial && (
                        <>
                          <span>{money(p.purchase_price)}</span>
                          <span>
                            {money(
                              Number(p.repair_cost || 0) +
                                Number(p.other_cost || 0),
                            )}
                          </span>
                          <span>{money(p.selling_price)}</span>
                          <span>{money(profit(p))}</span>
                        </>
                      )}
                      <span className={"badge " + (isSold(p) ? "sold" : "")}>
                        {p.status || "In Stock"}
                      </span>
                      <div
                        className="actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button onClick={() => openControlCenter(p)}>View</button>
                        {!isSold(p) && (
                          <button
                            className="ad-button"
                            onClick={() => openAdBuilder(p)}
                          >
                            Create Ad
                          </button>
                        )}
                        {Number(photoCounts[String(p.id)] || 0) > 0 && (
                          <button
                            type="button"
                            className="photo-button"
                            title="Open saved phone photos"
                            onClick={() => openPhotoViewer(p)}
                          >
                            📷 Photos
                          </button>
                        )}
                        {financial && !isSold(p) && (
                          <button
                            className="deal-button"
                            onClick={() => openDealCalculator(p)}
                          >
                            Deal
                          </button>
                        )}
                        <button
                          disabled={busy}
                          onClick={() => setEditor(phoneEditorState(p))}
                        >
                          Edit
                        </button>
                        <button
                          className="danger"
                          disabled={busy || !access.can_delete}
                          title={
                            !access.can_delete
                              ? "Your Admin has restricted deletion"
                              : undefined
                          }
                          onClick={() => setDeleting(p)}
                        >
                          Delete
                        </button>
                        {!isSold(p) ? (
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              act(
                                () =>
                                  rpc("lager_transition_phone", {
                                    phone_id: String(p.id),
                                    new_status: "Sold",
                                  }),
                                tab === "samer"
                                  ? "Samer phone marked Sold."
                                  : "Phone moved to Sold Phones.",
                              )
                            }
                          >
                            Mark Sold
                          </button>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() =>
                              act(
                                () =>
                                  rpc("lager_transition_phone", {
                                    phone_id: String(p.id),
                                    new_status: "In Stock",
                                  }),
                                tab === "samer"
                                  ? "Samer phone returned to Available."
                                  : "Phone returned to stock; sale history preserved.",
                              )
                            }
                          >
                            {tab === "samer"
                              ? "Return to Available"
                              : "Return to Stock / Relist"}
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                {!filtered.length && (
                  <p className="empty">
                    {search
                      ? "No phones match your search."
                      : `No ${tab} phones yet.`}
                  </p>
                )}
              </section>
            )}
            {tab === "market" && (
              <section className="panel market-panel">
                <h2>Market Prices</h2>
                <p>
                  Compare matching model, storage and condition. These are
                  recorded listing prices, not guaranteed sales.
                </p>
                <p className="notice">
                  <strong>Multi-source purchase-price comparison.</strong>{" "}
                  Use live sources when available and compare direct Swedish trade-in quotes from Apple and Elgiganten. Trade-in values are kept separate from resale listings.
                </p>
                <div className="calculator market-live">
                  <div className="calculator-heading"><span className="market-dot" /><div><span className="section-kicker">Live intelligence</span><h3>Live market check</h3></div></div>
                  <p>Tradera auction bids and starting prices are ignored. Fixed-price listings are used, and when an auction also has Buy Now, the Buy Now price is used.</p>
                  <div className="grid">
                    <Field
                      label="Model"
                      value={marketForm.model}
                      placeholder="e.g. iPhone 16 Pro Max"
                      onChange={(v) => setMarketForm({ ...marketForm, model: v })}
                    />
                    <Field
                      label="Storage (GB)"
                      type="number"
                      min="1"
                      value={marketForm.storage_gb}
                      onChange={(v) => setMarketForm({ ...marketForm, storage_gb: v })}
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={checkingMarket || !marketForm.model.trim()}
                      onClick={async () => {
                        setCheckingMarket(true);
                        setError("");
                        try {
                          const params = new URLSearchParams({
                            model: marketForm.model.trim(),
                            storage: String(marketForm.storage_gb || "")
                          });
                          const response = await fetch("/api/market/compare?" + params.toString(), { cache: "no-store" });
                          const body = await response.json();
                          if (!response.ok) throw new Error(body?.error || "Market comparison failed.");
                          setLiveMarket(body);
                          const summary = body.market_summary;
                          if (summary?.typical_price) {
                            const snapshot = {
                              id: Date.now(),
                              model: marketForm.model.trim(),
                              storage_gb: Number(marketForm.storage_gb || 0),
                              price: Number(summary.typical_price),
                              min: Number(summary.min_price || summary.typical_price),
                              max: Number(summary.max_price || summary.typical_price),
                              sample_count: Number(summary.sample_count || body.listings?.length || 0),
                              confidence:
                                (body.sources || []).find((s) => s.source === "Tradera")?.confidence ||
                                "unknown",
                              at: new Date().toISOString(),
                            };
                            persistPriceHistory([...priceHistory, snapshot]);
                            rpc("lager_add_market", {
                              payload: {
                                model: snapshot.model,
                                storage_gb: snapshot.storage_gb,
                                condition: marketForm.condition || "Good",
                                source: "Tradera",
                                market_price: snapshot.price,
                                listing_url: "https://www.tradera.com/category/340186",
                              },
                            }).catch(() => {});
                          }
                          if (!body.listings?.length && !body.trade_in_offers?.length) {
                            const statuses = (body.sources || []).map((s) => s.source + ": " + s.status).join(" · ");
                            setNotice("Live prices are not available from the connected sources yet. You can still open the direct trade-in calculators. " + statuses);
                          } else {
                            setNotice("Market check completed.");
                          }
                        } catch (e) {
                          setLiveMarket(null);
                          setError(e.message);
                        } finally {
                          setCheckingMarket(false);
                        }
                      }}
                    >
                      {checkingMarket ? "Checking…" : "Check Live Market"}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={!marketForm.model.trim()}
                      onClick={() => {
                        const q = encodeURIComponent([marketForm.model.trim(), marketForm.storage_gb ? marketForm.storage_gb + "GB" : ""].filter(Boolean).join(" "));
                        window.open("https://www.blocket.se/nybegagnat/mobil?query=" + q, "_blank", "noopener,noreferrer");
                      }}
                    >
                      Check Blocket Nybegagnat
                    </button>
                    <button
                      type="button"
                      disabled={!marketForm.model.trim()}
                      onClick={() => window.open("https://www.apple.com/se/shop/trade-in", "_blank", "noopener,noreferrer")}
                    >
                      Apple Trade In
                    </button>
                    <button
                      type="button"
                      disabled={!marketForm.model.trim()}
                      onClick={() => window.open("https://www.elgiganten.se/tjanster-tillbehor/tjanster/trade-in", "_blank", "noopener,noreferrer")}
                    >
                      Elgiganten Trade-In
                    </button>
                  </div>
                  {liveMarket && (() => {
                    const values = liveMarket.listings
                      .map((item) => Number(item.price))
                      .filter((n) => Number.isFinite(n) && n > 0)
                      .sort((a, b) => a - b);
                    if (!values.length)
                      return <p>No usable fixed-price listings were returned.</p>;
                    const medianOf = (arr) =>
                      arr.length % 2
                        ? arr[Math.floor(arr.length / 2)]
                        : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2;
                    let clean = values;
                    if (values.length >= 4) {
                      const lower = values.slice(0, Math.floor(values.length / 2));
                      const upper = values.slice(Math.ceil(values.length / 2));
                      const q1 = medianOf(lower), q3 = medianOf(upper), iqr = q3 - q1;
                      clean = values.filter((n) => n >= q1 - 1.5 * iqr && n <= q3 + 1.5 * iqr);
                    }
                    const summary = liveMarket.market_summary;
                    const typical = Number(summary?.typical_price) || medianOf(clean);
                    const marketMin = Number(summary?.min_price) || Math.min(...clean);
                    const marketMax = Number(summary?.max_price) || Math.max(...clean);
                    const removedOutliers = Number(summary?.excluded_outliers ?? (values.length - clean.length));
                    const traderaMeta = (liveMarket.sources || []).find((s) => s.source === "Tradera");
                    const excludedAuctions = Number(traderaMeta?.excluded_auctions || 0);
                    const excludedProblems = Number(traderaMeta?.excluded_problem_listings || 0);
                    const confidence = traderaMeta?.confidence || (clean.length >= 5 ? "high" : clean.length >= 3 ? "medium" : "low");
                    const recommended = typical * Number(percentage || 0) / 100;
                    const expected = typical - recommended - Number(expenses || 0);
                    return (
                      <>
                        <p>
                          <strong>{liveMarket.listings.length}</strong> live listings found from {(liveMarket.sources || []).filter((s) => s.count > 0).map((s) => s.source + " (" + s.count + ")").join(" + ") || "configured sources"} ·
                          {excludedAuctions > 0 ? ` ${excludedAuctions} auction price(s) ignored ·` : ""}
                          {excludedProblems > 0 ? ` ${excludedProblems} repair/damaged listing(s) ignored ·` : ""}
                          {removedOutliers > 0 ? ` ${removedOutliers} unusual fixed price(s) excluded ·` : ""}
                          {" "}Confidence: <strong>{confidence}</strong> · checked {new Date(liveMarket.checked_at).toLocaleTimeString()}.
                        </p>
                        <div className="cards">
                          <Card title="Live Typical Price" value={money(typical)} detail={"Fixed-price / Buy Now only · " + confidence + " confidence"} />
                          <Card title="Live Market Range" value={`${money(marketMin)} / ${money(marketMax)}`} detail="Fixed-price range after filtering" />
                          {financial && <>
                            <Card title="Max Buy Price" value={money(recommended)} detail={`${percentage || 0}% of typical price`} />
                            <Card title="Expected Profit" value={money(expected)} detail="After estimated costs" />
                          </>}
                        </div>
                      </>
                    );
                  })()}
                </div>
                <SuggestedPricePanel
                  recommendations={recommendations}
                  confidence={(liveMarket?.sources || []).find((s) => s.source === "Tradera")?.confidence}
                />
                <SmartBuyPanel
                  analysis={smartBuy}
                  dealPrice={dealPrice}
                  setDealPrice={setDealPrice}
                  dealBattery={dealBattery}
                  setDealBattery={setDealBattery}
                  expenses={expenses}
                  setExpenses={setExpenses}
                />
                <PriceHistoryPanel
                  points={historyPoints}
                  range={historyRange}
                  setRange={setHistoryRange}
                />
                <div className="calculator">
                  <h3>Competitor Buy Offers</h3>
                  <p>
                    Record direct trade-in / purchase quotes separately from resale listings.
                    This makes it easy to see what competitors would pay the customer and how much room you have to beat their offer.
                  </p>
                  {(() => {
                    const buySources = new Set(["Apple Trade In", "Elgiganten Trade-In", "PhoneHero"]);
                    const autoOffers = (liveMarket?.trade_in_offers || []).filter((r) => Number(r.price) > 0);
                    const offers = market.filter((r) =>
                      buySources.has(r.source) &&
                      String(r.model || "").toLowerCase() === String(marketForm.model || "").toLowerCase() &&
                      String(r.storage_gb || "") === String(marketForm.storage_gb || "")
                    );
                    const values = [...offers.map((r) => Number(r.market_price)), ...autoOffers.map((r) => Number(r.price))].filter((n) => Number.isFinite(n) && n > 0);
                    const best = values.length ? Math.max(...values) : null;
                    const resale = liveMarket?.listings?.map((x) => Number(x.price)).filter((n) => Number.isFinite(n) && n > 0).sort((a,b) => a-b) || [];
                    const resaleTypical = resale.length ? (resale.length % 2 ? resale[Math.floor(resale.length/2)] : (resale[resale.length/2-1]+resale[resale.length/2])/2) : null;
                    const beatOffer = best == null ? null : Math.ceil((best + 100) / 50) * 50;
                    const projected = resaleTypical == null || beatOffer == null ? null : resaleTypical - beatOffer - Number(expenses || 0);
                    return (
                      <>
                        <div className="cards">
                          <Card title="Best Competitor Offer" value={best == null ? "—" : money(best)} detail={values.length ? values.length + " recorded direct offer(s)" : "Add Apple / Elgiganten / PhoneHero quotes below"} />
                          {financial && <Card title="Suggested Customer Offer" value={beatOffer == null ? "—" : money(beatOffer)} detail={beatOffer == null ? "Waiting for competitor quote" : "Competitor best + at least 100 SEK"} />}
                          <Card title="Resale Reference" value={resaleTypical == null ? "—" : money(resaleTypical)} detail="Live listing median; kept separate from trade-in offers" />
                          {financial && <Card title="Projected Profit" value={projected == null ? "—" : money(projected)} detail="Resale reference − customer offer − costs" />}
                        </div>
                        {(liveMarket?.trade_in_links || []).length > 0 && (
                          <div className="actions">
                            {(liveMarket.trade_in_links || []).map((o) => (
                              <button key={o.source} type="button" onClick={() => window.open(o.url, "_blank", "noopener,noreferrer")}>
                                Open {o.source} calculator
                              </button>
                            ))}
                          </div>
                        )}
                        {autoOffers.length > 0 && (
                          <div className="table">
                            <table>
                              <thead><tr><th>Live Source</th><th>Offer</th><th>Updated</th><th>Link</th></tr></thead>
                              <tbody>{autoOffers.map((o, i) => <tr key={"auto-"+i}><td>{o.source}</td><td>{money(o.price)}</td><td>{o.updated || "Live"}</td><td>{o.url ? <a href={o.url} target="_blank" rel="noopener noreferrer">Open</a> : "—"}</td></tr>)}</tbody>
                            </table>
                          </div>
                        )}
                        {offers.length > 0 && (
                          <div className="table">
                            <table>
                              <thead><tr><th>Source</th><th>Offer</th><th>Model</th><th>Storage</th></tr></thead>
                              <tbody>{offers.map((o, i) => <tr key={o.id ?? i}><td>{o.source}</td><td>{money(o.market_price)}</td><td>{o.model}</td><td>{o.storage_gb} GB</td></tr>)}</tbody>
                            </table>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                {financial && (
                  <div className="calculator">
                    <h3>Buying guide</h3>
                    <div className="grid">
                      <Field
                        label="Maximum buy price (% of typical market price)"
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={percentage}
                        onChange={(v) => {
                          if (
                            v === "" ||
                            (Number(v) >= 0 && Number(v) <= 100)
                          ) {
                            setPercentage(v);
                            localStorage.setItem("lager-buy-percentage", v);
                          }
                        }}
                      />
                      <Field
                        label="Estimated repair and other costs (SEK)"
                        type="number"
                        min="0"
                        step="0.01"
                        value={expenses}
                        onChange={(v) => {
                          if (Number(v) >= 0) setExpenses(v);
                        }}
                      />
                    </div>
                    <p>
                      Recommended buy price = typical market price × {percentage || 0}%.
                      Expected profit = typical market price − recommended buy
                      price − estimated costs. Unusual listing prices are
                      filtered automatically. The percentage is saved on this
                      device.
                    </p>
                  </div>
                )}
                {stats ? (
                  <>
                    <p>
                      {stats.count} reliable matching records for the model, storage and
                      condition selected above.
                      {stats.removedOutliers > 0
                        ? ` ${stats.removedOutliers} unusual price${stats.removedOutliers === 1 ? "" : "s"} excluded automatically.`
                        : ""}
                    </p>
                    <div className="cards">
                      <Card
                        title="Typical Market Price"
                        value={money(stats.median ?? stats.average)}
                        detail="Median of reliable matching listings"
                      />
                      <Card
                        title="Market Range"
                        value={`${money(stats.min)} / ${money(stats.max)}`}
                        detail="Low / high after outlier filtering"
                      />
                      {financial && (
                        <>
                          <Card
                            title="Recommended Buy Price"
                            value={money(stats.buy)}
                          />
                          <Card
                            title="Expected Profit"
                            value={money(stats.expected)}
                          />
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="empty">
                    Enter a model and select storage and condition to see
                    matching prices.
                  </p>
                )}
                <div className="table">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "Model",
                          "Storage",
                          "Condition",
                          "Source",
                          "Market Price",
                          "Listing",
                        ].map((t) => (
                          <th key={t}>{t}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {market.map((r, i) => (
                        <tr key={r.id ?? i}>
                          <td>{r.model}</td>
                          <td>{r.storage_gb} GB</td>
                          <td>{r.condition}</td>
                          <td>{r.source}</td>
                          <td>{money(r.market_price)}</td>
                          <td>
                            {/^https?:\/\//i.test(r.listing_url || "") ? (
                              <a
                                href={r.listing_url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                View listing
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {tab === "insights" && financial && (
              <InsightsPanel insights={insights} onDeal={openDealCalculator} />
            )}
            {tab === "ads" && (
              <AdCenterPanel
                records={adRecords}
                onReopen={(record) => {
                  const phone =
                    phones.find((p) => String(p.id) === String(record.phoneId)) || {
                      id: record.phoneId,
                      model: record.model,
                      storage_gb: record.storage_gb,
                    };
                  openAdBuilder(phone, record.platform, record.text);
                }}
                onStatus={updateAdRecordStatus}
                onDelete={deleteAdRecord}
              />
            )}
            {tab === "operations" && (
              <OperationsCenter
                phones={phones}
                initialPhoneId={operationsTargetId}
                onInitialPhoneOpened={() => setOperationsTargetId(null)}
                saleHistory={saleHistory}
                financial={financial}
                adRecords={adRecords}
                priceHistory={priceHistory}
                onCreatePhone={async (form) => {
                  await rpc("lager_save_phone", {
                    phone_id: null,
                    payload: payload(form, financial),
                  });
                  await load();
                }}
                onSavePhone={async (phone, changes) => {
                  await rpc("lager_save_phone", {
                    phone_id: String(phone.id),
                    payload: changes,
                  });
                  await load();
                }}
                onTransition={async (phone, newStatus) => {
                  await rpc("lager_transition_phone", {
                    phone_id: String(phone.id),
                    new_status: newStatus,
                  });
                  await load();
                }}
                onCompleteSale={async (phone, saleMeta) => {
                  await rpc("lager_complete_sale", {
                    phone_id: String(phone.id),
                    sale_meta: saleMeta,
                  });
                  await load();
                }}
                onOpenAd={(phone, photos) => openAdBuilder(phone, "Facebook", "", photos)}
                onPhotoCountChange={(phoneId, count) =>
                  setPhotoCounts((current) => ({ ...current, [String(phoneId)]: count }))
                }
                onOpenDeal={openDealCalculator}
                onReplaceAdRecords={persistAdRecords}
                onReplacePriceHistory={persistPriceHistory}
                setNotice={setNotice}
                setError={setError}
              />
            )}
            {tab === "team" && access.role === "admin" && (
              <section className="panel">
                <h2>Team Permissions</h2>
                <p>
                  Invite a new user or update an existing user by email.
                  Invitations are sent by the secure server endpoint; Admins
                  always have full access.
                </p>
                <form
                  className="grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(async () => {
                      const {
                        data: { session },
                      } = await supabase.auth.getSession();
                      const response = await fetch("/api/team/invite", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${session?.access_token || ""}`,
                        },
                        body: JSON.stringify(member),
                      });
                      const result = await response.json();
                      if (!response.ok)
                        throw new Error(result.error || "Invitation failed");
                      setMembers(await rpc("lager_members"));
                    }, "Permissions updated.");
                  }}
                >
                  <Field
                    label="User email"
                    type="email"
                    required
                    value={member.email}
                    onChange={(v) => setMember({ ...member, email: v })}
                  />
                  <Select
                    label="Role"
                    options={["employee", "admin"]}
                    value={member.role}
                    onChange={(v) => setMember({ ...member, role: v })}
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={
                        member.role === "admin" || member.can_view_financials
                      }
                      disabled={member.role === "admin"}
                      onChange={(e) =>
                        setMember({
                          ...member,
                          can_view_financials: e.target.checked,
                        })
                      }
                    />{" "}
                    View and edit financial fields
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={member.role === "admin" || member.can_delete}
                      disabled={member.role === "admin"}
                      onChange={(e) =>
                        setMember({ ...member, can_delete: e.target.checked })
                      }
                    />{" "}
                    Delete phones
                  </label>
                  <button disabled={busy} className="primary">
                    Invite / Save Permissions
                  </button>
                </form>
                {members.map((m) => (
                  <div className="member" key={m.user_id}>
                    <span>
                      {m.email} · {m.role} · Financial access:{" "}
                      {m.can_view_financials ? "Yes" : "No"} · Delete:{" "}
                      {m.can_delete ? "Yes" : "No"}
                    </span>
                    <button onClick={() => setMember(m)}>
                      Edit Permissions
                    </button>
                  </div>
                ))}
              </section>
            )}
          </>
        )
      )}
      {editor && (
        <Modal
          title={editor.id ? "Edit Phone" : "Add Phone"}
          onClose={() => !busy && setEditor(null)}
          error={error}
        >
          <form
            className="grid"
            onSubmit={(e) => {
              e.preventDefault();
              act(
                async () => {
                  const changes = editor.original
                    ? editPayload(editor.form, editor.original, financial)
                    : payload(editor.form, financial);
                  if (Object.keys(changes).length)
                    await rpc("lager_save_phone", {
                      phone_id: editor.id == null ? null : String(editor.id),
                      payload: changes,
                    });
                  setEditor(null);
                },
                editor.id ? "Phone updated." : "Phone added.",
              );
            }}
          >
            {columns
              .filter(
                ([k]) =>
                  !["profit", "notes"].includes(k) &&
                  (financial || !sensitive.includes(k)),
              )
              .map(([k, label]) =>
                ["condition", "status"].includes(k) ? (
                  <Select
                    key={k}
                    label={label}
                    options={k === "condition" ? conditions : statuses}
                    value={editor.form[k]}
                    onChange={(v) =>
                      setEditor({ ...editor, form: { ...editor.form, [k]: v } })
                    }
                  />
                ) : (
                  <Field
                    key={k}
                    label={
                      label +
                      (k === "storage_gb"
                        ? " (GB)"
                        : k.endsWith("price") || k.endsWith("cost")
                          ? " (SEK)"
                          : "")
                    }
                    value={editor.form[k]}
                    required={["model", "storage_gb"].includes(k)}
                    type={
                      k === "purchase_date"
                        ? "date"
                        : [
                              "storage_gb",
                              "battery_health",
                              "purchase_price",
                              "repair_cost",
                              "other_cost",
                              "selling_price",
                            ].includes(k)
                          ? "number"
                          : "text"
                    }
                    min={k === "storage_gb" ? 1 : 0}
                    max={k === "battery_health" ? 100 : undefined}
                    step={
                      k.endsWith("price") || k.endsWith("cost") ? "0.01" : "1"
                    }
                    inputMode={k === "imei" ? "numeric" : undefined}
                    pattern={
                      k === "imei" && editor.form.imei !== editor.original?.imei
                        ? "[0-9]{15}"
                        : undefined
                    }
                    title={
                      k === "imei"
                        ? "IMEI must contain 15 digits, or leave blank"
                        : undefined
                    }
                    onChange={(v) =>
                      setEditor({ ...editor, form: { ...editor.form, [k]: v } })
                    }
                  />
                ),
              )}
            <label className="wide">
              <span>Notes</span>
              <textarea
                rows="3"
                value={editor.form.notes}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    form: { ...editor.form, notes: e.target.value },
                  })
                }
              />
            </label>
            <div className="actions wide">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save Phone"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {photoViewer && (
        <Modal
          title={`Photos · ${photoViewer.phone.model}`}
          onClose={() => setPhotoViewer(null)}
          error=""
        >
          <div className="ad-builder">
            <p>{photoViewer.photos.length} saved photo(s) for this phone.</p>
            <div className="ad-photo-strip photo-viewer-grid">
              {photoViewer.photos.map((photo) => (
                <button
                  type="button"
                  key={photo.id}
                  title="Open photo"
                  onClick={() => window.open(photo.dataUrl, "_blank", "noopener,noreferrer")}
                >
                  <img src={photo.dataUrl} alt={photoViewer.phone.model + " photo"} />
                </button>
              ))}
            </div>
            <div className="actions">
              <button type="button" onClick={() => setPhotoViewer(null)}>Close</button>
              {!isSold(photoViewer.phone) && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const viewer = photoViewer;
                    setPhotoViewer(null);
                    openAdBuilder(viewer.phone, "Facebook", "", viewer.photos);
                  }}
                >
                  Create Ad With Photos
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
      {adBuilder && (
        <Modal
          title={`Create Ad · ${adBuilder.phone.model}`}
          onClose={() => setAdBuilder(null)}
          error=""
        >
          <div className="ad-builder">
            <p>
              Choose a marketplace. The Swedish ad text is generated from the phone data and can be edited before copying.
            </p>
            <div className="ad-platforms" role="group" aria-label="Marketplace">
              {["Facebook", "Blocket", "Tradera", "TikTok"].map((platform) => (
                <button
                  type="button"
                  key={platform}
                  className={adBuilder.platform === platform ? "active" : ""}
                  onClick={() =>
                    setAdBuilder({
                      ...adBuilder,
                      platform,
                      text: buildMarketplaceAd(adBuilder.phone, platform),
                    })
                  }
                >
                  {platform}
                </button>
              ))}
            </div>
            <label className="wide ad-copy-field">
              <span>Ad text</span>
              <textarea
                rows="15"
                value={adBuilder.text}
                onChange={(e) =>
                  setAdBuilder({ ...adBuilder, text: e.target.value })
                }
              />
            </label>
            <div className="ad-builder-meta">
              <span>{adBuilder.platform}</span>
              <span>{adBuilder.text.length} characters</span>
              <span>{adBuilder.photos?.length || 0} photo(s)</span>
            </div>
            {(adBuilder.photos?.length || 0) > 0 && (
              <div className="ad-photo-strip">
                {adBuilder.photos.map((photo) => (
                  <button
                    type="button"
                    key={photo.id}
                    title="Open photo"
                    onClick={() => window.open(photo.dataUrl, "_blank", "noopener,noreferrer")}
                  >
                    <img src={photo.dataUrl} alt={adBuilder.phone.model + " ad photo"} />
                  </button>
                ))}
              </div>
            )}
            <div className="actions ad-builder-actions">
              <button type="button" onClick={() => setAdBuilder(null)}>
                Close
              </button>
              <button type="button" onClick={() => saveAdRecord("Draft")}>
                Save Draft
              </button>
              <button type="button" onClick={publishAdToPlatform}>
                Open {adBuilder.platform} + Mark Published
              </button>
              {(adBuilder.photos?.length || 0) > 0 && (
                <button type="button" onClick={shareAdWithPhotos}>
                  Share Ad + Photos
                </button>
              )}
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(adBuilder.text);
                    setNotice(adBuilder.platform + " ad copied.");
                  } catch {
                    window.prompt("Copy your ad:", adBuilder.text);
                  }
                }}
              >
                Copy Ad
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dealCalculator && (
        <Modal
          title={`Deal Calculator · ${dealCalculator.phone.model}`}
          onClose={() => setDealCalculator(null)}
          error=""
        >
          <DealCalculatorContent state={dealCalculator} />
        </Modal>
      )}
      {details && (() => {
        const timeline = buildPhoneTimeline(details, saleHistory, adRecords);
        const statusIndex = controlStatusIndex(details.status);
        const totalCost = cost(details);
        const expectedProfit = profit(details);
        const margin =
          Number(details.selling_price || 0) > 0
            ? Math.round((expectedProfit / Number(details.selling_price || 0)) * 100)
            : 0;
        const matchingSales = saleHistory.filter(
          (sale) => String(sale.phone_id ?? sale.phoneId ?? "") === String(details.id),
        );
        const latestSale = matchingSales.find((sale) => !sale.returned_at) || matchingSales[0];
        const photos = controlPhotos || [];

        return (
          <Modal
            title="Phone Control Center"
            className="control-center-dialog"
            onClose={() => {
              setDetails(null);
              setControlPhotos([]);
            }}
            error=""
          >
            <div className="phone-control-center">
              <section className="control-hero">
                <button
                  type="button"
                  className="control-photo-hero"
                  disabled={controlLoading || !photos.length}
                  onClick={() =>
                    photos.length && setPhotoViewer({ phone: details, photos })
                  }
                  aria-label={photos.length ? "Open phone photos" : "No phone photos"}
                >
                  {controlLoading ? (
                    <span className="control-photo-placeholder">Loading photos…</span>
                  ) : photos[0] ? (
                    <img src={photos[0].dataUrl} alt={details.model + " photo"} />
                  ) : (
                    <span className="control-photo-placeholder">
                      <strong>📱</strong>
                      No photo
                    </span>
                  )}
                  {photos.length > 0 && (
                    <span className="control-photo-count">📷 {photos.length}</span>
                  )}
                </button>

                <div className="control-hero-copy">
                  <div className="control-eyebrow">DEVICE WORKSPACE</div>
                  <div className="control-title-row">
                    <div>
                      <h2>{details.model}</h2>
                      <p>
                        {[details.storage_gb ? details.storage_gb + " GB" : "", details.color, details.grade ? "Grade " + details.grade : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className={"control-status " + String(details.status || "in-stock").toLowerCase().replace(/\s+/g, "-")}>
                      {details.status || "In Stock"}
                    </span>
                  </div>

                  <div className="control-identifiers">
                    <div>
                      <span>IMEI</span>
                      <strong>{details.imei || "Not recorded"}</strong>
                    </div>
                    <div>
                      <span>Battery</span>
                      <strong>
                        {details.battery_health == null ? "—" : details.battery_health + "%"}
                      </strong>
                    </div>
                    <div>
                      <span>Condition</span>
                      <strong>{details.condition || "—"}</strong>
                    </div>
                  </div>

                  <div className="control-actions">
                    <button
                      className="primary"
                      onClick={() => {
                        setEditor(phoneEditorState(details));
                        setDetails(null);
                      }}
                    >
                      Edit Phone
                    </button>
                    {!isSold(details) && (
                      <button
                        className="ad-button"
                        onClick={() => {
                          openAdBuilder(details, "Facebook", "", photos);
                          setDetails(null);
                        }}
                      >
                        Create Ad
                      </button>
                    )}
                    {photos.length > 0 && (
                      <button
                        className="photo-button"
                        onClick={() => setPhotoViewer({ phone: details, photos })}
                      >
                        Open Photos
                      </button>
                    )}
                    {financial && !isSold(details) && (
                      <button
                        className="deal-button"
                        onClick={() => {
                          openDealCalculator(details);
                          setDetails(null);
                        }}
                      >
                        Market & Deal
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        if (details.imei) {
                          try {
                            await navigator.clipboard.writeText(details.imei);
                            setNotice("IMEI copied.");
                          } catch {}
                        }
                      }}
                      disabled={!details.imei}
                    >
                      Copy IMEI
                    </button>
                    <button
                      onClick={() => {
                        setOperationsTargetId(String(details.id));
                        setDetails(null);
                        setTab("operations");
                      }}
                    >
                      Operations
                    </button>
                  </div>
                </div>
              </section>

              <section className="control-stage-card">
                <div className="control-section-heading">
                  <div>
                    <span>WORKFLOW</span>
                    <h3>Phone status</h3>
                  </div>
                  <small>Current · {details.status || "In Stock"}</small>
                </div>
                <div className="control-stage-track">
                  {["In Stock", "Repairing", "Listed", "Sold"].map((stage, index) => (
                    <div
                      key={stage}
                      className={
                        "control-stage " +
                        (index < statusIndex ? "done" : index === statusIndex ? "active" : "")
                      }
                    >
                      <span>{index < statusIndex ? "✓" : index + 1}</span>
                      <strong>{stage}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <div className={"control-main-grid" + (financial ? "" : " no-financial")}>
                <section className="control-card">
                  <div className="control-section-heading">
                    <div>
                      <span>DEVICE</span>
                      <h3>Phone information</h3>
                    </div>
                  </div>
                  <dl className="control-detail-grid">
                    <Detail label="Model" value={details.model} />
                    <Detail label="Storage" value={details.storage_gb ? details.storage_gb + " GB" : "—"} />
                    <Detail label="Color" value={details.color || "—"} />
                    <Detail label="Grade" value={details.grade || "—"} />
                    <Detail label="Purchase source" value={details.purchase_source || "—"} />
                    <Detail label="Purchase date" value={controlDate(details.purchase_date)} />
                    <Detail label="Added" value={controlDate(details.created_at)} />
                    <Detail label="Last updated" value={controlDate(details.updated_at)} />
                  </dl>
                  {details.notes && (
                    <div className="control-notes">
                      <span>NOTES</span>
                      <p>{details.notes}</p>
                    </div>
                  )}
                </section>

                {financial && (
                  <section className="control-card control-finance-card">
                    <div className="control-section-heading">
                      <div>
                        <span>PROFIT</span>
                        <h3>Financial overview</h3>
                      </div>
                      <strong className={expectedProfit >= 0 ? "positive" : "negative"}>
                        {money(expectedProfit)}
                      </strong>
                    </div>
                    <div className="control-kpi-grid">
                      <div>
                        <span>Total cost</span>
                        <strong>{money(totalCost)}</strong>
                      </div>
                      <div>
                        <span>Selling price</span>
                        <strong>{money(details.selling_price)}</strong>
                      </div>
                      <div>
                        <span>Expected profit</span>
                        <strong>{money(expectedProfit)}</strong>
                      </div>
                      <div>
                        <span>Margin</span>
                        <strong>{margin}%</strong>
                      </div>
                    </div>
                    <div className="control-cost-breakdown">
                      <div><span>Purchase</span><strong>{money(details.purchase_price)}</strong></div>
                      <div><span>Repair</span><strong>{money(details.repair_cost)}</strong></div>
                      <div><span>Other</span><strong>{money(details.other_cost)}</strong></div>
                    </div>
                    {latestSale && (
                      <p className="control-sale-note">
                        Latest sale · {money(latestSale.selling_price)} · {controlDate(latestSale.sold_at)}
                      </p>
                    )}
                  </section>
                )}

                <section className="control-card control-photo-card">
                  <div className="control-section-heading">
                    <div>
                      <span>MEDIA</span>
                      <h3>Phone photos</h3>
                    </div>
                    <small>{controlLoading ? "Loading…" : photos.length + " saved"}</small>
                  </div>
                  {photos.length ? (
                    <div className="control-photo-grid">
                      {photos.slice(0, 6).map((photo, index) => (
                        <button
                          type="button"
                          key={photo.id || photo.storagePath || index}
                          onClick={() => setPhotoViewer({ phone: details, photos })}
                          aria-label={"Open phone photo " + (index + 1)}
                        >
                          <img src={photo.dataUrl} alt={details.model + " photo " + (index + 1)} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="control-empty-state">
                      <strong>{controlLoading ? "Checking photos…" : "No photos saved"}</strong>
                      <span>Use Operations to add device photos.</span>
                    </div>
                  )}
                </section>

                <section className="control-card control-timeline-card">
                  <div className="control-section-heading">
                    <div>
                      <span>HISTORY</span>
                      <h3>Device timeline</h3>
                    </div>
                    <small>{timeline.length} events</small>
                  </div>
                  {timeline.length ? (
                    <div className="control-timeline">
                      {timeline.map((event, index) => (
                        <div className={"control-timeline-row " + event.tone} key={event.at + event.title + index}>
                          <span className="control-timeline-dot" />
                          <div>
                            <strong>{event.title}</strong>
                            <p>{event.detail}</p>
                          </div>
                          <time>{controlDate(event.at, true)}</time>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="control-empty-state">
                      <strong>No activity yet</strong>
                      <span>Changes, ads and sales will appear here.</span>
                    </div>
                  )}
                </section>
              </div>
            </div>
          </Modal>
        );
      })()}
      {deleting && (
        <Modal
          title="Delete phone?"
          error={error}
          onClose={() => !busy && setDeleting(null)}
        >
          <p>
            Permanently delete {deleting.model} (
            {deleting.imei || `${deleting.storage_gb} GB`}) and its financial
            record? This cannot be undone.
          </p>
          <div className="actions">
            <button disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await rpc("lager_delete_phone", {
                    phone_id: String(deleting.id),
                  });
                  setDeleting(null);
                }, "Phone deleted.")
              }
            >
              Delete Phone
            </button>
          </div>
        </Modal>
      )}
      {importing && (
        <Modal
          title="Import Excel"
          onClose={() => !busy && setImporting(false)}
          error={error}
        >
          <p><strong>{importRows.length}</strong> phones found. Review before adding them to inventory.</p>
          <div className="table">
            <table>
              <thead><tr><th>Model</th><th>Storage</th><th>Color</th><th>Grade</th><th>Battery</th><th>Purchase</th><th>Selling</th></tr></thead>
              <tbody>
                {importRows.slice(0, 100).map((p, i) => (
                  <tr key={i}>
                    <td>{p.model}</td><td>{p.storage_gb} GB</td><td>{p.color || "—"}</td>
                    <td>{p.grade || "—"}</td><td>{p.battery_health === "" ? "—" : p.battery_health + "%"}</td>
                    <td>{financial ? money(p.purchase_price) : "—"}</td><td>{money(p.selling_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {importRows.length > 100 && <p>Showing first 100 rows. All {importRows.length} will be imported.</p>}
          <div className="actions">
            <button disabled={busy} onClick={() => setImporting(false)}>Cancel</button>
            <button className="primary" disabled={busy || !importRows.length} onClick={importPhones}>
              {busy ? "Importing…" : "Import All"}
            </button>
          </div>
        </Modal>
      )}
      {exporting && (
        <Modal
          title="Export inventory"
          error={error}
          onClose={() => !busy && setExporting(false)}
        >
          <p>
            Export {filtered.length} phones from the current {tab} list,
            including your search filter. Choose the columns to share.
          </p>
          <div className="grid">
            {columns
              .filter(([k]) => financial || !sensitive.includes(k))
              .map(([k, label]) => (
                <label className="check" key={k}>
                  <input
                    type="checkbox"
                    checked={selected.includes(k)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, k]
                          : selected.filter((x) => x !== k),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
          </div>
          <p>Purchase price, costs and profit are unchecked by default.</p>
          <Select
            label="File format"
            options={["xlsx", "pdf"]}
            value={format}
            onChange={setFormat}
          />
          <div className="actions">
            <button disabled={busy} onClick={() => setExporting(false)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !selected.length}
              onClick={exportPhones}
            >
              {busy ? "Preparing…" : "Download Export"}
            </button>
          </div>
        </Modal>
      )}
      <footer>Lager iPhone · All prices in SEK</footer>
    </main>
  );
}
function Field({ label, onChange, ...props }) {
  return (
    <label>
      <span>{label}</span>
      <input {...props} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function Select({ label, options, value, onChange }) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!options.includes(value) && (
          <option value={value}>{value || "Select"}</option>
        )}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
function Card({ title, value, detail }) {
  return (
    <div className="card">
      <span>{title}</span>
      <strong>{value}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}
function Detail({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
function Modal({ title, onClose, children, error, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <div className="title">
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
