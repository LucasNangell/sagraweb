import { afterEach, describe, expect, it } from "vitest";

import type { OsSearchRow } from "@/features/os/types";

import {
  frozenOsWaitingBody,
  waitUntilAndamentoSaved,
  waitUntilFieldFilled,
  waitUntilHistoryEditing,
  waitUntilOsSelected,
} from "./andamentos";

function os(overrides: Partial<OsSearchRow> = {}): OsSearchRow {
  return { nr_os: 120, ano: 2026, situacao: "Em Execução", ...overrides };
}

describe("andamentos tour waitUntil", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("não avança sem OS selecionada", () => {
    expect(waitUntilOsSelected({ selectedOs: null })).toBe(false);
  });

  it("não avança quando a OS está congelada", () => {
    expect(
      waitUntilOsSelected({ selectedOs: os({ situacao: "Entregue" }) }),
    ).toBe(false);
    expect(
      waitUntilOsSelected({ selectedOs: os({ situacao: "Cancelada" }) }),
    ).toBe(false);
    expect(
      frozenOsWaitingBody({ selectedOs: os({ situacao: "Entregue" }) }),
    ).toMatch(/congelada/i);
  });

  it("avança quando a OS não está congelada", () => {
    expect(waitUntilOsSelected({ selectedOs: os() })).toBe(true);
  });

  it("não avança com situação ou setor vazios", () => {
    document.body.innerHTML = `
      <label data-tour="os-history-situacao"><select value=""><option value=""></option></select></label>
      <label data-tour="os-history-setor"><select><option value=""></option></select></label>
    `;
    const situacao = document.querySelector(
      '[data-tour="os-history-situacao"] select',
    ) as HTMLSelectElement;
    const setor = document.querySelector(
      '[data-tour="os-history-setor"] select',
    ) as HTMLSelectElement;
    situacao.value = "";
    setor.value = "";
    expect(waitUntilFieldFilled("os-history-situacao")).toBe(false);
    expect(waitUntilFieldFilled("os-history-setor")).toBe(false);

    situacao.innerHTML = `<option value="Em Execução" selected>Em Execução</option>`;
    situacao.value = "Em Execução";
    setor.innerHTML = `<option value="SEFOC" selected>SEFOC</option>`;
    setor.value = "SEFOC";
    expect(waitUntilFieldFilled("os-history-situacao")).toBe(true);
    expect(waitUntilFieldFilled("os-history-setor")).toBe(true);
  });

  it("espera editing e saved no painel de histórico", () => {
    document.body.innerHTML = `
      <section data-tour="os-history-panel" data-tour-editing="false" data-tour-saved="false"></section>
    `;
    expect(waitUntilHistoryEditing()).toBe(false);
    expect(waitUntilAndamentoSaved()).toBe(false);

    const panel = document.querySelector(
      '[data-tour="os-history-panel"]',
    ) as HTMLElement;
    panel.setAttribute("data-tour-editing", "true");
    expect(waitUntilHistoryEditing()).toBe(true);

    panel.setAttribute("data-tour-saved", "true");
    expect(waitUntilAndamentoSaved()).toBe(true);
  });
});
