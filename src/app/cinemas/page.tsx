import { MapPin, Ticket } from "lucide-react";
import Link from "next/link";
import { Poster } from "@/components/movie-card";
import { Badge, Card, Empty, SectionTitle, inputClass } from "@/components/ui";
import { q } from "@/lib/db";
import { formatDate } from "@/lib/notify/format";
import { cairoToday } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cinema explorer" };

type SP = Promise<{ city?: string; chain?: string; q?: string; bookable?: string; date?: string }>;

export default async function CinemasPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const today = cairoToday();
  const [cities, chains] = await Promise.all([
    q<{ city: string }>("select distinct city from cinema_branches where city is not null order by 1"),
    q<{ chain: string }>("select distinct chain from cinema_branches where chain is not null order by 1"),
  ]);
  const dates = await q<{ d: string }>("select distinct show_date::text d from screenings where active and show_date >= $1 order by 1 limit 7", [today]);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : (dates[0]?.d ?? today);

  const rows = await q<{
    branch_id: string;
    name: string;
    chain: string | null;
    city: string | null;
    area: string | null;
    address: string | null;
    online: boolean;
    movies: { tmdb_id: number; title: string; poster_path: string | null; times: string[]; booking_url: string | null }[];
  }>(
    `select b.id as branch_id, b.name, b.chain, b.city, b.area, b.address, b.online_booking_via_provider as online,
            json_agg(json_build_object('tmdb_id', x.tmdb_id, 'title', x.title, 'poster_path', x.poster_path, 'times', x.times, 'booking_url', x.booking_url)
                     order by x.booking_url is null, x.title) as movies
       from cinema_branches b
       join lateral (
         select m.tmdb_id, m.title, m.poster_path, array_agg(s.show_time order by s.starts_at) as times,
                max(s.booking_url) filter (where s.is_bookable and s.booking_url_broken_at is null) as booking_url
           from screenings s join movies m on m.id = s.movie_id
          where s.branch_id = b.id and s.active and s.show_date = $1 and m.tmdb_id > 0
          group by m.id) x on true
      where ($2::text is null or b.city = $2) and ($3::text is null or b.chain = $3)
        and ($4::text is null or b.name ilike '%' || $4 || '%' or x.title ilike '%' || $4 || '%')
        and (not $5 or x.booking_url is not null)
      group by b.id order by bool_or(x.booking_url is not null) desc, b.name`,
    [date, sp.city || null, sp.chain || null, sp.q?.slice(0, 60) || null, sp.bookable === "1"],
  );

  return (
    <div>
      <SectionTitle>Cinema explorer</SectionTitle>
      <form className="mb-6 grid gap-3 sm:grid-cols-5">
        <input name="q" defaultValue={sp.q} placeholder="Cinema or movie" className={`${inputClass} sm:col-span-2`} />
        <select name="city" defaultValue={sp.city ?? ""} className={inputClass}>
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c.city}>{c.city}</option>
          ))}
        </select>
        <select name="chain" defaultValue={sp.chain ?? ""} className={inputClass}>
          <option value="">All chains</option>
          {chains.map((c) => (
            <option key={c.chain}>{c.chain}</option>
          ))}
        </select>
        <select name="date" defaultValue={date} className={inputClass}>
          {(dates.length ? dates : [{ d: today }]).map((d) => (
            <option key={d.d} value={d.d}>
              {formatDate(d.d)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted sm:col-span-3">
          <input type="checkbox" name="bookable" value="1" defaultChecked={sp.bookable === "1"} className="accent-red-600" /> Only show online-bookable
        </label>
        <button className="h-11 rounded-xl bg-surface-2 text-sm font-semibold hover:bg-zinc-800 sm:col-span-2">Apply filters</button>
      </form>

      {rows.length === 0 ? (
        <Empty title="No showtimes match">
          Showtimes appear here for every movie the monitor has checked (everything playing in Egypt is refreshed hourly; watched movies every 5 minutes).
        </Empty>
      ) : (
        <div className="space-y-4">
          {rows.map((b) => (
            <Card key={b.branch_id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">{b.name}</p>
                  <p className="flex items-center gap-1.5 text-sm text-muted">
                    <MapPin className="h-4 w-4" /> {[b.area, b.city].filter(Boolean).join(", ") || "Egypt"}
                    {b.address ? <span className="hidden text-zinc-500 sm:inline"> · {b.address}</span> : null}
                  </p>
                </div>
                <div className="flex gap-2">
                  {b.chain && b.chain !== "Independent" && <Badge>{b.chain}</Badge>}
                  {b.online ? <Badge tone="green">Online booking</Badge> : <Badge tone="amber">Listing only</Badge>}
                </div>
              </div>
              <div className="scrollbar-none mt-4 flex gap-3 overflow-x-auto pb-1">
                {b.movies.map((m) => (
                  <div key={m.tmdb_id} className="w-40 shrink-0 rounded-xl border border-border bg-surface-2/60 p-2">
                    <Link href={`/movie/${m.tmdb_id}`} className="flex gap-2">
                      <div className="w-10 shrink-0 overflow-hidden rounded">
                        <Poster path={m.poster_path} alt={m.title} size="w92" />
                      </div>
                      <p className="line-clamp-3 text-xs font-semibold">{m.title}</p>
                    </Link>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted">{m.times.join(" · ")}</p>
                    {m.booking_url && (
                      <a href={m.booking_url} target="_blank" rel="noopener" className="mt-2 flex items-center justify-center gap-1 rounded-full bg-accent py-1.5 text-xs font-semibold text-white hover:bg-red-500">
                        <Ticket className="h-3.5 w-3.5" /> Book
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
