import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const appId = process.env.TRADERA_APP_ID?.trim();
const appKey = process.env.TRADERA_APP_KEY?.trim();

if (!appId || !appKey) {
  console.log("Cloudflare Tradera build credentials are not present; runtime secret sync skipped.");
  process.exit(0);
}

const tempFile = join(process.cwd(), `.wrangler-runtime-secrets-${process.pid}.json`);

try {
  writeFileSync(
    tempFile,
    JSON.stringify({
      TRADERA_APP_ID: appId,
      TRADERA_APP_KEY: appKey,
    }),
    { mode: 0o600 },
  );

  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "secret",
      "bulk",
      tempFile,
      "--name",
      "lager-iphone",
    ],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.status !== 0) {
    throw new Error("Cloudflare runtime secret sync failed.");
  }

  console.log("Cloudflare runtime Tradera credentials synchronized.");
} finally {
  try {
    unlinkSync(tempFile);
  } catch {}
}
