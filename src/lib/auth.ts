import "server-only";
import { q, q1 } from "./db";
import { adminEmails } from "./env";
import { supabaseServer } from "./supabase/server";

export interface SessionUser {
  id: string;
  email: string | null;
  isAdmin: boolean;
}

/** Verified user from the Supabase session (getUser() validates the JWT with Supabase). */
export async function currentUser(): Promise<SessionUser | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return null;
  // The auth trigger normally creates these; this covers users created before the migration.
  await q(`insert into profiles (id, email) values ($1, $2) on conflict (id) do update set email = excluded.email`, [u.id, u.email ?? null]);
  await q(`insert into notification_preferences (user_id, email_address) values ($1, $2) on conflict do nothing`, [u.id, u.email ?? null]);
  const p = await q1<{ is_admin: boolean }>("select is_admin from profiles where id = $1", [u.id]);
  const isAdmin = !!p?.is_admin || (!!u.email && adminEmails().includes(u.email.toLowerCase()));
  return { id: u.id, email: u.email ?? null, isAdmin };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Sign in required");
  return u;
}

export async function requireAdmin() {
  const u = await requireUser();
  if (!u.isAdmin) throw new HttpError(403, "Admins only");
  return u;
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
