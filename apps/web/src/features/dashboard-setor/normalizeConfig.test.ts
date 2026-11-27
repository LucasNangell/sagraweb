import { describe, expect, it } from "vitest";

import { DEFAULT_DASHBOARD_CONFIG, INBOX_COLUMN_SOURCE } from "./constants";
import {
  normalizeDashboardColumns,
  normalizeDashboardConfigFromRemote,
  resolveDashboardHeading,
  showsAndamentoTime,
} from "./normalizeConfig";
import { buildDashboardConfigSignature } from "./utils";

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

  it("preserva a cor do head por coluna", () => {
    const columns = normalizeDashboardColumns([
      {
        id: "exec",
        title: "Execução",
        statuses: ["Em Execução"],
        headerBg: "#112233",
        headerBg2: "#445566",
      },
    ]);
    expect(columns[0]?.headerBg).toBe("#112233");
    expect(columns[0]?.headerBg2).toBe("#445566");
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

describe("tema do board", () => {
  it("preserva espaçamento, fundos e gradiente do head", () => {
    const config = normalizeDashboardConfigFromRemote({
      ...DEFAULT_DASHBOARD_CONFIG,
      theme: {
        cardGap: 16,
        pageBg: "#112233",
        columnBg: "#445566",
        headerBg: "#aabbcc",
        headerBg2: "#ddeeff",
      },
    });
    expect(config.theme).toEqual({
      cardGap: 16,
      pageBg: "#112233",
      columnBg: "#445566",
      headerBg: "#aabbcc",
      headerBg2: "#ddeeff",
    });
  });

  it("preserva o som de notificação customizado", () => {
    const config = normalizeDashboardConfigFromRemote({
      ...DEFAULT_DASHBOARD_CONFIG,
      notificationSound: { preset: "chime" },
    });
    expect(config.notificationSound).toEqual({ preset: "chime" });
  });

  it("preserva toques por prioridade", () => {
    const config = normalizeDashboardConfigFromRemote({
      ...DEFAULT_DASHBOARD_CONFIG,
      notificationSounds: {
        high: { preset: "bell" },
        medium: { preset: "suave" },
        normal: { preset: "none" },
      },
    });
    expect(config.notificationSounds).toEqual({
      high: { preset: "bell" },
      medium: { preset: "suave" },
      normal: { preset: "none" },
    });
  });

  it("omite o espaçamento padrão e cores inválidas", () => {
    const config = normalizeDashboardConfigFromRemote({
      ...DEFAULT_DASHBOARD_CONFIG,
      theme: { cardGap: 8, pageBg: "red", headerBg: "#fff" },
    });
    expect(config.theme).toEqual({ headerBg: "#fff" });
  });
});

describe("título do header", () => {
  it("usa “OPs na {setor}” quando não há título personalizado", () => {
    const config = normalizeDashboardConfigFromRemote({ sector: "SEPAC" });
    expect(config.headerTitle).toBeUndefined();
    expect(resolveDashboardHeading(config)).toBe("OPs na SEPAC");
    expect(
      resolveDashboardHeading({ sector: "SEPAC", headerTitle: "   " }),
    ).toBe("OPs na SEPAC");
  });

  it("substitui o texto inteiro pelo título configurado (com trim)", () => {
    const config = normalizeDashboardConfigFromRemote({
      sector: "SEPAC",
      headerTitle: "  Fila da Acabamento  ",
    });
    expect(config.headerTitle).toBe("Fila da Acabamento");
    expect(resolveDashboardHeading(config)).toBe("Fila da Acabamento");
  });

  it("limita o tamanho e ignora valores não textuais", () => {
    const long = normalizeDashboardConfigFromRemote({
      headerTitle: "x".repeat(500),
    });
    expect(long.headerTitle).toHaveLength(120);
    const invalid = normalizeDashboardConfigFromRemote({ headerTitle: 42 });
    expect(invalid.headerTitle).toBeUndefined();
  });

  it("muda a assinatura para o painel aplicar a configuração remota", () => {
    const base = normalizeDashboardConfigFromRemote({ sector: "SEFOC" });
    expect(buildDashboardConfigSignature(base)).not.toBe(
      buildDashboardConfigSignature({ ...base, headerTitle: "Produção" }),
    );
  });
});
