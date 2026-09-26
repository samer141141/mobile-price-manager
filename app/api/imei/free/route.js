import { APPLE_TAC_MODELS } from "../../../../lib/apple-tac-models";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function cleanImei(value) {
  return String(value || "").replace(/\D/g, "");
}

function validLuhn(imei) {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i += 1) {
    let digit = Number(imei[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const imei = cleanImei(body?.imei);
    if (!/^\d{15}$/.test(imei)) {
      return Response.json(
        { error: "IMEI must contain exactly 15 digits." },
        { status: 400 },
      );
    }

    const tac = imei.slice(0, 8);
    const model = APPLE_TAC_MODELS[tac] || null;

    return Response.json(
      {
        imei,
        tac,
        provider: "Free local TAC database",
        mode: "free",
        luhn_valid: validLuhn(imei),
        device_name: model,
        model_description: model,
        storage_gb: null,
        blacklist: "Free manual check",
        sim_lock: "Check on device/carrier",
        fmi: "Check before purchase",
        icloud: "Check before purchase",
        carrier: "Unknown",
        country: "Unknown",
        warranty: "Unknown",
        activation: "Manual verification required",
        refurbished: null,
        demo_unit: null,
        lost_mode: null,
        checked_at: new Date().toISOString(),
        swappa_url: "https://swappa.com/imei",
        apple_activation_lock_url: "https://support.apple.com/en-us/108794",
        device_lookup_url:
          "https://devicedecoded.com/tools/check-imei?imei=" +
          encodeURIComponent(imei),
        note:
          "Device identification is local and free. Blacklist and Activation Lock must be confirmed using the free external checks before purchase.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Free IMEI check failed." },
      { status: 500 },
    );
  }
}
