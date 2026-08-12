import { describe, expect, it } from "vitest";

import {
  buildItemPanelDirtySnapshot,
  isItemPanelDirty,
  shouldReportItemPanelDirty,
} from "./analiseLabItemPanelDirty";
import {
  applyProvidenciasToHtml,
  libraryProvidenciaTextsFromDrafts,
  parseProvidenciasFromHtml,
  PROVIDENCIA_TIPO_AUTORIZAR,
  PROVIDENCIA_TIPO_LIVRE,
  seedProvidenciasDraft,
} from "./analiseLabProvidencias";

describe("isItemPanelDirty", () => {
  it("returns false when baseline is null", () => {
    const current = buildItemPanelDirtySnapshot({
      titulo: "A",
      html: "<p>x</p>",
      obs: "",
      componente: "Miolo",
      escopo: "pagina",
      pageSpec: "1",
      resolucaoObrigatoria: false,
      corrigidoSefoc: false,
      obsCorrecaoSefoc: "",
      providencias: seedProvidenciasDraft(""),
    });
    expect(isItemPanelDirty(null, current)).toBe(false);
  });

  it("detects title change", () => {
    const base = buildItemPanelDirtySnapshot({
      titulo: "A",
      html: "<p>x</p>",
      obs: "",
      componente: "Miolo",
      escopo: "pagina",
      pageSpec: "1",
      resolucaoObrigatoria: false,
      corrigidoSefoc: false,
      obsCorrecaoSefoc: "",
      providencias: seedProvidenciasDraft(""),
    });
    const dirty = buildItemPanelDirtySnapshot({
      ...base,
      titulo: "B",
      providencias: seedProvidenciasDraft(""),
    });
    // rebuild with same fields except titulo
    const current = buildItemPanelDirtySnapshot({
      titulo: "B",
      html: "<p>x</p>",
      obs: "",
      componente: "Miolo",
      escopo: "pagina",
      pageSpec: "1",
      resolucaoObrigatoria: false,
      corrigidoSefoc: false,
      obsCorrecaoSefoc: "",
      providencias: seedProvidenciasDraft(""),
    });
    expect(isItemPanelDirty(base, current)).toBe(true);
    expect(dirty.titulo).toBe("B");
  });

  it("ignores equivalent providencia key noise", () => {
    const rowsA = [
      {
        key: "a",
        texto: "Corrigir",
        tipo: PROVIDENCIA_TIPO_LIVRE,
        ordem: 0,
        selecionada: true,
        origem: "biblioteca",
      },
      {
        key: "sys",
        texto: "Autorizar impressão desconsiderando o problema",
        tipo: PROVIDENCIA_TIPO_AUTORIZAR,
        ordem: 1,
        selecionada: false,
        origem: "sistema",
      },
    ];
    const rowsB = rowsA.map((r) => ({ ...r, key: `other-${r.key}` }));
    const a = buildItemPanelDirtySnapshot({
      titulo: "A",
      html: "",
      obs: "",
      componente: "Miolo",
      escopo: "pagina",
      pageSpec: "1",
      resolucaoObrigatoria: false,
      corrigidoSefoc: false,
      obsCorrecaoSefoc: "",
      providencias: rowsA,
    });
    const b = buildItemPanelDirtySnapshot({
      titulo: "A",
      html: "",
      obs: "",
      componente: "Miolo",
      escopo: "pagina",
      pageSpec: "1",
      resolucaoObrigatoria: false,
      corrigidoSefoc: false,
      obsCorrecaoSefoc: "",
      providencias: rowsB,
    });
    expect(isItemPanelDirty(a, b)).toBe(false);
  });
});

describe("shouldReportItemPanelDirty", () => {
  it("stays clean until the technician edits something", () => {
    const base = buildItemPanelDirtySnapshot({
      titulo: "A",
      html: "<p>raw</p>",
      obs: "",
      componente: "Miolo",
      escopo: "pagina",
      pageSpec: "1",
      resolucaoObrigatoria: false,
      corrigidoSefoc: false,
      obsCorrecaoSefoc: "",
      providencias: seedProvidenciasDraft(""),
    });
    const normalized = buildItemPanelDirtySnapshot({
      titulo: "A",
      html: "<p>normalized</p>",
      obs: "",
      componente: "Miolo",
      escopo: "pagina",
      pageSpec: "1",
      resolucaoObrigatoria: false,
      corrigidoSefoc: false,
      obsCorrecaoSefoc: "",
      providencias: seedProvidenciasDraft(""),
    });
    expect(shouldReportItemPanelDirty(false, base, normalized)).toBe(false);
    expect(shouldReportItemPanelDirty(true, base, normalized)).toBe(true);
    expect(shouldReportItemPanelDirty(true, base, base)).toBe(false);
  });
});

describe("applyProvidenciasToHtml", () => {
  it("writes action-list and roundtrips parse", () => {
    const html = applyProvidenciasToHtml("<p>Desc</p>", [
      "Corrigir sangria",
      "Reenviar PDF",
    ]);
    expect(html).toContain("action-list");
    expect(parseProvidenciasFromHtml(html)).toEqual([
      "Corrigir sangria",
      "Reenviar PDF",
    ]);
  });

  it("replaces previous providencias block", () => {
    const first = applyProvidenciasToHtml("<p>X</p>", ["Um"]);
    const second = applyProvidenciasToHtml(first, ["Dois"]);
    expect(parseProvidenciasFromHtml(second)).toEqual(["Dois"]);
    expect(second.match(/action-list/g)?.length).toBe(1);
  });

  it("libraryProvidenciaTextsFromDrafts skips sistema", () => {
    const drafts = seedProvidenciasDraft(`
      <ul class="action-list"><li class="action-item">Livre</li></ul>
    `);
    expect(libraryProvidenciaTextsFromDrafts(drafts)).toEqual(["Livre"]);
  });
});
