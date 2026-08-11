import type { AnaliseLabItem } from "@/api/analiseLab";
import type { ClientAnalysisItem } from "@/api/client-portal";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import { itemHomesForComponents } from "./analiseLabComponente";

/** Converte itens do Lab para o formato do portal do cliente. */
export function labItemsToClientItems(
  items: AnaliseLabItem[],
  overrides?: {
    disregardedIds?: ReadonlySet<number>;
    /** Simula “resolvido” após upload do componente. */
    uploadedComponents?: ReadonlySet<string>;
    pages?: ProvaWebPageMeta[];
    modo?: string;
  },
): ClientAnalysisItem[] {
  const disregarded = overrides?.disregardedIds ?? new Set<number>();
  const uploaded = overrides?.uploadedComponents ?? new Set<string>();
  const pages = overrides?.pages ?? [];
  const modo = overrides?.modo || "capa_miolo";
  const out: ClientAnalysisItem[] = [];

  for (const item of items) {
    const homes = itemHomesForComponents(item, pages, modo);
    const desconsiderado = disregarded.has(item.id);
    for (const home of homes) {
      const componente = (home || "Outros").trim() || "Outros";
      const fileUploaded = uploaded.has(componente);
      out.push({
        uniqueId: item.id,
        originalId: item.id,
        titulo: item.titulo,
        html: item.htmlSnapshot,
        obs: item.obs || undefined,
        componenteOrigem: componente,
        desconsiderado,
        resolver: fileUploaded && !desconsiderado,
        resolucaoObrigatoria: Boolean(item.resolucaoObrigatoria),
      });
    }
  }

  return out;
}

export function labClientPreviewStorageKey(ano: number, osId: number): string {
  return `analise-lab:client-preview:${ano}:${osId}`;
}

export type LabClientPreviewState = {
  nome: string;
  ponto: string;
  disregardedIds: number[];
  uploadedComponents: string[];
};

export function loadLabClientPreviewState(
  ano: number,
  osId: number,
): LabClientPreviewState {
  try {
    const raw = localStorage.getItem(labClientPreviewStorageKey(ano, osId));
    if (!raw) {
      return { nome: "", ponto: "", disregardedIds: [], uploadedComponents: [] };
    }
    const parsed = JSON.parse(raw) as Partial<LabClientPreviewState>;
    return {
      nome: typeof parsed.nome === "string" ? parsed.nome : "",
      ponto: typeof parsed.ponto === "string" ? parsed.ponto : "",
      disregardedIds: Array.isArray(parsed.disregardedIds)
        ? parsed.disregardedIds.filter((n) => Number.isFinite(n)).map(Number)
        : [],
      uploadedComponents: Array.isArray(parsed.uploadedComponents)
        ? parsed.uploadedComponents.filter((s) => typeof s === "string")
        : [],
    };
  } catch {
    return { nome: "", ponto: "", disregardedIds: [], uploadedComponents: [] };
  }
}

export function saveLabClientPreviewState(
  ano: number,
  osId: number,
  state: LabClientPreviewState,
): void {
  try {
    localStorage.setItem(
      labClientPreviewStorageKey(ano, osId),
      JSON.stringify(state),
    );
  } catch {
    /* ignore */
  }
}
