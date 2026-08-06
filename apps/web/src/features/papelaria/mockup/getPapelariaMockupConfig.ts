import {
  PAPELARIA_MOCKUP_CONFIGS,
  PAPELARIA_MOCKUP_CONFIG_LIST,
} from "./papelariaMockupConfigs";
import { parseMockupConfigJson } from "./mockupConfigUtils";
import type {
  PapelariaMockupConfig,
  PapelariaMockupResolveInput,
  PapelariaMockupResolveResult,
} from "./types";

export type PapelariaMockupResolveResultExtended = PapelariaMockupResolveResult & {
  isInvalid?: boolean;
  source?: "db" | "preset" | "fallback";
};

function norm(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function stripExt(filename: string): string {
  return filename.replace(/\.(cdr|pdf)$/i, "");
}

function matchesPattern(haystack: string, pattern: string): boolean {
  const p = norm(pattern);
  if (!p) return false;
  return (
    haystack.includes(p) ||
    haystack.replace(/[\s_-]/g, "").includes(p.replace(/[\s_-]/g, ""))
  );
}

function matchArquivoModelo(
  arquivoModelo: string,
  patterns: string[] | undefined,
): boolean {
  if (!patterns?.length) return false;
  const base = norm(stripExt(arquivoModelo));
  return patterns.some((p) => matchesPattern(base, p));
}

function matchProduto(produto: string, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return false;
  const p = norm(produto);
  return patterns.some((pattern) => matchesPattern(p, pattern));
}

function cloneConfig(config: PapelariaMockupConfig): PapelariaMockupConfig {
  return {
    ...config,
    faces: config.faces.map((f) => ({ ...f, style3d: { ...f.style3d } })),
    dobras: config.dobras?.map((d) => ({ ...d })),
    cena: config.cena ? { ...config.cena } : undefined,
    vinco: config.vinco ? { ...config.vinco } : undefined,
  };
}

function fallbackByPageCount(pageCount: number): PapelariaMockupConfig {
  if (pageCount >= 2) {
    return cloneConfig(PAPELARIA_MOCKUP_CONFIGS.cartao_duplo_retrato_lateral);
  }
  return cloneConfig(PAPELARIA_MOCKUP_CONFIGS.folha_simples);
}

/**
 * Resolve mockup: MockupConfigJson (banco) → preset automático → fallback.
 */
export function getPapelariaMockupConfig(
  input: PapelariaMockupResolveInput,
): PapelariaMockupResolveResultExtended {
  const dbJson = input.mockupConfigJson?.trim();
  if (dbJson) {
    const parsed = parseMockupConfigJson(dbJson);
    if (parsed.ok) {
      return {
        config: cloneConfig(parsed.config),
        isFallback: false,
        isInvalid: false,
        source: "db",
      };
    }
    const cfg = cloneConfig(PAPELARIA_MOCKUP_CONFIGS.folha_simples);
    cfg.isFallback = true;
    return {
      config: cfg,
      isFallback: true,
      isInvalid: true,
      source: "fallback",
    };
  }

  const produto = norm(input.produto);
  const arquivo = norm(input.arquivoModelo);
  const frenteVerso = norm(input.frenteVerso);
  const pageCount = input.pageCount ?? 0;

  const byArquivoSpecificity = PAPELARIA_MOCKUP_CONFIG_LIST.filter(
    (p) => !p.isFallback && p.arquivoModeloMatch?.length,
  ).sort((a, b) => {
    const maxA = Math.max(...(a.arquivoModeloMatch ?? []).map((m) => m.length));
    const maxB = Math.max(...(b.arquivoModeloMatch ?? []).map((m) => m.length));
    return maxB - maxA;
  });

  for (const preset of byArquivoSpecificity) {
    if (arquivo && matchArquivoModelo(arquivo, preset.arquivoModeloMatch)) {
      return {
        config: cloneConfig(preset),
        isFallback: false,
        source: "preset",
      };
    }
  }

  for (const preset of PAPELARIA_MOCKUP_CONFIG_LIST) {
    if (preset.isFallback) continue;
    if (produto && matchProduto(produto, preset.produtoMatch)) {
      return {
        config: cloneConfig(preset),
        isFallback: false,
        source: "preset",
      };
    }
  }

  if (frenteVerso.includes("frente") && frenteVerso.includes("verso")) {
    return {
      config: cloneConfig(PAPELARIA_MOCKUP_CONFIGS.cartao_visita_frente_verso),
      isFallback: false,
      source: "preset",
    };
  }

  if (pageCount >= 2) {
    const cfg = fallbackByPageCount(pageCount);
    cfg.isFallback = true;
    return { config: cfg, isFallback: true, source: "fallback" };
  }

  const cfg = cloneConfig(PAPELARIA_MOCKUP_CONFIGS.folha_simples);
  cfg.isFallback = true;
  return { config: cfg, isFallback: true, source: "fallback" };
}
