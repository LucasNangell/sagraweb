import type { CSSProperties } from "react";

import type {
  PapelariaMockupConfig,
  PapelariaMockupCrop,
  PapelariaMockupFaceConfig,
  PapelariaMockupFaceStyle3d,
} from "./types";

const FULL_CROP: PapelariaMockupCrop = { x: 0, y: 0, width: 100, height: 100 };

export function normalizeCrop(crop?: PapelariaMockupCrop): PapelariaMockupCrop {
  return crop ?? FULL_CROP;
}

export function cropToBackgroundStyle(crop: PapelariaMockupCrop): {
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

export function resolvePageUrl(
  pages: string[],
  pageIndex: number,
): string | null {
  if (pageIndex < 0 || pageIndex >= pages.length) return null;
  const url = pages[pageIndex]?.trim();
  return url || null;
}

export function sceneDimensionsPx(
  config: PapelariaMockupConfig,
  foldOpen: number,
  basePx = 300,
): { width: number; height: number } {
  const closedW = config.larguraFechadaMm ?? config.larguraAbertaMm;
  const closedH = config.alturaFechadaMm ?? config.alturaAbertaMm;
  const openW = config.larguraAbertaMm;
  const openH = config.alturaAbertaMm;

  const wMm = closedW + (openW - closedW) * foldOpen;
  const hMm = closedH + (openH - closedH) * foldOpen;
  const scale = config.cena?.escalaBase ?? 1.15;
  const ratio = wMm / hMm;

  if (ratio >= 1) {
    return {
      width: Math.round(basePx * scale),
      height: Math.round((basePx / ratio) * scale),
    };
  }
  return {
    width: Math.round(basePx * ratio * scale),
    height: Math.round(basePx * scale),
  };
}

/** Calcula basePx para o mockup caber na área disponível (com margem de segurança). */
export function resolveSceneBasePx(
  config: PapelariaMockupConfig,
  foldOpen: number,
  availWidth: number,
  availHeight: number,
  safety = 0.9,
): number {
  const w = Math.max(0, availWidth) * safety;
  const h = Math.max(0, availHeight) * safety;
  if (w <= 0 || h <= 0) {
    return 280;
  }

  const closedW = config.larguraFechadaMm ?? config.larguraAbertaMm;
  const closedH = config.alturaFechadaMm ?? config.alturaAbertaMm;
  const openW = config.larguraAbertaMm;
  const openH = config.alturaAbertaMm;
  const wMm = closedW + (openW - closedW) * foldOpen;
  const hMm = closedH + (openH - closedH) * foldOpen;
  const ratio = wMm / hMm;
  const cenaScale = config.cena?.escalaBase ?? 1.15;

  let maxBase: number;
  if (ratio >= 1) {
    maxBase = Math.min(w / cenaScale, (h / cenaScale) * ratio);
  } else {
    maxBase = Math.min(w / (ratio * cenaScale), h / cenaScale);
  }

  return Math.max(160, Math.min(Math.round(maxBase), 960));
}

function pickRotation(
  style: PapelariaMockupFaceStyle3d,
  foldOpen: number,
  isHover: boolean,
  abreComDobra: boolean,
): { rotateX: number; rotateY: number } {
  let rotateX = style.rotateX ?? 0;
  let rotateY = style.rotateY ?? 0;

  if (abreComDobra) {
    const baseX = style.rotateX ?? 0;
    const baseY = style.rotateY ?? 0;
    const hoverX = style.rotateXHover ?? baseX * 1.6;
    const hoverY = style.rotateYHover ?? baseY * 1.55;
    if (isHover) {
      rotateX = hoverX;
      rotateY = hoverY;
    } else {
      rotateX = baseX;
      rotateY = baseY;
    }
    void foldOpen;
  } else if (isHover) {
    if (style.rotateXHover !== undefined) rotateX = style.rotateXHover;
    if (style.rotateYHover !== undefined) rotateY = style.rotateYHover;
  }

  return { rotateX, rotateY };
}

export function buildFaceTransform(
  face: PapelariaMockupFaceConfig,
  foldOpen: number,
  isHover: boolean,
): string {
  const s = face.style3d;
  const { rotateX, rotateY } = pickRotation(
    s,
    foldOpen,
    isHover,
    Boolean(face.abreComDobra),
  );

  const parts: string[] = [];
  if (s.translateX) parts.push(`translateX(${s.translateX})`);
  if (s.translateY) parts.push(`translateY(${s.translateY})`);
  if (s.translateZ) parts.push(`translateZ(${s.translateZ}px)`);
  if (rotateX) parts.push(`rotateX(${rotateX}deg)`);
  if (rotateY) parts.push(`rotateY(${rotateY}deg)`);
  if (s.rotateZ) parts.push(`rotateZ(${s.rotateZ}deg)`);

  return parts.length ? parts.join(" ") : "none";
}

export function buildSceneTransform(
  config: PapelariaMockupConfig,
  isHover: boolean,
): string {
  const c = config.cena ?? {};
  const rotateX = isHover && c.rotateXHover !== undefined ? c.rotateXHover : (c.rotateX ?? 5);
  const rotateY = isHover && c.rotateYHover !== undefined ? c.rotateYHover : (c.rotateY ?? -30);
  return `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
}

export function faceLayoutStyle(
  face: PapelariaMockupFaceConfig,
  config: PapelariaMockupConfig,
  productW: number,
  productH: number,
): CSSProperties {
  const crop = normalizeCrop(face.crop);
  const isEdge = Boolean(face.espessuraMm);

  if (isEdge) {
    const wPx =
      ((face.espessuraMm ?? 0.5) / config.larguraAbertaMm) * productW;
    return {
      width: `${wPx}px`,
      height: "100%",
      left: `${crop.x}%`,
      top: `${crop.y}%`,
    };
  }

  if (face.style3d.widthMm || face.style3d.heightMm) {
    const w =
      ((face.style3d.widthMm ?? config.larguraFechadaMm ?? config.larguraAbertaMm) /
        config.larguraAbertaMm) *
      100;
    const h =
      ((face.style3d.heightMm ?? config.alturaFechadaMm ?? config.alturaAbertaMm) /
        config.alturaAbertaMm) *
      100;
    const left =
      ((face.style3d.leftMm ?? 0) / config.larguraAbertaMm) * 100;
    const top =
      ((face.style3d.topMm ?? 0) / config.alturaAbertaMm) * 100;
    return {
      width: `${w}%`,
      height: `${h}%`,
      left: `${left}%`,
      top: `${top}%`,
    };
  }

  return {
    width: `${crop.width}%`,
    height: `${crop.height}%`,
    left: `${crop.x}%`,
    top: `${crop.y}%`,
  };
}

export function configUsesFold(config: PapelariaMockupConfig): boolean {
  return Boolean(
    config.dobras?.length ||
      config.faces.some((f) => f.abreComDobra),
  );
}

export function paginasUsadas(config: PapelariaMockupConfig): number[] {
  const indices = config.faces.map((f) => f.pageIndex);
  return [...new Set(indices)].sort((a, b) => a - b);
}
