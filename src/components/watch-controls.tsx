"use client";
import { Pause, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function WatchControls({ tmdbId, paused }: { tmdbId: number; paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const call = async (method: "PATCH" | "DELETE", body: object) => {
    setBusy(true);
    await fetch("/api/watchlist", { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ tmdbId, ...body }) });
    setBusy(false);
    router.refresh();
  };
  const cls = "rounded-full p-2 text-muted transition hover:bg-surface-2 hover:text-foreground disabled:opacity-40";
  return (
    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
      <button disabled={busy} className={cls} onClick={() => call("PATCH", { paused: !paused })} aria-label={paused ? "Resume tracking" : "Pause tracking"} title={paused ? "Resume" : "Pause"}>
        {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      </button>
      <button disabled={busy} className={`${cls} hover:text-red-400`} onClick={() => call("DELETE", {})} aria-label="Remove from watchlist" title="Remove">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
