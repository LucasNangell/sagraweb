import { formatOsNumber } from "@/features/dashboard-setor/utils";

import { fornecedorSessionLabel } from "./buildObservacao";
import { GRAVACAO_COLUMN_TITLES } from "./constants";
import {
  GRAVACAO_COLUMN_IDS,
  type GravacaoBoardCard,
  type GravacaoColumnId,
  type GravacaoDisplayCard,
  type GravacaoDisplayColumn,
  type GravacaoBoardResponse,
  type GravacaoOsMembro,
  type GravacaoSession,
} from "./types";

export function cardUniqueKey(
  card: Pick<GravacaoBoardCard, "nr_os" | "ano" | "juntada_grupo_id">,
  columnId: GravacaoColumnId,
): string {
  const gid = (card.juntada_grupo_id ?? "").trim();
  if (gid) return `j-${gid}-${columnId}`;
  return `${card.nr_os}-${card.ano}-${columnId}`;
}

function protocolKind(nrOs: number): "OS" | "SP" {
  return nrOs < 5000 ? "OS" : "SP";
}

function cardMembros(
  card: Pick<GravacaoBoardCard, "nr_os" | "ano" | "membros">,
): GravacaoOsMembro[] {
  const list = (card.membros ?? []).filter(
    (m) => Number.isFinite(m.nr_os) && Number.isFinite(m.ano),
  );
  if (list.length > 0) {
    return [...list].sort((a, b) => a.nr_os - b.nr_os || a.ano - b.ano);
  }
  return [{ nr_os: card.nr_os, ano: card.ano }];
}

export function formatGravacaoCardTitle(
  card: Pick<GravacaoBoardCard, "nr_os" | "ano" | "membros">,
): { label: string; tooltip: string } {
  const membros = cardMembros(card);
  if (membros.length <= 1) {
    const label = formatOsNumber(card.nr_os, card.ano);
    return { label, tooltip: label };
  }
  const kinds = new Set(membros.map((m) => protocolKind(m.nr_os)));
  const prefix =
    kinds.size === 1 && kinds.has("SP") ? "SPs" : kinds.size === 1 ? "OSs" : "OSs";
  const label = `${prefix} ${membros.map((m) => m.nr_os).join(",")}`;
  const tooltip = membros.map((m) => formatOsNumber(m.nr_os, m.ano)).join(", ");
  return { label, tooltip };
}

export function toDisplayColumns(
  board: GravacaoBoardResponse | null | undefined,
): GravacaoDisplayColumn[] {
  const columns = board?.columns ?? {};
  return GRAVACAO_COLUMN_IDS.map((id) => {
    const items: GravacaoDisplayCard[] = (columns[id] ?? []).map((card) => ({
      ...card,
      sessions: card.sessions ?? [],
      uniqueKey: cardUniqueKey(card, id),
      columnId: id,
    }));
    return {
      id,
      title: GRAVACAO_COLUMN_TITLES[id],
      items,
    };
  });
}

export function displayChapasQty(chapa: {
  quantidade: number;
  quantidade_restante?: number;
}): number {
  if (chapa.quantidade_restante != null) {
    return chapa.quantidade_restante;
  }
  return chapa.quantidade;
}

export interface FornecedorChapaBadge {
  key: string;
  label: string;
}

function sessionGroupKey(session: GravacaoSession, index: number): string {
  const ponto = (session.fornecedor_ponto ?? "").trim();
  const nome = fornecedorSessionLabel(session);
  if (ponto) return `p:${ponto}`;
  if (nome) return `n:${nome}`;
  return `s:${index}`;
}

function formatChapasSuffix(
  chapas: Array<{ maquina: string; quantidade: number }>,
): string {
  const parts = chapas
    .map((ch) => {
      const maquina = (ch.maquina || "").trim();
      if (!maquina) return "";
      return `${maquina}: ${ch.quantidade}`;
    })
    .filter(Boolean);
  return parts.join(" · ");
}

/** Um badge por fornecedor, com todas as máquinas daquele fornecedor. */
export function cardFornecedorChapaBadges(
  card: Pick<GravacaoBoardCard, "sessions">,
): FornecedorChapaBadge[] {
  const groups = new Map<
    string,
    { label: string; chapas: Array<{ maquina: string; quantidade: number }> }
  >();
  (card.sessions ?? []).forEach((session, index) => {
    const key = sessionGroupKey(session, index);
    const fornecedor = fornecedorSessionLabel(session);
    let group = groups.get(key);
    if (!group) {
      group = { label: fornecedor, chapas: [] };
      groups.set(key, group);
    }
    const seenMaquinas = new Set(group.chapas.map((c) => c.maquina));
    for (const chapa of session.chapas_por_maquina ?? []) {
      const maquina = (chapa.maquina || "").trim();
      if (!maquina || seenMaquinas.has(maquina)) continue;
      seenMaquinas.add(maquina);
      group.chapas.push({ maquina, quantidade: displayChapasQty(chapa) });
    }
  });
  const badges: FornecedorChapaBadge[] = [];
  for (const [key, group] of groups) {
    const chapasText = formatChapasSuffix(group.chapas);
    if (!group.label && !chapasText) continue;
    badges.push({
      key,
      label: [group.label, chapasText].filter(Boolean).join(" · "),
    });
  }
  return badges;
}

export function isSaidaTotalSituacao(situacao: string | null | undefined): boolean {
  return (situacao ?? "").trim() === "Saída p/";
}

export function isSaidaParcialSituacao(situacao: string | null | undefined): boolean {
  return (situacao ?? "").trim() === "Saída parcial p/";
}

/** Todas as máquinas marcadas com a quantidade restante completa. */
export function areAllChapasSelected(
  maquinaKeys: string[],
  selectedMaquinas: ReadonlySet<string>,
  qtyByKey: Record<string, number>,
  maxByKey: Record<string, number>,
): boolean {
  if (maquinaKeys.length === 0) return false;
  return maquinaKeys.every((key) => {
    if (!selectedMaquinas.has(key)) return false;
    const max = maxByKey[key] ?? 0;
    const qty = qtyByKey[key] ?? max;
    return qty >= max;
  });
}

/** Marcar `nextKey` deixaria todas as máquinas selecionadas. */
export function wouldSelectAllMaquinas(
  maquinaKeys: string[],
  selectedMaquinas: ReadonlySet<string>,
  nextKey: string,
): boolean {
  if (maquinaKeys.length === 0) return false;
  return maquinaKeys.every((key) => key === nextKey || selectedMaquinas.has(key));
}
