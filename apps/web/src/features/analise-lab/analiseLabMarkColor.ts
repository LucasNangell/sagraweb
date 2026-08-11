import type { AnaliseLabMarkCor } from "@/api/analiseLab";

import { COLOR_OPTIONS } from "./analiseLabLabels";

export const MARK_COLOR_HEX: Record<AnaliseLabMarkCor, string> = {
  red: "#dc2626",
  orange: "#ea580c",
  yellow: "#ca8a04",
  green: "#16a34a",
  blue: "#2563eb",
  purple: "#9333ea",
  black: "#111827",
  white: "#f8fafc",
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Escolhe o nome de cor do Lab mais próximo do hex informado. */
export function nearestMarkCor(hex: string): AnaliseLabMarkCor {
  const target = hexToRgb(hex);
  if (!target) return "red";
  let best: AnaliseLabMarkCor = "red";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const name of COLOR_OPTIONS) {
    const rgb = hexToRgb(MARK_COLOR_HEX[name]);
    if (!rgb) continue;
    const dr = rgb.r - target.r;
    const dg = rgb.g - target.g;
    const db = rgb.b - target.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

export function markCorToHex(cor: string): string {
  return MARK_COLOR_HEX[cor as AnaliseLabMarkCor] || MARK_COLOR_HEX.red;
}
