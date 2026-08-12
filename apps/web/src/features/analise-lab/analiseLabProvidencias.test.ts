import { describe, expect, it } from "vitest";

import {
  AUTORIZAR_IMPRESSAO_TEXTO,
  dedupeAutorizarDraft,
  parseProvidenciasFromHtml,
  PROVIDENCIA_TIPO_AUTORIZAR,
  PROVIDENCIA_TIPO_LIVRE,
  resolucaoObrigatoriaFromProvidencias,
  seedProvidenciasDraft,
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
  it("seeds biblioteca rows plus sistema autorizar", () => {
    const rows = seedProvidenciasDraft(`
      <ul class="action-list">
        <li class="action-item">Ajustar margem</li>
      </ul>
    `);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      texto: "Ajustar margem",
      origem: "biblioteca",
      selecionada: true,
    });
    expect(rows[1]).toMatchObject({
      texto: AUTORIZAR_IMPRESSAO_TEXTO,
      tipo: PROVIDENCIA_TIPO_AUTORIZAR,
      origem: "sistema",
      selecionada: false,
    });
  });

  it("does not duplicate autorizar when HTML already has that action-item", () => {
    const rows = seedProvidenciasDraft(`
      <ul class="action-list">
        <li class="action-item">Revisar PDF</li>
        <li class="action-item">${AUTORIZAR_IMPRESSAO_TEXTO}</li>
      </ul>
    `);
    const autorizar = rows.filter(
      (r) =>
        r.tipo === PROVIDENCIA_TIPO_AUTORIZAR ||
        r.texto === AUTORIZAR_IMPRESSAO_TEXTO,
    );
    expect(autorizar).toHaveLength(1);
    expect(autorizar[0]?.tipo).toBe(PROVIDENCIA_TIPO_AUTORIZAR);
  });
});

describe("dedupeAutorizarDraft", () => {
  it("collapses livre + sistema with the same text into one sistema row", () => {
    const rows = dedupeAutorizarDraft([
      {
        key: "1",
        texto: AUTORIZAR_IMPRESSAO_TEXTO,
        tipo: PROVIDENCIA_TIPO_LIVRE,
        ordem: 0,
        selecionada: true,
        origem: "biblioteca",
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
        texto: "Outra",
        tipo: PROVIDENCIA_TIPO_LIVRE,
        ordem: 2,
        selecionada: true,
        origem: "manual",
      },
    ]);
    expect(rows.filter((r) => r.texto === AUTORIZAR_IMPRESSAO_TEXTO)).toHaveLength(
      1,
    );
    expect(rows).toHaveLength(2);
    expect(
      rows.find((r) => r.tipo === PROVIDENCIA_TIPO_AUTORIZAR)?.selecionada,
    ).toBe(false);
  });
});

describe("resolucaoObrigatoriaFromProvidencias", () => {
  it("is true when autorizar impressão is not selected", () => {
    expect(
      resolucaoObrigatoriaFromProvidencias([
        { tipo: PROVIDENCIA_TIPO_AUTORIZAR, selecionada: false },
      ]),
    ).toBe(true);
  });

  it("is false when autorizar impressão is selected", () => {
    expect(
      resolucaoObrigatoriaFromProvidencias([
        { tipo: PROVIDENCIA_TIPO_AUTORIZAR, selecionada: true },
      ]),
    ).toBe(false);
  });
});
