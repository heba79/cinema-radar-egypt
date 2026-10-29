import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { userAgent } from "@/lib/http";

// Admin diagnostic: fetch one cinema page FROM the production server (same User-Agent
// as the monitor) and report what we actually receive. Secret-protected, provider hosts only.
export const dynamic = "force-dynamic";
const ALLOWED = /^(cfc|district5)\.scenecinemas\.com$|^(www\.)?scenecinemas\.com$|^egy\.voxcinemas\.com$|^elcinema\.com$/;

function authorized(req: Request) {
  const secret = env().CRON_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return !!secret && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("forbidden", { status: 403 });
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  let target: URL;
  try {
    target = new URL(url ?? "");
  } catch {
    return Response.json({ error: "bad url" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED.test(target.hostname)) return Response.json({ error: "host not allowed" }, { status: 400 });

  const hops: { url: string; status: number }[] = [];
  let current = target.toString();
  let res: Response | null = null;
  const t0 = Date.now();
  try {
    for (let i = 0; i < 5; i++) {
      res = await fetch(current, { redirect: "manual", headers: { "user-agent": userAgent(), "accept-language": "en,ar;q=0.8" }, signal: AbortSignal.timeout(20_000) });
      hops.push({ url: current, status: res.status });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) current = new URL(loc, current).toString();
      else break;
    }
  } catch (e) {
    return Response.json({ region: process.env.VERCEL_REGION ?? null, hops, error: (e as Error).message, ms: Date.now() - t0 });
  }
  const body = await res!.text();
  const pick = (h: string) => res!.headers.get(h);
  return Response.json({
    region: process.env.VERCEL_REGION ?? null,
    hops,
    status: res!.status,
    bytes: body.length,
    ms: Date.now() - t0,
    headers: { server: pick("server"), "content-type": pick("content-type"), "cf-ray": pick("cf-ray"), "cf-mitigated": pick("cf-mitigated") },
    title: body.match(/<title>([^<]*)/i)?.[1]?.trim().slice(0, 120) ?? null,
    markers: {
      dateIds: [...new Set(body.match(/data-\d{2}-\d{2}-\d{4}/g) ?? [])],
      showtimeLinks: new Set(body.match(/showtime-[0-9a-f]{24}/g) ?? []).size,
      cloudflareChallenge: /cf-chl|challenge-platform|Just a moment|Attention Required/i.test(body),
    },
    snippet: body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
  });
}
