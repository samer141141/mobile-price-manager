const PROVIDERS = {
  tradera: {
    label: "Tradera",
    category: "used_marketplace",
    mode: "official_api",
    configured: () => Boolean(process.env.TRADERA_APP_ID && process.env.TRADERA_APP_KEY),
    status: () => process.env.TRADERA_APP_ID && process.env.TRADERA_APP_KEY ? "Connected" : "Not configured",
    note: "Official Tradera REST v4 credentials are required server-side."
  },
  blocket: {
    label: "Blocket",
    category: "used_marketplace",
    mode: "manual_only",
    configured: () => false,
    status: () => "Manual only",
    note: "Blocket's documented Pro Import API manages a business's own ads; it is not used here as a public market-price feed."
  },
  swappie: {
    label: "Swappie",
    category: "refurbished_retail",
    mode: "manual_only",
    configured: () => false,
    status: () => "Manual only",
    note: "No approved automatic pricing feed is configured."
  },
  back_market: {
    label: "Back Market",
    category: "refurbished_retail",
    mode: "manual_only",
    configured: () => false,
    status: () => "Manual only",
    note: "No approved automatic pricing feed is configured."
  }
};

export function marketSourceStatus() {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([key, provider]) => [key, {
    label: provider.label,
    category: provider.category,
    mode: provider.mode,
    status: provider.status(),
    note: provider.note
  }]));
}

export function traderaHeaders() {
  if (!PROVIDERS.tradera.configured()) return null;
  return {
    "X-App-Id": process.env.TRADERA_APP_ID,
    "X-App-Key": process.env.TRADERA_APP_KEY,
    Accept: "application/json"
  };
}
