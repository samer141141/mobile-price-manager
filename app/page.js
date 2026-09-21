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
  statuses = ["In Stock", "Repairing", "Listed", "Sold"],
  sources = ["Tradera", "Blocket", "Swappie", "Back Market", "Other"];
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
    [editor, setEditor] = useState(null),
    [deleting, setDeleting] = useState(null),
    [exporting, setExporting] = useState(false),
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
  const available = phones.filter((p) => !isSold(p)),
    sold = phones.filter(isSold),
    filtered = phones.filter(
      (p) => (tab === "sold" ? isSold(p) : !isSold(p)) && matches(p, search),
    ),
    stats = marketStats(
      market,
      marketForm,
      Number(percentage),
      Number(expenses),
    );
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
                    title="Inventory Value"
                    value={money(available.reduce((n, p) => n + cost(p), 0))}
                  />
                  <Card
                    title="Realized Profit"
                    value={money(sold.reduce((n, p) => n + profit(p), 0))}
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
            {["available", "sold"].includes(tab) && (
              <section className="panel">
                <div className="title">
                  <div>
                    <h2>
                      {tab === "sold" ? "Sold Phones" : "Available Phones"}
                    </h2>
                    <p>
                      {filtered.length} phones
                      {search ? " matching your search" : ""}
                    </p>
                  </div>
                  <div className="actions">
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
                        setEditor({ id: null, form: { ...blank } })
                      }
                    >
                      + Add Phone
                    </button>
                  </div>
                </div>
                <Field
                  label="Search inventory"
                  type="search"
                  placeholder="Model, IMEI, storage, color, condition or status"
                  value={search}
                  onChange={setSearch}
                />
                <div className="phone-list">
                  {filtered.map((p) => (
                    <article className="phone" key={p.id}>
                      <div className="phone-title">
                        <div>
                          <h3>{p.model}</h3>
                          <p>
                            {p.storage_gb} GB · {p.color || "No color"} ·{" "}
                            {p.condition || "No condition"}
                          </p>
                        </div>
                        <span className={"badge " + (isSold(p) ? "sold" : "")}>
                          {p.status || "In Stock"}
                        </span>
                      </div>
                      <dl>
                        <Detail label="IMEI" value={p.imei || "Not recorded"} />
                        <Detail
                          label="Battery Health"
                          value={
                            p.battery_health == null
                              ? "Not recorded"
                              : `${p.battery_health}%`
                          }
                        />
                        <Detail
                          label="Selling Price"
                          value={money(p.selling_price)}
                        />
                        {financial && (
                          <>
                            <Detail
                              label="Purchase Price"
                              value={money(p.purchase_price)}
                            />
                            <Detail
                              label="Repair / Other Cost"
                              value={`${money(p.repair_cost)} / ${money(p.other_cost)}`}
                            />
                            <Detail label="Profit" value={money(profit(p))} />
                          </>
                        )}
                        <Detail
                          label="Purchase Source"
                          value={p.purchase_source || "—"}
                        />
                      </dl>
                      {p.notes && <p className="notes">{p.notes}</p>}
                      <div className="actions">
                        <button
                          disabled={busy}
                          onClick={() =>
                            setEditor({
                              id: p.id,
                              original: p,
                              form: Object.fromEntries(
                                Object.keys(blank).map((k) => [k, p[k] ?? ""]),
                              ),
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
                        {!isSold(p) && (
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              act(
                                () =>
                                  rpc("lager_save_phone", {
                                    phone_id: String(p.id),
                                    payload: { status: "Sold" },
                                  }),
                                "Phone moved to Sold Phones.",
                              )
                            }
                          >
                            Mark Sold
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
                        label="Buy price (% of average market price)"
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
                      Recommended buy price = average × {percentage || 0}%.
                      Expected profit = average − recommended buy price −
                      estimated costs. The percentage is saved on this device.
                    </p>
                  </div>
                )}
                {stats ? (
                  <>
                    <p>
                      {stats.count} matching records for the model, storage and
                      condition selected above.
                    </p>
                    <div className="cards">
                      <Card
                        title="Average Market Price"
                        value={money(stats.average)}
                      />
                      <Card
                        title="Minimum / Maximum"
                        value={`${money(stats.min)} / ${money(stats.max)}`}
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
                  Use an existing Supabase Auth user's email. New users need an
                  assignment before accessing inventory. Admins always have full
                  access.
                </p>
                <form
                  className="grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(async () => {
                      await rpc("lager_set_member", {
                        member_email: member.email,
                        member_role: member.role,
                        financial_access: member.can_view_financials,
                        delete_access: member.can_delete,
                      });
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
                    Save Permissions
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
                      [
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
