export type PlateColor = "C" | "M" | "Y" | "K";

export type PlateChannelKind = "cmyk" | "pantone";

const PLATE_COLORS: PlateColor[] = ["C", "M", "Y", "K"];

/** Natural ascending compare for filenames (Cad 2 before Cad 10, etc.). */
export function compareNaturalName(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
}

/** Last parenthetical before .tif/.tiff — CMYK or Pantone/spot token. */
const PLATE_CHANNEL_SUFFIX = /\s*\(([^)]+)\)\.tiff?$/i;
const CHAPA_LABEL_RE = /\((Cad\s+\d+\s+[A-Z])\)/i;

export const PLATE_CHANNEL_COLORS: Record<
  PlateColor,
  { rgb: string; bg: string; text: string; border: string }
> = {
  C: {
    rgb: "rgb(0, 174, 239)",
    bg: "bg-sky-100",
    text: "text-sky-800",
    border: "border-sky-400",
  },
  M: {
    rgb: "rgb(236, 0, 140)",
    bg: "bg-fuchsia-100",
    text: "text-fuchsia-800",
    border: "border-fuchsia-400",
  },
  Y: {
    rgb: "rgb(255, 242, 0)",
    bg: "bg-yellow-100",
    text: "text-yellow-900",
    border: "border-yellow-500",
  },
  K: {
    rgb: "rgb(30, 30, 30)",
    bg: "bg-neutral-200",
    text: "text-neutral-900",
    border: "border-neutral-600",
  },
};

export const PANTONE_CHANNEL_STYLE = {
  bg: "bg-amber-100",
  text: "text-amber-900",
  border: "border-amber-500",
} as const;

export interface ParsedPlateFilename {
  /** CMYK channel when kind is cmyk; null for pantone. */
  color: PlateColor | null;
  kind: PlateChannelKind | null;
  chapaLabel: string | null;
  groupKey: string | null;
  /** Raw token inside the last `(...)` before extension. */
  channelToken: string | null;
}

export interface PlateChapaGroup<T extends { id: number; nome: string }> {
  groupKey: string;
  chapaLabel: string | null;
  displayLabel: string;
  filesByColor: Partial<Record<PlateColor, T>>;
  pantoneFiles: T[];
  order: number;
}

export interface PlateCadernoFaceGroup<T extends { id: number; nome: string }>
  extends PlateChapaGroup<T> {
  face: string;
  faceLabel: string;
}

export interface PlateCadernoGroup<T extends { id: number; nome: string }> {
  cadernoKey: string;
  displayLabel: string;
  faces: PlateCadernoFaceGroup<T>[];
  order: number;
}

const CADERNO_PARTS_RE = /^Cad\s+(\d+)\s+([A-Z])$/i;

export function faceLetterToLabel(face: string): string {
  const upper = face.toUpperCase();
  if (upper === "A") return "Frente";
  if (upper === "B") return "Verso";
  return `Face ${upper}`;
}

export function parseCadernoParts(chapaLabel: string | null | undefined): {
  cadernoNumber: number | null;
  cadernoKey: string | null;
  face: string | null;
  faceLabel: string | null;
} {
  if (!chapaLabel) {
    return {
      cadernoNumber: null,
      cadernoKey: null,
      face: null,
      faceLabel: null,
    };
  }
  const match = chapaLabel.trim().match(CADERNO_PARTS_RE);
  if (!match) {
    return {
      cadernoNumber: null,
      cadernoKey: null,
      face: null,
      faceLabel: null,
    };
  }
  const cadernoNumber = Number(match[1]);
  const face = match[2]!.toUpperCase();
  return {
    cadernoNumber,
    cadernoKey: `Cad ${cadernoNumber}`,
    face,
    faceLabel: faceLetterToLabel(face),
  };
}

function isCmykToken(token: string): token is PlateColor {
  const upper = token.toUpperCase();
  return upper === "C" || upper === "M" || upper === "Y" || upper === "K";
}

function isCadLabelToken(token: string): boolean {
  return /^Cad\s+\d+\s+[A-Z]$/i.test(token.trim());
}

export function parsePlateColorFromFilename(name: string): PlateColor | null {
  const match = name.trim().match(PLATE_CHANNEL_SUFFIX);
  const token = match?.[1]?.trim();
  if (!token || !isCmykToken(token)) {
    return null;
  }
  return token.toUpperCase() as PlateColor;
}

export function parseChapaLabelFromFilename(name: string): string | null {
  const match = name.trim().match(CHAPA_LABEL_RE);
  return match?.[1] ?? null;
}

export function parsePlateFilename(name: string): ParsedPlateFilename {
  const trimmed = name.trim();
  const match = trimmed.match(PLATE_CHANNEL_SUFFIX);
  const chapaLabel = parseChapaLabelFromFilename(trimmed);
  const token = match?.[1]?.trim() ?? null;

  if (!token || isCadLabelToken(token)) {
    return {
      color: null,
      kind: null,
      chapaLabel,
      groupKey: null,
      channelToken: null,
    };
  }

  const groupKey = trimmed.replace(PLATE_CHANNEL_SUFFIX, "").trim() || null;

  if (isCmykToken(token)) {
    return {
      color: token.toUpperCase() as PlateColor,
      kind: "cmyk",
      chapaLabel,
      groupKey,
      channelToken: token,
    };
  }

  return {
    color: null,
    kind: "pantone",
    chapaLabel,
    groupKey,
    channelToken: token,
  };
}

export function isPdfFilename(name: string): boolean {
  return name.trim().toLowerCase().endsWith(".pdf");
}

