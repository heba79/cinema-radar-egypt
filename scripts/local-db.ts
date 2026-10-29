// Local Postgres for development/tests without Docker or a Supabase project.
// Runs PGlite (real Postgres compiled to WASM) behind the Postgres wire protocol,
// stubs the bits of Supabase's `auth` schema the migration needs, and applies
// supabase/migrations/*.sql.
//
//   npx tsx scripts/local-db.ts            # serves postgres://postgres@127.0.0.1:54329/postgres
//   DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npm run worker
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export async function createLocalDb(dataDir?: string) {
  const db = await PGlite.create({ dataDir, extensions: { pg_trgm, pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
    create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  `);
  const dir = join(__dirname, "..", "supabase", "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  return db;
}

if (require.main === module) {
  (async () => {
    const port = Number(process.env.LOCAL_DB_PORT ?? 54329);
    const db = await createLocalDb(process.env.LOCAL_DB_DIR);
    const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 20 });
    await server.start();
    console.log(`local postgres ready: postgres://postgres@127.0.0.1:${port}/postgres`);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
