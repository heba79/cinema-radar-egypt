// Cinema Radar Egypt — laptop worker (Windows 11, Node.js).
//
// Reads Scene and VOX with the SAME readers the cloud uses, from your home connection
// (which those sites accept; they refuse cloud servers), and sends what it saw to the
// protected /api/ingest endpoint. The server runs the normal check → dedupe → alert
// pipeline, so alerts are never sent twice and no database keys live on the laptop.
//
//   npx tsx local-worker/run.ts --check   access & policy checks only (no data sent)
//   npx tsx local-worker/run.ts --once    one full monitoring run, verbose
//   npx tsx local-worker/run.ts           scheduled run (what Task Scheduler starts)
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

const DIR = __dirname;
const VERSION = "laptop-1.0.0";
const LOG_DIR = join(DIR, "logs");
const STATE_FILE = join(DIR, "state.json");
const LOCK_FILE = join(DIR, "run.lock");
const BLOCK_HOURS = 6; // a site that blocks/challenges us is left alone this long
const PROVIDERS = ["scene", "vox-egypt"] as const;
type Provider = (typeof PROVIDERS)[number];
type ProviderState = { state: "ok" | "blocked" | "error" | "disabled"; detail?: string };

// ---------- config (local-worker/.env, never committed) ----------
function loadConfig() {
  const file = join(DIR, ".env");
  if (!existsSync(file)) throw new Error(`missing ${file} — see local-worker/README.md`);
  const env = Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
  if (!env.LOCAL_WORKER_TOKEN || env.LOCAL_WORKER_TOKEN.length < 32) throw new Error("LOCAL_WORKER_TOKEN missing in local-worker/.env");
  const enabled = (env.PROVIDERS ?? "scene,vox-egypt").split(",").map((s) => s.trim()) as Provider[];
  process.env.SCRAPER_CONTACT = env.SCRAPER_CONTACT ?? "https://cinema-radar-egypt.vercel.app";
  return { ingestUrl: env.INGEST_URL ?? "https://cinema-radar-egypt.vercel.app/api/ingest", token: env.LOCAL_WORKER_TOKEN, enabled };
}

// ---------- logging (logs/worker-YYYY-MM-DD.log, kept 14 days) ----------
mkdirSync(LOG_DIR, { recursive: true });
const verbose = process.argv.includes("--once") || process.argv.includes("--check");
function log(...a: unknown[]) {
  const line = `${new Date().toISOString()} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`;
  appendFileSync(join(LOG_DIR, `worker-${line.slice(0, 10)}.log`), line + "\n");
  if (verbose) console.log(line);
}
function pruneLogs() {
  for (const f of readdirSync(LOG_DIR)) if (Date.now() - statSync(join(LOG_DIR, f)).mtimeMs > 14 * 86_400_000) unlinkSync(join(LOG_DIR, f));
}

// ---------- state & lock ----------
type State = { blockedUntil: Partial<Record<Provider, string>>; errors: Partial<Record<Provider, number>>; retryAt: Partial<Record<Provider, string>> };
const readState = (): State => {
  try {
    return { blockedUntil: {}, errors: {}, retryAt: {}, ...JSON.parse(readFileSync(STATE_FILE, "utf8")) };
  } catch {
    return { blockedUntil: {}, errors: {}, retryAt: {} };
  }
};
const saveState = (s: State) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
function takeLock(): boolean {
  if (existsSync(LOCK_FILE) && Date.now() - statSync(LOCK_FILE).mtimeMs < 20 * 60_000) return false; // previous run still going
  writeFileSync(LOCK_FILE, String(process.pid));
  return true;
}

