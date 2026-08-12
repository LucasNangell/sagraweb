/** Detecção de alterações não salvas no painel de problema técnico (Lab). */

import type { ProvidenciaDraft } from "./analiseLabProvidencias";

export const UNSAVED_CHANGES_CONFIRM =
  "Há alterações não salvas. Deseja descartá-las?";

export type ItemPanelDirtySnapshot = {
  titulo: string;
  html: string;
  obs: string;
  componente: string;
  escopo: string;
  pageSpec: string;
  resolucaoObrigatoria: boolean;
  corrigidoSefoc: boolean;
  obsCorrecaoSefoc: string;
  providencias: Array<{
    texto: string;
    tipo: string;
    selecionada: boolean;
    ordem: number;
  }>;
};

export function snapshotProvidencias(
  rows: ProvidenciaDraft[],
): ItemPanelDirtySnapshot["providencias"] {
  return [...rows]
    .map((r) => ({
      texto: (r.texto || "").trim(),
      tipo: r.tipo || "",
      selecionada: Boolean(r.selecionada),
      ordem: r.ordem ?? 0,
    }))
    .sort((a, b) => a.ordem - b.ordem || a.texto.localeCompare(b.texto, "pt-BR"));
}

export function buildItemPanelDirtySnapshot(args: {
  titulo: string;
  html: string;
  obs: string;
  componente: string;
  escopo: string;
  pageSpec: string;
  resolucaoObrigatoria: boolean;
  corrigidoSefoc: boolean;
  obsCorrecaoSefoc: string;
  providencias: ProvidenciaDraft[];
}): ItemPanelDirtySnapshot {
  return {
    titulo: (args.titulo || "").trim(),
    html: args.html || "",
    obs: args.obs || "",
    componente: args.componente || "",
    escopo: args.escopo || "",
    pageSpec: (args.pageSpec || "").trim(),
    resolucaoObrigatoria: Boolean(args.resolucaoObrigatoria),
    corrigidoSefoc: Boolean(args.corrigidoSefoc),
    obsCorrecaoSefoc: args.obsCorrecaoSefoc || "",
    providencias: snapshotProvidencias(args.providencias),
  };
}

export function isItemPanelDirty(
  baseline: ItemPanelDirtySnapshot | null,
  current: ItemPanelDirtySnapshot,
): boolean {
  if (!baseline) return false;
  return JSON.stringify(baseline) !== JSON.stringify(current);
}

/** Só reporta dirty depois que o técnico alterou algum campo (não no load/normalização). */
export function shouldReportItemPanelDirty(
  userEdited: boolean,
  baseline: ItemPanelDirtySnapshot | null,
  current: ItemPanelDirtySnapshot,
): boolean {
  if (!userEdited) return false;
  return isItemPanelDirty(baseline, current);
}

export function confirmDiscardUnsavedChanges(): boolean {
  return window.confirm(UNSAVED_CHANGES_CONFIRM);
}
