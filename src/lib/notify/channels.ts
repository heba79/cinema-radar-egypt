import { Resend } from "resend";
import webpush from "web-push";
import { env } from "../env";

export class PermanentDeliveryError extends Error {}

let resend: Resend | null = null;
export async function sendEmail(to: string, subject: string, html: string, text: string, idempotencyKey: string) {
  const e = env();
  if (!e.RESEND_API_KEY) throw new PermanentDeliveryError("RESEND_API_KEY not configured");
  resend ??= new Resend(e.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({ from: e.EMAIL_FROM, to, subject, html, text }, { idempotencyKey });
  if (error) {
    const permanent = ["validation_error", "invalid_from_address", "missing_required_field"].includes(error.name);
    throw permanent ? new PermanentDeliveryError(error.message) : new Error(error.message);
  }
  return data?.id ?? null;
}

let vapidSet = false;
export function pushConfigured() {
  const e = env();
  return !!(e.NEXT_PUBLIC_VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
}
export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: object) {
  const e = env();
  if (!pushConfigured()) throw new PermanentDeliveryError("VAPID keys not configured");
  if (!vapidSet) {
    webpush.setVapidDetails(e.VAPID_SUBJECT, e.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, e.VAPID_PRIVATE_KEY!);
    vapidSet = true;
  }
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
      TTL: 6 * 3600,
      urgency: "high",
    });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) throw new PermanentDeliveryError(`subscription gone (${status})`);
    throw err;
  }
}

export async function sendTelegram(chatId: string, text: string) {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) throw new PermanentDeliveryError("TELEGRAM_BOT_TOKEN not configured");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id: number } };
  if (!res.ok || !body.ok) {
    if (res.status === 403 || res.status === 400) throw new PermanentDeliveryError(body.description ?? `telegram ${res.status}`);
    throw new Error(body.description ?? `telegram ${res.status}`);
  }
  return String(body.result?.message_id ?? "");
}
