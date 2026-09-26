import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROVIDER_URL = "https://api.imeicheck.net/v1/checks";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function envJson(name: string, key: string) {
  try {
    const raw = Deno.env.get(name);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return String(parsed?.[key] || "");
  } catch {
    return "";
  }
}

function normalizeBool(value: unknown) {
  if (typeof value === "boolean") return value;
  const v = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "1", "on", "locked", "active"].includes(v)) return true;
  if (["false", "no", "0", "off", "unlocked", "inactive"].includes(v)) return false;
  return null;
}

function statusFrom(value: unknown) {
  const v = String(value ?? "").trim();
  if (!v) return "Unknown";
  const n = v.toLowerCase();
  if (["clean", "unblocked", "not blacklisted", "not found"].some((word) => n.includes(word))) return "Clean";
  if (/(blacklist|blacklisted|blocked|stolen|lost|reported)/i.test(v)) return "Blacklisted";
  return v;
}

function simLockFrom(value: unknown) {
  if (value === true) return "Locked";
  if (value === false) return "Unlocked";
  const v = String(value ?? "").trim();
  if (!v) return "Unknown";
  if (/unlocked|no sim restrictions/i.test(v)) return "Unlocked";
  if (/locked/i.test(v)) return "Locked";
  return v;
}

function fmiFrom(value: unknown) {
  if (value === true) return "ON";
  if (value === false) return "OFF";
  const v = String(value ?? "").trim();
  if (!v) return "Unknown";
  if (/^(on|enabled|active|locked)$/i.test(v)) return "ON";
  if (/^(off|disabled|inactive|unlocked)$/i.test(v)) return "OFF";
  return v;
}

function findValue(object: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function inferStorage(...values: unknown[]) {
  for (const value of values) {
    const match = String(value ?? "").match(/\b(16|32|64|128|256|512|1024|2048)\s*GB\b/i);
    if (match) return Number(match[1]);
    const tb = String(value ?? "").match(/\b([12])\s*TB\b/i);
    if (tb) return Number(tb[1]) * 1024;
  }
  return null;
}

async function rpc(url: string, apiKey: string, fn: string, authHeader = "", body: object = {}) {
  const headers: Record<string, string> = {
    apikey: apiKey,
    "Content-Type": "application/json",
  };
  if (authHeader) headers.Authorization = authHeader;
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as Record<string, unknown>).message)
        : `Supabase RPC failed (${response.status})`;
    throw new Error(message);
  }
  return parsed;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Sign in required." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const publishableKey =
      Deno.env.get("SUPABASE_ANON_KEY") ||
      envJson("SUPABASE_PUBLISHABLE_KEYS", "default");
    const secretKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      envJson("SUPABASE_SECRET_KEYS", "default");

    if (!supabaseUrl || !publishableKey || !secretKey) {
      return json({ error: "Supabase function environment is incomplete." }, 500);
    }

    await rpc(supabaseUrl, publishableKey, "lager_access", authHeader, {});

    const body = await req.json().catch(() => ({}));
    const imei = String(body?.imei ?? "").replace(/\D/g, "");
    if (!/^\d{15}$/.test(imei)) {
      return json({ error: "IMEI must contain exactly 15 digits." }, 400);
    }

    const config = await rpc(supabaseUrl, secretKey, "lager_edge_imei_config", "", {}) as Record<string, unknown> | null;
    if (!config?.configured || !config?.token) {
      return json(
        {
          error: "IMEI provider is not connected yet. An Admin must save the IMEIcheck.net API token in Lager iPhone settings.",
          code: "IMEI_API_NOT_CONFIGURED",
          setup_url: "https://imeicheck.net/promo-api",
        },
        503,
      );
    }

    const serviceId = Number(config.serviceId || 1);
    const providerResponse = await fetch(PROVIDER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${String(config.token)}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ deviceId: imei, serviceId }),
    });

    const providerText = await providerResponse.text();
    let providerBody: any = {};
    try {
      providerBody = providerText ? JSON.parse(providerText) : {};
    } catch {
      providerBody = { error: providerText };
    }

    if (!providerResponse.ok) {
      const message =
        providerBody?.message ||
        providerBody?.error ||
        providerBody?.detail ||
        `IMEI provider returned HTTP ${providerResponse.status}.`;
      return json(
        {
          error: String(message),
          code: "IMEI_PROVIDER_ERROR",
          provider_status: providerResponse.status,
        },
        502,
      );
    }

    const properties =
      providerBody?.properties ||
      providerBody?.result?.properties ||
      providerBody?.data?.properties ||
      providerBody?.result ||
      providerBody?.data ||
      {};

    const deviceName = findValue(properties, [
      "deviceName",
      "modelName",
      "model",
      "productDescription",
      "product",
    ]);
    const modelDescription = findValue(properties, [
      "modelDesc",
      "modelDescription",
      "description",
      "productDescription",
    ]);
    const blacklistRaw = findValue(properties, [
      "blacklistStatus",
      "blackListStatus",
      "usaBlockStatus",
      "gsmaBlacklistStatus",
      "blockStatus",
    ]);
    const simRaw = findValue(properties, [
      "simLock",
      "simLockStatus",
      "sim-lock",
      "carrierLock",
      "networkLock",
    ]);
    const fmiRaw = findValue(properties, [
      "fmiOn",
      "findMy",
      "findMyStatus",
      "icloudLock",
      "iCloudLock",
      "activationLock",
    ]);

    return json({
      imei,
      provider: "IMEIcheck.net",
      provider_check_id: providerBody?.id || providerBody?.result?.id || null,
      service: providerBody?.service?.title || providerBody?.result?.service?.title || null,
      amount: providerBody?.amount || null,
      device_name: deviceName ? String(deviceName) : null,
      model_description: modelDescription ? String(modelDescription) : null,
      storage_gb: inferStorage(deviceName, modelDescription),
      blacklist: statusFrom(blacklistRaw),
      sim_lock: simLockFrom(simRaw),
      fmi: fmiFrom(fmiRaw),
      icloud: String(findValue(properties, ["icloudStatus", "iCloudStatus", "icloud"]) ?? "Unknown"),
      carrier: String(findValue(properties, ["lockedCarrier", "carrier", "apple/region", "network"]) ?? "Unknown"),
      country: String(findValue(properties, ["purchaseCountry", "country", "countryOfPurchase"]) ?? "Unknown"),
      warranty: String(findValue(properties, ["warrantyStatus", "warranty", "coverageStatus"]) ?? "Unknown"),
      activation: String(findValue(properties, ["activationStatus", "registrationStatus"]) ?? "Unknown"),
      refurbished: normalizeBool(findValue(properties, ["refurbished", "isRefurbished"])),
      demo_unit: normalizeBool(findValue(properties, ["demoUnit", "isDemo"])),
      lost_mode: normalizeBool(findValue(properties, ["lostMode", "isLostMode"])),
      estimated_purchase_date: findValue(properties, ["estPurchaseDate", "estimatedPurchaseDate", "purchaseDate"]),
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "IMEI check failed." },
      500,
    );
  }
});
