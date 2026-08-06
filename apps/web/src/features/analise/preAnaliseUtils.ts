import type {
  PreAnaliseAchado,
  PreAnaliseCheckResult,
  PreAnaliseLiveState,
  PreAnaliseTimingFields,
} from "./preAnaliseTypes";

export interface PreAnaliseProblemaItem {
  id: string;
  verificacao: string;
  titulo: string;
  descricao: string;
  /** Páginas onde o problema ocorre (consolidado). */
  paginas?: number[];
  /** @deprecated Use paginas — mantido para compatibilidade. */
  pagina?: number;
  severidade: "warning" | "error";
}

export interface PreAnaliseProblemasPorArquivo {
  arquivo: string;
  rotulo: string;
  itens: PreAnaliseProblemaItem[];
}

const ARQUIVO_ENTRE_ASPAS = /^"([^"]+)"/;
const PAGINA_NA_MENSAGEM = /(?:pág\.|Página)\s*(\d+)/i;

const ROTULO_GERAL = "Geral (pasta / OS)";

export function isPreAnaliseProblemResult(result: PreAnaliseCheckResult): boolean {
  const achados = result.achados ?? [];
  if (
    achados.some(
      (a) => a.severidade === "warning" || a.severidade === "error",
    )
  ) {
    return true;
  }
  return (
    (result.status === "error" || result.status === "warning") &&
    achados.length === 0
  );
}

export function filterProblemResults(
  results: PreAnaliseCheckResult[],
): PreAnaliseCheckResult[] {
  return results.filter(isPreAnaliseProblemResult);
}

export function countProblemResults(results: PreAnaliseCheckResult[]): number {
  return filterProblemResults(results).length;
}

