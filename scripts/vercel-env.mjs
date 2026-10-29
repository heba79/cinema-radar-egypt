// Copies .env.local settings to the linked Vercel project's production environment
// without printing any values.   node scripts/vercel-env.mjs https://your-app.vercel.app
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const appUrl = process.argv[2];
if (!/^https:\/\//.test(appUrl ?? "")) throw new Error("usage: vercel-env.mjs <https production url>");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);
const token = env.VERCEL_TOKEN;
const SKIP = new Set(["VERCEL_TOKEN", "VERCEL_OIDC_TOKEN", "PG_POOL_MAX"]);
const out = { ...env };
// Serverless → Supabase transaction pooler (port 6543), small pool per instance.
out.DATABASE_URL = env.DATABASE_URL.replace(":5432/", ":6543/");
out.PG_POOL_MAX = "3";
out.APP_URL = appUrl;
out.SCRAPER_CONTACT = appUrl;

const vercel = (args, input) =>
  spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vercel@latest", ...args, "--token", token], {
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

for (const [k, v] of Object.entries(out)) {
  if (SKIP.has(k) && k !== "PG_POOL_MAX") continue;
  if (!v) continue;
  vercel(["env", "rm", k, "production", "--yes"]);
  const r = vercel(["env", "add", k, "production"], v);
  console.log(`${k.padEnd(30)} ${r.status === 0 ? "✓" : "✘ " + (r.stderr || r.stdout).split("\n").filter(Boolean).pop()}`);
}
