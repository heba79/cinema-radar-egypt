// Minimal shadcn/ui-style primitives (same API shape: variant/size + className),
// written inline so the project doesn't depend on the shadcn CLI.
import { clsx, type ClassValue } from "clsx";
import Link from "next/link";
import { twMerge } from "tailwind-merge";
import type { ComponentProps, ReactNode } from "react";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.98]";
const buttonVariants = {
  primary: "bg-accent text-white hover:bg-red-500 shadow-lg shadow-red-900/30",
  secondary: "bg-surface-2 text-foreground border border-border hover:border-zinc-500",
  ghost: "text-muted hover:text-foreground hover:bg-surface-2",
  danger: "bg-transparent border border-red-900 text-red-400 hover:bg-red-950",
};
const buttonSizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-5 text-sm", lg: "h-12 px-7 text-base" };

type BtnProps = { variant?: keyof typeof buttonVariants; size?: keyof typeof buttonSizes };

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & BtnProps) {
  return <button className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...p} />;
}

export function ButtonLink({ variant = "primary", size = "md", className, ...p }: ComponentProps<typeof Link> & BtnProps) {
  return <Link className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...p} />;
}

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={cn("rounded-2xl border border-border bg-surface/80 backdrop-blur", className)} {...p} />;
}

const badgeTones = {
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  red: "bg-red-500/15 text-red-300 border-red-500/30",
  blue: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  zinc: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};
export type Tone = keyof typeof badgeTones;

export function Badge({ tone = "zinc", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="flex items-center gap-3 font-display text-xl font-bold tracking-tight sm:text-2xl">
        <span className="h-6 w-1.5 rounded-full bg-accent" />
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="p-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </Card>
  );
}

export const inputClass =
  "h-11 w-full rounded-xl border border-border bg-surface-2 px-4 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";
