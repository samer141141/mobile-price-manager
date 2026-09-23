import { NextResponse } from "next/server";
import { fetchTraderaMarket } from "../../../../lib/tradera-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(v) { return String(v ?? "").trim(); }

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const model = text(searchParams.get("model"));
  const storage = Number(searchParams.get("storage"));
  if (!model) return NextResponse.json({ error: "Model is required." }, { status: 400 });
  const query = [model, Number.isFinite(storage) && storage > 0 ? storage + "GB" : ""].filter(Boolean).join(" ");
  try {
    const result = await fetchTraderaMarket(model, storage);
    return NextResponse.json({
      source: "Tradera", status: result.status, mode: result.mode, query,
      checked_at: new Date().toISOString(), listings: result.listings
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Could not reach Tradera." }, { status: 502 });
  }
}
