// Official websites of chains whose showtimes we get from elCinema listings but whose
// booking links can't be verified from the cloud (they refuse cloud-server traffic).
// These are the chains' real home pages — never constructed deep booking links.
export const OFFICIAL_SITE_CHAINS = ["Scene Cinemas", "VOX Cinemas"] as const;

export function officialSiteFor(chain: string | null, branchName: string): string | null {
  if (chain === "Scene Cinemas") {
    if (/district\s*5/i.test(branchName)) return "https://district5.scenecinemas.com/";
    if (/festival/i.test(branchName)) return "https://cfc.scenecinemas.com/";
    return "https://scenecinemas.com/";
  }
  if (chain === "VOX Cinemas") return "https://egy.voxcinemas.com/";
  return null;
}
