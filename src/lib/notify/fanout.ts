import { q, q1 } from "../db";

/** Create one pending delivery per (watcher, enabled channel). Idempotent via unique(event_id,user_id,channel). */
export async function fanOutEvent(eventId: string) {
  const ev = await q1<{ movie_id: string; event_type: string; cities: string[]; chains: string[] }>(
    `select e.movie_id, e.event_type,
            coalesce(array_agg(distinct b.city) filter (where b.city is not null), '{}') as cities,
            coalesce(array_agg(distinct b.chain) filter (where b.chain is not null), '{}') as chains
       from notification_events e
       left join notified_branches n on n.event_id = e.id
       left join cinema_branches b on b.id = n.branch_id
      where e.id = $1 group by e.id`,
    [eventId],
  );
  if (!ev) return 0;
  const prefCol = {
    advance_booking_opened: "notify_advance_booking",
    booking_opened: "notify_booking_opened",
    new_branch: "notify_new_branch",
    showtimes_listed: "notify_showtimes_listed",
  }[ev.event_type];
  if (!prefCol) return 0;

  const inserted = await q(
    `insert into notification_deliveries (event_id, user_id, channel)
     select $1, w.user_id, ch.channel
       from watchlists w
       join notification_preferences p on p.user_id = w.user_id
       join profiles pr on pr.id = w.user_id
       cross join lateral (values
         ('email'::notification_channel, p.email_enabled and coalesce(p.email_address, pr.email) is not null),
         ('push'::notification_channel, p.push_enabled and exists (select 1 from push_subscriptions s where s.user_id = w.user_id and s.disabled_at is null)),
         ('telegram'::notification_channel, p.telegram_enabled and p.telegram_chat_id is not null)
       ) as ch(channel, enabled)
      where w.movie_id = $2 and not w.paused and ch.enabled and p.${prefCol}
        -- new-branch alerts respect preferred cities / favourite chains when the user set them
        and ($3 <> 'new_branch' or cardinality(pr.preferred_cities) = 0 or pr.preferred_cities && $4::text[])
        and ($3 <> 'new_branch' or cardinality(pr.favorite_chains) = 0 or pr.favorite_chains && $5::text[])
     on conflict (event_id, user_id, channel) do nothing
     returning id`,
    [eventId, ev.movie_id, ev.event_type, ev.cities, ev.chains],
  );
  await q("update notification_events set fanned_out_at = now() where id = $1", [eventId]);
  return inserted.length;
}
