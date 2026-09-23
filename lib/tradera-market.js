const TRADERA_BASE = "https://www.tradera.com";
const IPHONE_CATEGORY = TRADERA_BASE + "/category/340186";

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;|\\u00a0/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\s+/g, " ")
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
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

function exactModelMatch(title, model) {
  const t = normalizeText(title);
  const m = normalizeText(model);
  if (!t.includes(m)) return false;
  const wantsProMax = /\\bpro max\\b/.test(m);
  const wantsPro = /\\bpro\\b/.test(m);
  const wantsPlus = /\\bplus\\b/.test(m);
  const wantsMini = /\\bmini\\b/.test(m);
  if (wantsProMax) return /\\bpro max\\b/.test(t);
  if (wantsPro) return /\\bpro\\b/.test(t) && !/\\bpro max\\b/.test(t);
  if (wantsPlus) return /\\bplus\\b/.test(t);
  if (wantsMini) return /\\bmini\\b/.test(t);
  return !/\\bpro\\b|\\bplus\\b|\\bmini\\b/.test(t);
}

function storageMatch(title, storage) {
  const n = Number(storage);
  if (!Number.isFinite(n) || n <= 0) return true;
  const compact = normalizeText(title).replace(/\\s+/g, "");
  return compact.includes(String(n) + "gb");
}

export function parseTraderaCategoryPage(html) {
  const source = String(html ?? "");
  const chunks = source.split(/(?=<div[^>]+data-item-card-id=")/i);
  const listings = [];
  for (const chunk of chunks) {
    const id = chunk.match(/data-item-card-id="(\\d+)"/i)?.[1];
    if (!id) continue;
    const anchor = chunk.match(/<a\\b[^>]*data-testid="item-card-image"[^>]*>/i)?.[0] ?? "";
    const title = attr(anchor, "aria-label");
    const href = attr(anchor, "href");
    const priceHtml = chunk.match(/data-testid="price"[^>]*>([\\s\\S]*?)<\\/span>/i)?.[1] ?? "";
    const price = parsePrice(priceHtml);
    if (!title || !href || !price) continue;
    listings.push({
      id,
      source: "Tradera",
      title,
      price,
      url: href.startsWith("http") ? href : TRADERA_BASE + href,
    });
  }
  return listings;
}

export async function fetchTraderaMarket(model, storage, { pages = 4 } = {}) {
  const pageNumbers = Array.from({ length: pages }, (_, i) => i + 1);
  const responses = await Promise.allSettled(
    pageNumbers.map(async (page) => {
      const url = page === 1 ? IPHONE_CATEGORY : IPHONE_CATEGORY + "?paging=" + page;
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
  const listings = all
    .filter((item) => exactModelMatch(item.title, model) && storageMatch(item.title, storage))
    .slice(0, 25);
  return { source: "Tradera", status: "ok", mode: "public_market", listings };
}