function ensureChapaGroup<T extends { id: number; nome: string }>(
  chapaMap: Map<string, PlateChapaGroup<T>>,
  groupKey: string,
  chapaLabel: string | null,
  index: number,
): PlateChapaGroup<T> {
  let group = chapaMap.get(groupKey);
  if (!group) {
    group = {
      groupKey,
      chapaLabel,
      displayLabel: chapaLabel ?? groupKey,
      filesByColor: {},
      pantoneFiles: [],
      order: index,
    };
    chapaMap.set(groupKey, group);
  }
  return group;
}

export function groupArquivosByChapa<T extends { id: number; nome: string }>(
  arquivos: T[],
): { chapas: PlateChapaGroup<T>[]; espelhos: T[]; others: T[] } {
  const chapaMap = new Map<string, PlateChapaGroup<T>>();
  const espelhos: T[] = [];
  const others: T[] = [];

  arquivos.forEach((arq, index) => {
    if (isPdfFilename(arq.nome)) {
      espelhos.push(arq);
      return;
    }

    const parsed = parsePlateFilename(arq.nome);
    if (!parsed.groupKey || !parsed.kind) {
      others.push(arq);
      return;
    }

    const group = ensureChapaGroup(
      chapaMap,
      parsed.groupKey,
      parsed.chapaLabel,
      index,
    );

    if (parsed.kind === "cmyk" && parsed.color) {
      group.filesByColor[parsed.color] = arq;
      return;
    }

    group.pantoneFiles.push(arq);
  });

  const chapas = [...chapaMap.values()].sort((a, b) => {
    const labelCmp = compareNaturalName(a.displayLabel, b.displayLabel);
    if (labelCmp !== 0) {
      return labelCmp;
    }
    return a.order - b.order;
  });

  for (const chapa of chapas) {
    chapa.pantoneFiles.sort((a, b) => compareNaturalName(a.nome, b.nome));
  }

  espelhos.sort((a, b) => compareNaturalName(a.nome, b.nome));
  others.sort((a, b) => compareNaturalName(a.nome, b.nome));

  return { chapas, espelhos, others };
}

/** Nest face-level chapa groups under Cad N (Frente/Verso). */
export function groupArquivosByCaderno<T extends { id: number; nome: string }>(
  arquivos: T[],
): {
  cadernos: PlateCadernoGroup<T>[];
  orphanChapas: PlateChapaGroup<T>[];
  espelhos: T[];
  others: T[];
} {
  const { chapas, espelhos, others } = groupArquivosByChapa(arquivos);
  const cadernoMap = new Map<string, PlateCadernoGroup<T>>();
  const orphanChapas: PlateChapaGroup<T>[] = [];

  for (const chapa of chapas) {
    const parts = parseCadernoParts(chapa.chapaLabel);
    if (!parts.cadernoKey || !parts.face || !parts.faceLabel) {
      orphanChapas.push(chapa);
      continue;
    }
    let caderno = cadernoMap.get(parts.cadernoKey);
    if (!caderno) {
      caderno = {
        cadernoKey: parts.cadernoKey,
        displayLabel: parts.cadernoKey,
        faces: [],
        order: chapa.order,
      };
      cadernoMap.set(parts.cadernoKey, caderno);
    }
    caderno.faces.push({
      ...chapa,
      face: parts.face,
      faceLabel: parts.faceLabel,
    });
  }

  const faceOrder = (face: string) => {
    const upper = face.toUpperCase();
    if (upper === "A") return 0;
    if (upper === "B") return 1;
    return 10 + upper.charCodeAt(0);
  };

  const cadernos = [...cadernoMap.values()].sort((a, b) => {
    const labelCmp = compareNaturalName(a.displayLabel, b.displayLabel);
    if (labelCmp !== 0) return labelCmp;
    return a.order - b.order;
  });

  for (const caderno of cadernos) {
    caderno.faces.sort((a, b) => {
      const fo = faceOrder(a.face) - faceOrder(b.face);
      if (fo !== 0) return fo;
      return a.order - b.order;
    });
  }

  return { cadernos, orphanChapas, espelhos, others };
}

export interface MaquinaArquivoGroup<T> {
  /** Empty string when files have no machine assigned. */
  maquina: string;
  label: string;
  arquivos: T[];
  order: number;
}

/** Groups files by `maquina`, preserving first-seen order; unlabeled last. */
export function groupArquivosByMaquina<
  T extends { maquina?: string | null; nome?: string | null },
>(arquivos: T[]): MaquinaArquivoGroup<T>[] {
  const map = new Map<string, MaquinaArquivoGroup<T>>();

  arquivos.forEach((arq, index) => {
    const maquina = String(arq.maquina || "").trim();
    let group = map.get(maquina);
    if (!group) {
      group = {
        maquina,
        label: maquina || "Sem máquina",
        arquivos: [],
        order: index,
      };
      map.set(maquina, group);
    }
    group.arquivos.push(arq);
  });

  for (const group of map.values()) {
    group.arquivos.sort((a, b) =>
      compareNaturalName(String(a.nome ?? ""), String(b.nome ?? "")),
    );
  }

  return [...map.values()].sort((a, b) => {
    if (!a.maquina && b.maquina) return 1;
    if (a.maquina && !b.maquina) return -1;
    const labelCmp = compareNaturalName(a.label, b.label);
    if (labelCmp !== 0) return labelCmp;
    return a.order - b.order;
  });
}

export function formatPlatePreviewBadge(nome: string): string | null {
  const parsed = parsePlateFilename(nome);
  if (!parsed.kind) {
    return null;
  }
  const channelLabel = parsed.kind === "pantone" ? "PANTONE" : parsed.color;
  if (!channelLabel) {
    return null;
  }
  if (parsed.chapaLabel) {
    return `${parsed.chapaLabel} · ${channelLabel}`;
  }
  return channelLabel;
}

export { PLATE_COLORS };
