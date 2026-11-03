export interface CardModelPalette {
  bg: string;
  border: string;
  accent: string;
}

export interface CardModelDef {
  id: string;
  label: string;
  group: string;
  /** Paleta nativa do efeito (usada como fallback no CSS). */
  palette: CardModelPalette;
}

const GLAB = "Laboratório";
const G11 = "11 • Painel moderno";
const G6 = "6 • Next-Gen 3D & Design (37–56)";
const G7 = "7 • Tipografia viva (57–66)";

export const CARD_MODELS: CardModelDef[] = [
  {
    id: "lab-vidro-fosco",
    label: "Vidro fosco · Composição",
    group: GLAB,
    palette: { bg: "#141e2a", border: "#7aa86a", accent: "#b4f48a" },
  },

  // Seção 11
  { id: "v79", label: "79 · Varredura metálica", group: G11, palette: { bg: "#ff9d00", border: "#ffd166", accent: "#fff0b3" } },
  { id: "v77", label: "77 · Bobina de Tesla", group: G11, palette: { bg: "#18181b", border: "#10b981", accent: "#4ade80" } },
  { id: "v80", label: "80 · Giroflex", group: G11, palette: { bg: "#18181b", border: "#ffffff", accent: "#10b981" } },
  { id: "v81", label: "81 · Pulso duplo", group: G11, palette: { bg: "#18181b", border: "#10b981", accent: "#10b981" } },
  { id: "v37", label: "37 · Laser orbit", group: G11, palette: { bg: "#0f172a", border: "#38bdf8", accent: "#ffffff" } },

  // Seção 6 (37–56)
  { id: "mod-conic-beam", label: "37 · Feixe cônico", group: G6, palette: { bg: "#0f172a", border: "#00f2fe", accent: "#4facfe" } },
  { id: "mod-kinetic-grad", label: "38 · Gradiente cinético", group: G6, palette: { bg: "#0a0a0c", border: "#27272a", accent: "#ff007f" } },
  { id: "mod-3d-orbit", label: "39 · Órbita 3D", group: G6, palette: { bg: "#0f172a", border: "#94a3b8", accent: "#38bdf8" } },
  { id: "mod-brutalist", label: "40 · Brutalista", group: G6, palette: { bg: "#fde047", border: "#09090b", accent: "#ec4899" } },
  { id: "mod-terminal", label: "41 · Terminal", group: G6, palette: { bg: "#05100a", border: "#10b981", accent: "#10b981" } },
  { id: "mod-stroke-wave", label: "42 · Contorno pulsante", group: G6, palette: { bg: "#13111c", border: "#2e2640", accent: "#a855f7" } },
  { id: "mod-cinematic-serif", label: "43 · Serifa cinemática", group: G6, palette: { bg: "#0c0a09", border: "#78716c", accent: "#fbbf24" } },
  { id: "mod-3d-text-extrude", label: "44 · Texto extrudado 3D", group: G6, palette: { bg: "#31102f", border: "#db2777", accent: "#f472b6" } },
  { id: "mod-aurora", label: "45 · Aurora", group: G6, palette: { bg: "#ee7752", border: "#23a6d5", accent: "#e73c7e" } },
  { id: "mod-holo-prism", label: "46 · Prisma holográfico", group: G6, palette: { bg: "#1e293b", border: "#ffffff", accent: "#00ffff" } },
  { id: "mod-neumorph", label: "47 · Neumorfismo", group: G6, palette: { bg: "#1e293b", border: "#2d3e59", accent: "#38bdf8" } },
  { id: "mod-hud", label: "48 · HUD", group: G6, palette: { bg: "#06182a", border: "#06b6d4", accent: "#22d3ee" } },
  { id: "mod-slot-text", label: "49 · Slot machine", group: G6, palette: { bg: "#18181b", border: "#3f3f46", accent: "#fbbf24" } },
  { id: "mod-water-mirror", label: "50 · Espelho d'água", group: G6, palette: { bg: "#0b1030", border: "#312e81", accent: "#818cf8" } },
  { id: "mod-cube-spin", label: "51 · Cubo giratório", group: G6, palette: { bg: "#4f46e5", border: "#7c3aed", accent: "#db2777" } },
  { id: "mod-liquid-blob", label: "52 · Blob líquido", group: G6, palette: { bg: "#10b981", border: "#047857", accent: "#06b6d4" } },
  { id: "mod-anaglyph", label: "53 · Anáglifo 3D", group: G6, palette: { bg: "#09090b", border: "#27272a", accent: "#ff0055" } },
  { id: "mod-sonar", label: "54 · Sonar", group: G6, palette: { bg: "#0c192c", border: "#1e3a8a", accent: "#3b82f6" } },
  { id: "mod-spotlight", label: "55 · Holofote", group: G6, palette: { bg: "#050505", border: "#1f1f1f", accent: "#3b82f6" } },
  { id: "mod-maglev", label: "56 · Maglev", group: G6, palette: { bg: "#18181b", border: "#f43f5e", accent: "#38bdf8" } },

  // Seção 7 (57–66)
  { id: "txt-cyber-slice", label: "57 · Fatiamento cyber", group: G7, palette: { bg: "#090a0f", border: "#1e293b", accent: "#00f0ff" } },
  { id: "txt-inferno", label: "58 · Inferno", group: G7, palette: { bg: "#0a0200", border: "#450a0a", accent: "#ff8000" } },
  { id: "txt-char-wave", label: "59 · Onda de letras", group: G7, palette: { bg: "#111827", border: "#374151", accent: "#38bdf8" } },
  { id: "txt-marquee", label: "60 · Letreiro", group: G7, palette: { bg: "#090d16", border: "#eab308", accent: "#facc15" } },
  { id: "txt-vegas-neon", label: "61 · Neon Vegas", group: G7, palette: { bg: "#0d0414", border: "#4a044e", accent: "#d946ef" } },
  { id: "txt-matrix", label: "62 · Matrix", group: G7, palette: { bg: "#000a00", border: "#00ff41", accent: "#00ff41" } },
  { id: "txt-ghost-smoke", label: "63 · Fumaça fantasma", group: G7, palette: { bg: "#0f172a", border: "#1e293b", accent: "#f1f5f9" } },
  { id: "txt-slingshot", label: "64 · Estilingue", group: G7, palette: { bg: "#1e1b4b", border: "#4338ca", accent: "#f43f5e" } },
  { id: "txt-3d-roller", label: "65 · Rolo 3D", group: G7, palette: { bg: "#18181b", border: "#3f3f46", accent: "#a855f7" } },
  { id: "txt-xray", label: "66 · Raio-X", group: G7, palette: { bg: "#090d16", border: "#1e293b", accent: "#00ffcc" } },
];

