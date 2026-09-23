"use client";

import { money } from "../lib/inventory.mjs";

export function InsightsPanel({ insights, onDeal }) {
  const best = insights.bestModel;
  return (
    <section className="panel intelligence-panel">
      <div className="title intelligence-title">
        <div>
          <span className="section-kicker">Business intelligence</span>
          <h2>Profit Dashboard</h2>
          <p>Sales performance, stock velocity and capital tied up.</p>
        </div>
        <span className="insight-chip">{insights.slowCount} stock item(s) need attention</span>
      </div>

      <div className="cards intelligence-cards">
        <MiniKpi label="Profit this month" value={money(insights.monthProfit)} />
        <MiniKpi label="Sales this month" value={money(insights.monthRevenue)} detail={`${insights.soldThisMonth} device(s)`} />
        <MiniKpi label="Avg profit / device" value={money(insights.avgProfit)} />
        <MiniKpi
          label="Avg days to sell"
          value={insights.avgDaysToSell == null ? "—" : `${Math.round(insights.avgDaysToSell)} days`}
        />
        <MiniKpi label="Capital in stock" value={money(insights.capital)} />
        <MiniKpi
          label="Best profit model"
          value={best?.model || "—"}
          detail={best ? `${money(best.profit)} · ${best.units} sold` : "No sales yet"}
        />
      </div>

      <div className="aging-section">
        <div className="subheading-row">
          <div>
            <span className="section-kicker">Inventory aging</span>
            <h3>Stock age & action list</h3>
          </div>
          <p>Older stock gets higher priority so capital does not sit still.</p>
        </div>
        <div className="aging-list">
          {insights.aging.length ? insights.aging.map((row) => (
            <div className="aging-row" key={row.phone.id}>
              <div>
                <strong>{row.phone.model} {row.phone.storage_gb}GB</strong>
                <span>{row.phone.color || row.phone.grade || row.phone.condition || "—"}</span>
              </div>
              <span className={`aging-badge ${row.level}`}>{row.days == null ? "—" : `${row.days}d`} · {row.label}</span>
              <span className="aging-action">{row.action}</span>
              <button type="button" onClick={() => onDeal?.(row.phone)}>Deal Calculator</button>
            </div>
          )) : <p className="empty">No available business stock.</p>}
        </div>
      </div>
    </section>
  );
}

export function SmartBuyPanel({ analysis, dealPrice, setDealPrice, dealBattery, setDealBattery, expenses, setExpenses }) {
  return (
    <div className="smart-buy-card">
      <div className="subheading-row">
        <div>
          <span className="section-kicker">Smart Buy</span>
          <h3>Should I buy this phone?</h3>
        </div>
        {analysis && <span className={`deal-decision ${analysis.level}`}>{analysis.decision}</span>}
      </div>
      <div className="grid smart-buy-inputs">
        <label>
          <span>Seller asking price (SEK)</span>
          <input type="number" min="0" value={dealPrice} onChange={(e) => setDealPrice(e.target.value)} />
        </label>
        <label>
          <span>Battery health (%)</span>
          <input type="number" min="0" max="100" value={dealBattery} onChange={(e) => setDealBattery(e.target.value)} />
        </label>
        <label>
          <span>Expected repair / extra cost (SEK)</span>
          <input type="number" min="0" value={expenses} onChange={(e) => setExpenses(e.target.value)} />
        </label>
      </div>
      {analysis ? (
        <>
          <div className="cards smart-buy-results">
            <MiniKpi label="Max safe buy" value={money(analysis.safeBuy)} />
            <MiniKpi label="Recommended sell" value={money(analysis.recommended)} />
            <MiniKpi label="Expected profit" value={money(analysis.expectedProfit)} />
            <MiniKpi label="Expected margin" value={`${analysis.marginPct.toFixed(1)}%`} />
          </div>
          {analysis.batteryNote && <p className="smart-buy-note">{analysis.batteryNote}</p>}
        </>
      ) : (
        <p>Run a live market check first to calculate the deal.</p>
      )}
    </div>
  );
}

export function SuggestedPricePanel({ recommendations, confidence }) {
  if (!recommendations) return null;
  return (
    <div className="suggested-prices">
      <div className="subheading-row">
        <div>
          <span className="section-kicker">Suggested sell price</span>
          <h3>Three pricing strategies</h3>
        </div>
        <span className="confidence-pill">{confidence || "unknown"} confidence</span>
      </div>
      <div className="cards suggested-price-cards">
        <MiniKpi label="Quick Sale" value={money(recommendations.quick)} detail="Price to move faster" />
        <MiniKpi label="Recommended" value={money(recommendations.recommended)} detail="Balanced market price" />
        <MiniKpi label="Max Profit" value={money(recommendations.maxProfit)} detail="Higher price, may take longer" />
      </div>
    </div>
  );
}

