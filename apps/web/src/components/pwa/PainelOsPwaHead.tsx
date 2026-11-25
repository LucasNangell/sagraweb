import {
  usePainelOsManifest,
  type SagraPwaVariant,
} from "@/components/pwa/usePainelOsManifest";

/** Aplica head/manifest do PWA do painel enquanto montado. */
export function PainelOsPwaHead({
  variant = "tablet",
}: {
  variant?: SagraPwaVariant;
}) {
  usePainelOsManifest(true, variant);
  return null;
}
