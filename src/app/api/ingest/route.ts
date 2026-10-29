// Ingest endpoint for the laptop worker (local-worker/). The laptop reads Scene/VOX
// pages from a network those sites accept and posts what it saw; this endpoint runs
// the SAME check → dedupe → notification pipeline as the cloud monitor. The laptop
// only holds LOCAL_WORKER_TOKEN (revocable); it never gets database or API keys.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { q, q1 } from "@/lib/db";
import { env } from "@/lib/env";
import { checkMovieWithProvider, linkMovie, recordProviderResult, syncCatalog } from "@/lib/monitor/check";
import { LOCAL_PROVIDERS } from "@/lib/monitor/local";
import { dispatchDue } from "@/lib/notify/dispatcher";
import { activeAdapters } from "@/lib/providers/registry";
import { isSceneBookingUrl, SCENE_BRANCHES } from "@/lib/providers/scene/parse";
import type { MovieListing, ProviderAdapter } from "@/lib/providers/types";
import { isVoxBookingUrl, VOX_BRANCHES } from "@/lib/providers/vox/parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY = 1_000_000;
const CATALOG_STALE_HOURS = 6;
const provider = z.enum(LOCAL_PROVIDERS);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const slug = z.string().regex(/^[a-z0-9_-]{1,120}$/);

// Branches are only accepted when they are the provider's real, known sites.
const SCENE_NAMES = new Set<string>(Object.values(SCENE_BRANCHES).map((b) => b.name));
const VOX_NAMES = new Set(Object.keys(VOX_BRANCHES));
const branch = z.object({ externalId: z.string().regex(/^[a-z0-9]{1,20}$/), name: z.string().max(80), url: z.string().url().max(200) });
const listing = z.object({
  externalId: slug,
  sourceUrl: z.string().max(300),
  branches: z.array(branch.extend({ bookingUrl: z.string().max(200).optional() })).max(10),
  showtimes: z
    .array(
      z.object({
        branch,
        businessDate: isoDate,
        time: z.string().regex(/^\d{2}:\d{2} (AM|PM)$/),
        startsAt: z.string().datetime(),
        experience: z.string().max(40),
        priceEgp: z.number().positive().max(10_000).optional(),
        bookingUrl: z.string().max(200).optional(),
      }),
    )
    .max(1500),
});

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan") }),
  z.object({
    action: z.literal("catalog"),
    provider,
    entries: z
      .array(
        z.object({
          externalId: slug,
          titleEn: z.string().max(200).optional(),
          posterUrl: z.string().url().max(400).optional(),
          releaseDate: isoDate.optional(),
          inNowPlaying: z.boolean().optional(),
          inComingSoon: z.boolean().optional(),
        }),
      )
      .max(300),
  }),
  z.object({
    action: z.literal("listing"),
    provider,
    movieId: z.string().uuid(),
    listings: z.array(listing).max(10),
    verifiedBookingUrls: z.array(z.string().max(200)).max(200).default([]),
  }),
  z.object({
    action: z.literal("heartbeat"),
    workerId: z.string().regex(/^laptop-[A-Za-z0-9-]{1,40}$/),
    version: z.string().max(40),
    providers: z.record(provider, z.object({ state: z.enum(["ok", "blocked", "error", "disabled"]), detail: z.string().max(300).optional() })),
    lastRun: z.record(z.string(), z.unknown()).optional(),
  }),
]);

