import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(
  resolve(here, "./components/PainelAdminPage.tsx"),
  "utf8",
);
const preview = readFileSync(
  resolve(here, "./components/PainelCardPreview.tsx"),
  "utf8",
);
const form = readFileSync(
  resolve(here, "./components/PainelCardStyleForm.tsx"),
  "utf8",
);

describe("layout do admin de painéis", () => {
  it("reserva 1/4 da largura para o preview fixo à direita", () => {
    expect(page).toContain(
      "xl:grid-cols-[minmax(16rem,18rem)_minmax(0,3fr)_minmax(0,1fr)]",
    );
    expect(page).toContain("PainelCardPreview");
    expect(preview).toContain("PainelLivePreviewBoard");
    expect(
      readFileSync(
        resolve(here, "./components/PainelLivePreviewBoard.tsx"),
        "utf8",
      ),
    ).toContain('data-columns="1"');
    expect(form).not.toContain("painel-card-preview");
    expect(form).toContain("painel-card-model-thumb");
    expect(form).toContain("1234/26");
    const cardsCss = readFileSync(
      resolve(here, "../dashboard-setor-modern/dashboard-setor-modern-cards.css"),
      "utf8",
    );
    expect(cardsCss).toContain("margin: 0 1.25rem 0.75rem");
    expect(cardsCss).toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr))",
    );
    expect(cardsCss).toContain("min-height: 95px");
  });

  it("rola só a coluna central de configurações", () => {
    expect(page).toContain('variant="admin"');
    expect(page).not.toContain("dashboard-setor-page");
    expect(page).toMatch(
      /aside className="flex min-h-0 flex-col overflow-hidden[\s\S]*Exibindo agora/,
    );
    expect(page).toContain(
      "configuracoes-page-scroll min-h-0 flex-1 overflow-y-auto",
    );
  });

  it("separa as configurações em abas Geral Colunas Visual Animação Fonte", () => {
    expect(page).toContain('aria-label="Configurações do painel"');
    expect(page).toContain("Geral");
    expect(page).toContain('label: "Colunas"');
    expect(page).toContain("Visual");
    expect(page).toContain("Animação");
    expect(page).toContain("Fonte");
    expect(form).toContain('section === "typography"');
    expect(form).toContain("Título da página (OPs na …)");
    expect(form).toContain("Head das colunas");
    expect(form).toContain("Cor da fonte ·");
    expect(form).toContain("Cor do nome do usuário");
    expect(form).toContain("Cor do relógio");
    expect(form).toContain("Tamanho do número da OS");
    expect(form).toContain("Tamanho da situação");
    expect(form).toContain("Tamanho do nome do usuário");
    expect(form).toContain("Tamanho do relógio");
  });

  it("miniaturas usam a cor original e abrem modal de paleta", () => {
    expect(form).toContain("function PaletteModal");
    expect(form).toContain("pickVisual");
    expect(form).toContain("pickHighlight");
    expect(form).toContain("pickEntry");
    expect(form).toContain("LabVidroFoscoCard");
    expect(form).toContain("isHtmlCardModel");
    expect(form).toContain("Cores originais do modelo");
    expect(form).toContain("placeBesideAnchor");
    expect(form).toContain("if (swatches.length === 0)");
    expect(form).not.toContain("Esta opção não usa cores próprias");
    expect(form).not.toContain("bg-black/40");
    expect(form).not.toContain("colors={slotColors}");
    expect(form).not.toContain("setSlotColor");
    expect(page).toContain("configRef");
    expect(page).toContain("profileChanged");
    expect(page).toContain("savePainelAdminConfig");
    expect(
      readFileSync(
        resolve(here, "../dashboard-setor/hooks/usePainelOsRemoteConfig.ts"),
        "utf8",
      ),
    ).toContain("PAINEL_REMOTE_CONFIG_POLL_MS");
  });

  it("usa situações reais nos cards de preview", () => {
    expect(preview).toContain("Janela separada");
    expect(preview).toContain("openPainelPreviewWindow");
    const board = readFileSync(
      resolve(here, "./components/PainelLivePreviewBoard.tsx"),
      "utf8",
    );
    expect(board).toContain("Recebido");
    expect(board).toContain("Tramit. de Prévia p/");
    expect(board).toContain("setor-modern-heading");
    expect(board).toContain("setor-modern-lane-header");
  });

  it("controla espaçamento, fundos e head em gradiente", () => {
    expect(page).toContain("Espaçamento entre os cards");
    expect(page).toContain("Fundo do sistema");
    expect(page).toContain("Fundo das colunas");
    expect(page).toContain("PainelNotificationSoundField");
    expect(page).toContain("Som de notificação");
    expect(page).toContain("NOTIFICATION_SOUND_SLOTS");
    expect(
      readFileSync(
        resolve(here, "./components/PainelNotificationSoundField.tsx"),
        "utf8",
      ),
    ).toContain("{title}");
    const settingsForm = readFileSync(
      resolve(
        here,
        "../dashboard-setor/components/DashboardSetorSettingsForm.tsx",
      ),
      "utf8",
    );
    expect(settingsForm).toContain("Cor do head");
    expect(settingsForm).toContain("Usar gradiente");
    expect(
      readFileSync(
        resolve(here, "./components/PainelLivePreviewBoard.tsx"),
        "utf8",
      ),
    ).toContain("laneBoardStyle");
    const presets = readFileSync(
      resolve(here, "./components/PainelPresetsPanel.tsx"),
      "utf8",
    );
    expect(page).toContain("PainelPresetsPanel");
    expect(presets).toContain("Salvar preset");
    expect(presets).toContain("todas as abas");
  });
});
