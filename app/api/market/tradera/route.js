import { NextResponse } from "next/server";

export const runtime = "nodejs";

function text(v) { return String(v ?? "").trim(); }
function priceOf(item) {
  const candidates = [
    item?.buyItNowPrice?.value, item?.buyItNowPrice?.amount, item?.buyItNowPrice,
    item?.price?.value, item?.price?.amount, item?.price,
    item?.currentBid?.value, item?.currentBid?.amount, item?.currentBid,
    item?.maxBid?.value, item?.maxBid
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
function normalize(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: String(item?.id ?? item?.itemId ?? ""),
      title: text(item?.title ?? item?.shortDescription ?? item?.name),
      price: priceOf(item),
      url: text(item?.url ?? item?.itemUrl ?? item?.itemLink),
    }))
    .filter((x) => x.title && x.price);
}
export async function GET(request) {
  const env = typeof process !== "undefined" ? process.env : {};
  const appId = env.TRADERA_APP_ID;
  const appKey = env.TRADERA_APP_KEY;
  if (!appId || !appKey)
    return NextResponse.json({ error: "Tradera is not configured." }, { status: 503 });

  const { searchParams } = new URL(request.url);
  const model = text(searchParams.get("model"));
  const storage = Number(searchParams.get("storage"));
  if (!model)
    return NextResponse.json({ error: "Model is required." }, { status: 400 });

  const query = [model, Number.isFinite(storage) && storage > 0 ? `${storage}GB` : ""]
    .filter(Boolean).join(" ");

  const upstream = new URL("https://api.tradera.com/v4/search");
  upstream.searchParams.set("query", query);

  try {
    const response = await fetch(upstream, {
      headers: { "X-App-Id": appId, "X-App-Key": appKey, Accept: "application/json" },
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      return NextResponse.json({
        error: body?.error?.message || "Tradera request failed.",
        provider_status: response.status
      }, { status: 502 });

    const items =
      body?.items ??
      body?.searchItems ??
      body?.itemList ??
      body?.results?.items ??
      body?.results ??
      body?.data?.items ??
      body?.data ??
      body;
    return NextResponse.json({
      source: "Tradera",
      query,
      checked_at: new Date().toISOString(),
      listings: normalize(items)
    });
  } catch {
    return NextResponse.json({ error: "Could not reach Tradera." }, { status: 502 });
  }
}
