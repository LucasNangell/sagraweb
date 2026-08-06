import type { PapelariaModel } from "./types";

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Espelha a lógica de auto-seleção do legado (papelaria.js). */
export function matchModelId(
  models: PapelariaModel[],
  targetProduct: string,
): string | null {
  const targetNorm = normalizeText(targetProduct);

  const exact = models.find(
    (m) => m.nome === targetProduct || m.id === targetProduct,
  );
  if (exact) return exact.id;

  const normMatch = models.find((m) => normalizeText(m.nome) === targetNorm);
  if (normMatch) return normMatch.id;

  const mapManual: Record<string, string> = {
    cartao: "ct",
    envelope: "env",
    timbrado: "timbrado",
  };

  const keywords = targetNorm.split(/\s+/).filter((k) => k.length > 2);

  const keywordMatch = models.find((m) => {
    const optNorm = normalizeText(m.nome);
    return keywords.some((k) => {
      if (optNorm.includes(k)) return true;
      if (mapManual[k] && optNorm.includes(mapManual[k])) return true;
      return false;
    });
  });

  return keywordMatch?.id ?? null;
}

export function getCanvasSize(tipo: string): { width: string; height: string } {
  const t = tipo.toLowerCase();
  if (t.includes("a4") || t.includes("timbrado")) {
    return { width: "420px", height: "594px" };
  }
  if (t.includes("bloco a5")) {
    return { width: "350px", height: "495px" };
  }
  if (t.includes("pasta")) {
    return { width: "440px", height: "310px" };
  }
  if (t.includes("retrato") || t.includes("gabinete")) {
    return { width: "300px", height: "500px" };
  }
  if (t.includes("paisagem") || t.includes("duplo")) {
    return { width: "600px", height: "350px" };
  }
  return { width: "500px", height: "280px" };
}

export function buildPapelariaObsBlock(dados: Record<string, string>): string {
  let obsTexto = "--- DADOS PAPELARIA ---\n";
  for (const [k, v] of Object.entries(dados)) {
    obsTexto += `${k}: ${v}\n`;
  }
  return obsTexto;
}

export function mergePapelariaObserv(
  oldObs: string | null | undefined,
  block: string,
): string {
  const old = oldObs ?? "";
  if (!old.includes("--- DADOS PAPELARIA ---")) {
    return old ? `${old}\n\n${block}` : block;
  }
  return `${old}\n${block}`;
}
