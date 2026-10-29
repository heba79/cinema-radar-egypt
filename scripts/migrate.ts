// Applies supabase/migrations/*.sql to DATABASE_URL (idempotent; safe to re-run).
//   npm run db:migrate            # uses .env.local
//   npm run db:migrate -- --check # only test the connection
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is empty");
  if (url.includes("[YOUR-PASSWORD]")) throw new Error("DATABASE_URL still contains [YOUR-PASSWORD]");
  const c = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  try {
    await c.connect();
  } catch (e) {
    // never echo the connection string (it contains the password)
    throw new Error(`could not connect: ${(e as Error).message.replaceAll(url, "<DATABASE_URL>")}`);
  }
  const who = await c.query("select current_user, split_part(version(), ',', 1) as v");
  console.log(`connected as ${who.rows[0].current_user} (${who.rows[0].v})`);
  if (process.argv.includes("--check")) return c.end();

  const dir = join(__dirname, "..", "supabase", "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    process.stdout.write(`applying ${f} … `);
    await c.query(readFileSync(join(dir, f), "utf8"));
    console.log("ok");
  }
  const t = await c.query(
    `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`,
  );
  console.log(`${t.rows.length} tables; RLS enabled on ${t.rows.filter((r) => r.relrowsecurity).length}`);
  const off = t.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  if (off.length) console.log("WARNING: RLS off on", off.join(", "));
  await c.end();
}

main().catch((e) => {
  console.error("✘", (e as Error).message);
  process.exit(1);
});
