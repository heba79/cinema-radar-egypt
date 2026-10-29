import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { q } from "@/lib/db";

const sub = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = sub.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid subscription" }, { status: 400 });
    const { endpoint, keys } = parsed.data;
    await q(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values ($1,$2,$3,$4,$5)
       on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, disabled_at = null`,
      [user.id, endpoint, keys.p256dh, keys.auth, req.headers.get("user-agent")?.slice(0, 300) ?? null],
    );
    await q("update notification_preferences set push_enabled = true where user_id = $1", [user.id]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const { endpoint } = z.object({ endpoint: z.string() }).parse(await req.json());
    await q("update push_subscriptions set disabled_at = now() where user_id = $1 and endpoint = $2", [user.id, endpoint]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
