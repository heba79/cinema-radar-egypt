import { STATUS_LABEL } from "@/lib/availability";
import type { AvailabilityStatus } from "@/lib/providers/types";
import { Badge, type Tone } from "./ui";

const TONE: Record<AvailabilityStatus, Tone> = {
  bookable_now: "green",
  advance_booking: "green",
  listed_not_bookable: "amber",
  upcoming: "blue",
  released_not_listed: "zinc",
  no_longer_listed: "zinc",
  provider_unavailable: "red",
  unknown: "zinc",
};

export function StatusBadge({ status, short }: { status: AvailabilityStatus; short?: boolean }) {
  const label = short
    ? { bookable_now: "Book now", advance_booking: "Advance booking", listed_not_bookable: "Listed", upcoming: "Upcoming" }[status as string] ??
      STATUS_LABEL[status]
    : STATUS_LABEL[status];
  const live = status === "bookable_now" || status === "advance_booking";
  return (
    <Badge tone={TONE[status]}>
      {live && <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />}
      {label}
    </Badge>
  );
}

const INTEGRATION_TONE: Record<string, Tone> = { working: "green", partial: "amber", unavailable: "red", not_integrated: "zinc" };
const INTEGRATION_LABEL: Record<string, string> = {
  working: "Working",
  partial: "Partially supported",
  unavailable: "Unavailable",
  not_integrated: "Not yet integrated",
};
export function IntegrationBadge({ status }: { status: string }) {
  return <Badge tone={INTEGRATION_TONE[status] ?? "zinc"}>{INTEGRATION_LABEL[status] ?? status}</Badge>;
}
