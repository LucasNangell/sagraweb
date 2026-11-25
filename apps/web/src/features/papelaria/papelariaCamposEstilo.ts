/** Estilo tipográfico de campos do modelo na prévia — `dados.__campos_estilo`. */

import type { CampoExtraAlignH, CampoExtraAlignV } from "./papelariaCamposExtras";

export const CAMPOS_ESTILO_DADOS_KEY = "__campos_estilo";

export type CampoEstilo = {
  tamanho_pt?: number | null;
  align_h?: CampoExtraAlignH;
  align_v?: CampoExtraAlignV;
};

export function camposEstiloParaDados(mapa: Record<string, CampoEstilo>): string | null {
  const limpo: Record<string, CampoEstilo> = {};
  for (const [chave, est] of Object.entries(mapa)) {
    if (!chave || !est) continue;
    const entry: CampoEstilo = {};
    if (est.tamanho_pt != null && Number.isFinite(est.tamanho_pt)) {
      entry.tamanho_pt = Math.max(4, Math.min(72, Number(est.tamanho_pt)));
    }
    if (est.align_h) entry.align_h = est.align_h;
    if (est.align_v) entry.align_v = est.align_v;
    if (entry.tamanho_pt != null || entry.align_h || entry.align_v) limpo[chave] = entry;
  }
  return Object.keys(limpo).length ? JSON.stringify(limpo) : null;
}

export function normalizarCamposEstilo(raw: unknown): Record<string, CampoEstilo> {
  if (raw == null || raw === "") return {};
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: Record<string, CampoEstilo> = {};
  for (const [chave, valor] of Object.entries(obj as Record<string, unknown>)) {
    if (!chave || !valor || typeof valor !== "object") continue;
    const v = valor as Record<string, unknown>;
    const entry: CampoEstilo = {};
    const tam = v.tamanho_pt == null || v.tamanho_pt === "" ? null : Number(v.tamanho_pt);
    if (tam != null && Number.isFinite(tam) && tam >= 4 && tam <= 72) entry.tamanho_pt = tam;
    const ah = String(v.align_h ?? "").toLowerCase();
    if (ah === "esquerda" || ah === "centro" || ah === "direita") entry.align_h = ah;
    const av = String(v.align_v ?? "").toLowerCase();
    if (av === "topo" || av === "meio" || av === "base") entry.align_v = av;
    if (entry.tamanho_pt != null || entry.align_h || entry.align_v) out[chave] = entry;
  }
  return out;
}
