import { isTourTargetVisible, readProofPageAttr } from "../tourDom";
import type { GuidedTour } from "../types";
import {
  PORTAL_APROVACAO_ALTERACOES_TOUR_ID,
  PORTAL_APROVACAO_TOUR_ID,
} from "../tourSeen";

export { PORTAL_APROVACAO_ALTERACOES_TOUR_ID, PORTAL_APROVACAO_TOUR_ID };
export const PORTAL_APROVACAO_TOUR_TITLE = "Como aprovar a prova?";
export const PORTAL_APROVACAO_ALTERACOES_TOUR_TITLE = "Como solicitar alterações?";

export function isProofAlteracoesMode(): boolean {
  return readProofPageAttr("data-tour-alteracoes") === "true";
}

export function isProofApproveModalOpen(): boolean {
  return readProofPageAttr("data-tour-approve-modal") === "true";
}

export function hasProofEditableFields(): boolean {
  return readProofPageAttr("data-tour-editable-fields") === "true";
}

export function waitUntilPortalAlteracoes(): boolean {
  return isProofAlteracoesMode();
}

export function shouldCompletePortalChoice(): boolean {
  return isProofApproveModalOpen();
}

export function shouldSkipAlteracoesFollowUp(): boolean {
  return !isProofAlteracoesMode();
}

export function shouldSkipEditableFieldsStep(): boolean {
  return shouldSkipAlteracoesFollowUp() || !hasProofEditableFields();
}

export function shouldSkipAlteracoesTextoStep(): boolean {
  return shouldSkipAlteracoesFollowUp() || hasProofEditableFields();
}

export const portalAprovacaoTour: GuidedTour = {
  id: PORTAL_APROVACAO_TOUR_ID,
  title: PORTAL_APROVACAO_TOUR_TITLE,
  steps: [
    {
      id: "intro",
      title: "Bem-vindo à aprovação de prova",
      body: "Navegue pelos tipos de visualizações disponíveis no topo para conferir o trabalho. Depois identifique-se e escolha aprovar ou solicitar alterações. Este guia acompanha o que você fizer.",
      placement: "center",
      advance: "next",
    },
    {
      id: "viewer-tabs",
      title: "Tipos de visualização",
      body: "Há três formas de ver a prova: Mockup 3D (produto montado), Folhear (virar as páginas) e PDF (arquivo original). Clique nas abas para alternar.",
      target: "proof-viewer-tabs",
      placement: "bottom",
      advance: "next",
      skipIfMissingTarget: true,
    },
    {
      id: "mockup-tab",
      title: "Mockup 3D",
      body: "Nesta aba você vê o produto em três dimensões. Clique aqui para abrir o mockup.",
      target: "proof-tab-mockup",
      placement: "bottom",
      advance: "next",
      skipIfMissingTarget: true,
    },
    {
      id: "mockup-stage",
      title: "Interaja com o mockup",
      body: "Arraste para girar o produto. Em alguns modelos, o scroll ou os controles abrem e fecham as abas. Experimente antes de responder.",
      target: "proof-mockup-stage",
      placement: "left",
      advance: "next",
      skipIfMissingTarget: true,
    },
    {
      id: "folhear-tab",
      title: "Folhear",
      body: "Use Folhear para virar as páginas como um livro ou folheto e conferir frente e verso.",
      target: "proof-tab-folhear",
      placement: "bottom",
      advance: "next",
      skipIfMissingTarget: true,
    },
    {
      id: "pdf-tab",
      title: "PDF",
      body: "A aba PDF mostra o arquivo original da prova, com zoom e páginas nativas do navegador.",
      target: "proof-tab-pdf",
      placement: "bottom",
      advance: "next",
      skipIfMissingTarget: true,
    },
    {
      id: "pdf-viewer",
      title: "Visualização em PDF",
      body: "Confira o PDF da prova. Você também pode abrir em nova aba ou baixar o arquivo.",
      target: "proof-pdf-viewer",
      placement: "left",
      advance: "next",
      skipIfMissingTarget: true,
      shouldSkip: () => isTourTargetVisible("proof-tab-pdf"),
    },
    {
      id: "resposta",
      title: "Identifique-se e responda",
      body: "Informe o número de ponto e o nome para liberar os botões. Depois escolha Aprovar prova ou Solicitar alterações.",
      target: "proof-actions",
      placement: "right",
      advance: "next",
      completeWhen: shouldCompletePortalChoice,
    },
  ],
};

export const portalAprovacaoAlteracoesTour: GuidedTour = {
  id: PORTAL_APROVACAO_ALTERACOES_TOUR_ID,
  title: PORTAL_APROVACAO_ALTERACOES_TOUR_TITLE,
  steps: [
    {
      id: "editable-fields",
      title: "Campos editáveis da prova",
      body: "Altere os dados diretamente nos campos da prévia. A visualização atualiza na hora. O que não estiver nos campos pode ser descrito no campo à esquerda.",
      target: "proof-editable-fields",
      placement: "left",
      advance: "next",
      skipIfMissingTarget: true,
      shouldSkip: shouldSkipEditableFieldsStep,
    },
    {
      id: "alteracoes-texto",
      title: "Descreva as alterações",
      body: "Escreva aqui o que precisa ser corrigido.",
      target: "proof-alteracoes-texto",
      placement: "right",
      advance: "next",
      skipIfMissingTarget: true,
      shouldSkip: shouldSkipAlteracoesTextoStep,
    },
    {
      id: "example-file",
      title: "Arquivo de exemplo",
      body: "Se quiser, você pode enviar um arquivo de modelo ou referência.",
      target: "proof-example-file",
      placement: "top",
      advance: "next",
      skipIfMissingTarget: true,
    },
    {
      id: "fim",
      title: "Pronto para enviar",
      body: "Revise o que informou e envie a solicitação. Você receberá uma nova prova para aprovação. Pode fechar este guia.",
      placement: "center",
      advance: "next",
    },
  ],
};
