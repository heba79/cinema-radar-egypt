# Laptop worker (Windows 11) — Scene & VOX from your home connection

Scene's and VOX's websites refuse our cloud server, but answer normal home connections.
This small program runs on your laptop every 10 minutes, reads Scene/VOX with the same
code the website uses, and sends what it saw to the website (`/api/ingest`). The website
then runs the normal checks and sends alerts — once, never duplicated.

**What it may read** (checked on every run; if a site starts blocking or challenging the
laptop, that site is paused for 6 hours — nothing ever tries to get around a block):

| Site | Allowed by robots.txt | What we read |
|---|---|---|
| Scene | everything (`Allow: /`) | movie pages, every listed day's sessions, one "Buy Tickets" page per branch (read-only) |
| VOX | `/movies/*` only — **not** booking pages or URLs with `?` | **disabled**: VOX's Akamai front end stalls every request that identifies itself as a monitor (even robots.txt). We don't disguise the monitor, so VOX stays off unless VOX allows it. |

It costs $0, holds **no database keys** (only a revocable worker token), and only runs
while you're signed in and the laptop is awake.

## One-time setup

You need: Windows 11, **Node.js 20+** (check: open PowerShell, type `node -v`;
if missing, install the "LTS" version from nodejs.org), and **Git** (`git --version`;
if missing: git-scm.com).

1. **Get a permanent copy** of the project (PowerShell):
   ```powershell
   git clone https://github.com/heba79/cinema-radar-egypt.git C:\CinemaRadar
   cd C:\CinemaRadar
   npm ci
   ```
2. **Add the worker token.** Create `C:\CinemaRadar\local-worker\.env` by copying
   `local-worker\.env.example`, and set `LOCAL_WORKER_TOKEN=` to the same value as
   `LOCAL_WORKER_TOKEN` on Vercel (Claude already created one — you can copy the whole
   file from the session folder, see the chat). Never share or commit this file.
3. **Access check** (reads nothing into the website):
   ```powershell
   npx tsx local-worker/run.ts --check
   ```
   Expect `scene: access ok`. VOX is switched off (`PROVIDERS=scene`); if you
   enable it, expect `vox-egypt: access error … timeout` — see the table above.
4. **Manual test run:**
   ```powershell
   npx tsx local-worker/run.ts --once
   ```
   Expect lines like `scene: <movie> — 28 session(s) read → {"status":"advance_booking",…}`.
5. **Turn on automatic runs** (every 10 minutes while you're signed in):
   ```powershell
   powershell -ExecutionPolicy Bypass -File local-worker\install-task.ps1
   ```
6. **Check it's working**: open https://cinema-radar-egypt.vercel.app/admin →
   *Laptop worker* shows **● Online** and `scene: ok`. Or open *Task Scheduler* →
   *Task Scheduler Library* → **CinemaRadarLocalWorker** → *Last Run Result* `0x0`.

## Everyday use
- **Logs:** `C:\CinemaRadar\local-worker\logs\worker-YYYY-MM-DD.log` (kept 14 days).
- **Pause for a site:** remove it from `PROVIDERS=` in `local-worker\.env` (default: `PROVIDERS=scene`).
- **Stop completely:** `powershell -ExecutionPolicy Bypass -File local-worker\uninstall-task.ps1`
- **Update after code changes:** `cd C:\CinemaRadar; git pull; npm ci`
- **Laptop asleep/off:** no Scene/VOX checks; after 15 minutes the website falls back
  to its cloud checks (elCinema keeps working; Scene/VOX show "temporarily unavailable").
- **Revoke the token** (e.g. lost laptop): change `LOCAL_WORKER_TOKEN` on Vercel and redeploy.
