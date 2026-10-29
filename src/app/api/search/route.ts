import { z } from "zod";
import { searchMovies } from "@/lib/tmdb";

const schema = z.object({ q: z.string().trim().min(2).max(100) });

export async function GET(req: Request) {
  const parsed = schema.safeParse({ q: new URL(req.url).searchParams.get("q") ?? "" });
  if (!parsed.success) return Response.json({ results: [] });
  try {
    const results = await searchMovies(parsed.data.q);
    return Response.json(
      { results: results.map(({ id, title, original_title, release_date, poster_path }) => ({ id, title, original_title, release_date, poster_path })) },
      { headers: { "cache-control": "public, max-age=300" } },
    );
  } catch (e) {
    console.error("[search]", e);
    return Response.json({ error: "Movie search is temporarily unavailable" }, { status: 502 });
  }
}
