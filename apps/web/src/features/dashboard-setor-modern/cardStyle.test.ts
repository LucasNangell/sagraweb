import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeDashboardConfigFromRemote } from "@/features/dashboard-setor/normalizeConfig";
import { DEFAULT_DASHBOARD_CONFIG } from "@/features/dashboard-setor/constants";

import {
  boardThemeVars,
  laneHeaderVars,
  cardSlotStyleVars,
  entryColorVars,
  normalizeCardStyle,
  resolveCardModelId,
  resolveCardTextColors,
} from "./cardStyle";

const here = dirname(fileURLToPath(import.meta.url));
const catalogCss = readFileSync(
  resolve(here, "./dashboard-setor-modern-catalog.css"),
  "utf8",
);
const modernCss = readFileSync(
  resolve(here, "./dashboard-setor-modern.css"),
  "utf8",
);

describe("cardStyle", () => {
  it("migra ids legados (sufixo de cor) para efeito + paleta", () => {
    const style = normalizeCardStyle({
      models: { high: "v79-red", medium: "nope", normal: "v37-amber" },
      entryAnimation: "fx-iris",
      entrySpeed: 1.5,
    });
    expect(style?.models.high.effect).toBe("v79");
    expect(style?.models.high.colors?.bg).toBe("#b91c1c");
    expect(style?.models.medium.effect).toBe("");
    expect(style?.models.normal.effect).toBe("v37");
    expect(style?.models.normal.colors?.border).toBe("#ffd166");
    expect(style?.entryAnimation).toBe("fx-iris");
    expect(style?.entrySpeed).toBe(1.5);
  });

  it("aceita o formato novo (efeito + paleta) e mapeia por prioridade", () => {
    const style = normalizeCardStyle({
      models: {
        high: { effect: "mod-aurora", colors: { bg: "#112233" } },
        medium: { effect: "txt-matrix" },
        normal: { effect: "v77" },
      },
      entryAnimation: "none",
    });
    expect(resolveCardModelId(style, "priority-high")).toBe("mod-aurora");
    expect(resolveCardModelId(style, "priority-medium")).toBe("txt-matrix");
    expect(resolveCardModelId(style, null)).toBe("v77");
    expect(style?.models.high.colors?.bg).toBe("#112233");
  });

  it("normalizeConfig preserva cardStyle", () => {
    const next = normalizeDashboardConfigFromRemote({
      ...DEFAULT_DASHBOARD_CONFIG,
      cardStyle: {
        models: {
          high: { effect: "v80", colors: { accent: "#ff0000" } },
          medium: "v80-amber",
          normal: { effect: "" },
        },
        entryAnimation: "fx-warp",
        typography: { fontScale: 1.2, titleColor: "#ffcc00" },
      },
    });
    expect(next.cardStyle?.models.high.effect).toBe("v80");
    expect(next.cardStyle?.models.high.colors?.accent).toBe("#ff0000");
    expect(next.cardStyle?.models.medium.effect).toBe("v80");
    expect(next.cardStyle?.entryAnimation).toBe("fx-warp");
    expect(next.cardStyle?.typography?.fontScale).toBe(1.2);
    expect(next.cardStyle?.typography?.titleColor).toBe("#ffcc00");
  });

  it("preserva tipografia do título da página e do head das colunas", () => {
    const style = normalizeCardStyle({
      models: { high: "", medium: "", normal: "" },
      entryAnimation: "none",
      typography: {
        heading: {
          fontFamily: "Orbitron, ui-sans-serif, system-ui, sans-serif",
          fontScale: 1.15,
          color: "#abc123",
        },
        column: {
          fontFamily: "Syne, ui-sans-serif, system-ui, sans-serif",
          letterSpacing: 0.04,
          color: "#fedcba",
        },
      },
    });
    expect(style?.typography?.heading?.fontScale).toBe(1.15);
    expect(style?.typography?.heading?.color).toBe("#abc123");
    expect(style?.typography?.column?.letterSpacing).toBe(0.04);
    expect(style?.typography?.column?.color).toBe("#fedcba");
  });

  it("preserva tamanho de fonte por elemento do card", () => {
    const style = normalizeCardStyle({
      models: { high: "", medium: "", normal: "" },
      entryAnimation: "none",
      typography: {
        titleScale: 1.2,
        situationScale: 0.9,
        authorScale: 1.1,
        timerScale: 1.3,
      },
    });
    expect(style?.typography?.titleScale).toBe(1.2);
    expect(style?.typography?.situationScale).toBe(0.9);
    expect(style?.typography?.authorScale).toBe(1.1);
    expect(style?.typography?.timerScale).toBe(1.3);
  });

  it("resolve cores de fonte por prioridade com fallback global", () => {
    const style = normalizeCardStyle({
      models: { high: "", medium: "", normal: "" },
      entryAnimation: "none",
      typography: {
        titleColor: "#edf3fa",
        situationColor: "#e1eaf4",
        priorities: {
          high: {
            titleColor: "#ff0000",
            situationColor: "#00ff00",
            authorColor: "#abcdef",
            timerColor: "#123456",
          },
          medium: { titleColor: "#0000ff" },
        },
      },
    });
    expect(resolveCardTextColors(style, "priority-high")).toEqual({
      titleColor: "#ff0000",
      situationColor: "#00ff00",
      authorColor: "#abcdef",
      timerColor: "#123456",
    });
    expect(resolveCardTextColors(style, "priority-medium")).toEqual({
      titleColor: "#0000ff",
      situationColor: "#e1eaf4",
    });
    expect(resolveCardTextColors(style, null)).toEqual({
      titleColor: "#edf3fa",
      situationColor: "#e1eaf4",
    });
  });

  it("expõe variáveis de tema do board", () => {
    expect(
      boardThemeVars({
        cardGap: 20,
        pageBg: "#010101",
        columnBg: "#111111",
        headerBg: "#222222",
        headerBg2: "#333333",
      }),
    ).toMatchObject({
      "--sm-card-gap": "20px",
      "--sm-bg": "#010101",
      "--sm-surface": "#111111",
      "--sm-header-bg": "#222222",
      "--sm-header-gradient": "linear-gradient(180deg, #222222, #333333)",
    });
    expect(modernCss).toContain("--sm-card-gap");
    expect(modernCss).toContain("data-custom-header");
  });

  it("aplica cor de head por coluna e herda o tema quando a coluna não tem cor", () => {
    expect(
      laneHeaderVars(
        { headerBg: "#aa0000", headerBg2: "#bb0000" },
        { headerBg: "#222222", headerBg2: "#333333" },
      ),
    ).toMatchObject({
      "--lane-header-color": "#aa0000",
      "--lane-header-bg": "linear-gradient(180deg, #aa0000, #bb0000)",
    });
    expect(
      laneHeaderVars({}, { headerBg: "#222222" }),
    ).toMatchObject({
      "--lane-header-color": "#222222",
      "--lane-header-bg": "none",
    });
    expect(laneHeaderVars({}, {})).toEqual({});
  });

  it("aceita o modelo HTML do laboratório", () => {
    const style = normalizeCardStyle({
      models: {
        high: { effect: "lab-vidro-fosco" },
        medium: { effect: "" },
        normal: { effect: "" },
      },
      entryAnimation: "none",
    });
    expect(resolveCardModelId(style, "priority-high")).toBe("lab-vidro-fosco");
    const htmlCss = readFileSync(
      resolve(here, "./html-cards/lab-vidro-fosco.css"),
      "utf8",
    );
    expect(htmlCss).toContain('[data-model="lab-vidro-fosco"]');
    expect(htmlCss).toContain("lab-vidro-fosco-pulse");
    expect(htmlCss).toContain("lab-vidro-fosco-stamp");
  });

  it("efeitos do catálogo são parametrizados por paleta (--cm-*)", () => {
    expect(catalogCss).toContain(
      '.setor-modern .setor-modern-card[data-model="v79"]',
    );
    expect(catalogCss).toContain(
      '.setor-modern .setor-modern-card[data-model="mod-aurora"]',
    );
    expect(catalogCss).toContain(
      '.setor-modern .setor-modern-card[data-model="txt-matrix"]',
    );
    expect(catalogCss).toContain("var(--cm-bg");
    expect(catalogCss).toContain("var(--cm-border");
    expect(catalogCss).toContain("var(--cm-accent");
    expect(catalogCss).toContain("var(--cm-extra");
    expect(catalogCss).toContain("var(--fx-accent");
    expect(catalogCss).toContain('[data-model="v37"]::before');
    expect(catalogCss).toContain("@property --sm-beam-angle");
    expect(catalogCss).toContain("mask-composite: exclude");
    expect(catalogCss).toContain("left: -75%");
  });

  it("separa entrada (data-entry, 1x) de realce (data-highlight, loop)", () => {
    // Seção 8 = entrada (wrapper, uma vez)
    expect(catalogCss).toContain('[data-entry="fx-meteor"]');
    expect(catalogCss).toContain('[data-entry="fx-blackhole"]');
    // Seções 7 e 9 = realce em loop no card/número
    expect(catalogCss).toContain('[data-highlight="fx-cyber-slice"]');
    expect(catalogCss).toContain('[data-highlight="fx-tesla"]');
    expect(catalogCss).toContain('[data-highlight="fx-solar-flare"]');
    expect(catalogCss).not.toContain('[data-entry="fx-tesla"]');
  });

  it("preserva cores extras, de realce e de entrada", () => {
    const style = normalizeCardStyle({
      models: {
        high: {
          effect: "mod-aurora",
          colors: { bg: "#112233", extra: "#23d5ab" },
          highlight: "fx-tesla",
          highlightColors: { accent: "#00ffff", extra: "#3b82f6" },
        },
        medium: { effect: "" },
        normal: { effect: "" },
      },
      entryAnimation: "fx-laser",
      entryColors: { accent: "#ffffff", border: "#38bdf8" },
    });
    expect(style?.models.high.colors?.extra).toBe("#23d5ab");
    expect(style?.models.high.highlightColors?.accent).toBe("#00ffff");
    expect(style?.entryColors?.border).toBe("#38bdf8");
    const slotVars = cardSlotStyleVars(style?.models.high);
    expect(slotVars).toMatchObject({
      "--cm-bg": "#112233",
      "--cm-extra": "#23d5ab",
      "--fx-accent": "#00ffff",
    });
    expect(entryColorVars(style?.entryColors)).toMatchObject({
      "--fx-accent": "#ffffff",
      "--fx-border": "#38bdf8",
    });
  });

  it("realce é por prioridade e aceito no slot", () => {
    const style = normalizeCardStyle({
      models: {
        high: { effect: "v79", highlight: "fx-tesla" },
        medium: { effect: "", highlight: "fx-matrix" },
        normal: { effect: "v37" },
      },
      entryAnimation: "fx-meteor",
    });
    expect(style?.models.high.highlight).toBe("fx-tesla");
    expect(style?.models.medium.highlight).toBe("fx-matrix");
    expect(style?.models.normal.highlight).toBeUndefined();
    expect(style?.entryAnimation).toBe("fx-meteor");
    // entrada só aceita ids de entrada; realce não vale como entrada
    const bad = normalizeCardStyle({
      models: { high: { effect: "" }, medium: { effect: "" }, normal: { effect: "" } },
      entryAnimation: "fx-tesla",
    });
    expect(bad?.entryAnimation ?? "none").toBe("none");
  });

  it("aplica cor de fonte no card (não no board inteiro)", () => {
    const cardsCss = readFileSync(
      resolve(here, "./dashboard-setor-modern-cards.css"),
      "utf8",
    );
    expect(cardsCss).toContain(
      '.setor-modern .setor-modern-card[data-title-color="1"] .setor-modern-card-top h3',
    );
    expect(cardsCss).toContain(
      '.setor-modern .setor-modern-card[data-situation-color="1"] .setor-modern-situation',
    );
    expect(cardsCss).toContain(
      '.setor-modern .setor-modern-card[data-author-color="1"] .setor-modern-card-author',
    );
    expect(cardsCss).toContain(
      ".setor-modern-card[data-timer-color=\"1\"]",
    );
    expect(cardsCss).toContain("var(--sm-title-scale");
    expect(cardsCss).toContain("var(--sm-situation-scale");
    expect(cardsCss).toContain("var(--sm-author-scale");
    expect(cardsCss).toContain("var(--sm-timer-scale");
  });

  it("realce padrão de prioridade só vale para cards sem efeito", () => {
    expect(modernCss).toContain(
      ".setor-modern-card:is(.priority-high, .priority-medium):not([data-model])::before",
    );
    expect(modernCss).toContain(
      ".setor-modern-card.is-new:not([data-model])::after",
    );
  });
});
