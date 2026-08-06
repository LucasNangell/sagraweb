import type { MockupConfig, MockupFaceConfig, MockupFaceCrop } from "./types";

/** Converte crop percentual da arte aberta em background-size/position CSS */
export function cropToBackgroundStyle(crop: MockupFaceCrop): {
  backgroundSize: string;
  backgroundPosition: string;
} {
  const { x, y, width, height } = crop;
  if (width <= 0 || height <= 0) {
    return { backgroundSize: "100% 100%", backgroundPosition: "0% 0%" };
  }
  return {
    backgroundSize: `${(100 / width) * 100}% ${(100 / height) * 100}%`,
    backgroundPosition: `${-(x / width) * 100}% ${-(y / height) * 100}%`,
  };
}

export function faceSizePercent(
  face: MockupFaceConfig,
  config: MockupConfig,
): { widthPct: number; heightPct: number; leftPct: number; topPct: number } {
  const widthPct = (face.crop.width / 100) * 100;
  const heightPct = (face.crop.height / 100) * 100;
  const leftPct = face.crop.x;
  const topPct = face.crop.y;
  return { widthPct, heightPct, leftPct, topPct };
}

export function buildFaceTransform(
  face: MockupFaceConfig,
  foldOpen: number,
): string {
  const t = face.transform;
  let rotateX = t.rotateX ?? 0;
  let rotateY = t.rotateY ?? 0;
  if (face.abreComDobra) {
    if (t.rotateY !== undefined) rotateY = t.rotateY * foldOpen;
    if (t.rotateX !== undefined) rotateX = t.rotateX * foldOpen;
  }

  const parts: string[] = [];
  if (t.translateX) parts.push(`translateX(${t.translateX})`);
  if (t.translateY) parts.push(`translateY(${t.translateY})`);
  if (t.translateZ) parts.push(`translateZ(${t.translateZ}px)`);
  if (t.rotateX !== undefined || (face.abreComDobra && t.rotateX)) {
    parts.push(`rotateX(${rotateX}deg)`);
  }
  if (t.rotateY !== undefined || face.abreComDobra) {
    parts.push(`rotateY(${rotateY}deg)`);
  }
  if (t.rotateZ) parts.push(`rotateZ(${t.rotateZ}deg)`);

  return parts.length ? parts.join(" ") : "none";
}

export function sceneDimensionsPx(
  config: MockupConfig,
  foldOpen: number,
  basePx = 280,
): { width: number; height: number } {
  const closedW = config.larguraFechadaMm ?? config.larguraAbertaMm;
  const closedH = config.alturaFechadaMm ?? config.alturaAbertaMm;
  const openW = config.larguraAbertaMm;
  const openH = config.alturaAbertaMm;

  const wMm = closedW + (openW - closedW) * foldOpen;
  const hMm = closedH + (openH - closedH) * foldOpen;

  const ratio = wMm / hMm;
  if (ratio >= 1) {
    return { width: basePx, height: Math.round(basePx / ratio) };
  }
  return { width: Math.round(basePx * ratio), height: basePx };
}

export function isRasterArteUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(url);
}
