"use client";
import { Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, inputClass } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/watchlist";
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setError(error.message);
      setState("error");
    } else setState("sent");
  }

  return (
    <Card className="mx-auto mt-10 max-w-md p-8">
      <h1 className="font-display text-2xl font-bold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">We&apos;ll email you a magic link — no password needed. Your watchlist and alerts are tied to this email.</p>
      {state === "sent" ? (
        <div className="mt-6 rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-300">
          Check <b>{email}</b> for your sign-in link.
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={inputClass} autoComplete="email" />
          <Button type="submit" className="w-full" disabled={state === "sending"}>
            <Mail className="h-4 w-4" /> {state === "sending" ? "Sending…" : "Email me a link"}
          </Button>
          {state === "error" && <p className="text-sm text-red-400">{error}</p>}
        </form>
      )}
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
