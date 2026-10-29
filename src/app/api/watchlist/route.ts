import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { requestMovieCheck } from "@/lib/monitor/jobs";
import { ensureMovie, movieByTmdb } from "@/lib/movies";

const body = z.object({ tmdbId: z.number().int().positive(), paused: z.boolean().optional() });

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { tmdbId } = body.parse(await req.json());
    const movie = await ensureMovie(tmdbId);
    await q(
      `insert into watchlists (user_id, movie_id) values ($1,$2) on conflict (user_id, movie_id) do update set paused = false`,
      [user.id, movie.id],
    );
    // Schedule an immediate check; the worker promotes it to 5-minute monitoring.
    await requestMovieCheck(movie.id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: "Invalid request" }, { status: 400 });
    return errorResponse(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const { tmdbId, paused } = body.parse(await req.json());
    const movie = await movieByTmdb(tmdbId);
    if (!movie) return Response.json({ error: "Not found" }, { status: 404 });
    await q("update watchlists set paused = $3 where user_id = $1 and movie_id = $2", [user.id, movie.id, !!paused]);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: "Invalid request" }, { status: 400 });
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const { tmdbId } = body.parse(await req.json());
    const movie = await movieByTmdb(tmdbId);
    if (movie) await q("delete from watchlists where user_id = $1 and movie_id = $2", [user.id, movie.id]);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: "Invalid request" }, { status: 400 });
    return errorResponse(e);
  }
}
