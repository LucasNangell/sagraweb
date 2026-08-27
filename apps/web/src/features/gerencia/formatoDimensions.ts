/** Dimensões ISO e formatos com medidas no nome (mm). Convenção: altura × largura. */
const ISO_FORMATOS_MM: Record<string, { altura: number; largura: number }> = {
  A2: { altura: 420, largura: 594 },
  A3: { altura: 297, largura: 420 },
  A4: { altura: 210, largura: 297 },
  "A4 PAISAGEM": { altura: 297, largura: 210 },
  A5: { altura: 148, largura: 210 },
  A6: { altura: 105, largura: 148 },
};

/** Aceita unidades opcionais coladas ao número (ex.: 50mmx50mm, 210mm x 297mm). */
const DIM_PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(?:mm|cm|m)?\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(?:mm|cm|m)?/i;
const ISO_SUFFIX_ORDER = ["A6", "A5", "A4", "A3", "A2"] as const;

export interface FormatoDimensoes {
  altura: number;
  largura: number;
}

export interface FormatoLookupItem {
  formato: string;
  altura_mm?: number | null;
  largura_mm?: number | null;
}

export function resolveFormatoDimensions(
  formato: string,
  predefinidos?: FormatoLookupItem[],
): FormatoDimensoes | null {
  const text = formato.trim();
  if (!text) return null;

  const fromApi = predefinidos?.find(
    (f) => f.formato.localeCompare(text, "pt-BR", { sensitivity: "accent" }) === 0,
  );
  if (fromApi?.altura_mm != null && fromApi?.largura_mm != null) {
    return { altura: fromApi.altura_mm, largura: fromApi.largura_mm };
  }

  const upper = text.toUpperCase();
  if (ISO_FORMATOS_MM[upper]) {
    return ISO_FORMATOS_MM[upper];
  }

  const match = text.match(DIM_PATTERN);
  if (match) {
    const altura = parseFloat(match[1].replace(",", "."));
    const largura = parseFloat(match[2].replace(",", "."));
    if (altura > 0 && largura > 0) {
      return { altura, largura };
    }
  }

  if (/\bA4\s+PAISAGEM\b/i.test(text)) {
    return ISO_FORMATOS_MM["A4 PAISAGEM"];
  }

  for (const iso of ISO_SUFFIX_ORDER) {
    if (new RegExp(`\\b${iso}\\b`, "i").test(text)) {
      return ISO_FORMATOS_MM[iso];
    }
  }

  return null;
}

function sameDims(a: FormatoDimensoes, b: FormatoDimensoes, eps = 0.051): boolean {
  return Math.abs(a.altura - b.altura) <= eps && Math.abs(a.largura - b.largura) <= eps;
}

function formatMm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function formatDimensionFormato(altura: number, largura: number): string {
  return `${formatMm(altura)} x ${formatMm(largura)}`;
}

/**
 * Nome de formato que corresponde às medidas (catálogo, ISO ou "H x L").
 * Preserva o nome atual quando ele já descreve as mesmas dimensões.
 */
export function findFormatoForDimensions(
  altura: number,
  largura: number,
  predefinidos?: FormatoLookupItem[],
  currentFormato?: string,
): string | null {
  if (!(altura > 0) || !(largura > 0)) return null;
  const target = { altura, largura };
  const current = (currentFormato || "").trim();

  if (current) {
    const currentDims = resolveFormatoDimensions(current, predefinidos);
    if (currentDims && sameDims(currentDims, target)) return current;
  }

  const fromApi = predefinidos?.find(
    (f) =>
      f.altura_mm != null &&
      f.largura_mm != null &&
      sameDims({ altura: f.altura_mm, largura: f.largura_mm }, target),
  );
  if (fromApi?.formato.trim()) return fromApi.formato.trim();

  for (const [nome, dims] of Object.entries(ISO_FORMATOS_MM)) {
    if (sameDims(dims, target)) {
      return nome === "A4 PAISAGEM" ? "A4 Paisagem" : nome;
    }
  }

  return formatDimensionFormato(altura, largura);
}
