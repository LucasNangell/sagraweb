import {
  usePainelOsManifest,
  type PainelPwaVariant,
} from "@/components/pwa/usePainelOsManifest";

/** Aplica head/manifest do PWA do painel enquanto montado. */
export function PainelOsPwaHead({
  variant = "tablet",
}: {
  variant?: PainelPwaVariant;
}) {
  usePainelOsManifest(true, variant);
  return null;
}
