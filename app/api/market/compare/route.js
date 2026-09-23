import { NextResponse } from "next/server";

export const runtime = "nodejs";

function text(v) { return String(v ?? "").trim(); }
function numberFrom(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
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
function traderaListings(body) {
  const items = body?.items ?? body?.searchItems ?? body?.itemList ?? body?.results?.items ?? body?.results ?? body?.data?.items ?? body?.data ?? body;
  return flatten(items).map((item) => ({
    id: String(item?.id ?? item?.itemId ?? ""),
    source: "Tradera",
    title: text(item?.title ?? item?.shortDescription ?? item?.name),
    price: numberFrom(item?.buyItNowPrice?.value,item?.buyItNowPrice?.amount,item?.buyItNowPrice,item?.price?.value,item?.price?.amount,item?.price,item?.currentBid?.value,item?.currentBid?.amount,item?.currentBid),
    url: text(item?.url ?? item?.itemUrl ?? item?.itemLink)
  })).filter(x => x.title && x.price);
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
  let env = process.env;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    env = { ...env, ...(getCloudflareContext().env || {}) };
  } catch {}
  return env;
}
async function fetchTradera(env, query) {
  if (!env.TRADERA_APP_ID || !env.TRADERA_APP_KEY)
    return { source:"Tradera", status:"not_configured", listings:[] };
  try {
    const u = new URL("https://api.tradera.com/v4/search");
    u.searchParams.set("query", query);
    const r = await fetch(u,{headers:{"X-App-Id":env.TRADERA_APP_ID,"X-App-Key":env.TRADERA_APP_KEY,Accept:"application/json"},cache:"no-store"});
    const body = await r.json().catch(()=>({}));
    if (!r.ok) return { source:"Tradera", status:"error", error:body?.error?.message || ("HTTP "+r.status), listings:[] };
    return { source:"Tradera", status:"ok", listings:traderaListings(body) };
  } catch { return { source:"Tradera", status:"error", error:"Could not reach Tradera.", listings:[] }; }
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
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const model=text(searchParams.get("model")), storage=Number(searchParams.get("storage"));
  if (!model) return NextResponse.json({error:"Model is required."},{status:400});
  const query=[model,Number.isFinite(storage)&&storage>0?storage+"GB":""].filter(Boolean).join(" ");
  const env=await envValues();
  const sources=await Promise.all([fetchTradera(env,query),fetchPrisjakt(env,query)]);
  const listings=sources.flatMap(s=>s.listings);
  return NextResponse.json({query,checked_at:new Date().toISOString(),sources:sources.map(({listings,...s})=>({...s,count:listings.length})),listings});
}
