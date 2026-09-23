import { NextResponse } from "next/server";
import { fetchTraderaMarket } from "../../../../lib/tradera-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(v) { return String(v ?? "").trim(); }
function numberFrom(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
function summarizeMarket(listings) {
  const values = listings
    .map((item) => Number(item?.price))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (!values.length) return null;

  let clean = values;
  if (values.length >= 4) {
    const lower = values.slice(0, Math.floor(values.length / 2));
    const upper = values.slice(Math.ceil(values.length / 2));
    const q1 = median(lower);
    const q3 = median(upper);
    const iqr = q3 - q1;
    if (Number.isFinite(iqr) && iqr > 0) {
      clean = values.filter(
        (n) => n >= q1 - 1.5 * iqr && n <= q3 + 1.5 * iqr,
      );
    }
  }

  return {
    sample_count: clean.length,
    raw_count: values.length,
    excluded_outliers: values.length - clean.length,
    typical_price: median(clean),
    min_price: clean[0],
    max_price: clean[clean.length - 1],
  };
}
function flatten(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["data","items","results","products","suggestions"]) {
    const found = value[key];
    if (Array.isArray(found)) return found;
    if (found && typeof found === "object") {
      const nested = flatten(found);
      if (nested.length) return nested;
    }
  }
  return [];
}
function prisjaktListings(body) {
  return flatten(body).map((item) => {
    const low = item?.lowestPrice ?? item?.offer?.lowestPrice ?? item?.offers?.[0] ?? {};
    const p = low?.price ?? low;
    return {
      id: String(item?.id ?? item?.productId ?? ""),
      source: "Prisjakt",
      title: text(item?.productName ?? item?.name ?? item?.title),
      price: numberFrom(p?.includingShipping?.value,p?.value,p?.amount,p,item?.price?.value,item?.price),
      url: text(item?.url ?? item?.productUrl ?? item?.link)
    };
  }).filter(x => x.title && x.price);
}
async function envValues() {
  // OpenNext exposes Cloudflare text variables/secrets through process.env
  // when nodejs_compat is enabled. Avoid importing cloudflare:workers here,
  // because that module cannot be resolved while OpenNext bundles this route.
  return process.env;
}
async function fetchTradera(model, storage) {
  try {
    return await fetchTraderaMarket(model, storage);
  } catch {
    return { source:"Tradera", status:"error", error:"Could not reach Tradera.", listings:[] };
  }
}
async function fetchPrisjakt(env, query) {
  if (!env.PRISJAKT_CLIENT_ID || !env.PRISJAKT_CLIENT_SECRET || !env.PRISJAKT_REF_ID)
    return { source:"Prisjakt", status:"not_configured", listings:[] };
  try {
    const tokenBody = new URLSearchParams({grant_type:"client_credentials",client_id:env.PRISJAKT_CLIENT_ID,client_secret:env.PRISJAKT_CLIENT_SECRET});
    const tokenRes = await fetch("https://auth.pj.nu/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:tokenBody,cache:"no-store"});
    const token = await tokenRes.json().catch(()=>({}));
    if (!tokenRes.ok || !token.access_token) return { source:"Prisjakt",status:"error",error:"Authentication failed.",listings:[] };
    const u = new URL("https://api.pj.nu/partner-search/suggestions");
    u.searchParams.set("market","se"); u.searchParams.set("product",query); u.searchParams.set("ref",env.PRISJAKT_REF_ID); u.searchParams.set("limit","20");
    const r = await fetch(u,{headers:{Authorization:"Bearer "+token.access_token,Accept:"application/json"},cache:"no-store"});
    const body = await r.json().catch(()=>({}));
    if (!r.ok) return { source:"Prisjakt",status:"error",error:"HTTP "+r.status,listings:[] };
    return { source:"Prisjakt",status:"ok",listings:prisjaktListings(body) };
  } catch { return { source:"Prisjakt",status:"error",error:"Could not reach Prisjakt.",listings:[] }; }
}
async function fetchPhoneHeroReference(model, storage) {
  try {
    const r = await fetch("https://phonehero.se/salj-din-gamla-mobil-till-oss", { cache: "no-store" });
    if (!r.ok) return { source: "PhoneHero", status: "error", offers: [] };
    const html = await r.text();
    const normalized = html.replace(/&nbsp;|&#160;/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const wanted = (model + " " + storage + " GB").replace(/\s+/g, " ").trim().toLowerCase();
    const pos = normalized.toLowerCase().indexOf(wanted);
    if (pos < 0) return { source: "PhoneHero", status: "manual_quote_available", offers: [] };
    const nearby = normalized.slice(pos, pos + 500);
    const m = nearby.match(/([0-9][0-9 ]{2,})\s*(?:kr|SEK)/i);
    const price = m ? Number(m[1].replace(/[^0-9]/g, "")) : 0;
    if (!price) return { source: "PhoneHero", status: "manual_quote_available", offers: [] };
    return { source: "PhoneHero", status: "ok", offers: [{ source: "PhoneHero", price, url: "https://phonehero.se/salj-din-gamla-mobil-till-oss", updated: "Public quote/reference" }] };
  } catch {
    return { source: "PhoneHero", status: "error", offers: [] };
  }
}
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const model=text(searchParams.get("model")), storage=Number(searchParams.get("storage"));
  if (!model) return NextResponse.json({error:"Model is required."},{status:400});
  const query=[model,Number.isFinite(storage)&&storage>0?storage+"GB":""].filter(Boolean).join(" ");
  const env=await envValues();
  const [sourceResults, phoneHero] = await Promise.all([
    Promise.all([fetchTradera(model,storage),fetchPrisjakt(env,query)]),
    fetchPhoneHeroReference(model, storage)
  ]);
  const listings=sourceResults.flatMap(s=>s.listings);
  const marketSummary=summarizeMarket(listings);
  const directLinks = [
    {source:"Apple Trade In",status:"manual_quote_available",url:"https://www.apple.com/se/shop/trade-in"},
    {source:"Elgiganten Trade-In",status:"manual_quote_available",url:"https://www.elgiganten.se/tjanster-tillbehor/tjanster/trade-in"}
  ];
  const sources=[...sourceResults,{source:phoneHero.source,status:phoneHero.status,listings:[]},...directLinks.map(x=>({source:x.source,status:x.status,listings:[]}))];
  return NextResponse.json({
    query,checked_at:new Date().toISOString(),
    sources:sources.map(({listings,...s})=>({...s,count:listings.length})),
    listings,
    market_summary: marketSummary,
    trade_in_offers:phoneHero.offers || [],
    trade_in_links:directLinks
  });
}