// ---------- server calls (HTTPS + bearer token, retried) ----------
async function ingest<T>(cfg: ReturnType<typeof loadConfig>, payload: object): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(cfg.ingestUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      if (res.status === 403) throw Object.assign(new Error("server rejected the worker token (403)"), { fatal: true });
      if (!res.ok) throw new Error(`ingest ${res.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text) as T;
    } catch (e) {
      last = e;
      if ((e as { fatal?: boolean }).fatal) throw e;
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  throw last;
}

// ---------- provider access checks (robots.txt + a real page, no challenge) ----------
const ACCESS: Record<Provider, { robots: string; paths: string[]; page: string }> = {
  scene: { robots: "https://cfc.scenecinemas.com/robots.txt", paths: ["/", "/movie-details/x.html"], page: "https://cfc.scenecinemas.com/" },
  "vox-egypt": { robots: "https://egy.voxcinemas.com/robots.txt", paths: ["/movies/whatson", "/movies/x"], page: "https://egy.voxcinemas.com/movies/whatson" },
};

async function accessCheck(p: Provider): Promise<ProviderState> {
  const { parseRobots, robotsAllows, politeFetchText, ProviderHttpError } = await import("../src/lib/http");
  try {
    const robotsRes = await fetch(ACCESS[p].robots, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": (await import("../src/lib/http")).userAgent() } });
    const rules = parseRobots(robotsRes.ok ? await robotsRes.text() : "", "CinemaRadarEgypt");
    const denied = ACCESS[p].paths.filter((path) => !robotsAllows(rules, path));
    if (denied.length) return { state: "disabled", detail: `robots.txt disallows ${denied.join(", ")}` };
    await politeFetchText(ACCESS[p].page, { retries: 1, timeoutMs: 25_000 }); // throws on 403 / challenge
    return { state: "ok", detail: "robots.txt allows; page readable without challenge" };
  } catch (e) {
    const blocked = e instanceof ProviderHttpError && (e.status === 403 || e.status === 429 || !e.retryable);
    return { state: blocked ? "blocked" : "error", detail: (e as Error).message.slice(0, 200) };
  }
}

// ---------- one run ----------
async function main() {
  const cfg = loadConfig();
  const checkOnly = process.argv.includes("--check");
  if (!checkOnly && !takeLock()) return log("previous run still active — skipping");
  pruneLogs();
  const state = readState();
  const workerId = `laptop-${hostname().replace(/[^A-Za-z0-9-]/g, "").slice(0, 30) || "pc"}`;
  const status: Partial<Record<Provider, ProviderState>> = {};
  const summary: Record<string, unknown> = { startedAt: new Date().toISOString() };

  try {
    // server reachable + token accepted
    const plan = await ingest<{ movies: { movie_id: string; title: string; links: Record<string, string[]> }[]; catalogDue: string[] }>(cfg, { action: "plan" });
    log(`server OK — ${plan.movies.length} watched movie(s): ${plan.movies.map((m) => m.title).join(", ")}`);

    for (const p of PROVIDERS) {
      if (!cfg.enabled.includes(p)) {
        status[p] = { state: "disabled", detail: "disabled in local-worker/.env" };
        continue;
      }
      const until = state.blockedUntil[p];
      if (until && Date.parse(until) > Date.now()) {
        status[p] = { state: "blocked", detail: `paused until ${until} after the site blocked us` };
        log(`${p}: paused (blocked) until ${until}`);
        continue;
      }
      if (!checkOnly && state.retryAt[p] && Date.parse(state.retryAt[p]!) > Date.now()) {
        status[p] = { state: "error", detail: `waiting to retry until ${state.retryAt[p]}` };
        continue;
      }
      const access = await accessCheck(p);
      status[p] = access;
      log(`${p}: access ${access.state} — ${access.detail}`);
      if (access.state === "blocked") state.blockedUntil[p] = new Date(Date.now() + BLOCK_HOURS * 3600_000).toISOString();
      if (access.state === "error") {
        const n = (state.errors[p] ?? 0) + 1;
        state.errors[p] = n;
        state.retryAt[p] = new Date(Date.now() + Math.min(60, 5 * 2 ** (n - 1)) * 60_000).toISOString(); // 5,10,20,40,60 min
      }
      if (access.state !== "ok" || checkOnly) continue;
      state.errors[p] = 0;
      delete state.retryAt[p];
      await runProvider(cfg, p, plan, summary).catch((e) => {
        status[p] = { state: "error", detail: (e as Error).message.slice(0, 200) };
        log(`${p}: run failed — ${(e as Error).message}`);
      });
    }
  } catch (e) {
    log(`FAILED: ${(e as Error).message}`);
    if ((e as { fatal?: boolean }).fatal) process.exitCode = 2;
  } finally {
    saveState(state);
    if (!checkOnly) {
      summary.finishedAt = new Date().toISOString();
      await ingest(cfg, { action: "heartbeat", workerId, version: VERSION, providers: status, lastRun: summary }).catch((e) => log(`heartbeat failed: ${(e as Error).message}`));
      if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
    }
    log(`done ${JSON.stringify(status)}`);
  }
}

async function runProvider(
  cfg: ReturnType<typeof loadConfig>,
  p: Provider,
  plan: { movies: { movie_id: string; title: string; links: Record<string, string[]> }[]; catalogDue: string[] },
  summary: Record<string, unknown>,
) {
  const { scene } = await import("../src/lib/providers/scene/adapter");
  const { vox } = await import("../src/lib/providers/vox/adapter");
  const { politeFetch } = await import("../src/lib/http");
  const { looksLikeSceneBookingPage } = await import("../src/lib/providers/scene/parse");
  const adapter = p === "scene" ? scene : vox;

  if (plan.catalogDue.includes(p)) {
    const entries = await adapter.fetchCatalog!();
    const r = await ingest(cfg, { action: "catalog", provider: p, entries });
    log(`${p}: catalogue ${entries.length} titles sent`, r);
    plan = await ingest(cfg, { action: "plan" }); // links may have changed
  }

  for (const m of plan.movies) {
    const ids = m.links[p] ?? [];
    if (!ids.length) continue;
    const listings = [];
    for (const id of ids) listings.push(await adapter.fetchMovieListing(id));
    // Scene: open each branch's first "Buy Tickets" page (read-only) to confirm the link works.
    const verified: string[] = [];
    if (p === "scene") {
      for (const b of listings.flatMap((l) => l.branches)) {
        if (!b.bookingUrl) continue;
        const res = await politeFetch(b.bookingUrl, { minGapMs: 5000, retries: 1 }).catch(() => null);
        if (res && looksLikeSceneBookingPage(await res.text())) verified.push(...listings.flatMap((l) => l.showtimes.filter((s) => s.branch.externalId === b.externalId && s.bookingUrl).map((s) => s.bookingUrl!)));
      }
    }
    const sessions = listings.reduce((n, l) => n + l.showtimes.length, 0);
    const result = await ingest(cfg, { action: "listing", provider: p, movieId: m.movie_id, listings, verifiedBookingUrls: [...new Set(verified)] });
    log(`${p}: ${m.title} — ${sessions} session(s) read →`, result);
    summary[`${p}:${m.title}`] = { sessions, result };
  }
}

main();
