# Egyptian cinema provider investigation (Phase 1)

Investigated 2026-10-29. "Supported" below means an integration that works end to end against the live site and is covered by tests against saved fixtures in `tests/fixtures/`.

| Provider | Status | How | Interval | Booking link depth |
|---|---|---|---|---|
| **elCinema.com** | ✅ Working | Public HTML (no API) | 5 min watched / 60 min catalogue | movie + cinema (`/en/booking/<work>/<theater>`) |
| **Zawya** | ✅ Working (via elCinema) | Zawya's site says online booking is through elcinema.com/zawya | 5 min | movie + cinema |
| **Galaxy** (some branches) | 🟡 Partial (via elCinema) | Branches that sell on elCinema (e.g. El Maadi) | 5 min | movie + cinema |
| **VOX Cinemas Egypt** | 🟡 Partial | Public movie pages (no API) | 5 min watched | individual session (`/booking/<cinema>-<session>`) |
| **Scene Cinemas** | ✅ Working | Public branch sites (no API) | 5 min watched | individual session (`/showtime-<id>`) |
| Renaissance (Al Arabia) | ⚪ Not integrated | No reachable booking site/API found | — | — |
| Premiere, Cinema City, Sun City, Golden Stars, others | ⚪ Not integrated | Listed on elCinema without booking; booking in the chain's own app or at the box office | — | — |

## Scene Cinemas (scenecinemas.com)
- **API:** none public. **robots.txt:** `User-agent: * / Allow: /` on the main site and both branch subdomains.
- **Branches:** `cfc.scenecinemas.com` (Cairo Festival City) and `district5.scenecinemas.com` (District 5), both in New Cairo.
- **Pages used:** each branch's home page (catalogue) and `/movie-details/<slug>.html`. A movie page renders the current day's sessions per screen type (Standard, Premiere, ScreenX, 4DX), each linking to `/showtime-<id>`, the "Buy Tickets" page. If the current day has no sessions, the worker reads the first other offered day from `?business_day=DD-MM-YYYY&ajax=1`, the same URL the site uses. That is how advance booking is detected.
- **Every branch is checked for every linked title:** a branch can sell a film before listing it on its home page. On 29 Oct, District 5 was already selling *Sense and Sensibility* for 30 Oct.
- **Box-office-only sessions:** the site opens a "can't book online, buy at the counter" dialog via `showtime_from_cinema()`. Sessions wired to it are stored as listed but not bookable, and a booking page that triggers it fails verification.
- **Verification:** before alerting, the worker opens the session page (read-only; seat selection needs a further click) and checks it is a live "Buy Tickets" page.
- **Limitations:** no prices on the pages. Matching is by title, because no IMDb id is shown. Only the first day with sessions is read per check.

## elCinema.com
- **API:** none public.
- **robots.txt:** `User-agent: * / Allow: /` (Bing gets `Crawl-delay: 10`). We identify ourselves as `CinemaRadarEgypt/1.0 (+contact)` and keep ≥3 s between requests.
- **Pages used:**
  - `/en/available_for_booking/`: every title with an active "tickets" action. One request, polled every 5 minutes, and used to fast-track checks of watched movies.
  - `/en/now/eg/`, `/en/soon/eg/`: the catalogue.
  - `/en/work/<id>/`: IMDb id, Egyptian release date, title. Arabic title comes from `/work/<id>/`.
  - `/en/work/<id>/theater/eg`: every Egyptian cinema listing the film, per date tab, with showtimes. A cinema row carries a `tickets` button **only** when elCinema sells tickets there. That button is the bookability signal.
  - `/en/theater/<id>/`: city and area (from breadcrumbs), address, phone, and today's screen type and price per showtime.
- **Booking verification:** before alerting, the worker GETs the booking URL and checks that elCinema's booking form (`form#defaults`) shows the expected `work_id` and `theater_id`. We never call the booking AJAX endpoints (seat holds, payment).
- **Limitations:** prices and screen types are only shown for the current day. Cinemas listed without a tickets button may still sell at the box office or in their own app. We show these as "listed — online booking not open", never as bookable.
- **Terms:** robots.txt permits crawling. No API terms exist. Commercial use beyond personal alerts should be cleared with elCinema (DAMLAG S.A.E).

## VOX Cinemas Egypt (egy.voxcinemas.com)
- **API:** none public. The mobile app's API is private and not used.
- **robots.txt:** disallows `*/booking/`, `*/account/`, `*/orders/` and **any URL containing `?`**. `/movies/*` is allowed.
- **Pages used:** `/movies/whatson`, `/movies/comingsoon` (catalogue, with release dates for coming soon), and `/movies/<slug>`.
- **Key finding:** with no query string, a movie page shows the **first date that has sessions**. That is today for current films, or the first advance-booking date for upcoming ones (e.g. *Dune: Part Three* showed 17 Dec sessions on 29 Oct). Advance booking is therefore detectable without the disallowed `?d=` URLs.
- **Data:** branch (City Centre Alexandria, City Centre Almaza, Mall of Egypt), screen format (Standard, IMAX, MAX, VIP, …), and a session-level booking URL. No prices.
- **Booking verification:** `/booking/` is disallowed, so links are **not fetched**. A link is only used if it appeared on the official movie page during the same check and matches VOX's session URL format.
- **Limitations:** times for dates after the first available date aren't read. The date picker shows which dates exist. The site timed out from two networks earlier in the investigation and later responded normally, so the adapter retries with backoff and failures show as "provider temporarily unavailable". Matching is by title and year because VOX shows no IMDb id. Format variants ("X (Infinity Vision)") are linked to the same movie.
- **Interval:** ≥10 s between requests. Each watched movie costs one request per cycle.

## Renaissance Cinemas (Al Arabia Cinema)
No reachable official booking site (`renaissance-cinemas.com` does not resolve). Al Arabia's site is informational. Branches appear on elCinema as listings only. **Not integrated**, and never reported as bookable.

## Other chains
Premiere, Cinema City, Sun City, Golden Stars, Dandy Mall, Point 90 and others appear on elCinema with showtimes but without elCinema ticketing. Their booking happens in chain apps with no public API, or at the box office. Adding them needs either an authorised feed or a robots-permitted public page that exposes booking links. Each would be a new adapter in `src/lib/providers/<id>/` that implements `ProviderAdapter`.

## Adding a provider
1. Save real pages under `tests/fixtures/` and write pure parsers in `src/lib/providers/<id>/parse.ts`, with tests.
2. Implement `ProviderAdapter` in `adapter.ts`. Use `politeFetch` (robots.txt check, rate limit, backoff), and only emit booking URLs seen on the provider.
3. Register it in `src/lib/providers/registry.ts`. The worker creates its catalogue job automatically.