export const CARD_MODEL_IDS = new Set(CARD_MODELS.map((item) => item.id));

export const CARD_MODEL_MAP = new Map(
  CARD_MODELS.map((item) => [item.id, item] as const),
);

export function isCardModelId(value: string): boolean {
  return CARD_MODEL_IDS.has(value);
}

export function cardModelPalette(id: string): CardModelPalette | undefined {
  return CARD_MODEL_MAP.get(id)?.palette;
}

/** Paletas legadas da seção 10/11 (ids `*-amber`, `*-darkgray`, `*-red`). */
export const LEGACY_SUFFIX_PALETTE: Record<string, CardModelPalette> = {
  amber: { bg: "#ff9d00", border: "#ffd166", accent: "#fff0b3" },
  darkgray: { bg: "#18181b", border: "#10b981", accent: "#4ade80" },
  red: { bg: "#b91c1c", border: "#fecaca", accent: "#fde047" },
};

/**
 * Converte um id legado (`v79-amber`, `v37-red`, …) no efeito base + paleta.
 * Retorna `null` se não for um id legado conhecido.
 */
export function migrateLegacyModelId(
  value: string,
): { effect: string; palette: CardModelPalette } | null {
  const match = /^(v\d+)-(amber|darkgray|red)$/.exec(value);
  if (!match) {
    return null;
  }
  const effect = match[1];
  const palette = LEGACY_SUFFIX_PALETTE[match[2]];
  if (!isCardModelId(effect) || !palette) {
    return null;
  }
  return { effect, palette };
}
