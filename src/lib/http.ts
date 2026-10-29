// Polite HTTP client for provider sites: honest User-Agent, per-host minimum
// gap between requests, robots.txt checks, timeouts, and exponential backoff.

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = true,
  ) {
    super(message);
  }
}

export function userAgent(): string {
  const contact = process.env.SCRAPER_CONTACT || "https://github.com/";
  return `CinemaRadarEgypt/1.0 (+${contact}; showtime availability alerts)`;
}

const lastRequestAt = new Map<string, number>();
const hostQueues = new Map<string, Promise<unknown>>();

async function waitForSlot(host: string, gapMs: number) {
  // Serialize requests per host so the gap holds even with concurrent callers.
  const prev = hostQueues.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  hostQueues.set(host, prev.then(() => mine));
  await prev;
  const wait = (lastRequestAt.get(host) ?? 0) + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
  release();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- robots.txt -----------------------------------------------------------
type Robots = { disallow: string[]; allow: string[]; fetchedAt: number };
const robotsCache = new Map<string, Robots>();

export function parseRobots(txt: string, agentToken: string): Omit<Robots, "fetchedAt"> {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === "allow" && val) cur.allow.push(val);
      if (key === "disallow" && val) cur.disallow.push(val);
    }
  }
  const token = agentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
  };
}

export function robotsAllows(rules: Omit<Robots, "fetchedAt">, path: string): boolean {
  const match = (p: string) => path.startsWith(p.replace(/\*$/, ""));
  const longest = (list: string[]) => list.filter(match).reduce((n, p) => Math.max(n, p.length), -1);
  const a = longest(rules.allow);
  const d = longest(rules.disallow);
  return d < 0 || a >= d;
}

async function checkRobots(url: URL): Promise<boolean> {
  const key = url.origin;
  let rules = robotsCache.get(key);
  if (!rules || Date.now() - rules.fetchedAt > 6 * 3600_000) {
    try {
      const res = await fetch(`${url.origin}/robots.txt`, {
        headers: { "user-agent": userAgent() },
        signal: AbortSignal.timeout(15_000),
      });
      const txt = res.ok ? await res.text() : "";
      rules = { ...parseRobots(txt, "CinemaRadarEgypt"), fetchedAt: Date.now() };
    } catch {
      // Unreachable robots.txt: treat as allow-all (RFC 9309 §2.3.1.3 for 4xx);
      // the main request will fail anyway if the host is down.
      rules = { allow: [], disallow: [], fetchedAt: Date.now() };
    }
    robotsCache.set(key, rules);
  }
  return robotsAllows(rules, url.pathname);
}

// --- fetch ------------------------------------------------------------------
export interface PoliteFetchOptions {
  minGapMs?: number;
  retries?: number;
  timeoutMs?: number;
  method?: "GET" | "HEAD";
}

export async function politeFetchText(target: string, opts: PoliteFetchOptions = {}): Promise<string> {
  const res = await politeFetch(target, opts);
  return res.text();
}

export async function politeFetch(target: string, opts: PoliteFetchOptions = {}): Promise<Response> {
  const url = new URL(target);
  const { minGapMs = 3000, retries = 2, timeoutMs = 25_000, method = "GET" } = opts;
  if (!(await checkRobots(url))) {
    throw new ProviderHttpError(`robots.txt disallows ${url.pathname}`, undefined, false);
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await waitForSlot(url.host, minGapMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { "user-agent": userAgent(), "accept-language": "en,ar;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new ProviderHttpError(`HTTP ${res.status} for ${url.pathname}`, res.status, retryable);
      if (!retryable) throw lastErr;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (retryAfter > 0) await sleep(Math.min(retryAfter, 120) * 1000);
    } catch (e) {
      if (e instanceof ProviderHttpError && !e.retryable) throw e;
      lastErr = e;
    }
    if (attempt < retries) await sleep(backoffMs(attempt));
  }
  throw lastErr instanceof Error ? lastErr : new ProviderHttpError(String(lastErr));
}

export function backoffMs(attempt: number, baseMs = 2000, maxMs = 60_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2)); // "equal jitter"
}
