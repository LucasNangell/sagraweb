import { aplicarBolsoPadrao } from "./bolsoInterno";
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

function maxPaginasOf(preset: PapelariaMockupConfig): number {
  if (typeof preset.maxPaginas === "number" && preset.maxPaginas > 0) {
    return preset.maxPaginas;
  }
  return Math.max(1, preset.faces?.length ?? 1);
}

function arquivoSpecificity(preset: PapelariaMockupConfig): number {
  const patterns = preset.arquivoModeloMatch ?? [];
  if (!patterns.length) return 0;
  return Math.max(...patterns.map((m) => m.length));
}

/**
 * Entre presets do mesmo produto/arquivo, escolhe a variante pela
 * quantidade de páginas (2+ → maxPaginas >= 2; 1 → só frente).
 */
export function escolherPresetPorPaginas(
  candidatos: PapelariaMockupConfig[],
  querFrenteVerso: boolean,
): PapelariaMockupConfig | null {
  if (!candidatos.length) return null;
  const ordered = [...candidatos].sort(
    (a, b) => arquivoSpecificity(b) - arquivoSpecificity(a),
  );
  const preferred = querFrenteVerso
    ? ordered.filter((p) => maxPaginasOf(p) >= 2)
    : ordered.filter((p) => maxPaginasOf(p) <= 1);
  return preferred[0] ?? ordered[0] ?? null;
}

function presetsNaoFallback(): PapelariaMockupConfig[] {
  return PAPELARIA_MOCKUP_CONFIG_LIST.filter((p) => !p.isFallback);
}

/**
 * O JSON salvo declara para qual produto/arquivo foi feito.
 * Sem essas listas, a configuração é tratada como exclusiva deste item.
 */
export function mockupConfigMatchesRequest(
  config: PapelariaMockupConfig,
  input: { produto?: string; arquivoModelo?: string },
): boolean {
  const hasProduto = (config.produtoMatch?.length ?? 0) > 0;
  const hasArquivo = (config.arquivoModeloMatch?.length ?? 0) > 0;
  if (!hasProduto && !hasArquivo) return true;
  const produtoOk = hasProduto && matchProduto(input.produto ?? "", config.produtoMatch);
  const arquivoOk =
    hasArquivo && matchArquivoModelo(input.arquivoModelo ?? "", config.arquivoModeloMatch);
  return produtoOk || arquivoOk;
}

/**
 * Resolve mockup: MockupConfigJson (banco) → preset automático (por
 * arquivo/produto + pageCount) → fallback.
 */
/**
 * Mockup do produto (JSON salvo, preset ou genérico). Pasta com bolso ganha o
 * bolso interno padrão na face interna quando a configuração não define um.
 */
export function getPapelariaMockupConfig(
  input: PapelariaMockupResolveInput,
): PapelariaMockupResolveResultExtended {
  const r = resolverConfigBase(input);
  return { ...r, config: aplicarBolsoPadrao(r.config, input.produto) };
}

function resolverConfigBase(
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
  const arquivoIndicaFv =
    Boolean(arquivo) && matchArquivoModelo(arquivo, ["CtVisitaFV", "VisitaFV"]);
  const querFrenteVerso =
    pageCount >= 2 ||
    arquivoIndicaFv ||
    (frenteVerso.includes("frente") && frenteVerso.includes("verso"));

  const todos = presetsNaoFallback();
  const porArquivo = arquivo
    ? todos.filter((p) => matchArquivoModelo(arquivo, p.arquivoModeloMatch))
    : [];
  const porProduto = produto
    ? todos.filter((p) => matchProduto(produto, p.produtoMatch))
    : [];

  // Arquivo manda (ex.: CtVisitaFV.cdr); senão produto. pageCount escolhe F vs FV.
  const candidatos = porArquivo.length > 0 ? porArquivo : porProduto;
  const escolhido = escolherPresetPorPaginas(candidatos, querFrenteVerso);
  if (escolhido) {
    return {
      config: cloneConfig(escolhido),
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
