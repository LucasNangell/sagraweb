/** Variáveis calculadas a partir de `genero`; não entram no formulário. */
export const DERIVED_PREVIEW_VARIABLES = new Set(["artigo", "genero_curto"]);

export function isDerivedPreviewVariable(nome: string): boolean {
  return DERIVED_PREVIEW_VARIABLES.has(nome.trim());
}

export function enrichDerivedTemplateValues(
  values: Record<string, string>,
): Record<string, string> {
  const feminino = (values.genero ?? "").toLowerCase().includes("deputada");
  return {
    ...values,
    artigo: feminino ? "da" : "do",
    genero_curto: feminino ? "Deputada" : "Deputado",
  };
}

export type InlineBoldRange = { start: number; end: number };

export type PreviewTextRun = { text: string; bold: boolean };

export function parseInlineBold(texto: string): {
  plain: string;
  ranges: InlineBoldRange[];
} {
  let plain = "";
  const ranges: InlineBoldRange[] = [];
  let i = 0;
  while (i < texto.length) {
    if (texto.startsWith("**", i)) {
      const close = texto.indexOf("**", i + 2);
      if (close < 0) {
        plain += texto.slice(i);
        break;
      }
      const inner = texto.slice(i + 2, close);
      if (inner.length > 0) {
        const start = plain.length;
        plain += inner;
        ranges.push({ start, end: plain.length });
      }
      i = close + 2;
      continue;
    }
    plain += texto[i];
    i += 1;
  }
  return { plain, ranges };
}

function substitutePlaceholders(
  template: string,
  values: Record<string, string>,
): string {
  const resolvidos = enrichDerivedTemplateValues(values);
  return template.replace(/\{([^{}]+)\}/g, (_, nome: string) => {
    const key = nome.trim() === "nome_acessor" ? "nome_assessor" : nome.trim();
    return resolvidos[key] ?? "";
  });
}

function isIndexBold(index: number, ranges: InlineBoldRange[]): boolean {
  return ranges.some((r) => index >= r.start && index < r.end);
}

export function runsByLine(
  plain: string,
  ranges: InlineBoldRange[],
): PreviewTextRun[][] {
  const lines = plain.length === 0 ? [""] : plain.split(/\r?\n/);
  const result: PreviewTextRun[][] = [];
  let offset = 0;
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li] ?? "";
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    if (line.length === 0) {
      result.push([{ text: "", bold: false }]);
    } else {
      const cuts = new Set<number>([lineStart, lineEnd]);
      for (const r of ranges) {
        if (r.start > lineStart && r.start < lineEnd) cuts.add(r.start);
        if (r.end > lineStart && r.end < lineEnd) cuts.add(r.end);
      }
      const ordered = [...cuts].sort((a, b) => a - b);
      const runs: PreviewTextRun[] = [];
      for (let c = 0; c < ordered.length - 1; c += 1) {
        const a = ordered[c];
        const b = ordered[c + 1];
        if (b <= a) continue;
        runs.push({
          text: plain.slice(a, b),
          bold: isIndexBold(a, ranges),
        });
      }
      result.push(runs.length > 0 ? runs : [{ text: line, bold: false }]);
    }
    offset = lineEnd + 1;
  }
  return result;
}

/** Substitui `{variavel}` e remove marcação `**negrito**` (texto plano). */
export function applyPreviewTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return parseInlineBold(substitutePlaceholders(template, values)).plain;
}

/** Substituição + runs de negrito por linha para a prévia SVG. */
export function applyPreviewTemplateRuns(
  template: string,
  values: Record<string, string>,
): PreviewTextRun[][] {
  const { plain, ranges } = parseInlineBold(
    substitutePlaceholders(template, values),
  );
  return runsByLine(plain, ranges);
}
