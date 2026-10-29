import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";

// Return DATE columns as 'YYYY-MM-DD' strings (not JS Dates shifted by the server's timezone).
types.setTypeParser(types.builtins.DATE, (v) => v);

// One pool per process. In Next.js dev, survive hot reloads via globalThis.
const g = globalThis as unknown as { __pgPool?: Pool };

export function pool(): Pool {
  if (!g.__pgPool) {
    const url = env().DATABASE_URL;
    g.__pgPool = new Pool({
      connectionString: url,
      max: process.env.PG_POOL_MAX ? Number(process.env.PG_POOL_MAX) : 5,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
      idleTimeoutMillis: 30_000,
    });
    g.__pgPool.on("error", (err) => console.error("[db] idle client error", err));
  }
  return g.__pgPool;
}

export async function q<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query<T>(sql, params);
  return res.rows;
}

export async function q1<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