function authorized(req: Request) {
  const secret = env().LOCAL_WORKER_TOKEN;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return !!secret && secret.length >= 32 && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

/** Booking URLs / branches must be the provider's own, otherwise the reading is rejected. */
function validListing(p: (typeof LOCAL_PROVIDERS)[number], l: z.infer<typeof listing>) {
  const names = p === "scene" ? SCENE_NAMES : VOX_NAMES;
  const okUrl = (u?: string) => u === undefined || (p === "scene" ? isSceneBookingUrl(u) : isVoxBookingUrl(u));
  return l.branches.every((b) => names.has(b.name) && okUrl(b.bookingUrl)) && l.showtimes.every((s) => names.has(s.branch.name) && okUrl(s.bookingUrl));
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("forbidden", { status: 403 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "too large" }, { status: 413 });
  const parsed = body.safeParse(JSON.parse(raw || "{}"));
  if (!parsed.success) return Response.json({ error: "invalid", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  const b = parsed.data;

  if (b.action === "plan") {
    // watched movies and their Scene/VOX entries; catalogues due when older than 6 h
    const movies = await q<{ movie_id: string; title: string; links: Record<string, string[]> }>(
      `select w.movie_id, m.title,
              coalesce((select jsonb_object_agg(x.provider_id, x.ids) from (
                 select l.provider_id, jsonb_agg(l.external_id order by l.external_id) ids from provider_movie_links l
                  where l.movie_id = w.movie_id and l.provider_id = any($1) group by l.provider_id) x), '{}'::jsonb) links
         from (select distinct movie_id from watchlists where not paused) w join movies m on m.id = w.movie_id`,
      [[...LOCAL_PROVIDERS]],
    );
    const fresh = await q<{ provider_id: string }>(
      `select provider_id from provider_catalog where provider_id = any($1) group by 1 having max(last_seen_at) > now() - make_interval(hours => $2)`,
      [[...LOCAL_PROVIDERS], CATALOG_STALE_HOURS],
    );
    const catalogDue = LOCAL_PROVIDERS.filter((p) => !fresh.some((f) => f.provider_id === p));
    return Response.json({ movies, catalogDue });
  }

  if (b.action === "catalog") {
    const adapter = activeAdapters().find((a) => a.info.id === b.provider)!.adapter;
    const stats = await syncCatalog(adapter, 0, b.entries);
    await recordProviderResult(b.provider, true);
    // link watched movies that weren't matched yet
    const watched = await q<{ movie_id: string }>("select distinct movie_id from watchlists where not paused");
    let linked = 0;
    for (const w of watched) linked += (await linkMovie(b.provider, w.movie_id)).length > 0 ? 1 : 0;
    return Response.json({ ...stats, watchedLinked: linked });
  }

  if (b.action === "listing") {
    if (!b.listings.every((l) => validListing(b.provider, l))) return Response.json({ error: "listing contains unknown branches or foreign booking URLs" }, { status: 422 });
    const linked = await q<{ external_id: string }>("select external_id from provider_movie_links where provider_id = $1 and movie_id = $2", [b.provider, b.movieId]);
    const sent = new Set(b.listings.map((l) => l.externalId));
    if (linked.some((l) => !sent.has(l.external_id))) return Response.json({ error: "plan outdated: a linked entry is missing" }, { status: 409 });

    const real = activeAdapters().find((a) => a.info.id === b.provider)!.adapter;
    const byId = new Map<string, MovieListing>(
      b.listings.map((l) => [l.externalId, { ...l, showtimes: l.showtimes.map((s) => ({ ...s, startsAt: new Date(s.startsAt) })) }]),
    );
    const verified = new Set(b.verifiedBookingUrls);
    // Same pipeline, fed with the laptop's reading. Scene links count as verified only if the
    // laptop opened the "Buy Tickets" page; VOX booking pages are robots-disallowed, so (as in
    // the cloud) a VOX session link is accepted when it appeared on the official movie page.
    const proxy: ProviderAdapter = {
      ...real,
      fetchMovieListing: async (id) => byId.get(id) ?? { externalId: id, sourceUrl: "", showtimes: [], branches: [] },
      verifyBookingUrl: async (url) => (b.provider === "scene" ? verified.has(url) && isSceneBookingUrl(url) : isVoxBookingUrl(url)),
      fetchBranchDetails: undefined,
    };
    const result = await checkMovieWithProvider(proxy, b.movieId);
    await dispatchDue().catch(() => {}); // alerts go out now, not at the next cloud tick
    return Response.json(result);
  }

  // heartbeat
  await q(
    `insert into worker_heartbeats (worker_id, host, version, started_at, last_seen_at, details) values ($1,'laptop',$2, now(), now(), $3)
     on conflict (worker_id) do update set last_seen_at = now(), version = excluded.version, details = excluded.details`,
    [b.workerId, b.version, JSON.stringify({ providers: Object.fromEntries(Object.entries(b.providers).map(([k, v]) => [k, v.state])), detail: b.providers, lastRun: b.lastRun ?? null })],
  );
  for (const [p, v] of Object.entries(b.providers)) {
    if (v.state === "blocked" || v.state === "error") await recordProviderResult(p, false, `laptop: ${v.detail ?? v.state}`.slice(0, 300));
  }
  const ok = await q1<{ now: string }>("select now()::text now");
  return Response.json({ ok: true, serverTime: ok!.now });
}
