import { afterEach, describe, expect, it, vi } from "vitest";

import { formatTamanho } from "@/features/manutencao/components/AppMobileAcoes";
import { resumoVistoPor } from "@/features/manutencao/components/Visualizacoes";

import {
  isAndroidMobileBrowser,
  isSagraManutencaoApp,
  manutencaoApkUrl,
  salvarDataUrlNoApp,
} from "./sagraNativeApp";

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const APP = `${CHROME_ANDROID.replace("Chrome/124.0", "Version/4.0 Chrome/124.0")} SagraManutencaoApp/1.0.0`;
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

afterEach(() => {
  delete (window as unknown as { SagraApp?: unknown }).SagraApp;
});

describe("app Android da Manutenção — detecção", () => {
  it("reconhece o app pelo user agent", () => {
    expect(isSagraManutencaoApp(APP)).toBe(true);
    expect(isSagraManutencaoApp(CHROME_ANDROID)).toBe(false);
    expect(isSagraManutencaoApp(DESKTOP)).toBe(false);
  });

  it("oferece o APK só no navegador Android fora do app", () => {
    expect(isAndroidMobileBrowser(CHROME_ANDROID)).toBe(true);
    expect(isAndroidMobileBrowser(APP)).toBe(false);
    expect(isAndroidMobileBrowser(DESKTOP)).toBe(false);
  });

  it("aponta o download para a API", () => {
    expect(manutencaoApkUrl()).toMatch(/\/manutencao\/app\/apk$/);
  });
});

describe("salvarDataUrlNoApp", () => {
  it("retorna false fora do app (o navegador baixa sozinho)", () => {
    expect(salvarDataUrlNoApp("data:image/png;base64,AAAA", "x.png")).toBe(false);
  });

  it("entrega base64 + mime para a ponte nativa", () => {
    const salvarArquivo = vi.fn();
    (window as unknown as { SagraApp: unknown }).SagraApp = {
      versao: () => "1.0.0",
      statusNotificacoes: () => "ativas",
      abrirConfigNotificacoes: vi.fn(),
      salvarArquivo,
      sair: vi.fn(),
    };
    expect(isSagraManutencaoApp(DESKTOP)).toBe(true);
    expect(salvarDataUrlNoApp("data:image/png;base64,QUJD", "qrcode-MAQ-0001.png")).toBe(true);
    expect(salvarArquivo).toHaveBeenCalledWith("QUJD", "qrcode-MAQ-0001.png", "image/png");
  });
});

describe("resumoVistoPor", () => {
  it("indica quando ninguém viu", () => {
    expect(resumoVistoPor([])).toBe("Ninguém visualizou ainda");
  });

  it("lista quem viu, com origem app", () => {
    const texto = resumoVistoPor([
      { ponto: "123", nome: "Fulano", primeira_em: "2026-11-25T10:00:00", ultima_em: null, origem: "app", vezes: 2 },
      { ponto: "456", nome: null, primeira_em: "2026-11-25T11:30:00", ultima_em: null, origem: "web", vezes: 1 },
    ]);
    const linhas = texto.split("\n");
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toContain("Fulano");
    expect(linhas[0]).toContain("(app)");
    expect(linhas[1]).toContain("456");
    expect(linhas[1]).not.toContain("(app)");
  });
});

describe("formatTamanho", () => {
  it("usa KB para APKs pequenos e MB acima de 1 MB", () => {
    expect(formatTamanho(32_892)).toBe("32 KB");
    expect(formatTamanho(5 * 1024 * 1024 + 300_000)).toBe("5,3 MB");
  });
});
