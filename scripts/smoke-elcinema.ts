// Live smoke test of the elCinema adapter. Usage: npx tsx scripts/smoke-elcinema.ts [workId]
import { elcinema } from "../src/lib/providers/elcinema/adapter";

async function main() {
  const bookable = await elcinema.fetchBookableIndex!();
  console.log(`bookable works: ${bookable.size}`);
  const id = process.argv[2] ?? [...bookable][0];
  const details = await elcinema.fetchWorkDetails!(id);
  console.log("details", details);
  const listing = await elcinema.fetchMovieListing(id);
  const bookableBranches = listing.branches.filter((b) => b.bookingUrl);
  console.log(`branches: ${listing.branches.length}, bookable: ${bookableBranches.length}, showtimes: ${listing.showtimes.length}`);
  for (const b of bookableBranches.slice(0, 5)) console.log("  ", b.name, b.bookingUrl);
  if (bookableBranches[0]) {
    const ok = await elcinema.verifyBookingUrl!(bookableBranches[0].bookingUrl!);
    console.log("booking URL verified:", ok);
    const br = await elcinema.fetchBranchDetails!(bookableBranches[0].externalId);
    console.log("branch", { ...br, todaysShowtimes: br.todaysShowtimes.length });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
