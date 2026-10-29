import { randomBytes } from "node:crypto";
import { errorResponse, requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { env } from "@/lib/env";

// Creates a one-time code; the user presses Start in Telegram, our webhook receives
// "/start <code>" and stores their chat id.
export async function POST() {
  try {
    const user = await requireUser();
    const bot = env().TELEGRAM_BOT_USERNAME;
    if (!bot) return Response.json({ error: "Telegram not configured" }, { status: 501 });
    const code = randomBytes(12).toString("base64url");
    await q("update notification_preferences set telegram_link_code = $2 where user_id = $1", [user.id, code]);
    return Response.json({ url: `https://t.me/${bot}?start=${code}` });
  } catch (e) {
    return errorResponse(e);
  }
}
