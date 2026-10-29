// Provider adapter contract. Each Egyptian cinema source implements this so the
// monitor can treat them uniformly. Adapters must only return data observed on
// the provider — never synthesized listings or booking URLs.

export type AvailabilityStatus =
  | "upcoming"
  | "released_not_listed"
  | "listed_not_bookable"
  | "advance_booking"
  | "bookable_now"
  | "no_longer_listed"
  | "provider_unavailable"
  | "unknown";

export interface CatalogEntry {
  externalId: string;
  titleEn?: string;
  titleAr?: string;
  posterUrl?: string;
  inNowPlaying?: boolean;
  inComingSoon?: boolean;
  inBookable?: boolean;
  /** When the list page already gives the Egyptian release date, no details fetch is needed. */
  releaseDate?: string;
}

export interface WorkDetails {
  externalId: string;
  titleEn?: string;
  titleAr?: string;
  imdbId?: string;
  year?: number;
  egReleaseDate?: string; // YYYY-MM-DD
}

export interface BranchRef {
  externalId: string;
  name: string;
  url: string;
}

export interface ObservedShowtime {
  branch: BranchRef;
  businessDate: string; // YYYY-MM-DD, as grouped by the cinema
  time: string; // normalized "hh:mm AM"
  startsAt: Date;
  experience: string; // '' when not provided
  priceEgp?: number;
  bookingUrl?: string; // only when a real booking action was present
}

export interface MovieListing {
  externalId: string;
  sourceUrl: string;
  showtimes: ObservedShowtime[];
  /** Branches that list the movie (bookable or not), even if no times parsed. */
  branches: (BranchRef & { bookingUrl?: string })[];
}

export interface BranchDetails {
  externalId: string;
  name: string;
  nameAr?: string;
  city?: string;
  area?: string;
  address?: string;
  phone?: string;
  url: string;
  /** Today's per-movie experiences & prices, when the page provides them. */
  todaysShowtimes: { workId: string; experience: string; time: string; priceEgp?: number; bookingUrl?: string }[];
  businessDate?: string;
}

export interface ProviderAdapter {
  id: string;
  /** Chain name for every branch (single-chain providers like VOX). */
  defaultChain?: string;
  /** Static location for branches whose pages carry no address. */
  branchLocation?(name: string): { city: string; area: string } | undefined;
  /** Catalog titles carry no IMDb id → details are only needed for year/release (fetched lazily). */
  catalogHasDetails?: boolean;
  /** Movie-level booking page (provider's "tickets" action), used when booking is open beyond the showtimes window. */
  movieBookingUrl?(externalId: string): string;
  onlineBookingName?: string;
  /** Lightweight list of works currently bookable (one request). */
  fetchBookableIndex?(): Promise<Set<string>>;
  fetchCatalog?(): Promise<CatalogEntry[]>;
  fetchWorkDetails?(externalId: string): Promise<WorkDetails>;
  fetchMovieListing(externalId: string): Promise<MovieListing>;
  fetchBranchDetails?(externalId: string): Promise<BranchDetails>;
  /** Cheap reachability probe for the coverage dashboard. */
  probe(): Promise<{ ok: boolean; detail: string }>;
  /** Check that a booking URL still opens the provider's booking flow. */
  verifyBookingUrl?(url: string): Promise<boolean>;
}
