import { timingSafeEqual } from "node:crypto";
import { q1 } from "@/lib/db";
import { env } from "@/lib/env";
import { sendTelegram } from "@/lib/notify/channels";

// Register with: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<APP_URL>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
export async function POST(req: Request) {
  const secret = env().TELEGRAM_WEBHOOK_SECRET;
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await req.json().catch(() => null)) as { message?: { chat?: { id: number }; text?: string } } | null;
  const chatId = update?.message?.chat?.id;
  const text = update?.message?.text ?? "";
  if (!chatId) return Response.json({ ok: true });

  const m = text.match(/^\/start\s+([A-Za-z0-9_-]{8,64})$/);
  if (m) {
    const row = await q1<{ user_id: string }>(
      `update notification_preferences set telegram_chat_id = $2, telegram_enabled = true, telegram_link_code = null
        where telegram_link_code = $1 returning user_id`,
      [m[1], String(chatId)],
    );
    await sendTelegram(
      String(chatId),
      row ? "✅ Linked! You'll get Cinema Radar Egypt ticket alerts here." : "That link has expired — generate a new one from Settings.",
    ).catch(() => {});
  } else if (text.startsWith("/stop")) {
    await q1("update notification_preferences set telegram_enabled = false where telegram_chat_id = $1 returning user_id", [String(chatId)]);
    await sendTelegram(String(chatId), "Telegram alerts turned off. Re-enable them in Settings.").catch(() => {});
  }
  return Response.json({ ok: true });
}
