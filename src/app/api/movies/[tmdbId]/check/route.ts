import { q1 } from "@/lib/db";
import { requestMovieCheck } from "@/lib/monitor/jobs";
import { ensureMovie } from "@/lib/movies";

// Queues a check in the worker (never scrapes from the web tier). Throttled per
// movie: at most one on-demand check per minute regardless of how many users click.
export async function POST(_: Request, { params }: { params: Promise<{ tmdbId: string }> }) {
  const tmdbId = Number((await params).tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return Response.json({ error: "Invalid id" }, { status: 400 });
  const movie = await ensureMovie(tmdbId);
  const recent = await q1<{ last_run_at: string | null }>("select last_run_at from monitor_jobs where id = $1", [`movie:${movie.id}`]);
  if (recent?.last_run_at && Date.now() - new Date(recent.last_run_at).getTime() < 60_000) {
    return Response.json({ queued: false, reason: "checked within the last minute" });
  }
  await requestMovieCheck(movie.id);
  return Response.json({ queued: true });
}
