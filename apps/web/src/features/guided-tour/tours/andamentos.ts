import type { OsSearchRow } from "@/features/os/types";

import {
  isTourTargetVisible,
  readTourControlValue,
  readTourPanelAttr,
} from "../tourDom";
import type { GuidedTour, TourStepContext } from "../types";

export const ANDAMENTOS_TOUR_ID = "andamentos";
export const ANDAMENTOS_TOUR_TITLE = "Como lançar andamentos?";

const FROZEN_SITUACOES = new Set(["Entregue", "Cancelada", "Cancelado"]);

export function isOsFrozenForTour(row: OsSearchRow | null): boolean {
  if (!row) {
    return false;
  }
  if (row.is_sub_os) {
    return Boolean(row.congelada);
  }
  return FROZEN_SITUACOES.has((row.situacao ?? "").trim());
}

export function isOsSelectableForTour(row: OsSearchRow | null): boolean {
  return row != null && !isOsFrozenForTour(row);
}

export function waitUntilOsSelected(ctx: TourStepContext): boolean {
  return isOsSelectableForTour(ctx.selectedOs);
}

export function frozenOsWaitingBody(ctx: TourStepContext): string | null {
  if (ctx.selectedOs && isOsFrozenForTour(ctx.selectedOs)) {
    return "Esta OS está congelada (Entregue/Cancelada). Escolha outra OS da lista para continuar.";
  }
  return null;
}

export function waitUntilFieldFilled(tourId: string): boolean {
  return readTourControlValue(tourId).length > 0;
}

export function waitUntilHistoryEditing(): boolean {
  return readTourPanelAttr("data-tour-editing") === "true";
}

export function waitUntilAndamentoSaved(): boolean {
  return readTourPanelAttr("data-tour-saved") === "true";
}

export const andamentosTour: GuidedTour = {
  id: ANDAMENTOS_TOUR_ID,
  title: ANDAMENTOS_TOUR_TITLE,
  steps: [
    {
      id: "intro",
      title: "Como lançar andamentos?",
      body: "Este tutorial usa uma OS real. No último passo, ao clicar em Salvar, o andamento será registrado de verdade. Escolha uma OS que não esteja Entregue ou Cancelada.",
      placement: "center",
      advance: "next",
    },
    {
      id: "select-os",
      title: "Selecione uma OS",
      body: "Clique em uma OS na lista para abrir o histórico de tramitação.",
      target: "os-table",
      placement: "bottom",
      advance: "wait",
      mobileView: "list",
      waitUntil: waitUntilOsSelected,
      waitingBody: frozenOsWaitingBody,
    },
    {
      id: "mobile-history",
      title: "Aba Andamentos",
      body: "No celular, use esta aba para ver o histórico e lançar andamentos.",
      target: "os-mobile-history-tab",
      placement: "bottom",
      advance: "next",
      skipIfMissingTarget: true,
      shouldSkip: () => !isTourTargetVisible("os-mobile-history-tab"),
      mobileView: "history",
    },
    {
      id: "history-panel",
      title: "Histórico de tramitação",
      body: "À esquerda (ou acima) fica a lista de andamentos já lançados. À direita, o formulário para um novo lançamento.",
      target: "os-history-panel",
      placement: "left",
      advance: "next",
      mobileView: "history",
    },
    {
      id: "novo",
      title: "Novo andamento",
      body: "Clique em Novo para começar um lançamento. O sistema reserva a OS para você enquanto edita.",
      target: "os-history-novo",
      placement: "top",
      advance: "wait",
      waitUntil: waitUntilHistoryEditing,
    },
    {
      id: "situacao",
      title: "Campo Andamento",
      body: "Escolha a situação deste passo (por exemplo Em Execução, Saída p/ ou Entregue). É o que aparece na tramitação da OS.",
      target: "os-history-situacao",
      placement: "top",
      advance: "wait",
      waitUntil: () => waitUntilFieldFilled("os-history-situacao"),
    },
    {
      id: "setor",
      title: "Campo Setor",
      body: "Selecione o setor de destino da tramitação. Situação e setor são obrigatórios para salvar.",
      target: "os-history-setor",
      placement: "top",
      advance: "wait",
      waitUntil: () => waitUntilFieldFilled("os-history-setor"),
    },
    {
      id: "ponto",
      title: "Campo Ponto",
      body: "O ponto é preenchido com o seu identificador. Altere só se o lançamento for em nome de outro ponto.",
      target: "os-history-ponto",
      placement: "top",
      advance: "next",
    },
    {
      id: "obs",
      title: "Campo Observação",
      body: "Use a observação para registrar o que foi feito ou alguma informação útil. Não é obrigatória.",
      target: "os-history-obs",
      placement: "top",
      advance: "next",
    },
    {
      id: "componente",
      title: "Componente específico",
      body: "Marque esta opção somente se o andamento for de um componente ou Sub OS, não da OS principal. Depois escolha o destino.",
      target: "os-history-componente",
      placement: "top",
      advance: "next",
      skipIfMissingTarget: true,
    },
    {
      id: "salvar",
      title: "Salvar",
      body: "Ao clicar em Salvar, o andamento será gravado nesta OS de verdade. Confira os campos e clique em Salvar para concluir.",
      target: "os-history-salvar",
      placement: "top",
      advance: "wait",
      waitUntil: waitUntilAndamentoSaved,
    },
    {
      id: "fim",
      title: "Andamento lançado",
      body: "Pronto. O novo andamento aparece na lista de tramitação. Você pode repetir este tutorial quando quiser pelo menu Ajuda.",
      placement: "center",
      advance: "next",
    },
  ],
};
