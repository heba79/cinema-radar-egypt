import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { env } from "@/lib/env";
import { PermanentDeliveryError, sendEmail, sendPush, sendTelegram } from "@/lib/notify/channels";

// Sends a clearly-labelled TEST message to the signed-in user to verify a channel.
// It contains no booking link (we never fabricate one).
const body = z.object({ channel: z.enum(["email", "push", "telegram"]) });
const lastTest = new Map<string, number>();

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { channel } = body.parse(await req.json());
    const key = `${user.id}:${channel}`;
    if (Date.now() - (lastTest.get(key) ?? 0) < 30_000) return Response.json({ error: "Wait 30s between tests" }, { status: 429 });
    lastTest.set(key, Date.now());
    const appUrl = env().APP_URL;
    const text = `🧪 TEST ALERT from Cinema Radar Egypt\n\nThis channel works. Real alerts look like "🎬 TICKETS ARE LIVE!" and include a verified booking link.\n\n${appUrl}/watchlist`;

    if (channel === "email") {
      const p = await q1<{ email: string | null }>(
        "select coalesce(p.email_address, pr.email) email from notification_preferences p join profiles pr on pr.id = p.user_id where p.user_id = $1",
        [user.id],
      );
      if (!p?.email) return Response.json({ error: "No email address" }, { status: 400 });
      const id = await sendEmail(p.email, "🧪 Test alert — Cinema Radar Egypt", `<pre style="font-family:inherit">${text}</pre>`, text, `test-${user.id}-${Date.now()}`);
      return Response.json({ ok: true, detail: id });
    }
    if (channel === "push") {
      const subs = await q<{ endpoint: string; p256dh: string; auth: string }>(
        "select endpoint, p256dh, auth from push_subscriptions where user_id = $1 and disabled_at is null",
        [user.id],
      );
      if (!subs.length) return Response.json({ error: "No devices registered — tap 'Enable on this device' first" }, { status: 400 });
      let ok = 0;
      for (const s of subs) ok += await sendPush(s, { title: "🧪 Test alert", body: "Push notifications work on this device.", url: `${appUrl}/watchlist` }).then(() => 1, () => 0);
      return ok ? Response.json({ ok: true, detail: `${ok}/${subs.length} devices` }) : Response.json({ error: "Push failed" }, { status: 502 });
    }
    const t = await q1<{ telegram_chat_id: string | null }>("select telegram_chat_id from notification_preferences where user_id = $1", [user.id]);
    if (!t?.telegram_chat_id) return Response.json({ error: "Telegram not linked" }, { status: 400 });
    await sendTelegram(t.telegram_chat_id, text);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: "Invalid channel" }, { status: 400 });
    if (e instanceof PermanentDeliveryError) return Response.json({ error: e.message }, { status: 400 });
    return errorResponse(e);
  }
}
