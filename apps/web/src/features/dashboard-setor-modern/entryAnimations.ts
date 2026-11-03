export interface EntryAnimationDef {
  id: string;
  label: string;
  group: string;
}

const G5 = "5 • Entradas clássicas (25–36)";
const G8 = "8 • Entradas surreais (67–76)";
const G7 = "7 • Tipografia viva (57–66)";
const G9 = "9 • Realce extremo (77–86)";

/** Animações de entrada: rodam 1x na chegada do card. Padrão global. */
export const ENTRY_ANIMATIONS: EntryAnimationDef[] = [
  { id: "none", label: "Nenhuma", group: G5 },
  { id: "fx-iris", label: "25. Íris Portal", group: G5 },
  { id: "fx-stage-build", label: "26. Construção 2 estágios", group: G5 },
  { id: "fx-glitch", label: "27. Glitch RGB", group: G5 },
  { id: "fx-rubber", label: "28. Impacto elástico", group: G5 },
  { id: "fx-origami", label: "29. Corte diagonal", group: G5 },
  { id: "fx-laser", label: "30. Laser reconstrutor", group: G5 },
  { id: "fx-isometric", label: "31. Pouso isométrico", group: G5 },
  { id: "fx-crt", label: "32. Ignição CRT", group: G5 },
  { id: "fx-supernova", label: "33. Supernova", group: G5 },
  { id: "fx-stagger", label: "34. Cascata interna", group: G5 },
  { id: "fx-shutter", label: "35. Obturador", group: G5 },
  { id: "fx-warp", label: "36. Dobra espacial", group: G5 },

  // Seção 8 (67–76) — entradas surreais (1x na chegada)
  { id: "fx-blackhole", label: "67. Buraco negro", group: G8 },
  { id: "fx-teleport", label: "68. Teletransporte", group: G8 },
  { id: "fx-meteor", label: "69. Meteoro", group: G8 },
  { id: "fx-origami3d", label: "70. Origami 3D", group: G8 },
  { id: "fx-blinds", label: "71. Persianas", group: G8 },
  { id: "fx-pendulum", label: "72. Pêndulo", group: G8 },
  { id: "fx-mercury", label: "73. Mercúrio", group: G8 },
  { id: "fx-rift", label: "74. Fenda dimensional", group: G8 },
  { id: "fx-barrel-roll", label: "75. Barrel roll", group: G8 },
  { id: "fx-clone-merge", label: "76. Fusão de clones", group: G8 },
];

/** Animações de realce: rodam em loop contínuo. Podem variar por prioridade. */
export const HIGHLIGHT_ANIMATIONS: EntryAnimationDef[] = [
  // Seção 7 (57–66) — texto
  { id: "fx-cyber-slice", label: "57. Fatiamento cyber", group: G7 },
  { id: "fx-inferno", label: "58. Inferno", group: G7 },
  { id: "fx-char-wave", label: "59. Onda de letras", group: G7 },
  { id: "fx-marquee", label: "60. Letreiro", group: G7 },
  { id: "fx-vegas-neon", label: "61. Neon Vegas", group: G7 },
  { id: "fx-matrix", label: "62. Matrix", group: G7 },
  { id: "fx-ghost-smoke", label: "63. Fumaça fantasma", group: G7 },
  { id: "fx-slingshot", label: "64. Estilingue", group: G7 },
  { id: "fx-3d-roller", label: "65. Rolo 3D", group: G7 },
  { id: "fx-xray", label: "66. Raio-X", group: G7 },

  // Seção 9 (77–86) — realce extremo
  { id: "fx-tesla", label: "77. Tesla", group: G9 },
  { id: "fx-nuclear", label: "78. Núcleo nuclear", group: G9 },
  { id: "fx-gold-vip", label: "79. Ouro VIP", group: G9 },
  { id: "fx-siren", label: "80. Sirene", group: G9 },
  { id: "fx-heartbeat", label: "81. Batimento", group: G9 },
  { id: "fx-twin-laser", label: "82. Laser duplo", group: G9 },
  { id: "fx-forcefield", label: "83. Campo de força", group: G9 },
  { id: "fx-stamp", label: "84. Carimbo", group: G9 },
  { id: "fx-crystal", label: "85. Cristal", group: G9 },
  { id: "fx-solar-flare", label: "86. Explosão solar", group: G9 },
];

export const ENTRY_ANIMATION_IDS = new Set(
  ENTRY_ANIMATIONS.map((item) => item.id),
);

export const HIGHLIGHT_ANIMATION_IDS = new Set(
  HIGHLIGHT_ANIMATIONS.map((item) => item.id),
);

export function isEntryAnimationId(value: string): boolean {
  return ENTRY_ANIMATION_IDS.has(value);
}

export function isHighlightAnimationId(value: string): boolean {
  return HIGHLIGHT_ANIMATION_IDS.has(value);
}
