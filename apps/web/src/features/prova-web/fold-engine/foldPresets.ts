import type { FoldPresetId } from "@/api/provaWeb";

import type {
  FoldCrease,
  FoldMovingSide,
  FoldOperation,
  FoldTowards,
} from "./foldTypes";

export type FoldPresetGenerator = (
  widthMm: number,
  heightMm: number,
) => { creases: FoldCrease[]; operations: FoldOperation[] };

function crease(
  id: string,
  axis: FoldCrease["axis"],
  frac: number,
  span: number,
): FoldCrease {
  return {
    id,
    axis,
    positionMm: Math.round(span * frac * 100) / 100,
  };
}

function op(
  id: string,
  creaseId: string,
  order: number,
  movingSide: FoldMovingSide,
  towards: FoldTowards,
  phaseId?: string,
  targetAngleDeg = 180,
): FoldOperation {
  return {
    id,
    creaseId,
    order,
    movingSide,
    towards,
    targetAngleDeg,
    ...(phaseId ? { phaseId } : {}),
  };
}

/** Sanfona 3 painéis: lados e sentidos alternados. */
const tripticoSanfonaV: FoldPresetGenerator = (w) => {
  const creases = [
    crease("c1", "vertical", 1 / 3, w),
    crease("c2", "vertical", 2 / 3, w),
  ];
  return {
    creases,
    operations: [
      op("o1", "c1", 1, "negative", "front"),
      op("o2", "c2", 2, "positive", "back"),
    ],
  };
};

const tripticoSanfonaH: FoldPresetGenerator = (_w, h) => {
  const creases = [
    crease("c1", "horizontal", 1 / 3, h),
    crease("c2", "horizontal", 2 / 3, h),
  ];
  return {
    creases,
    operations: [
      op("o1", "c1", 1, "negative", "front"),
      op("o2", "c2", 2, "positive", "back"),
    ],
  };
};

/** Carteira: fecha aba direita, depois esquerda sobre o centro. */
const tripticoCarteiraDir: FoldPresetGenerator = (w) => {
  const creases = [
    crease("c1", "vertical", 1 / 3, w),
    crease("c2", "vertical", 2 / 3, w),
  ];
  return {
    creases,
    operations: [
      op("o1", "c2", 1, "positive", "front"),
      op("o2", "c1", 2, "negative", "front"),
    ],
  };
};

const tripticoCarteiraEsq: FoldPresetGenerator = (w) => {
  const creases = [
    crease("c1", "vertical", 1 / 3, w),
    crease("c2", "vertical", 2 / 3, w),
  ];
  return {
    creases,
    operations: [
      op("o1", "c1", 1, "negative", "front"),
      op("o2", "c2", 2, "positive", "front"),
    ],
  };
};

const sanfona4: FoldPresetGenerator = (w) => {
  const creases = [
    crease("c1", "vertical", 0.25, w),
    crease("c2", "vertical", 0.5, w),
    crease("c3", "vertical", 0.75, w),
  ];
  return {
    creases,
    operations: [
      op("o1", "c1", 1, "negative", "front"),
      op("o2", "c2", 2, "positive", "back"),
      op("o3", "c3", 3, "negative", "front"),
    ],
  };
};

/** Enrolada: sempre o mesmo lado móvel (pilha acompanha). */
const enrolada4: FoldPresetGenerator = (w) => {
  const creases = [
    crease("c1", "vertical", 0.25, w),
    crease("c2", "vertical", 0.5, w),
    crease("c3", "vertical", 0.75, w),
  ];
  return {
    creases,
    operations: [
      op("o1", "c3", 1, "positive", "front"),
      op("o2", "c2", 2, "positive", "front"),
      op("o3", "c1", 3, "positive", "front"),
    ],
  };
};

const portao: FoldPresetGenerator = (w) => {
  const creases = [
    crease("c1", "vertical", 0.25, w),
    crease("c2", "vertical", 0.75, w),
  ];
  return {
    creases,
    operations: [
      op("o1", "c1", 1, "negative", "front", "gate"),
      op("o2", "c2", 1, "positive", "front", "gate"),
    ],
  };
};

