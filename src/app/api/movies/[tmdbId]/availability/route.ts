import { movieByTmdb } from "@/lib/movies";
import { movieAvailability, movieShowtimes } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ tmdbId: string }> }) {
  const movie = await movieByTmdb(Number((await params).tmdbId));
  if (!movie) return Response.json({ availability: [], branches: [] });
  const [availability, branches] = await Promise.all([movieAvailability(movie.id), movieShowtimes(movie.id)]);
  return Response.json({ availability, branches }, { headers: { "cache-control": "no-store" } });
}
