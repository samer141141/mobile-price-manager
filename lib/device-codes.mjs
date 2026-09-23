export function deviceCodePayload(phone) {
  const id = String(phone?.id ?? "").trim();
  const imei = String(phone?.imei ?? "").replace(/\D/g, "").slice(0, 15);
  return ["LAGERIPHONE", id, imei].join("|");
}

export function parseDeviceCode(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { raw: value, id: "", imei: "" };

  if (value.startsWith("LAGERIPHONE|")) {
    const [, id = "", imeiRaw = ""] = value.split("|");
    const imei = String(imeiRaw).replace(/\D/g, "").slice(0, 15);
    return { raw: value, id: String(id).trim(), imei };
  }

  const digits = value.replace(/\D/g, "");
  const imeiMatch = digits.match(/\d{15}/);
  return {
    raw: value,
    id: "",
    imei: imeiMatch ? imeiMatch[0] : "",
  };
}

export function findPhoneFromCode(phones, raw) {
  const parsed = parseDeviceCode(raw);
  if (parsed.id) {
    const byId = (phones || []).find((p) => String(p.id) === parsed.id);
    if (byId) return { phone: byId, parsed };
  }
  if (parsed.imei) {
    const byImei = (phones || []).find(
      (p) => String(p.imei || "").replace(/\D/g, "") === parsed.imei,
    );
    if (byImei) return { phone: byImei, parsed };
  }
  return { phone: null, parsed };
}

export function extractImeiFromText(text) {
  const source = String(text ?? "");
  const compact = source.replace(/[^0-9]/g, "");
  const direct = compact.match(/\d{15}/);
  if (direct) return direct[0];

  const groups = source.match(/(?:\d[\s:.-]*){15,18}/g) || [];
  for (const group of groups) {
    const digits = group.replace(/\D/g, "");
    if (digits.length >= 15) return digits.slice(0, 15);
  }
  return "";
}