const paralelaDupla: FoldPresetGenerator = (w) => {
  const creases = [
    crease("c1", "vertical", 1 / 3, w),
    crease("c2", "vertical", 2 / 3, w),
  ];
  return {
    creases,
    operations: [
      op("o1", "c1", 1, "negative", "front"),
      op("o2", "c2", 2, "negative", "front"),
    ],
  };
};

const cruzadoV: FoldPresetGenerator = (w, h) => ({
  creases: [crease("cv", "vertical", 0.5, w), crease("ch", "horizontal", 0.5, h)],
  operations: [
    op("o1", "cv", 1, "positive", "front"),
    op("o2", "ch", 2, "positive", "front"),
  ],
});

const cruzadoH: FoldPresetGenerator = (w, h) => ({
  creases: [crease("cv", "vertical", 0.5, w), crease("ch", "horizontal", 0.5, h)],
  operations: [
    op("o1", "ch", 1, "positive", "front"),
    op("o2", "cv", 2, "positive", "front"),
  ],
});

export const FOLD_PRESET_GENERATORS: Record<string, FoldPresetGenerator> = {
  biparte_vertical: (w) => ({
    creases: [crease("c1", "vertical", 0.5, w)],
    operations: [op("o1", "c1", 1, "positive", "front")],
  }),
  biparte_horizontal: (_w, h) => ({
    creases: [crease("c1", "horizontal", 0.5, h)],
    operations: [op("o1", "c1", 1, "positive", "front")],
  }),
  triptico_sanfona_vertical: tripticoSanfonaV,
  triptico_sanfona_horizontal: tripticoSanfonaH,
  triptico_carteira_esquerda: tripticoCarteiraEsq,
  triptico_carteira_direita: tripticoCarteiraDir,
  portao,
  sanfona_4: sanfona4,
  enrolada_4: enrolada4,
  paralela_dupla: paralelaDupla,
  cruzado_v_primeiro: cruzadoV,
  cruzado_h_primeiro: cruzadoH,
  personalizada: (w) => ({
    creases: [crease("c1", "vertical", 0.5, w)],
    operations: [op("o1", "c1", 1, "positive", "front")],
  }),
  // Legado → gera equivalente (só se alguém ainda mandar o id)
  triptico_vertical: tripticoSanfonaV,
  triptico_horizontal: tripticoSanfonaH,
  quad_vertical: sanfona4,
  sanfona_vertical: sanfona4,
  cruzado: cruzadoV,
};

export const FOLD_PRESET_OPTIONS: Array<{
  id: FoldPresetId;
  label: string;
  hint: string;
}> = [
  { id: "biparte_vertical", label: "Biparte vertical", hint: "1 dobra no meio" },
  {
    id: "biparte_horizontal",
    label: "Biparte horizontal",
    hint: "1 dobra horizontal",
  },
  {
    id: "triptico_sanfona_vertical",
    label: "Tríptico sanfona",
    hint: "Z-fold · 3 faces",
  },
  {
    id: "triptico_sanfona_horizontal",
    label: "Tríptico sanfona H",
    hint: "Z-fold horizontal",
  },
  {
    id: "triptico_carteira_esquerda",
    label: "Carteira (esq. primeiro)",
    hint: "C-fold · fecha esquerda",
  },
  {
    id: "triptico_carteira_direita",
    label: "Carteira (dir. primeiro)",
    hint: "C-fold · fecha direita",
  },
  { id: "portao", label: "Portão", hint: "Abas laterais juntas" },
  { id: "sanfona_4", label: "Sanfona 4", hint: "Sinais alternados" },
  { id: "enrolada_4", label: "Enrolada 4", hint: "Roll fold" },
  { id: "paralela_dupla", label: "Paralela dupla", hint: "Mesmo lado móvel" },
  {
    id: "cruzado_v_primeiro",
    label: "Cruzada (V primeiro)",
    hint: "Grade 2×2",
  },
  {
    id: "cruzado_h_primeiro",
    label: "Cruzada (H primeiro)",
    hint: "Grade 2×2",
  },
  { id: "personalizada", label: "Personalizada", hint: "Editar vincos livremente" },
];

export function sheetFromPreset(
  preset: string,
  widthMm: number,
  heightMm: number,
): { creases: FoldCrease[]; operations: FoldOperation[] } {
  const gen =
    FOLD_PRESET_GENERATORS[preset] ?? FOLD_PRESET_GENERATORS.biparte_vertical!;
  return gen(widthMm, heightMm);
}
