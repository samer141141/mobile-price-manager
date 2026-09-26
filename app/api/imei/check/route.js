export const runtime = "edge";
export const dynamic = "force-dynamic";

const PROVIDER_URL = "https://api.imeicheck.net/v1/checks";

function normalizeBool(value) {
  if (typeof value === "boolean") return value;
  const v = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "1", "on", "locked", "active"].includes(v)) return true;
  if (["false", "no", "0", "off", "unlocked", "inactive"].includes(v)) return false;
  return null;
}

function statusFrom(value, cleanWords = ["clean", "unblocked", "not blacklisted", "not found"]) {
  const v = String(value ?? "").trim();
  if (!v) return "Unknown";
  const n = v.toLowerCase();
  if (cleanWords.some((word) => n.includes(word))) return "Clean";
  if (/(blacklist|blacklisted|blocked|stolen|lost|reported)/i.test(v)) return "Blacklisted";
  return v;
}

function simLockFrom(value) {
  if (value === true) return "Locked";
  if (value === false) return "Unlocked";
  const v = String(value ?? "").trim();
  if (!v) return "Unknown";
  if (/unlocked|no sim restrictions/i.test(v)) return "Unlocked";
  if (/locked/i.test(v)) return "Locked";
  return v;
}

function fmiFrom(value) {
  if (value === true) return "ON";
  if (value === false) return "OFF";
  const v = String(value ?? "").trim();
  if (!v) return "Unknown";
  if (/^(on|enabled|active|locked)$/i.test(v)) return "ON";
  if (/^(off|disabled|inactive|unlocked)$/i.test(v)) return "OFF";
  return v;
}

function findValue(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null && object?.[key] !== "") {
      return object[key];
    }
  }
  return null;
}

function inferStorage(...values) {
  for (const value of values) {
    const match = String(value ?? "").match(/\b(16|32|64|128|256|512|1024|2048)\s*GB\b/i);
    if (match) return Number(match[1]);
    const tb = String(value ?? "").match(/\b([12])\s*TB\b/i);
    if (tb) return Number(tb[1]) * 1024;
  }
  return null;
}

function validImei(value) {
  const imei = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{15}$/.test(imei)) return null;
  return imei;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const imei = validImei(body?.imei);
    if (!imei) {
      return Response.json({ error: "IMEI must contain exactly 15 digits." }, { status: 400 });
    }

    const token = process.env.IMEICHECK_API_TOKEN;
    const serviceId = Number(process.env.IMEICHECK_SERVICE_ID || "1");

    if (!token) {
      return Response.json(
        {
          error: "Live IMEI provider is not connected yet. The button is working, but blacklist / SIM lock / Find My data requires an API key.",
          code: "IMEI_API_NOT_CONFIGURED",
          setup_url: "https://imeicheck.net/promo-api",
        },
        { status: 503 },
      );
    }

    const response = await fetch(PROVIDER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ deviceId: imei, serviceId }),
      cache: "no-store",
    });

    let providerBody = null;
    try {
      providerBody = await response.json();
    } catch {
      providerBody = { error: await response.text().catch(() => "") };
    }

    if (!response.ok) {
      const message =
        providerBody?.message ||
        providerBody?.error ||
        providerBody?.detail ||
        `IMEI provider returned HTTP ${response.status}.`;
      return Response.json({ error: String(message), provider_status: response.status }, { status: 502 });
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

    const result = {
      imei,
      provider: "IMEIcheck.net",
      provider_check_id: providerBody?.id || providerBody?.result?.id || null,
      service: providerBody?.service?.title || providerBody?.result?.service?.title || null,
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
    };

    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "IMEI check failed." },
      { status: 500 },
    );
  }
}
