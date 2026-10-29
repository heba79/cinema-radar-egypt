import { Bell, Building2, Clapperboard, Gauge, Radar, Settings, Star } from "lucide-react";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { ButtonLink } from "./ui";

const links = [
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/cinemas", label: "Cinemas", icon: Building2 },
  { href: "/notifications", label: "Alerts", icon: Bell },
  { href: "/providers", label: "Coverage", icon: Radar },
];

export function Nav({ user }: { user: SessionUser | null }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-extrabold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent shadow-lg shadow-red-900/40">
              <Clapperboard className="h-4 w-4 text-white" />
            </span>
            <span>
              Cinema Radar <span className="text-accent">Egypt</span>
            </span>
          </Link>
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-full px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-foreground">
                {l.label}
              </Link>
            ))}
            {user?.isAdmin && (
              <Link href="/admin" className="rounded-full px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-foreground">
                Admin
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-2">
            {user ? (
              <Link href="/settings" aria-label="Settings" className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-foreground">
                <Settings className="h-5 w-5" />
              </Link>
            ) : (
              <ButtonLink href="/login" size="sm">
                Sign in
              </ButtonLink>
            )}
          </div>
        </div>
      </header>
      {/* mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {[{ href: "/", label: "Home", icon: Clapperboard }, ...links.slice(0, 3), user?.isAdmin ? { href: "/admin", label: "Admin", icon: Gauge } : links[3]].map(
          (l) => (
            <Link key={l.href} href={l.href} className="flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted hover:text-foreground">
              <l.icon className="h-5 w-5" />
              {l.label}
            </Link>
          ),
        )}
      </nav>
    </>
  );
}