export function PriceHistoryPanel({ points, range, setRange }) {
  const values = points.map((x) => Number(x.price)).filter((n) => Number.isFinite(n));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const spread = Math.max(1, max - min);
  const path = points.map((point, index) => {
    const x = points.length <= 1 ? 50 : (index / (points.length - 1)) * 100;
    const y = 88 - ((Number(point.price) - min) / spread) * 70;
    return `${index === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");
  const first = values[0];
  const last = values[values.length - 1];
  const change = first ? ((last - first) / first) * 100 : 0;

  return (
    <div className="price-history-card">
      <div className="subheading-row">
        <div>
          <span className="section-kicker">Price history</span>
          <h3>Market trend</h3>
        </div>
        <div className="range-switcher">
          {[7,30,90].map((d) => (
            <button type="button" key={d} className={range === d ? "active" : ""} onClick={() => setRange(d)}>
              {d}D
            </button>
          ))}
        </div>
      </div>
      {points.length ? (
        <>
          <div className="history-summary">
            <strong>{money(last)}</strong>
            <span className={change >= 0 ? "positive" : "negative"}>
              {change >= 0 ? "+" : ""}{change.toFixed(1)}%
            </span>
            <span>{points.length} check(s)</span>
          </div>
          <div className="price-chart" aria-label={`Price history with ${points.length} points`}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="historyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity=".22" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path className="history-area" d={`${path} L 100 100 L 0 100 Z`} />
              <path className="history-line" d={path} />
            </svg>
            <div className="chart-labels">
              <span>{money(min)}</span>
              <span>{money(max)}</span>
            </div>
          </div>
          <div className="history-points">
            {points.slice(-5).reverse().map((p) => (
              <span key={p.id || p.at}>
                {new Date(p.at).toLocaleDateString()} · {money(p.price)}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="history-empty">No history in this period yet. Every live market check now adds a snapshot automatically.</p>
      )}
    </div>
  );
}

export function AdCenterPanel({ records, onReopen, onStatus, onDelete }) {
  return (
    <section className="panel ad-center-panel">
      <div className="title">
        <div>
          <span className="section-kicker">Advertising workflow</span>
          <h2>Ad Center</h2>
          <p>Drafts and published ad copies for your inventory.</p>
        </div>
      </div>
      {records.length ? (
        <div className="ad-record-list">
          {records.map((record) => (
            <article className="ad-record" key={record.id}>
              <div className="ad-record-main">
                <strong>{record.model}</strong>
                <span>{record.platform} · {new Date(record.createdAt).toLocaleString()}</span>
              </div>
              <span className={`ad-status ${String(record.status).toLowerCase()}`}>{record.status}</span>
              <div className="actions">
                <button type="button" onClick={() => onReopen(record)}>Open</button>
                <button type="button" onClick={() => onStatus(record.id, record.status === "Published" ? "Draft" : "Published")}>
                  {record.status === "Published" ? "Move to Draft" : "Mark Published"}
                </button>
                <button type="button" className="danger" onClick={() => onDelete(record.id)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty">No saved ads yet. Create an ad from any available phone and save it here.</p>
      )}
    </section>
  );
}

export function DealCalculatorContent({ state }) {
  if (!state) return null;
  if (state.loading) return <p>Checking live market…</p>;
  if (state.error) return <p className="alert">{state.error}</p>;

  const phone = state.phone;
  const analysis = state.analysis;
  const totalCost =
    Number(phone.purchase_price || 0) +
    Number(phone.repair_cost || 0) +
    Number(phone.other_cost || 0);

  return (
    <div className="deal-calculator-content">
      <div className="cards deal-calculator-cards">
        <MiniKpi label="Your total cost" value={money(totalCost)} />
        <MiniKpi label="Live typical market" value={analysis ? money(analysis.typical) : "—"} />
        <MiniKpi label="Suggested sell" value={analysis ? money(analysis.recommended) : "—"} />
        <MiniKpi label="Expected profit" value={analysis ? money(analysis.recommended - totalCost) : "—"} />
      </div>
      {analysis && (
        <div className="deal-strategy-row">
          <div><span>Quick Sale</span><strong>{money(analysis.quick)}</strong></div>
          <div><span>Recommended</span><strong>{money(analysis.recommended)}</strong></div>
          <div><span>Max Profit</span><strong>{money(analysis.maxProfit)}</strong></div>
        </div>
      )}
      <p>Market values use filtered fixed-price / Buy Now listings rather than auction bids.</p>
    </div>
  );
}

function MiniKpi({ label, value, detail }) {
  return (
    <div className="mini-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
