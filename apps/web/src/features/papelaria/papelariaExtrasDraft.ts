/** Rascunho local de campos extras / estilo tipográfico por OS (sobrevive a F5). */

import {
  camposEstiloParaDados,
  normalizarCamposEstilo,
  type CampoEstilo,
} from "./papelariaCamposEstilo";
import {
  camposExtrasParaDados,
  normalizarCamposExtras,
  type CampoExtra,
} from "./papelariaCamposExtras";

export const PAPELARIA_EXTRAS_DRAFT_PREFIX = "sagra_papelaria_extras_draft:";

export type PapelariaExtrasDraft = {
  extras: CampoExtra[];
  estilos: Record<string, CampoEstilo>;
  updatedAt: number;
};

export function extrasDraftKey(ano: number, nro: number): string {
  return `${PAPELARIA_EXTRAS_DRAFT_PREFIX}${ano}:${nro}`;
}

export function loadExtrasDraft(ano: number, nro: number): PapelariaExtrasDraft | null {
  if (!Number.isFinite(ano) || !Number.isFinite(nro) || ano <= 0 || nro <= 0) return null;
  try {
    const raw = localStorage.getItem(extrasDraftKey(ano, nro));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    const extras = normalizarCamposExtras(o.extras ?? o.__campos_extras);
    const estilos = normalizarCamposEstilo(o.estilos ?? o.__campos_estilo);
    const updatedAt = Number(o.updatedAt) || Date.now();
    if (!extras.length && !Object.keys(estilos).length) return null;
    return { extras, estilos, updatedAt };
  } catch {
    return null;
  }
}

export function saveExtrasDraft(
  ano: number,
  nro: number,
  extras: CampoExtra[],
  estilos: Record<string, CampoEstilo>,
): void {
  if (!Number.isFinite(ano) || !Number.isFinite(nro) || ano <= 0 || nro <= 0) return;
  const key = extrasDraftKey(ano, nro);
  if (!extras.length && !Object.keys(estilos).length) {
    localStorage.removeItem(key);
    return;
  }
  const payload = {
    extras: JSON.parse(camposExtrasParaDados(extras) || "[]") as unknown[],
    estilos: JSON.parse(camposEstiloParaDados(estilos) || "{}") as Record<string, unknown>,
    updatedAt: Date.now(),
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

export function clearExtrasDraft(ano: number, nro: number): void {
  if (!Number.isFinite(ano) || !Number.isFinite(nro) || ano <= 0 || nro <= 0) return;
  localStorage.removeItem(extrasDraftKey(ano, nro));
}

/** Extrai extras/estilo de um mapa de internos (`__campos_extras` / `__campos_estilo`). */
export function extrasDeInternos(internos: Record<string, string> | null | undefined): {
  extras: CampoExtra[];
  estilos: Record<string, CampoEstilo>;
} {
  if (!internos) return { extras: [], estilos: {} };
  return {
    extras: normalizarCamposExtras(internos.__campos_extras),
    estilos: normalizarCamposEstilo(internos.__campos_estilo),
  };
}
