// Sends the most recent real notification event, formatted exactly like a live alert, to one address.
//   npx tsx --env-file=.env.local scripts/send-test-alert.ts you@example.com
import { pool, q1 } from "../src/lib/db";
import { env } from "../src/lib/env";
import type { EventPayload } from "../src/lib/monitor/check";
import { sendEmail } from "../src/lib/notify/channels";
import { formatEmail } from "../src/lib/notify/format";

(async () => {
  const to = process.argv[2];
  if (!to) throw new Error("usage: send-test-alert.ts <email>");
  const ev = await q1<{ id: string; event_type: string; payload: EventPayload }>(
    "select id, event_type, payload from notification_events order by detected_at desc limit 1",
  );
  if (!ev) throw new Error("no events detected yet");
  const msg = formatEmail(ev.event_type, ev.payload, env().APP_URL);
  const id = await sendEmail(to, `[TEST] ${msg.subject}`, msg.html, msg.text, `test-alert-${ev.id}-${Date.now()}`);
  console.log(`sent "${msg.subject}" (${ev.payload.branches.length} cinemas) → Resend id ${id}`);
  await pool().end();
})().catch((e) => {
  console.error("✘", (e as Error).message);
  process.exit(1);
});
