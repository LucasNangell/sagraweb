import { describe, expect, it } from "vitest";

import {
  AUTORIZAR_IMPRESSAO_TEXTO,
  dedupeAutorizarDraft,
  parseProvidenciasFromHtml,
  PROVIDENCIA_TIPO_AUTORIZAR,
  PROVIDENCIA_TIPO_LIVRE,
  seedProvidenciasDraft,
  stripAutorizarDraft,
} from "./analiseLabProvidencias";

describe("parseProvidenciasFromHtml", () => {
  it("reads .action-item texts", () => {
    const html = `
      <p>Descrição</p>
      <div class="providencias-bar">Providências</div>
      <ul class="action-list">
        <li class="action-item">Corrigir sangria</li>
        <li class="action-item">Reenviar PDF</li>
      </ul>
    `;
    expect(parseProvidenciasFromHtml(html)).toEqual([
      "Corrigir sangria",
      "Reenviar PDF",
    ]);
  });
});

describe("seedProvidenciasDraft", () => {
  it("seeds only biblioteca rows without sistema autorizar", () => {
    const rows = seedProvidenciasDraft(`
      <ul class="action-list">
        <li class="action-item">Ajustar margem</li>
        <li class="action-item">${AUTORIZAR_IMPRESSAO_TEXTO}</li>
      </ul>
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      texto: "Ajustar margem",
      origem: "biblioteca",
      selecionada: true,
      tipo: PROVIDENCIA_TIPO_LIVRE,
    });
  });
});

describe("stripAutorizarDraft", () => {
  it("removes autorizar sistema and keeps empty livres while editing", () => {
    const rows = stripAutorizarDraft([
      {
        key: "1",
        texto: "Revisar PDF",
        tipo: PROVIDENCIA_TIPO_LIVRE,
        ordem: 0,
        selecionada: true,
        origem: "manual",
      },
      {
        key: "2",
        texto: AUTORIZAR_IMPRESSAO_TEXTO,
        tipo: PROVIDENCIA_TIPO_AUTORIZAR,
        ordem: 1,
        selecionada: false,
        origem: "sistema",
      },
      {
        key: "3",
        texto: "",
        tipo: PROVIDENCIA_TIPO_LIVRE,
        ordem: 2,
        selecionada: true,
        origem: "manual",
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].texto).toBe("Revisar PDF");
    expect(rows[1].texto).toBe("");
  });

  it("dedupeAutorizarDraft aliases strip", () => {
    expect(
      dedupeAutorizarDraft([
        {
          key: "a",
          texto: AUTORIZAR_IMPRESSAO_TEXTO,
          tipo: PROVIDENCIA_TIPO_AUTORIZAR,
          ordem: 0,
          selecionada: false,
          origem: "sistema",
        },
      ]),
    ).toEqual([]);
  });
});
