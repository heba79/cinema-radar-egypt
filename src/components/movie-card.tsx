import Image from "next/image";
import Link from "next/link";
import { Film } from "lucide-react";
import type { AvailabilityStatus } from "@/lib/providers/types";
import { StatusBadge } from "./status";

export function Poster({ path, alt, size = "w342", className = "" }: { path: string | null | undefined; alt: string; size?: string; className?: string }) {
  if (!path)
    return (
      <div className={`flex aspect-[2/3] items-center justify-center bg-surface-2 text-zinc-600 ${className}`}>
        <Film className="h-10 w-10" />
      </div>
    );
  return (
    <Image
      src={`https://image.tmdb.org/t/p/${size}${path}`}
      alt={alt}
      width={342}
      height={513}
      className={`aspect-[2/3] w-full object-cover ${className}`}
      sizes="(max-width: 640px) 45vw, 200px"
    />
  );
}

export function MovieCard({
  tmdbId,
  title,
  posterPath,
  subtitle,
  status,
}: {
  tmdbId: number;
  title: string;
  posterPath: string | null | undefined;
  subtitle?: string | null;
  status?: AvailabilityStatus | null;
}) {
  return (
    <Link href={`/movie/${tmdbId}`} className="group block w-36 shrink-0 animate-fade-up sm:w-44">
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/40 transition duration-300 group-hover:-translate-y-1 group-hover:border-accent/60 group-hover:shadow-red-950/40">
        <Poster path={posterPath} alt={title} className="transition duration-500 group-hover:scale-105" />
        {status && (
          <div className="absolute left-2 top-2">
            <StatusBadge status={status} short />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-semibold leading-tight">{title}</p>
      {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
    </Link>
  );
}

export function Rail({ children }: { children: React.ReactNode }) {
  return <div className="scrollbar-none -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">{children}</div>;
}
