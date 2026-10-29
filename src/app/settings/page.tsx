import { redirect } from "next/navigation";
import { InstallGuide } from "@/components/pwa";
import { SettingsForm, type Settings } from "@/components/settings-form";
import { SectionTitle } from "@/components/ui";
import { currentUser } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings");
  const s = await q1<Settings>(
    `select coalesce(p.email_address, pr.email) as email_address, p.email_enabled, p.push_enabled, p.telegram_enabled,
            p.telegram_chat_id is not null as telegram_linked, p.notify_advance_booking, p.notify_booking_opened, p.notify_new_branch, p.notify_showtimes_listed,
            pr.preferred_cities, pr.favorite_chains,
            (select count(*)::int from push_subscriptions ps where ps.user_id = p.user_id and ps.disabled_at is null) as push_devices
       from notification_preferences p join profiles pr on pr.id = p.user_id where p.user_id = $1`,
    [user.id],
  );
  const cities = (await q<{ city: string }>("select distinct city from cinema_branches where city is not null order by 1")).map((r) => r.city);
  const chains = (await q<{ chain: string }>("select distinct chain from cinema_branches where chain is not null order by 1")).map((r) => r.chain);
  const e = env();
  return (
    <div className="max-w-2xl">
      <SectionTitle>Settings</SectionTitle>
      <div className="mb-5">
        <InstallGuide />
      </div>
      <SettingsForm
        initial={s!}
        cities={cities}
        chains={chains}
        vapidPublicKey={e.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        telegramBot={e.TELEGRAM_BOT_USERNAME ?? null}
        accountEmail={user.email}
      />
    </div>
  );
}
