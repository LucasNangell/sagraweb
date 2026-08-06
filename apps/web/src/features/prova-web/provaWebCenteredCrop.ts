import type { CropSidesMm } from "@/api/provaWeb";

const TOL_MM = 0.55;

/** True quando TrimBox/BleedBox/marcas já deram crop automático. */
export function hasAutoDetectedCrop(crop: CropSidesMm | null | undefined): boolean {
  const src = (crop?.source || "").toLowerCase();
  return src === "trimbox" || src === "bleedbox" || src === "marcas";
}

/** Crop ainda “auto” (pode ser recalculado com lombada/formato). */
export function isAutoFillableCrop(crop: CropSidesMm | null | undefined): boolean {
  if (!crop) return true;
  const src = (crop.source || "manual").toLowerCase();
  if (src === "formato") return true;
  if (hasAutoDetectedCrop(crop)) return false;
  return (
    crop.top === 0 &&
    crop.right === 0 &&
    crop.bottom === 0 &&
    crop.left === 0
  );
}

/**
 * Crop centralizado para targetW×targetH no MediaBox.
 * Tenta orientação invertida se a original não couber.
 */
export function centeredCropMm(
  mediaW: number,
  mediaH: number,
  targetW: number,
  targetH: number,
  source: string = "formato",
): CropSidesMm | null {
  if (mediaW <= 0 || mediaH <= 0 || targetW <= 0 || targetH <= 0) {
    return null;
  }
  const candidates: Array<[number, number]> = [[targetW, targetH]];
  if (Math.abs(targetW - targetH) > 0.05) {
    candidates.push([targetH, targetW]);
  }
  for (const [tw, th] of candidates) {
    if (tw > mediaW + 0.05 || th > mediaH + 0.05) continue;
    const left = Math.round(((mediaW - tw) / 2) * 100) / 100;
    const right = Math.round((mediaW - tw - left) * 100) / 100;
    const top = Math.round(((mediaH - th) / 2) * 100) / 100;
    const bottom = Math.round((mediaH - th - top) * 100) / 100;
    if (left < -0.05 || right < -0.05 || top < -0.05 || bottom < -0.05) {
      continue;
    }
    const remainW = mediaW - left - right;
    const remainH = mediaH - top - bottom;
    if (remainW < 5 || remainH < 5) continue;
    return {
      top: Math.max(0, top),
      right: Math.max(0, right),
      bottom: Math.max(0, bottom),
      left: Math.max(0, left),
      source,
    };
  }
  return null;
}

/** Alvo útil da capa aberta: 2 faces + lombada + orelhas. */
export function coverSpreadTargetMm(opts: {
  faceWidthMm: number;
  faceHeightMm: number;
  lombadaMm: number;
  orelhaEsquerdaMm: number;
  orelhaDireitaMm: number;
}): { w: number; h: number } {
  const faceW = Math.max(0, opts.faceWidthMm);
  const faceH = Math.max(0, opts.faceHeightMm);
  const lombada = Math.max(0, opts.lombadaMm);
  const earL = Math.max(0, opts.orelhaEsquerdaMm);
  const earR = Math.max(0, opts.orelhaDireitaMm);
  return {
    w: earL + faceW + lombada + faceW + earR,
    h: faceH,
  };
}

export function formatOsLabel(
  formato: string | null | undefined,
  larguraMm: number | null | undefined,
  alturaMm: number | null | undefined,
): string {
  if (larguraMm && alturaMm) {
    const dims = `${larguraMm.toFixed(0)} × ${alturaMm.toFixed(0)} mm`;
    return formato ? `${formato} (${dims})` : dims;
  }
  return formato?.trim() || "não informado";
}

export function remainsMatchTarget(
  remainW: number,
  remainH: number,
  targetW: number | null | undefined,
  targetH: number | null | undefined,
): boolean | null {
  if (!targetW || !targetH || remainW <= 0 || remainH <= 0) return null;
  const direct =
    Math.abs(remainW - targetW) <= TOL_MM &&
    Math.abs(remainH - targetH) <= TOL_MM;
  const swapped =
    Math.abs(remainW - targetH) <= TOL_MM &&
    Math.abs(remainH - targetW) <= TOL_MM;
  return direct || swapped;
}

/**
 * Decide o crop a aplicar no seed: Trim/Bleed se existir; senão formato centrado.
 */
export function resolveSeedCrop(opts: {
  suggested: CropSidesMm;
  suggestionSource: string;
  mediaW: number;
  mediaH: number;
  targetW: number | null | undefined;
  targetH: number | null | undefined;
}): CropSidesMm {
  const src = (opts.suggestionSource || opts.suggested.source || "").toLowerCase();
  if (src === "trimbox" || src === "bleedbox" || src === "marcas") {
    return { ...opts.suggested };
  }
  if (opts.targetW && opts.targetH) {
    const centered = centeredCropMm(
      opts.mediaW,
      opts.mediaH,
      opts.targetW,
      opts.targetH,
      "formato",
    );
    if (centered) return centered;
  }
  return { ...opts.suggested, source: opts.suggested.source || "manual" };
}
