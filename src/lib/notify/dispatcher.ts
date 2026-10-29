import { q, q1 } from "../db";
import { env } from "../env";
import { backoffMs } from "../http";
import type { EventPayload } from "../monitor/check";
import { PermanentDeliveryError, sendEmail, sendPush, sendTelegram } from "./channels";
import { formatEmail, formatText, headlineFor } from "./format";

const MAX_ATTEMPTS = 6;

interface DeliveryRow {
  id: string;
  event_id: string;
  user_id: string;
  channel: "email" | "push" | "telegram";
  attempts: number;
}

/** Claim and send due deliveries. Safe to run concurrently (SKIP LOCKED lease). */
export async function dispatchDue(limit = 20): Promise<{ sent: number; failed: number }> {
  const due = await q<DeliveryRow>("select * from claim_deliveries($1, $2)", [limit, 120]);
  let sent = 0;
  let failed = 0;
  for (const d of due) {
    try {
      const messageId = await deliver(d);
      await q(`update notification_deliveries set status = 'sent', sent_at = now(), provider_message_id = $2, last_error = null, locked_until = null where id = $1`, [
        d.id,
        messageId,
      ]);
      sent++;
    } catch (e) {
      failed++;
      const permanent = e instanceof PermanentDeliveryError || d.attempts >= MAX_ATTEMPTS;
      await q(
        `update notification_deliveries set status = $2, last_error = $3, locked_until = null,
           next_attempt_at = now() + make_interval(secs => $4) where id = $1`,
        [d.id, permanent ? "failed" : "pending", (e as Error).message.slice(0, 500), Math.round(backoffMs(d.attempts, 15_000, 3600_000) / 1000)],
      );
      console.error(new Date().toISOString(), `[notify] ${d.channel} delivery ${d.id} ${permanent ? "failed" : "will retry"}:`, (e as Error).message);
    }
  }
  return { sent, failed };
}

async function deliver(d: DeliveryRow): Promise<string | null> {
  const ev = await q1<{ event_type: string; payload: EventPayload }>("select event_type, payload from notification_events where id = $1", [d.event_id]);
  if (!ev) throw new PermanentDeliveryError("event missing");
  const appUrl = env().APP_URL;
  const p = ev.payload;
  if (!p.bookingUrl) throw new PermanentDeliveryError("no verified booking URL");

  if (d.channel === "email") {
    const to = await q1<{ email: string | null }>(
      `select coalesce(p.email_address, pr.email) as email from notification_preferences p join profiles pr on pr.id = p.user_id where p.user_id = $1`,
      [d.user_id],
    );
    if (!to?.email) throw new PermanentDeliveryError("no email address");
    const msg = formatEmail(ev.event_type, p, appUrl);
    // Resend idempotency key = delivery id, so a retry after a crash can't double-send.
    return sendEmail(to.email, msg.subject, msg.html, msg.text, `delivery-${d.id}`);
  }

  if (d.channel === "push") {
    const subs = await q<{ id: string; endpoint: string; p256dh: string; auth: string }>(
      "select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1 and disabled_at is null",
      [d.user_id],
    );
    if (!subs.length) throw new PermanentDeliveryError("no active push subscriptions");
    const b = p.branches[0];
    const first = b?.screenings[0];
    const more = p.branches.length > 1 ? ` +${p.branches.length - 1} more cinema${p.branches.length > 2 ? "s" : ""}` : "";
    const payload = {
      title: `${headlineFor(ev.event_type, p).replace("🎬 ", "")} ${p.movieTitle}`,
      body: `${b?.branch ?? ""}${first ? ` · ${first.date} ${first.time}` : ""}${more}. ${p.kind === "listing" ? "Tap for all showtimes." : "Tap to book."}`,
      // listing alerts open our movie page (all days & times), booking alerts open the booking page
      url: p.kind === "listing" ? `${appUrl}/movie/${p.tmdbId}` : p.bookingUrl,
      tag: `event-${d.event_id}`,
      icon: p.posterPath ? `https://image.tmdb.org/t/p/w185${p.posterPath}` : undefined,
    };
    let delivered = 0;
    let lastErr: unknown;
    for (const s of subs) {
      try {
        await sendPush(s, payload);
        delivered++;
        await q("update push_subscriptions set last_success_at = now() where id = $1", [s.id]);
      } catch (e) {
        lastErr = e;
        if (e instanceof PermanentDeliveryError) await q("update push_subscriptions set disabled_at = now() where id = $1", [s.id]);
      }
    }
    if (!delivered) throw lastErr instanceof Error ? lastErr : new Error("push failed");
    return `${delivered}/${subs.length} devices`;
  }

  const chat = await q1<{ telegram_chat_id: string | null }>("select telegram_chat_id from notification_preferences where user_id = $1", [d.user_id]);
  if (!chat?.telegram_chat_id) throw new PermanentDeliveryError("telegram not linked");
  return sendTelegram(chat.telegram_chat_id, formatText(ev.event_type, p, appUrl));
}
