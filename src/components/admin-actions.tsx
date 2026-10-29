"use client";
import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui";

export function AdminActions() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function run(action: string) {
    const res = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? data.message : data.error);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {msg && <span className="text-xs text-muted">{msg}</span>}
      <Button size="sm" variant="secondary" onClick={() => run("run_all_now")}>
        <RotateCw className="h-3.5 w-3.5" /> Run all checks now
      </Button>
      <Button size="sm" variant="ghost" onClick={() => run("retry_failed_deliveries")}>
        Retry failed deliveries
      </Button>
    </div>
  );
}
