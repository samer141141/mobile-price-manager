const TRADERA_BASE = "https://www.tradera.com";
const IPHONE_CATEGORY = TRADERA_BASE + "/category/340186";

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;|\u00a0/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag, name) {
  const m = String(tag ?? "").match(new RegExp(name + '="([^"]*)"', "i"));
  return m ? decodeHtml(m[1]) : "";
}

function parsePrice(value) {
  const digits = decodeHtml(value).replace(/[^0-9]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeText(value) {
  return decodeHtml(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function exactModelMatch(title, model) {
  const t = normalizeText(title);
  const m = normalizeText(model);
  if (!t.includes(m)) return false;

  const wantsProMax = /\bpro max\b/.test(m);
  const wantsPro = /\bpro\b/.test(m);
  const wantsPlus = /\bplus\b/.test(m);
  const wantsMini = /\bmini\b/.test(m);

  if (wantsProMax) return /\bpro max\b/.test(t);
  if (wantsPro) return /\bpro\b/.test(t) && !/\bpro max\b/.test(t);
  if (wantsPlus) return /\bplus\b/.test(t);
  if (wantsMini) return /\bmini\b/.test(t);

  return !/\bpro\b|\bplus\b|\bmini\b/.test(t);
}

function storageMatch(title, storage) {
  const n = Number(storage);
  if (!Number.isFinite(n) || n <= 0) return true;
  const compact = normalizeText(title).replace(/\s+/g, "");
  return compact.includes(String(n) + "gb");
}

function hasProblemTitle(title) {
  const t = normalizeText(title);
  return /\b(trasig|defekt|reparation|reservdel|reservdelar|repobjekt|fungerar ej|funkar ej|ej fungerande|sprucken|sprucket|icloud last|aktiveringslast|mdm|broken|repair|parts|for parts|parti)\b/.test(t);
}

function priceInfoFromCard(chunk) {
  const plain = decodeHtml(chunk);
  const itemType = chunk.match(/data-item-type="([^"]+)"/i)?.[1] ?? "";

  const mixedBuyNow = plain.match(/(?:eller\s+)?köp nu\s+([0-9][0-9 .]*)\s*kr/i);
  if (mixedBuyNow) {
    const price = parsePrice(mixedBuyNow[1]);
    if (price) return { price, price_type: "buy_now", item_type: itemType };
  }

  const priceHtml =
    chunk.match(/data-testid="price"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "";
  const firstPrice = parsePrice(priceHtml);
  if (!firstPrice) return null;

  const isAuction =
    /ledande bud|utropspris/i.test(plain) ||
    /^auction$/i.test(itemType);

  const isBuyNow =
    /köp nu/i.test(plain) &&
    !/ledande bud|utropspris/i.test(plain);

  if (isBuyNow) {
    return { price: firstPrice, price_type: "buy_now", item_type: itemType };
  }

  if (isAuction) {
    return { price: firstPrice, price_type: "auction", item_type: itemType };
  }

  return { price: firstPrice, price_type: "fixed", item_type: itemType };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function filterOutliers(listings) {
  if (listings.length < 4) return { clean: listings, removed: 0 };

  const values = listings.map((x) => x.price).sort((a, b) => a - b);
  const lower = values.slice(0, Math.floor(values.length / 2));
  const upper = values.slice(Math.ceil(values.length / 2));
  const q1 = median(lower);
  const q3 = median(upper);
  const iqr = q3 - q1;

  if (!Number.isFinite(iqr) || iqr <= 0)
    return { clean: listings, removed: 0 };

  const min = q1 - 1.5 * iqr;
  const max = q3 + 1.5 * iqr;
  const clean = listings.filter((x) => x.price >= min && x.price <= max);

  return { clean, removed: listings.length - clean.length };
}

export function parseTraderaCategoryPage(html) {
  const source = String(html ?? "");
  const chunks = source.split(/(?=<div[^>]+data-item-card-id=")/i);
  const listings = [];

  for (const chunk of chunks) {
    const id = chunk.match(/data-item-card-id="(\d+)"/i)?.[1];
    if (!id) continue;

    const anchor =
      chunk.match(/<a\b[^>]*data-testid="item-card-image"[^>]*>/i)?.[0] ?? "";
    const title = attr(anchor, "aria-label");
    const href = attr(anchor, "href");
    const priceInfo = priceInfoFromCard(chunk);

    if (!title || !href || !priceInfo?.price) continue;

    listings.push({
      id,
      source: "Tradera",
      title,
      price: priceInfo.price,
      price_type: priceInfo.price_type,
      item_type: priceInfo.item_type,
      url: href.startsWith("http") ? href : TRADERA_BASE + href,
    });
  }

  return listings;
}

export async function fetchTraderaMarket(model, storage, { pages = 8 } = {}) {
  const pageNumbers = Array.from({ length: pages }, (_, i) => i + 1);
  const responses = await Promise.allSettled(
    pageNumbers.map(async (page) => {
      const url =
        page === 1 ? IPHONE_CATEGORY : IPHONE_CATEGORY + "?paging=" + page;
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (compatible; LagerIphone/1.0)",
        },
        cache: "no-store",
      });

      if (!response.ok) throw new Error("Tradera HTTP " + response.status);
      return parseTraderaCategoryPage(await response.text());
    }),
  );

  const fulfilled = responses.filter((r) => r.status === "fulfilled");
  if (!fulfilled.length) throw new Error("Could not reach Tradera.");

  const seen = new Set();
  const all = fulfilled.flatMap((r) => r.value).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  const matching = all.filter(
    (item) =>
      exactModelMatch(item.title, model) &&
      storageMatch(item.title, storage),
  );

  const excludedAuctions = matching.filter(
    (item) => item.price_type === "auction",
  ).length;

  const excludedProblemListings = matching.filter(
    (item) => item.price_type !== "auction" && hasProblemTitle(item.title),
  ).length;

  const fixed = matching.filter(
    (item) =>
      item.price_type !== "auction" &&
      !hasProblemTitle(item.title),
  );

  const { clean, removed } = filterOutliers(fixed);
  const listings = clean.slice(0, 40);
  const prices = listings.map((x) => x.price).sort((a, b) => a - b);

  return {
    source: "Tradera",
    status: "ok",
    mode: "fixed_price_market",
    method: "buy_now_and_fixed_only",
    scanned_matches: matching.length,
    excluded_auctions: excludedAuctions,
    excluded_problem_listings: excludedProblemListings,
    excluded_outliers: removed,
    typical_price: median(prices),
    min_price: prices.length ? prices[0] : null,
    max_price: prices.length ? prices[prices.length - 1] : null,
    listings,
  };
}
