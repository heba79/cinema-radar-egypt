# Cinema Radar Egypt — $0 operation plan

Measured on the live system (29 Oct 2026, ~03:00 Cairo) unless marked *estimate*. Free-tier
figures were checked against current public sources; anything a provider doesn't publish
officially is marked *unverified*.

## 1. Audit of services in use

| Service | Used for | Plan | Genuinely free? | Notes / risks |
|---|---|---|---|---|
| **Vercel** | Website + `/api/cron/tick` worker | Hobby | ✅ Yes | Non-commercial use only. No overage billing on Hobby: exceeding a limit **pauses** functions (up to the rest of the 30-day window) instead of charging. |
| **Supabase** | Postgres, Auth, pg_cron scheduler, pg_net | Free | ✅ Yes | Free projects pause after ~1 week of inactivity; ours is never idle (scheduler runs every minute). Built-in auth email sender is rate-limited and meant for testing (see §4). |
| **TMDB** | Movie metadata/posters | Free API | ✅ Yes | Non-commercial with attribution (footer already credits TMDB). |
| **Resend** | Email alerts | Free | ✅ Yes | 3,000/month, 100/day. Without your own (paid) domain it can only email **your own** address. |
| **Web Push (VAPID)** | Phone/browser push | Browser vendors' push services | ✅ Yes | No account, no limits we'd hit. iPhone needs iOS 16.4+ and the site **added to the Home Screen**. |
| **elCinema / Scene / VOX** | Showtime data | Public pages | ✅ Free | Scene and VOX refuse cloud servers (403 / timeouts). Not bypassed. |
| **Telegram bot** (optional, not configured) | Alerts | Free | ✅ Yes | Built, needs a bot token from @BotFather. |
| **Domain** | — | `*.vercel.app` | ✅ Free | No custom domain (would cost money). |
| **Fly.io** | — | not used | — | Removed (needed a card). |
| **GitHub** | — | not used yet | ✅ Free | Recommended only for keeping the code safe (private repo is free). |

Nothing currently in use costs money or has a card on file.

## 2. Free monitoring architectures compared

| Option | How often | Reliability | Cost | Verdict |
|---|---|---|---|---|
| **A. Supabase pg_cron → Vercel function (current)** | Every 1 min trigger; each run up to ~4 min | Very good: 60/60 runs succeeded in the last hour | $0 within limits | ✅ **Best. Keep.** |
| B. GitHub Actions `schedule` | Minimum 5 min, commonly **5–30+ min late**, can be skipped under load | Fair | Free for public repos; private repos ~2,000 min/month (*unverified*), our load would need ~8,000+ | ❌ Worse latency; only useful as a backup pinger |
| C. Vercel Cron (Hobby) | Once per day | — | $0 | ❌ Far too slow |
| D. Always-on VM (Fly, Railway, Render) | Continuous | Good | Needs a card / sleeps on free tiers | ❌ Not $0 |
| E. Your own PC/phone running the worker | Continuous while on | Depends on device | $0 | ⚠️ Possible as a helper, but stops when the device is off |

**Not guaranteed:** no free option promises execution on time. pg_cron fires reliably each minute, but each check still depends on Vercel and the cinema sites responding.

## 3. Estimated usage vs free limits

| Limit | Free allowance | Before optimisation (measured) | After this plan (*estimate*) |
|---|---|---|---|
| Vercel invocations | 1,000,000 / month | ~44,000 (1/min + page views) | ~44,000 (**4%**) |
| Vercel provisioned memory | 360 GB-hrs / month | ~307 s work + ~60 s overhead per hour → ~150–180 GB-hrs | ~90–110 GB-hrs (**~30%**) |
| Vercel Active CPU | 4 h / month | Unknown, *estimate* 3–6 h ⚠️ could exceed | Measured per run from now on; *estimate* 1.5–2.5 h (**~50%**) |
| Supabase DB size | 500 MB | 18 MB, but logs growing ~1 MB/day | < 60 MB steady state (**~12%**) |
| Supabase egress | 5 GB / month | *estimate* < 1 GB | < 1 GB (**< 20%**) |
| Resend email | 100/day, 3,000/month | 2 this month | 1 email per alert (**< 5%**) |
| Cinema sites | polite use | elCinema ~150 req/h, Scene ~40 req/h (all 403), VOX 2 timeouts/h | elCinema ~110 req/h; Scene/VOX ~2 probes/h |

Main risk: **Vercel Active CPU (4 h)**. The changes below cut the work and record real CPU per run, so the dashboard shows the projection against the limit.

## 4. Not reliably possible for $0

1. **Guaranteed 5-minute checks.** Nothing free guarantees timing. Target: watched movies every 5 min, elCinema's bookable list every 2 min, best effort.
2. **Scene & VOX booking links and their far-future dates from the cloud.** Both refuse cloud servers, and bypassing that would break their access rules. Their dates come via elCinema (~7 days ahead), with a link to their official sites.
3. **Confirmed ticket restocks / seat availability.** Seat counts only exist inside the booking flow (seat maps), which we don't drive. What we *can* detect: a showtime reappearing, new showtimes, new dates, and booking opening.
4. **Email to anyone other than you.** Resend without a paid domain only emails your own address, so other users get **push/Telegram** instead.
5. **Sign-in emails for other people.** Supabase's built-in auth email is for testing (rate-limited, limited recipients). Free fix: add Google/GitHub sign-in (OAuth is free); not done yet.
6. **iPhone push without installing.** Apple only allows web push for Home-Screen web apps (iOS 16.4+).
7. **Commercial use.** Vercel Hobby and TMDB's free API are non-commercial.

## 5. Zero-cost roadmap (implemented incrementally)

1. **Fit the free tiers:** background (unwatched) checks hourly → every 6 h; Scene/VOX catalogue syncs → every 6 h while blocked; a circuit breaker skips a failing provider for 30 min (it stays "temporarily unavailable", never "no tickets"); log availability only when it changes; purge scheduler history; record CPU and duration per run.
2. **Earlier advance-booking detection:** elCinema's "available for booking" list every 2 min (1 request) → fast-tracks your watched movie and sends the alert in the same run.
3. **Mobile push via PWA:** register the service worker site-wide, an install guide (iPhone: Share → Add to Home Screen; Android: Install app), a push "test" button, and booking links in every push.
4. **New showtimes:** Scene/VOX alerts for new dates **and** new showtimes on existing days (each announced once).
5. **Health dashboard:** free-tier usage projections, scheduler success, detection-to-alert latency, provider health.
6. **Never** upgrade or enable paid features. Hobby/Free plans cannot be charged.
