import { chmodSync, lstatSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const target = join(process.cwd(), "node_modules", ".bin", "wrangler");
const wrapper = `#!/usr/bin/env sh
exec node scripts/wrangler-deploy-wrapper.mjs "$@"
`;

try {
  lstatSync(target);
  unlinkSync(target);
} catch {}

writeFileSync(target, wrapper, { mode: 0o755 });
chmodSync(target, 0o755);
console.log("Wrangler deploy wrapper installed.");
