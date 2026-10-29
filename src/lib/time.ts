export const CAIRO_TZ = "Africa/Cairo";

/** Offset of Africa/Cairo from UTC (minutes) at a given instant. Handles Egyptian DST. */
export function cairoOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CAIRO_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Convert a Cairo wall-clock time to a UTC Date. */
export function cairoWallToUtc(date: string, hour: number, minute: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let offset = cairoOffsetMinutes(new Date(guess));
  // second pass in case the guess straddled a DST transition
  offset = cairoOffsetMinutes(new Date(guess - offset * 60000));
  return new Date(guess - offset * 60000);
}

/** Today's date (YYYY-MM-DD) in Cairo. */
export function cairoToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CAIRO_TZ }).format(now);
}

/**
 * Parse a showtime like "02:15 PM", "12:15 midnight", "01:00 pm" on a cinema
 * business day. Cinemas list after-midnight shows (00:00–05:59) under the
 * previous day, so those roll over to the next calendar day.
 */
export function parseShowtime(businessDate: string, label: string): { startsAt: Date; display: string } | null {
  const m = label.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm|midnight|noon)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const mer = (m[3] || "").toLowerCase();
  if (mer === "pm" && h < 12) h += 12;
  if ((mer === "am" || mer === "midnight") && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  let date = businessDate;
  if (h < 6) date = addDays(businessDate, 1);
  const display = `${String(((h + 11) % 12) + 1).padStart(2, "0")}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return { startsAt: cairoWallToUtc(date, h, min), display };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function formatCairo(d: Date | string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: CAIRO_TZ, ...opts }).format(new Date(d));
}
