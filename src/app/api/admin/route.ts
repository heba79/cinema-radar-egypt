import { z } from "zod";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";

const body = z.object({ action: z.enum(["run_all_now", "retry_failed_deliveries"]) });

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { action } = body.parse(await req.json());
    if (action === "run_all_now") {
      const r = await q("update monitor_jobs set next_run_at = now() where enabled and priority >= 5 returning id");
      return Response.json({ message: `Queued ${r.length} jobs` });
    }
    const r = await q(
      `update notification_deliveries set status = 'pending', next_attempt_at = now(), attempts = 0
        where status = 'failed' and created_at > now() - interval '24 hours' returning id`,
    );
    return Response.json({ message: `Re-queued ${r.length} deliveries` });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: "Invalid action" }, { status: 400 });
    return errorResponse(e);
  }
}
