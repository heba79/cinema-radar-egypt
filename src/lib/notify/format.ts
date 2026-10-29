import type { BranchPayload, EventPayload } from "../monitor/check";
import { formatCairo } from "../time";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Headline for a specific alert (listing alerts that only add days say so). */
export function headlineFor(eventType: string, p: EventPayload) {
  if (p.kind === "listing" && p.newDates) return p.update === "showtimes" ? "🎬 NEW SHOWTIMES ADDED!" : "🎬 NEW DATES ADDED!";
  return headline(eventType);
}

export function headline(eventType: string) {
  if (eventType === "advance_booking_opened") return "🎬 ADVANCE BOOKING IS OPEN!";
  if (eventType === "new_branch") return "🎬 NEW CINEMA SELLING TICKETS!";
  if (eventType === "showtimes_listed") return "🎬 SHOWTIMES ARE OUT!";
  return "🎬 TICKETS ARE LIVE!";
}

export function formatDate(d: string) {
  return formatCairo(`${d}T12:00:00Z`, { weekday: "short", day: "numeric", month: "short" });
}

const firstDayTimes = (b: BranchPayload) => {
  const first = b.screenings[0];
  return first ? b.screenings.filter((s) => s.date === first.date).map((s) => s.time) : [];
};

const LISTING_NOTE = "Showtimes are from elCinema's listing. Online booking for this cinema couldn't be verified — book on the cinema's website/app or at the box office.";

/** All listed days, e.g. "Thu 6 Nov: 07:00 PM, 10:00 PM" (listing alerts show every day, not just the first). */
const daysSummary = (b: BranchPayload) => {
  const byDay = new Map<string, string[]>();
  for (const s of b.screenings) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s.time]);
  return [...byDay].map(([d, times]) => `${formatDate(d)}: ${times.join(", ")}`);
};

export function formatText(eventType: string, p: EventPayload, appUrl: string): string {
  const listing = p.kind === "listing";
  const lines = [headlineFor(eventType, p), "", `Movie: ${p.movieTitle}${p.movieTitleAr && p.movieTitleAr !== p.movieTitle ? ` (${p.movieTitleAr})` : ""}`];
  for (const b of p.branches) {
    const first = b.screenings[0];
    lines.push("", `Cinema: ${b.cinema}`, `Branch: ${b.branch}${b.city ? `, ${b.city}` : ""}`);
    if (listing) lines.push(...daysSummary(b));
    else if (!first) lines.push("Advance booking is open — choose cinema, date & time on the booking page.");
    else {
      lines.push(`Date: ${formatDate(first.date)}`, `Time: ${firstDayTimes(b).join(", ")}`);
      if (first.experience) lines.push(`Screen: ${first.experience}`);
      if (first.price) lines.push(`Price: ${first.price} EGP`);
    }
    lines.push(listing ? `🔗 OFFICIAL SITE: ${b.bookingUrl}` : `🎟 BOOK NOW: ${b.bookingUrl}`);
  }
  if (listing) lines.push("", LISTING_NOTE);
  lines.push("", `Detected: ${formatCairo(p.detectedAt)} (Cairo time)`, `All showtimes: ${appUrl}/movie/${p.tmdbId}`);
  return lines.join("\n");
}

export function formatEmail(eventType: string, p: EventPayload, appUrl: string) {
  const where = p.branches.length === 1 ? p.branches[0].branch : `${p.branches.length} cinemas`;
  const subject = `${headlineFor(eventType, p).replace("🎬 ", "")} ${p.movieTitle} — ${where}`;
  const poster = p.posterPath ? `https://image.tmdb.org/t/p/w342${p.posterPath}` : null;
  const listing = p.kind === "listing";
  const branchBlocks = p.branches
    .map((b) => {
      const first = b.screenings[0];
      const times = listing
        ? daysSummary(b).map((d) => `<div style="color:#e4e4e7;font-size:14px;margin-top:4px">${esc(d)}</div>`).join("")
        : first
          ? `<div style="color:#e4e4e7;font-size:14px;margin-top:6px">${esc(formatDate(first.date))}: <b>${esc(firstDayTimes(b).join(" · "))}</b>${first.experience ? ` · ${esc(first.experience)}` : ""}${first.price ? ` · ${first.price} EGP` : ""}</div>`
          : `<div style="color:#e4e4e7;font-size:14px;margin-top:6px">Advance booking is open — choose cinema, date &amp; time on the booking page.</div>`;
      return `<tr><td style="padding:16px 0;border-top:1px solid #27272a">
        <div style="color:#fff;font-weight:700;font-size:16px">${esc(b.branch)}</div>
        <div style="color:#a1a1aa;font-size:13px">${esc(b.cinema)}${b.city ? ` · ${esc(b.city)}` : ""}</div>
        ${times}
        <a href="${esc(b.bookingUrl)}" style="display:inline-block;margin-top:10px;background:#dc2626;color:#fff;text-decoration:none;font-weight:700;padding:10px 22px;border-radius:999px;font-size:14px">${listing ? "🔗 BOOK ON OFFICIAL SITE" : "🎟 BOOK NOW"}</a>
      </td></tr>`;
    })
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#0a0a0a;font-family:Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 12px"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#18181b;border-radius:16px;overflow:hidden;border:1px solid #27272a">
    <tr><td style="background:#dc2626;padding:16px 24px;color:#fff;font-size:20px;font-weight:800;letter-spacing:.5px">${esc(headlineFor(eventType, p))}</td></tr>
    <tr><td style="padding:24px">
      <table cellpadding="0" cellspacing="0"><tr>
        ${poster ? `<td valign="top" style="padding-right:16px"><img src="${poster}" width="100" style="border-radius:10px;display:block" alt=""></td>` : ""}
        <td valign="top" style="color:#e4e4e7;font-size:15px;line-height:1.5">
          <div style="font-size:22px;font-weight:700;color:#fff">${esc(p.movieTitle)}</div>
          ${p.movieTitleAr && p.movieTitleAr !== p.movieTitle ? `<div dir="rtl" style="color:#a1a1aa">${esc(p.movieTitleAr)}</div>` : ""}
          <div style="color:#a1a1aa;font-size:13px;margin-top:6px">${listing ? "Showtimes listed at" : "Now bookable at"} ${p.branches.length} cinema${p.branches.length > 1 ? "s" : ""}</div>
        </td></tr></table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${branchBlocks}</table>
      ${listing ? `<p style="color:#fbbf24;font-size:12px;margin-top:16px">${esc(LISTING_NOTE)}</p>` : ""}
      <p style="color:#71717a;font-size:12px;margin-top:16px">Availability detected ${esc(formatCairo(p.detectedAt))} (Cairo time). Seats can sell out — the cinema's booking page is the source of truth.<br>
      <a href="${appUrl}/movie/${p.tmdbId}" style="color:#a1a1aa">All showtimes</a> · <a href="${appUrl}/settings" style="color:#a1a1aa">Notification settings</a></p>
    </td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text: formatText(eventType, p, appUrl) };
}
