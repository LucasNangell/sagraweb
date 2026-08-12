import { describe, expect, it } from "vitest";

import {
  AUTORIZAR_IMPRESSAO_TEXTO,
  parseProvidenciasFromHtml,
  PROVIDENCIA_TIPO_AUTORIZAR,
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
