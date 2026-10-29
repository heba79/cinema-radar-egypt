import { politeFetch } from "../http";
import { elcinema } from "./elcinema/adapter";
import { scene } from "./scene/adapter";
import { vox } from "./vox/adapter";
import type { ProviderAdapter } from "./types";

export type IntegrationStatus = "working" | "partial" | "unavailable" | "not_integrated";

export interface ProviderInfo {
  id: string;
  name: string;
  website: string;
  kind: "ticketing_platform" | "chain" | "independent";
  integrationStatus: IntegrationStatus;
  pollIntervalSeconds: number;
  minRequestGapMs: number;
  coveredBy?: string;
  notes: string;
  adapter?: ProviderAdapter;
  /** URL used for reachability probes of providers without an adapter. */
  probeUrl?: string;
}

// Findings from the Phase 1 investigation (2026-10-29). See docs/PROVIDERS.md.
export const PROVIDERS: ProviderInfo[] = [
  {
    id: "elcinema",
    name: "elCinema.com",
    website: "https://elcinema.com",
    kind: "ticketing_platform",
    integrationStatus: "working",
    pollIntervalSeconds: 300,
    minRequestGapMs: 3000,
    notes:
      "No public API. robots.txt allows all agents. Public HTML lists every Egyptian cinema showing a film, per date, " +
      "and shows a 'tickets' action only where elCinema itself sells tickets (e.g. Zawya, Galaxy, El Tahrir, Zamalek). " +
      "Booking links open elCinema's official booking flow for that movie and cinema.",
    adapter: elcinema,
  },
  {
    id: "zawya",
    name: "Zawya Cinema",
    website: "https://zawyacinema.com",
    kind: "independent",
    integrationStatus: "working",
    pollIntervalSeconds: 300,
    minRequestGapMs: 3000,
    coveredBy: "elcinema",
    notes: "Zawya's own site states online booking is through elcinema.com/zawya, so it is monitored via the elCinema integration.",
  },
  {
    id: "vox-egypt",
    name: "VOX Cinemas Egypt",
    website: "https://egy.voxcinemas.com",
    kind: "chain",
    integrationStatus: "partial",
    pollIntervalSeconds: 300,
    minRequestGapMs: 10000,
    notes:
      "No public API. robots.txt allows movie pages but disallows booking pages and query-string URLs, so we read only each movie's " +
      "default page: it lists the first date with sessions (today, or the first advance-booking date) at City Centre Alexandria, " +
      "City Centre Almaza and Mall of Egypt, with screen format and a session-level booking link. Later dates' times aren't read, " +
      "and booking links are taken from the official page (not fetched). The site was intermittently unreachable during investigation.",
    adapter: vox,
  },
  {
    id: "renaissance",
    name: "Renaissance Cinemas (Al Arabia)",
    website: "https://alarabiacinema.com/renaissance",
    kind: "chain",
    integrationStatus: "not_integrated",
    pollIntervalSeconds: 3600,
    minRequestGapMs: 10000,
    notes: "No reachable online booking site or API found. Branch listings appear on elCinema (listed, not bookable through a supported provider).",
  },
  {
    id: "premiere",
    name: "Premiere Cinemas",
    website: "",
    kind: "chain",
    integrationStatus: "not_integrated",
    pollIntervalSeconds: 3600,
    minRequestGapMs: 10000,
    notes: "Listings visible on elCinema; no public booking endpoint found.",
  },
  {
    id: "scene",
    name: "Scene Cinemas",
    website: "https://scenecinemas.com",
    kind: "chain",
    integrationStatus: "partial",
    pollIntervalSeconds: 300,
    minRequestGapMs: 5000,
    notes:
      "Scene's servers answer home/mobile connections but return 403 Forbidden to cloud-hosting addresses (seen from Vercel, 29 Oct 2026), " +
      "so from the cloud deployment Scene checks show as temporarily unavailable — never as 'no tickets'. " +
      "No public API; robots.txt allows all. Each branch site (Cairo Festival City, District 5) lists the day's showtimes per screen " +
      "type (Standard, Premiere, ScreenX, 4DX) with a session-level 'Buy Tickets' link; other days load from a public day URL. " +
      "Box-office-only sessions are detected and never counted as bookable. Booking links are verified before alerting. No prices shown.",
    adapter: scene,
  },
  {
    id: "galaxy",
    name: "Galaxy Cinemas",
    website: "",
    kind: "chain",
    integrationStatus: "partial",
    pollIntervalSeconds: 300,
    minRequestGapMs: 3000,
    coveredBy: "elcinema",
    notes: "Several Galaxy branches (e.g. El Maadi) sell tickets on elCinema and are fully monitored there; others are listed only.",
  },
];

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);
export const activeAdapters = () => PROVIDERS.filter((p) => p.adapter).map((p) => ({ info: p, adapter: p.adapter! }));

export async function probeProvider(p: ProviderInfo): Promise<{ ok: boolean; detail: string }> {
  if (p.adapter) return p.adapter.probe();
  if (!p.probeUrl) return { ok: false, detail: "No integration" };
  try {
    const res = await politeFetch(p.probeUrl, { minGapMs: p.minRequestGapMs, retries: 0, timeoutMs: 20_000 });
    return { ok: true, detail: `Reachable (HTTP ${res.status}); showtime integration not built` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
