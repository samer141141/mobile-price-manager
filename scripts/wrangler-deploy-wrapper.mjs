#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { unlinkSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve("wrangler/package.json");
const realWrangler = join(dirname(packageJsonPath), "bin", "wrangler.js");
const args = process.argv.slice(2);
let tempFile = null;

try {
  if (args[0] === "deploy") {
    const appId = process.env.TRADERA_APP_ID?.trim();
    const appKey = process.env.TRADERA_APP_KEY?.trim();
    const hasSecretsFile = args.some(
      (arg) => arg === "--secrets-file" || arg.startsWith("--secrets-file="),
    );

    if (appId && appKey && !hasSecretsFile) {
      tempFile = join(process.cwd(), `.wrangler-deploy-secrets-${process.pid}.json`);
      writeFileSync(
        tempFile,
        JSON.stringify({
          TRADERA_APP_ID: appId,
          TRADERA_APP_KEY: appKey,
        }),
        { mode: 0o600 },
      );
      args.push("--secrets-file", tempFile);
      console.log("Tradera runtime secrets attached to Cloudflare deploy.");
    } else if (hasSecretsFile) {
      console.log("Tradera runtime secrets already attached to deploy.");
    } else {
      console.log("Tradera build credentials are not present; deploy will rely on existing Worker secrets.");
    }
  }

  const result = spawnSync(process.execPath, [realWrangler, ...args], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (tempFile) {
    try {
      unlinkSync(tempFile);
    } catch {}
  }
}
