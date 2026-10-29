"use client";
import { Bell, Check, Loader2, LogOut, Mail, MessageCircle, Send, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Card, cn, inputClass } from "./ui";

export interface Settings {
  email_address: string | null;
  email_enabled: boolean;
  push_enabled: boolean;
  telegram_enabled: boolean;
  telegram_linked: boolean;
  notify_advance_booking: boolean;
  notify_booking_opened: boolean;
  notify_new_branch: boolean;
  notify_showtimes_listed: boolean;
  preferred_cities: string[];
  favorite_chains: string[];
  push_devices: number;
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-accent" : "bg-zinc-700")}
      >
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", checked ? "left-5" : "left-0.5")} />
      </button>
    </label>
  );
}

function Chips({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!options.length) return <p className="text-xs text-muted">Options appear once the monitor has discovered cinemas.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cn("rounded-full border px-3 py-1.5 text-xs transition", on ? "border-accent bg-accent-soft text-red-200" : "border-border text-muted hover:border-zinc-500")}
          >
            {on && <Check className="mr-1 inline h-3 w-3" />}
            {o}
          </button>
        );
      })}
    </div>
  );
}

function urlB64ToUint8Array(b64: string) {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function SettingsForm({
  initial,
  cities,
  chains,
  vapidPublicKey,
  telegramBot,
  accountEmail,
}: {
  initial: Settings;
  cities: string[];
  chains: string[];
  vapidPublicKey: string | null;
  telegramBot: string | null;
  accountEmail: string | null;
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pushState, setPushState] = useState<string | null>(null);
  const [testState, setTestState] = useState<string | null>(null);
  const [tgLink, setTgLink] = useState<string | null>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  async function save() {
    setSaving("saving");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email_address: s.email_address,
        email_enabled: s.email_enabled,
        push_enabled: s.push_enabled,
        telegram_enabled: s.telegram_enabled,
        notify_advance_booking: s.notify_advance_booking,
        notify_booking_opened: s.notify_booking_opened,
        notify_new_branch: s.notify_new_branch,
        notify_showtimes_listed: s.notify_showtimes_listed,
        preferred_cities: s.preferred_cities,
        favorite_chains: s.favorite_chains,
      }),
    });
    setSaving(res.ok ? "saved" : "error");
    if (res.ok) router.refresh();
  }

  async function enablePush() {
    setPushState(null);
    if (!vapidPublicKey) return setPushState("Push isn't configured on this server yet.");
    if (!("serviceWorker" in navigator) || !("PushManager" in window))
      return setPushState("This browser doesn't support push. On iPhone, add this site to your Home Screen first (Share → Add to Home Screen), then open it from there.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setPushState("Notifications were blocked. Allow them in your browser's site settings.");
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(vapidPublicKey) });
    const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    if (res.ok) {
      set("push_enabled", true);
      set("push_devices", s.push_devices + 1);
      setPushState("This device will receive alerts.");
    } else setPushState("Could not save the subscription.");
  }

  async function linkTelegram() {
    const res = await fetch("/api/telegram/link", { method: "POST" });
    const data = await res.json();
    if (data.url) {
      setTgLink(data.url);
      window.open(data.url, "_blank");
    }
  }

  async function sendTest(channel: string) {
    setTestState(`Sending ${channel} test…`);
    const res = await fetch("/api/notifications/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel }) });
    const data = await res.json().catch(() => ({}));
    setTestState(res.ok ? `✓ ${channel} test sent${data.detail ? ` (${data.detail})` : ""}` : `✗ ${channel}: ${data.error ?? "failed"}`);
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <Mail className="h-4 w-4 text-accent" /> Email
        </h3>
        <Toggle checked={s.email_enabled} onChange={(v) => set("email_enabled", v)} label="Email alerts" hint="Sent through Resend the moment tickets are detected." />
        <input type="email" value={s.email_address ?? ""} onChange={(e) => set("email_address", e.target.value)} className={`${inputClass} mt-2`} placeholder={accountEmail ?? ""} />
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => sendTest("email")}>
          <Send className="h-3.5 w-3.5" /> Send test email
        </Button>
      </Card>

      <Card className="p-5">
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <Smartphone className="h-4 w-4 text-accent" /> Phone & browser push
        </h3>
        <Toggle checked={s.push_enabled} onChange={(v) => set("push_enabled", v)} label="Push alerts" hint={`${s.push_devices} device(s) registered`} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={enablePush}>
            <Bell className="h-3.5 w-3.5" /> Enable on this device
          </Button>
          <Button variant="ghost" size="sm" onClick={() => sendTest("push")}>
            <Send className="h-3.5 w-3.5" /> Send test push
          </Button>
        </div>
        {pushState && <p className="mt-2 text-xs text-muted">{pushState}</p>}
      </Card>

      <Card className="p-5">
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <MessageCircle className="h-4 w-4 text-accent" /> Telegram (optional)
        </h3>
        {telegramBot ? (
          <>
            <Toggle checked={s.telegram_enabled} onChange={(v) => set("telegram_enabled", v)} label="Telegram alerts" hint={s.telegram_linked ? "Linked ✓" : "Not linked yet"} />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={linkTelegram}>
                {s.telegram_linked ? "Re-link Telegram" : "Link Telegram"}
              </Button>
              {s.telegram_linked && (
                <Button variant="ghost" size="sm" onClick={() => sendTest("telegram")}>
                  <Send className="h-3.5 w-3.5" /> Send test message
                </Button>
              )}
            </div>
            {tgLink && (
              <p className="mt-2 text-xs text-muted">
                Opened Telegram — press <b>Start</b> in the chat with @{telegramBot}, then reload this page. Link: <a className="underline" href={tgLink}>{tgLink}</a>
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Not configured on this server.</p>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="mb-2 font-semibold">What to alert me about</h3>
        <Toggle checked={s.notify_advance_booking} onChange={(v) => set("notify_advance_booking", v)} label="Advance booking opens" hint="Tickets on sale before the Egyptian release date" />
        <Toggle checked={s.notify_booking_opened} onChange={(v) => set("notify_booking_opened", v)} label="Regular booking opens" />
        <Toggle checked={s.notify_new_branch} onChange={(v) => set("notify_new_branch", v)} label="Another cinema starts selling" hint="Filtered by your preferred cities & chains below, if set" />
        <Toggle
          checked={s.notify_showtimes_listed}
          onChange={(v) => set("notify_showtimes_listed", v)}
          label="Showtimes out at Scene or VOX"
          hint="Dates & times as soon as they're listed; book on the cinema's official site"
        />
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h3 className="mb-2 font-semibold">Preferred cities</h3>
          <Chips options={cities} value={s.preferred_cities} onChange={(v) => set("preferred_cities", v)} />
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Favourite cinema chains</h3>
          <Chips options={chains} value={s.favorite_chains} onChange={(v) => set("favorite_chains", v)} />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={saving === "saving"}>
          {saving === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save settings
        </Button>
        {saving === "saved" && <span className="text-sm text-emerald-400">Saved</span>}
        {saving === "error" && <span className="text-sm text-red-400">Couldn&apos;t save — check the email address.</span>}
        {testState && <span className="text-sm text-muted">{testState}</span>}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={async () => {
            await supabaseBrowser().auth.signOut();
            router.push("/");
            router.refresh();
          }}
        >
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>
    </div>
  );
}
