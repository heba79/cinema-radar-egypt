import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { q } from "@/lib/db";

const schema = z.object({
  email_address: z.string().trim().email().max(254).nullable().or(z.literal("").transform(() => null)),
  email_enabled: z.boolean(),
  push_enabled: z.boolean(),
  telegram_enabled: z.boolean(),
  notify_advance_booking: z.boolean(),
  notify_booking_opened: z.boolean(),
  notify_new_branch: z.boolean(),
  notify_showtimes_listed: z.boolean(),
  preferred_cities: z.array(z.string().max(80)).max(50),
  favorite_chains: z.array(z.string().max(80)).max(50),
});

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
    const s = parsed.data;
    await q(
      `update notification_preferences set email_address = $2, email_enabled = $3, push_enabled = $4, telegram_enabled = $5,
         notify_advance_booking = $6, notify_booking_opened = $7, notify_new_branch = $8, notify_showtimes_listed = $9, updated_at = now() where user_id = $1`,
      [user.id, s.email_address, s.email_enabled, s.push_enabled, s.telegram_enabled, s.notify_advance_booking, s.notify_booking_opened, s.notify_new_branch, s.notify_showtimes_listed],
    );
    await q(`update profiles set preferred_cities = $2, favorite_chains = $3, updated_at = now() where id = $1`, [user.id, s.preferred_cities, s.favorite_chains]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
