import { describe, expect, it } from "vitest";

import { DEFAULT_DASHBOARD_CONFIG, INBOX_COLUMN_SOURCE } from "./constants";
import {
  normalizeDashboardColumns,
  normalizeDashboardConfigFromRemote,
  showsAndamentoTime,
} from "./normalizeConfig";

describe("normalizeDashboardColumns", () => {
  it("preserva fonte inbox e descarta setor da coluna", () => {
    const columns = normalizeDashboardColumns([
      {
        id: "inbox",
        title: "Novo e-mail",
        statuses: ["Em Execução"],
        source: INBOX_COLUMN_SOURCE,
        sector: "Papelaria",
        hideWhenEmpty: true,
      },
    ]);
    expect(columns[0]).toEqual({
      id: "inbox",
      title: "Novo e-mail",
      statuses: ["Em Execução"],
      source: INBOX_COLUMN_SOURCE,
      hideWhenEmpty: true,
    });
  });

  it("não marca coluna antiga como inbox", () => {
    const columns = normalizeDashboardColumns([
      { id: "exec", title: "Execução", statuses: ["Em Execução"] },
    ]);
    expect(columns[0]?.source).toBeUndefined();
  });
});

describe("tempo da OS no painel moderno", () => {
  it("continua exibindo o relógio quando a preferência ainda não existe", () => {
    const config = normalizeDashboardConfigFromRemote(DEFAULT_DASHBOARD_CONFIG);
    expect(showsAndamentoTime(config)).toBe(true);
    expect(config.showAndamentoTime).toBeUndefined();
  });

  it("preserva a escolha de ocultar e ignora valores que não sejam falso", () => {
    expect(
      normalizeDashboardConfigFromRemote({
        ...DEFAULT_DASHBOARD_CONFIG,
        showAndamentoTime: false,
      }).showAndamentoTime,
    ).toBe(false);
    expect(
      normalizeDashboardConfigFromRemote({
        ...DEFAULT_DASHBOARD_CONFIG,
        showAndamentoTime: true,
      }).showAndamentoTime,
    ).toBeUndefined();
  });
});
