// Laptop (local) worker coordination. The laptop reads Scene/VOX from a network those
// sites accept and reports through /api/ingest; while it is healthy, the cloud tick
// leaves those providers alone so the two never work (or alert) twice.
import { q } from "../db";

export const LOCAL_PROVIDERS = ["scene", "vox-egypt"] as const;
export type LocalProvider = (typeof LOCAL_PROVIDERS)[number];
/** A laptop heartbeat older than this means the laptop is off/asleep: the cloud takes over again. */
export const LOCAL_FRESH_MINUTES = 15;

/** Providers a recently-seen laptop worker reported as readable ("ok"). */
export async function laptopHandledProviders(): Promise<Set<string>> {
  const rows = await q<{ p: string }>(
    `select distinct p.key as p
       from worker_heartbeats h, jsonb_each_text(coalesce(h.details->'providers', '{}'::jsonb)) p
      where h.worker_id like 'laptop-%' and h.last_seen_at > now() - make_interval(mins => $1) and p.value = 'ok'`,
    [LOCAL_FRESH_MINUTES],
  );
  return new Set(rows.map((r) => r.p));
}
