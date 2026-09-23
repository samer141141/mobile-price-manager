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

function requestedStorageMatch(textValue, storage) {
  const n = Number(storage);
  if (!Number.isFinite(n) || n <= 0) return true;
  const t = normalizeText(textValue).replace(/\s+/g, "");
  return t.includes(String(n) + "gb") || t.includes(String(n) + "g");
}

function titleHasStorage(title) {
  const t = normalizeText(title).replace(/\s+/g, "");
  return /\b(?:64|128|256|512)g(?:b)?\b/.test(t) || /\b1tb\b/.test(t);
}

function hasProblemTitle(title) {
  const t = normalizeText(title);
  return /\b(trasig|defekt|reparation|reservdel|reservdelar|repobjekt|fungerar ej|funkar ej|ej fungerande|icloud last|aktiveringslast|mdm|broken|repair|parts|for parts|parti)\b/.test(t);
}

function detailLooksDefective(html) {
  const t = normalizeText(html);
  return /\b(defekt|skadad eller fungerar inte|for reparation|repobjekt|icloud last|aktiveringslast|mdm)\b/.test(t);
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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (compatible; LagerIphone/1.0)",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Tradera HTTP " + response.status);
  return response.text();
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

async function fetchCategoryPages(maxPages) {
  const all = [];
  const batchSize = 6;

  for (let start = 1; start <= maxPages; start += batchSize) {
    const pages = Array.from(
      { length: Math.min(batchSize, maxPages - start + 1) },
      (_, i) => start + i,
    );

    const results = await Promise.allSettled(
      pages.map(async (page) => {
        const params = new URLSearchParams();
        params.set("expanded", "1");
        if (page > 1) params.set("paging", String(page));
        const url = IPHONE_CATEGORY + "?" + params.toString();
        return parseTraderaCategoryPage(await fetchText(url));
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") all.push(...result.value);
    }
  }

  if (!all.length) throw new Error("Could not reach Tradera.");
  return all;
}

async function confirmStorageFromDetail(item, storage) {
  try {
    const html = await fetchText(item.url);
    if (detailLooksDefective(html)) return { matches: false, defective: true };
    return {
      matches: requestedStorageMatch(html, storage),
      defective: false,
    };
  } catch {
    return { matches: false, defective: false };
  }
}

export async function fetchTraderaMarket(model, storage, { pages = 18 } = {}) {
  const raw = await fetchCategoryPages(pages);

  const seen = new Set();
  const all = raw.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  const modelMatches = all.filter((item) => exactModelMatch(item.title, model));

  const directMatches = modelMatches.filter(
    (item) =>
      titleHasStorage(item.title) &&
      requestedStorageMatch(item.title, storage),
  );

  const missingStorage = modelMatches
    .filter(
      (item) =>
        !titleHasStorage(item.title) &&
        item.price_type !== "auction" &&
        !hasProblemTitle(item.title),
    )
    .slice(0, 20);

  const detailResults = await Promise.all(
    missingStorage.map(async (item) => ({
      item,
      ...(await confirmStorageFromDetail(item, storage)),
    })),
  );

  const enrichedMatches = detailResults
    .filter((r) => r.matches && !r.defective)
    .map((r) => r.item);

  const matchingMap = new Map();
  for (const item of [...directMatches, ...enrichedMatches]) {
    matchingMap.set(item.id, item);
  }
  const matching = [...matchingMap.values()];

  const excludedAuctions = modelMatches.filter(
    (item) =>
      item.price_type === "auction" &&
      (
        requestedStorageMatch(item.title, storage) ||
        !titleHasStorage(item.title)
      ),
  ).length;

  const excludedProblemListings = matching.filter(
    (item) => hasProblemTitle(item.title),
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
    status: listings.length ? "ok" : "insufficient_fixed_price_data",
    mode: "fixed_price_market",
    method: "buy_now_and_fixed_only",
    scanned_matches: modelMatches.length,
    excluded_auctions: excludedAuctions,
    excluded_problem_listings: excludedProblemListings,
    excluded_outliers: removed,
    sample_count: listings.length,
    confidence:
      listings.length >= 5 ? "high" : listings.length >= 3 ? "medium" : "low",
    typical_price: median(prices),
    min_price: prices.length ? prices[0] : null,
    max_price: prices.length ? prices[prices.length - 1] : null,
    listings,
  };
}