export function warningAchados(result: PreAnaliseCheckResult): PreAnaliseAchado[] {
  return (
    result.achados?.filter(
      (a) => a.severidade === "warning" || a.severidade === "error",
    ) ?? []
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extrairArquivo(
  achado: PreAnaliseAchado,
  mensagem: string,
): string | null {
  const det = achado.detalhes;
  if (typeof det?.arquivo === "string" && det.arquivo.trim()) {
    return det.arquivo.trim();
  }
  const match = mensagem.match(ARQUIVO_ENTRE_ASPAS);
  return match ? match[1] : null;
}

function extrairPagina(
  achado: PreAnaliseAchado,
  mensagem: string,
): number | undefined {
  const det = achado.detalhes;
  if (typeof det?.pagina === "number" && det.pagina > 0) {
    return det.pagina;
  }
  const match = mensagem.match(PAGINA_NA_MENSAGEM);
  if (match) {
    return Number.parseInt(match[1], 10);
  }
  return undefined;
}

function limparDescricao(mensagem: string, arquivo: string | null): string {
  let texto = mensagem.trim();
  if (arquivo) {
    texto = texto.replace(
      new RegExp(`^"${escapeRegex(arquivo)}"\\s*`),
      "",
    );
    const needle = `"${arquivo}"`;
    const second = texto.indexOf(needle, 1);
    if (second > 0) {
      texto = texto.slice(0, second).trim();
    }
  }
  texto = texto
    .replace(/^(?:—\s*)+/g, "")
    .replace(/^(?:pág\.|Página)\s*\d+\s*:?\s*/i, "")
    .replace(/\s*nas páginas:\s*[\d,\s]+/gi, "")
    .replace(/^:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (texto && !/[.!?]$/.test(texto)) {
    texto += ".";
  }
  return texto;
}

function extrairPaginas(
  achado: PreAnaliseAchado,
  mensagem: string,
): number[] {
  const det = achado.detalhes;
  if (Array.isArray(det?.paginas)) {
    return det.paginas
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  const lista = mensagem.match(/nas páginas:\s*([\d,\s]+)/i);
  if (lista) {
    return lista[1]
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  const unica = extrairPagina(achado, mensagem);
  return unica ? [unica] : [];
}

function formatPaginas(paginas: number[]): string {
  const sorted = [...new Set(paginas)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return `Pág. ${sorted[0]}`;

  const partes: string[] = [];
  let inicio = sorted[0];
  let anterior = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const atual = sorted[i];
    if (atual === anterior + 1) {
      anterior = atual;
      continue;
    }
    partes.push(inicio === anterior ? `${inicio}` : `${inicio}–${anterior}`);
    inicio = atual;
    anterior = atual;
  }

  return `Páginas ${partes.join(", ")}`;
}

function montarDescricaoConsolidada(
  paginas: number[],
  textos: string[],
): string {
  const unicos = [...new Set(textos.map((t) => t.trim()).filter(Boolean))];
  let corpo = unicos.length === 1 ? unicos[0] : unicos.join(" ");
  if (!corpo) {
    corpo = "Ocorrência registrada nesta verificação.";
  }

  if (paginas.length === 0) {
    return corpo;
  }

  const prefixo = formatPaginas(paginas);
  if (/nas páginas:/i.test(corpo)) {
    return `${prefixo}: ${corpo.replace(/\s*nas páginas:\s*[\d,\s]+/gi, "").trim()}`;
  }
  return `${prefixo}: ${corpo}`;
}

interface ProblemaAgregado {
  verificacao: string;
  titulo: string;
  codigo: string;
  severidade: "warning" | "error";
  paginas: Set<number>;
  textos: string[];
}

function chaveAgregacao(
  arquivo: string,
  verificacao: string,
  codigo: string,
  titulo: string,
): string {
  return `${arquivo}|${verificacao}|${codigo}|${titulo}`;
}

/**
 * Agrupa todos os alertas das verificações por arquivo PDF.
 * Itens sem arquivo (ex.: comparação com OS da pasta) vão em «Geral».
 */
export function groupProblemsByFile(
  results: PreAnaliseCheckResult[],
): PreAnaliseProblemasPorArquivo[] {
  const agregados = new Map<string, Map<string, ProblemaAgregado>>();

  const obterAgregado = (
    chaveArquivo: string,
    verificacao: string,
    achado: PreAnaliseAchado,
  ): ProblemaAgregado => {
    const chave = chaveAgregacao(
      chaveArquivo,
      verificacao,
      achado.codigo,
      achado.titulo,
    );
    let porTipo = agregados.get(chaveArquivo);
    if (!porTipo) {
      porTipo = new Map();
      agregados.set(chaveArquivo, porTipo);
    }
    let agg = porTipo.get(chave);
    if (!agg) {
      agg = {
        verificacao,
        titulo: achado.titulo,
        codigo: achado.codigo,
        severidade: achado.severidade === "error" ? "error" : "warning",
        paginas: new Set(),
        textos: [],
      };
      porTipo.set(chave, agg);
    }
    if (achado.severidade === "error") {
      agg.severidade = "error";
    }
    return agg;
  };

  for (const result of results) {
    const verificacao = result.check_nome || result.check_id;

    for (const achado of warningAchados(result)) {
      const mensagem = achado.mensagem || "";
      const arquivoNome = extrairArquivo(achado, mensagem);
      const chaveArquivo = arquivoNome ?? "__geral__";
      const agg = obterAgregado(chaveArquivo, verificacao, achado);

      for (const p of extrairPaginas(achado, mensagem)) {
        agg.paginas.add(p);
      }

      const descricao = limparDescricao(mensagem, arquivoNome);
      if (descricao && !agg.textos.includes(descricao)) {
        agg.textos.push(descricao);
      }
    }

    if (
      isPreAnaliseProblemResult(result) &&
      warningAchados(result).length === 0 &&
      result.mensagem
    ) {
      const chaveArquivo = "__geral__";
      const pseudo: PreAnaliseAchado = {
        codigo: `__${result.check_id}__`,
        titulo: verificacao,
        mensagem: result.mensagem,
        severidade: result.status === "error" ? "error" : "warning",
      };
      const agg = obterAgregado(chaveArquivo, verificacao, pseudo);
      const descricao = limparDescricao(result.mensagem, null);
      if (descricao && !agg.textos.includes(descricao)) {
        agg.textos.push(descricao);
      }
    }
  }

  const ordenarArquivo = (a: string, b: string) => {
    if (a === "__geral__") return 1;
    if (b === "__geral__") return -1;
    return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
  };

  return [...agregados.entries()]
    .sort(([a], [b]) => ordenarArquivo(a, b))
    .map(([arquivo, porTipo]) => {
      const itens: PreAnaliseProblemaItem[] = [...porTipo.values()].map(
        (agg) => {
          const paginas = [...agg.paginas].sort((a, b) => a - b);
          const descricao = montarDescricaoConsolidada(paginas, agg.textos);
          const id = chaveAgregacao(
            arquivo,
            agg.verificacao,
            agg.codigo,
            agg.titulo,
          );
          return {
            id,
            verificacao: agg.verificacao,
            titulo: agg.titulo,
            descricao,
            paginas: paginas.length ? paginas : undefined,
            pagina: paginas.length === 1 ? paginas[0] : undefined,
            severidade: agg.severidade,
          };
        },
      );

      itens.sort((x, y) => {
        const px = x.paginas?.[0] ?? x.pagina ?? 0;
        const py = y.paginas?.[0] ?? y.pagina ?? 0;
        if (px !== py) return px - py;
        return x.titulo.localeCompare(y.titulo, "pt-BR");
      });

      return {
        arquivo,
        rotulo: arquivo === "__geral__" ? ROTULO_GERAL : arquivo,
        itens,
      };
    });
}

export function countProblemItems(results: PreAnaliseCheckResult[]): number {
  return groupProblemsByFile(results).reduce(
    (total, grupo) => total + grupo.itens.length,
    0,
  );
}

export function countFilesWithProblems(
  results: PreAnaliseCheckResult[],
): number {
  return groupProblemsByFile(results).filter(
    (g) => g.arquivo !== "__geral__",
  ).length;
}

/** Formata segundos como MM:SS para contagem regressiva. */
export function formatPreAnaliseDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function timingFieldsFromEvent(
  event: PreAnaliseTimingFields,
): Pick<
  PreAnaliseLiveState,
  | "estimatedTotalSec"
  | "remainingSec"
  | "elapsedSec"
  | "hasTimingHistory"
  | "timingSampleCount"
> {
  return {
    estimatedTotalSec:
      typeof event.estimate_total_sec === "number"
        ? event.estimate_total_sec
        : undefined,
    remainingSec:
      typeof event.remaining_sec === "number" ? event.remaining_sec : undefined,
    elapsedSec:
      typeof event.elapsed_sec === "number" ? event.elapsed_sec : undefined,
    hasTimingHistory: Boolean(event.has_timing_history),
    timingSampleCount:
      typeof event.timing_sample_count === "number"
        ? event.timing_sample_count
        : undefined,
  };
}
