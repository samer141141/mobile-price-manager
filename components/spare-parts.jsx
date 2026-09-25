"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { money } from "../lib/inventory.mjs";

const partTypes = [
  "Screen",
  "Battery",
  "Back Glass",
  "Camera",
  "Charging Port",
  "Speaker",
  "Microphone",
  "Housing / Frame",
  "Flex Cable",
  "Face ID / Sensor",
  "Other",
];

const qualities = [
  "New",
  "Original / OEM",
  "Original Pull",
  "Aftermarket",
  "Used",
];

const blankPart = {
  device_model: "",
  part_type: "Screen",
  quality: "New",
  color: "",
  quantity: 1,
  unit_cost: 0,
  storage_location: "",
  supplier: "",
  notes: "",
};

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

function normalizePart(part) {
  return {
    ...blankPart,
    ...part,
    quantity: Number(part?.quantity ?? 1),
    unit_cost: Number(part?.unit_cost ?? 0),
  };
}

export default function SparePartsPanel({ access }) {
  const financial = !!access?.can_view_financials;
  const canDelete = !!access?.can_delete;
  const [parts, setParts] = useState([]);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({
    model: "",
    partType: "",
    quality: "",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await rpc("lager_parts");
      setParts(Array.isArray(rows) ? rows.map(normalizePart) : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return parts.filter((part) => {
      if (filters.model && part.device_model !== filters.model) return false;
      if (filters.partType && part.part_type !== filters.partType) return false;
      if (filters.quality && part.quality !== filters.quality) return false;

      if (!tokens.length) return true;
      const haystack = [
        part.device_model,
        part.part_type,
        part.quality,
        part.color,
        part.storage_location,
        part.supplier,
        part.notes,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ");
      return tokens.every((token) => haystack.includes(token));
    });
  }, [parts, query, filters]);

  const totalUnits = parts.reduce(
    (sum, part) => sum + Number(part.quantity || 0),
    0,
  );
  const stockValue = parts.reduce(
    (sum, part) =>
      sum + Number(part.quantity || 0) * Number(part.unit_cost || 0),
    0,
  );

  const modelOptions = useMemo(
    () => [...new Set(parts.map((part) => part.device_model).filter(Boolean))].sort(),
    [parts],
  );
  const typeOptions = useMemo(
    () => [...new Set(parts.map((part) => part.part_type).filter(Boolean))].sort(),
    [parts],
  );

  function openEditor(part = null) {
    setError("");
    setNotice("");
    setEditor({
      id: part?.id ?? null,
      form: normalizePart(part || blankPart),
    });
  }

  async function savePart(event) {
    event.preventDefault();
    const form = editor.form;
    if (!form.device_model.trim() || !form.part_type.trim()) {
      setError("Device model and part type are required.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const payload = {
        device_model: form.device_model.trim(),
        part_type: form.part_type.trim(),
        quality: form.quality,
        color: form.color.trim(),
        quantity: Number(form.quantity || 0),
        storage_location: form.storage_location.trim(),
        supplier: form.supplier.trim(),
        notes: form.notes.trim(),
      };
      if (financial) payload.unit_cost = Number(form.unit_cost || 0);

      await rpc("lager_save_part", {
        part_id: editor.id == null ? null : String(editor.id),
        payload,
      });
      const wasEdit = editor.id != null;
      setEditor(null);
      setNotice(wasEdit ? "Part updated." : "Part added.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deletePart(part) {
    if (
      !window.confirm(
        `Delete ${part.device_model} ${part.part_type} from spare parts?`,
      )
    )
      return;

    setBusy(true);
    setError("");
    try {
      await rpc("lager_delete_part", { part_id: String(part.id) });
      setNotice("Part deleted.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel workspace-panel spare-parts-panel">
      <div className="title">
        <div>
          <h2>Spare Parts</h2>
          <p>
            {filtered.length} part {filtered.length === 1 ? "line" : "lines"} ·{" "}
            {totalUnits} {totalUnits === 1 ? "unit" : "units"}
            {financial ? ` · ${money(stockValue)} stock value` : ""}
            {query ? " · matching your search" : ""}
          </p>
        </div>

        <div className="actions inventory-toolbar parts-inventory-toolbar">
          <button
            className="primary tool-button add-phone-button"
            type="button"
            onClick={() => openEditor()}
          >
            <span className="tool-icon" aria-hidden="true">＋</span>
            <span>Add Part</span>
          </button>
        </div>
      </div>

      <label className="parts-search">
        <span>Search inventory</span>
        <input
          type="search"
          placeholder="Device, screen, battery, back glass, color or location"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className="filter-bar parts-filter-bar">
        <label>
          <span>Filter by Model</span>
          <select
            value={filters.model}
            onChange={(e) => setFilters({ ...filters, model: e.target.value })}
          >
            <option value="">All</option>
            {modelOptions.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Filter by Part</span>
          <select
            value={filters.partType}
            onChange={(e) => setFilters({ ...filters, partType: e.target.value })}
          >
            <option value="">All</option>
            {typeOptions.map((partType) => (
              <option key={partType} value={partType}>{partType}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Filter by Quality</span>
          <select
            value={filters.quality}
            onChange={(e) => setFilters({ ...filters, quality: e.target.value })}
          >
            <option value="">All</option>
            {qualities.map((quality) => (
              <option key={quality} value={quality}>{quality}</option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice spare-parts-notice">{notice}</p>}

      {loading ? (
        <p className="empty">Loading spare parts…</p>
      ) : filtered.length ? (
        <div
          className={
            "inventory-table spare-parts-inventory" +
            (financial ? " financial" : "")
          }
        >
          <div className="inventory-row inventory-head" aria-hidden="true">
            <span>Device</span>
            <span>Part</span>
            <span>Quality</span>
            <span>Color</span>
            <span>Qty</span>
            {financial && <span>Unit Cost</span>}
            <span>Location</span>
            <span>Actions</span>
          </div>

          {filtered.map((part) => (
            <article className="inventory-row spare-inventory-row" key={part.id}>
              <strong data-label="Device">{part.device_model}</strong>
              <span data-label="Part">{part.part_type}</span>
              <span data-label="Quality">{part.quality || "—"}</span>
              <span data-label="Color">{part.color || "—"}</span>
              <span data-label="Quantity">
                <span
                  className={
                    "spare-part-qty" +
                    (Number(part.quantity) === 0 ? " empty" : "")
                  }
                >
                  {part.quantity}
                </span>
              </span>
              {financial && (
                <span data-label="Unit Cost">{money(part.unit_cost)}</span>
              )}
              <span data-label="Location">{part.storage_location || "—"}</span>

              <div className="actions spare-part-actions">
                <button type="button" onClick={() => openEditor(part)}>
                  Edit
                </button>
                {canDelete && (
                  <button
                    className="danger"
                    type="button"
                    disabled={busy}
                    onClick={() => deletePart(part)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty">
          {query || filters.model || filters.partType || filters.quality
            ? "No spare parts match your search or filters."
            : "No spare parts added yet."}
        </p>
      )}

      {editor && (
        <PartDialog
          editor={editor}
          setEditor={setEditor}
          financial={financial}
          busy={busy}
          error={error}
          onClose={() => !busy && setEditor(null)}
          onSubmit={savePart}
        />
      )}
    </section>
  );
}

function PartDialog({
  editor,
  setEditor,
  financial,
  busy,
  error,
  onClose,
  onSubmit,
}) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const form = editor.form;
  const set = (key, value) =>
    setEditor({ ...editor, form: { ...form, [key]: value } });

  return (
    <dialog
      ref={ref}
      className="spare-part-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="title">
        <div>
          <h2>{editor.id ? "Edit Spare Part" : "Add Spare Part"}</h2>
          <p>Keep it simple: device, part type, quantity and optional details.</p>
        </div>
        <button type="button" aria-label="Close dialog" onClick={onClose}>×</button>
      </div>

      {error && <p className="alert" role="alert">{error}</p>}

      <form className="grid" onSubmit={onSubmit}>
        <label>
          <span>Device Model</span>
          <input
            required
            placeholder="iPhone 14 Pro Max"
            value={form.device_model}
            onChange={(e) => set("device_model", e.target.value)}
          />
        </label>

        <label>
          <span>Part Type</span>
          <input
            required
            list="spare-part-types"
            placeholder="Screen"
            value={form.part_type}
            onChange={(e) => set("part_type", e.target.value)}
          />
          <datalist id="spare-part-types">
            {partTypes.map((item) => <option value={item} key={item} />)}
          </datalist>
        </label>

        <label>
          <span>Quality</span>
          <select value={form.quality} onChange={(e) => set("quality", e.target.value)}>
            {qualities.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>

        <label>
          <span>Color</span>
          <input
            placeholder="Black / White / Natural"
            value={form.color}
            onChange={(e) => set("color", e.target.value)}
          />
        </label>

        <label>
          <span>Quantity</span>
          <input
            required
            type="number"
            min="0"
            max="9999"
            step="1"
            value={form.quantity}
            onChange={(e) => set("quantity", e.target.value)}
          />
        </label>

        {financial && (
          <label>
            <span>Unit Cost (SEK)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.unit_cost}
              onChange={(e) => set("unit_cost", e.target.value)}
            />
          </label>
        )}

        <label>
          <span>Storage Location</span>
          <input
            placeholder="Shelf A / Box 2"
            value={form.storage_location}
            onChange={(e) => set("storage_location", e.target.value)}
          />
        </label>

        <label>
          <span>Supplier</span>
          <input
            placeholder="Optional"
            value={form.supplier}
            onChange={(e) => set("supplier", e.target.value)}
          />
        </label>

        <label className="wide">
          <span>Notes</span>
          <textarea
            rows="3"
            placeholder="Optional note"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </label>

        <div className="actions wide">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : editor.id ? "Save Changes" : "Add Part"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
