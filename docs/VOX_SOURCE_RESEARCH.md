# VOX Egypt source feasibility — 2026-11-03

## Verified public-facing sources
- Official VOX Egypt home: https://egy.voxcinemas.com/home — exposes movie and cinema selectors to visitors; this **does not** establish permission for unattended scraping.
- Official VOX app page: https://egy.voxcinemas.com/vox-cinemas-app — advertises showtimes and booking in its consumer app; no public developer API documented there.
- VOX customer contact: https://egy.voxcinemas.com/contact-us — a route to request a permitted data feed / written approval.
- Independent historical integration writeup: https://www.canfactory.com/blog/vox-cinemas-vista-working-like-dream/ — describes Vista Connect OData/REST integration used by VOX in 2016; **not** evidence of public or currently accessible API credentials.
- Third-party open-source bot: https://github.com/omararafa295-cmd/Reservations-Monitor-Bot — claims to monitor VOX showtimes every 15 minutes, but its methods, permission, reliability, and compliance have **not** been verified. Do not copy anti-bot workarounds or credentials.

## Existing project observations
- VOX automated requests previously timed out or encountered Akamai protection on cloud and laptop.
- The existing adapter only accesses movie pages and avoids robots-disallowed booking endpoints.
- VOX stays disabled in the local worker; no claim of real-time availability.

## Safe next validation gates
1. Obtain documented permission or an officially available, non-restricted source for automated showtimes.
2. Validate robots policy and permitted paths before any automated access; fail closed on unavailable robots policy.
3. Test read-only parsing against fixtures first, with bounded requests, long backoff, and no login/session or seat locks.
4. Distinguish a movie's catalogue listing from a verified bookable session in the UI and alert pipeline.
5. Do not enable VOX monitoring until reliability and source permission are established.

## UI plan
- Phase 1: mobile-responsive discovery grid, text filter, Now Showing / Coming Soon, sorting (implemented in this branch).
- Phase 2: provider-backed cinema, hall, format, and date filters only when the listing API returns trustworthy structured values.
- Phase 3: alert configuration improvements, while preserving existing auth, watchlist, and notification behavior.

No deployment or VOX enablement is authorized by this research document.
