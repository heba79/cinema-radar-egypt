"use client";
// PWA support: registers the service worker on every page (needed for push and for
// "Add to Home Screen" on iPhone), and explains how to install on each platform.
import { Download, Share, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card } from "./ui";

type Platform = "ios-safari" | "ios-other" | "ios-installed" | "android" | "desktop" | "unsupported";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

function detect(): Platform {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (ios) return standalone ? "ios-installed" : /CriOS|FxiOS|EdgiOS/.test(ua) ? "ios-other" : "ios-safari";
  if (!("PushManager" in window)) return "unsupported";
  return /Android/.test(ua) ? "android" : "desktop";
}

/** Step-by-step instructions for getting push alerts on this device. */
export function InstallGuide() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setPlatform(detect());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!platform) return null;
  return (
    <Card className="border-sky-900/60 p-5">
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <Smartphone className="h-4 w-4 text-sky-400" /> Get alerts on your phone (free)
      </h3>
      {platform === "ios-safari" && (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-300">
          <li>
            Tap <Share className="inline h-4 w-4" /> <b>Share</b> at the bottom of Safari.
          </li>
          <li>
            Choose <b>Add to Home Screen</b>, then <b>Add</b>.
          </li>
          <li>
            Open <b>Cinema Radar</b> from your Home Screen (not Safari), go to Settings, and tap <b>Enable on this device</b>.
          </li>
          <li className="text-muted">Needs iOS 16.4 or newer. Apple only allows web push for apps added to the Home Screen.</li>
        </ol>
      )}
      {platform === "ios-other" && (
        <p className="text-sm text-zinc-300">
          On iPhone, push works only after adding the site from <b>Safari</b>: open this page in Safari, tap Share → <b>Add to Home Screen</b>, then
          open it from the Home Screen.
        </p>
      )}
      {platform === "ios-installed" && (
        <p className="text-sm text-emerald-300">✓ Installed. Tap <b>Enable on this device</b> below and allow notifications.</p>
      )}
      {(platform === "android" || platform === "desktop") && (
        <div className="space-y-2 text-sm text-zinc-300">
          <p>
            Tap <b>Enable on this device</b> below and allow notifications. Alerts arrive even when the site is closed.
          </p>
          {installEvent ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await installEvent.prompt();
                setInstallEvent(null);
              }}
            >
              <Download className="h-3.5 w-3.5" /> Install the app (optional)
            </Button>
          ) : (
            platform === "android" && <p className="text-muted">Optional: Chrome menu ⋮ → Install app / Add to Home screen.</p>
          )}
        </div>
      )}
      {platform === "unsupported" && <p className="text-sm text-amber-300">This browser can&apos;t receive web push. Try Chrome, Edge, Firefox or Safari.</p>}
    </Card>
  );
}
