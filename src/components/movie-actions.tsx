"use client";
import { Bell, BellRing, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "./ui";

export function NotifyButton({ tmdbId, signedIn, watching }: { tmdbId: number; signedIn: boolean; watching: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(watching);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle() {
    if (!signedIn) {
      router.push(`/login?next=/movie/${tmdbId}`);
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/watchlist", {
      method: on ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdbId }),
    });
    setBusy(false);
    if (res.ok) {
      setOn(!on);
      setMsg(on ? "Stopped tracking." : "Tracking 24/7 — we'll alert you when tickets open.");
      router.refresh();
    } else setMsg((await res.json().catch(() => ({}))).error ?? "Something went wrong");
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant={on ? "secondary" : "primary"} size="lg" onClick={toggle} disabled={busy} className={on ? "" : "bg-white text-black hover:bg-zinc-200 shadow-none"}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : on ? <BellRing className="h-5 w-5 text-accent" /> : <Bell className="h-5 w-5" />}
        {on ? "Tracking — tap to stop" : "Notify me"}
      </Button>
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}

/** While a check is queued, poll the availability endpoint and refresh when the worker has finished. */
export function AvailabilityRefresher({ tmdbId, pending }: { tmdbId: number; pending: boolean }) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(pending);
  const [, start] = useTransition();
  const started = useRef(Date.now());

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/movies/${tmdbId}/availability`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      const checked = Math.max(0, ...(data?.availability ?? []).map((a: { last_checked_at: string | null }) => (a.last_checked_at ? Date.parse(a.last_checked_at) : 0)));
      if (checked > started.current - 5000 || Date.now() - started.current > 120_000) {
        setWaiting(false);
        start(() => router.refresh());
      }
    }, 4000);
    return () => clearInterval(t);
  }, [waiting, tmdbId, router]);

  async function recheck() {
    started.current = Date.now();
    setWaiting(true);
    await fetch(`/api/movies/${tmdbId}/check`, { method: "POST" });
  }

  return (
    <button onClick={recheck} disabled={waiting} className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground disabled:opacity-70">
      <RefreshCw className={`h-4 w-4 ${waiting ? "animate-spin" : ""}`} />
      {waiting ? "Checking cinemas…" : "Check now"}
    </button>
  );
}
