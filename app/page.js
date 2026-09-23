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
const conditions = ["Excellent", "Good", "Fair", "Damaged"],
  marketConditions = ["Used", "Renewed", "Refurbished", "New"],
  statuses = ["In Stock", "Repairing", "Listed", "Sold"],
  sources = ["Apple Trade In", "Elgiganten Trade-In", "Tradera", "Blocket", "Swappie", "Back Market", "PhoneHero", "Other"];
async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
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
    [liveMarket, setLiveMarket] = useState(null),
    [checkingMarket, setCheckingMarket] = useState(false),
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
    <main>
      <header>
        <div className="brand">
          <span className="brand-icon">Li</span>
          <div>
            <h1>Lager iPhone</h1>
            <p>Your inventory. A clearer overview.</p>
          </div>
        </div>
        <div className="actions">
          <span className="badge">{access?.role || "Connecting"}</span>
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
            <section className="cards">
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
                </>
              ) : (
                <Card
                  title="Access"
                  value="Employee"
                  detail="Financial information is restricted"
                />
              )}
            </section>
            <nav aria-label="Dashboard sections">
              {[
                ["available", "Available Phones"],
                ["sold", "Sold Phones"],
                ["samer", "Samer"],
                ["market", "Market Prices"],
                ...(access.role === "admin"
                  ? [["team", "Team Permissions"]]
                  : []),
              ].map(([key, label]) => (
                <button
                  aria-current={tab === key ? "page" : undefined}
                  className={tab === key ? "active" : ""}
                  key={key}
                  onClick={() => {
                    setTab(key);
                    if (key === "team")
                      rpc("lager_members")
                        .then(setMembers)
                        .catch((e) => setError(e.message));
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
            {["available", "sold", "samer"].includes(tab) && (
              <section className="panel">
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
                  <div className="actions">
                    <label className="import-button">
                      Import Excel
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
                      Export
                    </button>
                    <button
                      className="primary"
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
                      + Add Phone
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
                      onClick={() => setDetails(p)}
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
                        <button onClick={() => setDetails(p)}>View</button>
                        {!isSold(p) && (
                          <button
                            className="ad-button"
                            onClick={() => {
                              const title = [p.model, String(p.storage_gb) + "GB", p.color].filter(Boolean).join(" – ");
                              const lines = [
                                "📱 " + title,
                                "",
                                "Säljer en " + p.model + " med " + p.storage_gb + " GB lagring i " + (p.grade ? "Grade " + p.grade : (p.condition || "fint skick")) + ".",
                                "",
                                "✅ Fungerar som den ska",
                                p.battery_health != null ? "🔋 Batterihälsa: " + p.battery_health + "%" : "",
                                p.color ? "🎨 Färg: " + p.color : "",
                                "🔓 Olåst",
                                p.selling_price ? "💰 Pris: " + money(p.selling_price) : "",
                                "📦 Kan skickas med post eller hämtas enligt överenskommelse.",
                                "",
                                "📩 Skicka meddelande vid intresse."
                              ].filter(Boolean);
                              const ad = title + "\n\n" + lines.join("\n");
                              window.prompt("Your ad is ready — copy it:", ad);
                            }}
                          >
                            Create Ad
                          </button>
                        )}                        <button
                          disabled={busy}
                          onClick={() =>
                            setEditor({
                              id: p.id,
                              original: p,
                              form: {
                                ...Object.fromEntries(
                                  Object.keys(blank).map((k) => [
                                    k,
                                    p[k] ?? "",
                                  ]),
                                ),
                                inventory_scope:
                                  p.inventory_scope || "business",
                              },
                            })
                          }
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
              <section className="panel">
                <h2>Market Prices</h2>
                <p>
                  Compare matching model, storage and condition. These are
                  recorded listing prices, not guaranteed sales.
                </p>
                <p className="notice">
                  <strong>Multi-source purchase-price comparison.</strong>{" "}
                  Use live sources when available and compare direct Swedish trade-in quotes from Apple and Elgiganten. Trade-in values are kept separate from resale listings.
                </p>
                <div className="calculator">
                  <h3>Live market check</h3>
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
                          if (!body.listings?.length) {
                            const statuses = (body.sources || []).map((s) => s.source + ": " + s.status).join(" · ");
                            setNotice("No automated listing prices returned yet. Direct trade-in comparison is still available below. " + statuses);
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
                    const typical = medianOf(clean);
                    const recommended = typical * Number(percentage || 0) / 100;
                    const expected = typical - recommended - Number(expenses || 0);
                    return (
                      <>
                        <p>
                          <strong>{liveMarket.listings.length}</strong> live listings found from {(liveMarket.sources || []).filter((s) => s.count > 0).map((s) => s.source + " (" + s.count + ")").join(" + ") || "configured sources"} ·
                          {values.length - clean.length > 0 ? ` ${values.length - clean.length} unusual price(s) excluded ·` : ""}
                          {" "}checked {new Date(liveMarket.checked_at).toLocaleTimeString()}.
                        </p>
                        <div className="cards">
                          <Card title="Live Typical Price" value={money(typical)} detail="Median after outlier filtering" />
                          <Card title="Live Market Range" value={`${money(Math.min(...clean))} / ${money(Math.max(...clean))}`} detail="Range after outlier filtering" />
                          {financial && <>
                            <Card title="Max Buy Price" value={money(recommended)} detail={`${percentage || 0}% of typical price`} />
                            <Card title="Expected Profit" value={money(expected)} detail="After estimated costs" />
                          </>}
                        </div>
                      </>
                    );
                  })()}
                </div>
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
                <form
                  className="grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(async () => {
                      await rpc("lager_add_market", {
                        payload: {
                          ...marketForm,
                          storage_gb: Number(marketForm.storage_gb),
                          market_price: Number(marketForm.market_price),
                        },
                      });
                      setMarketForm({
                        ...marketForm,
                        market_price: "",
                        listing_url: "",
                      });
                    }, "Market price added.");
                  }}
                >
                  <Field
                    label="Model"
                    value={marketForm.model}
                    required
                    onChange={(v) => setMarketForm({ ...marketForm, model: v })}
                  />
                  <Field
                    label="Storage (GB)"
                    type="number"
                    min="1"
                    required
                    value={marketForm.storage_gb}
                    onChange={(v) =>
                      setMarketForm({ ...marketForm, storage_gb: v })
                    }
                  />
                  <Select
                    label="Condition"
                    options={conditions}
                    value={marketForm.condition}
                    onChange={(v) =>
                      setMarketForm({ ...marketForm, condition: v })
                    }
                  />
                  <Select
                    label="Source"
                    options={sources}
                    value={marketForm.source}
                    onChange={(v) =>
                      setMarketForm({ ...marketForm, source: v })
                    }
                  />
                  <Select
                    label="Market Type"
                    options={marketConditions}
                    value={marketForm.market_condition || "Used"}
                    onChange={(v) =>
                      setMarketForm({ ...marketForm, market_condition: v })
                    }
                  />
                  <Field
                    label="Market Price (SEK)"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={marketForm.market_price}
                    onChange={(v) =>
                      setMarketForm({ ...marketForm, market_price: v })
                    }
                  />
                  <Field
                    label="Listing URL"
                    type="url"
                    value={marketForm.listing_url}
                    onChange={(v) =>
                      setMarketForm({ ...marketForm, listing_url: v })
                    }
                  />
                  <button className="primary" disabled={busy}>
                    Add Market Price
                  </button>
                </form>
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
      {details && (
        <Modal
          title={`${details.model} details`}
          onClose={() => setDetails(null)}
          error=""
        >
          <dl className="detail-grid">
            <Detail label="Model" value={details.model} />
            <Detail label="Storage" value={`${details.storage_gb} GB`} />
            <Detail label="Color" value={details.color || "—"} />
            <Detail label="Grade" value={details.grade || "—"} />
            <Detail label="Condition" value={details.condition || "—"} />
            <Detail
              label="Battery Health"
              value={
                details.battery_health == null
                  ? "—"
                  : `${details.battery_health}%`
              }
            />
            <Detail label="IMEI" value={details.imei || "Not recorded"} />
            <Detail label="Status" value={details.status || "In Stock"} />
            <Detail
              label="Purchase Source"
              value={details.purchase_source || "—"}
            />
            <Detail
              label="Purchase Date"
              value={details.purchase_date || "—"}
            />
            <Detail
              label="Added"
              value={
                details.created_at
                  ? new Date(details.created_at).toLocaleDateString()
                  : "—"
              }
            />
            {financial && (
              <>
                <Detail
                  label="Purchase Price"
                  value={money(details.purchase_price)}
                />
                <Detail
                  label="Repair Cost"
                  value={money(details.repair_cost)}
                />
                <Detail label="Other Cost" value={money(details.other_cost)} />
                <Detail
                  label="Selling Price"
                  value={money(details.selling_price)}
                />
                <Detail label="Profit" value={money(profit(details))} />
              </>
            )}
          </dl>
          {details.notes && (
            <p className="notes">
              <strong>Notes</strong>
              <br />
              {details.notes}
            </p>
          )}
        </Modal>
      )}
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
function Modal({ title, onClose, children, error }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
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
