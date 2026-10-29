import { z } from "zod";

// Server-only configuration. Never import this from a client component.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  TMDB_API_KEY: z.string().min(1).optional(),
  TMDB_READ_TOKEN: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default("Cinema Radar Egypt <alerts@example.com>"),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_EMAILS: z.string().default(""),
  CRON_SECRET: z.string().optional(),
  SCRAPER_CONTACT: z.string().default("https://github.com/"),
  MONITOR_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(300),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) {
    // `KEY=` (blank) in an env file means "not set", not an invalid empty value.
    const vars = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
    const parsed = schema.safeParse(vars);
    if (!parsed.success) {
      throw new Error(
        "Invalid environment: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    cached = parsed.data;
  }
  return cached;
}

export function adminEmails(): string[] {
  return env()
    .ADMIN_EMAILS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
