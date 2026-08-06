import { usePainelOsManifest } from "@/components/pwa/usePainelOsManifest";

/** Aplica head/manifest do PWA Painel OS enquanto montado. */
export function PainelOsPwaHead() {
  usePainelOsManifest(true);
  return null;
}
