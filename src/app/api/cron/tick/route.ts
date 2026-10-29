import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { env } from "@/lib/env";
import { runTick } from "@/lib/monitor/runner";

// Called every minute by Supabase pg_cron (see scripts/schedule-cron.ts).
// Responds immediately and does the work after the response, within maxDuration.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const secret = env().CRON_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return !!secret && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("forbidden", { status: 403 });
  after(async () => {
    try {
      const r = await runTick(240_000);
      console.log("[tick]", JSON.stringify(r));
    } catch (e) {
      console.error("[tick] failed", e);
    }
  });
  return Response.json({ accepted: true }, { status: 202 });
}
