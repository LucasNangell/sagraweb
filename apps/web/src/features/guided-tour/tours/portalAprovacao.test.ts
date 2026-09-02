import { afterEach, describe, expect, it } from "vitest";

import { getTour } from "../catalog";
import {
  PORTAL_APROVACAO_ALTERACOES_TOUR_ID,
  PORTAL_APROVACAO_TOUR_ID,
} from "../tourSeen";
import {
  hasProofEditableFields,
  shouldCompletePortalChoice,
  shouldSkipAlteracoesFollowUp,
  shouldSkipAlteracoesTextoStep,
  shouldSkipEditableFieldsStep,
  waitUntilPortalAlteracoes,
} from "./portalAprovacao";

describe("portalAprovacao waitUntil / shouldSkip", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("encerra a primeira parte em resposta, sem passos de alterações", () => {
    const tour = getTour(PORTAL_APROVACAO_TOUR_ID);
    const ids = tour?.steps.map((s) => s.id) ?? [];
    expect(ids).toEqual([
      "intro",
      "viewer-tabs",
      "mockup-tab",
      "mockup-stage",
      "folhear-tab",
      "pdf-tab",
      "pdf-viewer",
      "resposta",
    ]);
    expect(ids.at(-1)).toBe("resposta");

    const intro = tour?.steps.find((s) => s.id === "intro");
    expect(intro?.body).toBe(
      "Navegue pelos tipos de visualizações disponíveis no topo para conferir o trabalho. Depois identifique-se e escolha aprovar ou solicitar alterações. Este guia acompanha o que você fizer.",
    );

    const resposta = tour?.steps.find((s) => s.id === "resposta");
    expect(resposta?.body).toContain("número de ponto e o nome");
    expect(resposta?.advance).toBe("next");
    expect(resposta?.target).toBe("proof-actions");
    expect(resposta?.waitUntil).toBeUndefined();
    expect(resposta?.completeWhen).toBe(shouldCompletePortalChoice);
  });

  it("só tem os passos de alterações no segundo tour", () => {
    const tour = getTour(PORTAL_APROVACAO_ALTERACOES_TOUR_ID);
    expect(tour?.steps.map((s) => s.id)).toEqual([
      "editable-fields",
      "alteracoes-texto",
      "example-file",
      "fim",
    ]);
  });

  it("pula campos editáveis quando a prova não tem campos", () => {
    document.body.innerHTML = `
      <div
        data-tour="portal-proof-page"
        data-tour-alteracoes="true"
        data-tour-editable-fields="false"
      ></div>
    `;
    expect(hasProofEditableFields()).toBe(false);
    expect(shouldSkipAlteracoesFollowUp()).toBe(false);
    expect(shouldSkipEditableFieldsStep()).toBe(true);
    expect(shouldSkipAlteracoesTextoStep()).toBe(false);
  });

  it("pula o passo de texto quando há campos editáveis", () => {
    document.body.innerHTML = `
      <div
        data-tour="portal-proof-page"
        data-tour-alteracoes="true"
        data-tour-editable-fields="true"
      ></div>
    `;
    expect(shouldSkipEditableFieldsStep()).toBe(false);
    expect(shouldSkipAlteracoesTextoStep()).toBe(true);
  });

  it("completeWhen no Aprovar e waitUntil nas alterações", () => {
    document.body.innerHTML = `
      <div
        data-tour="portal-proof-page"
        data-tour-alteracoes="false"
        data-tour-approve-modal="false"
      ></div>
    `;
    expect(waitUntilPortalAlteracoes()).toBe(false);
    expect(shouldCompletePortalChoice()).toBe(false);

    const page = document.querySelector(
      '[data-tour="portal-proof-page"]',
    ) as HTMLElement;
    page.setAttribute("data-tour-approve-modal", "true");
    expect(shouldCompletePortalChoice()).toBe(true);

    page.setAttribute("data-tour-approve-modal", "false");
    page.setAttribute("data-tour-alteracoes", "true");
    expect(waitUntilPortalAlteracoes()).toBe(true);
    expect(shouldCompletePortalChoice()).toBe(false);
  });
});
