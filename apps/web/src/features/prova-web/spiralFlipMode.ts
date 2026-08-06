import type { ProvaWebManifestBase } from "@/api/provaWeb";

/** Folhear vertical (CSS) só quando mockup espiral com binding no topo. */
export function shouldUseVerticalSpiralPager(
  manifest: Pick<ProvaWebManifestBase, "spiralMockup"> | null | undefined,
): boolean {
  return manifest?.spiralMockup?.edge === "top";
}
