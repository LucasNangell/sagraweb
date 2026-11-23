import type {
  ProvaPdfCampo,
  ProvaPdfModelo,
  ProvaPdfTexto,
} from "@/api/papelariaProvaPdf";

/** Chave da linha (o mesmo texto pode aparecer em mais de uma página). */
export function chaveTexto(t: Pick<ProvaPdfTexto, "marcador" | "pagina">): string {
  return `${t.pagina}|${t.marcador}`;
}

export function campoVazio(t: ProvaPdfTexto): ProvaPdfCampo {
  return {
    marcador: t.marcador,
    pagina: t.pagina,
    template: "",
    alinhamento: "auto",
    ancora: "auto",
    entrelinha: 1.2,
    reduzir_para_caber: true,
    uppercase: false,
    bloquear_edicao: false,
  };
}

function paginaEfetiva(pagina: number | null | undefined): number {
  const n = Number(pagina);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Casa um campo salvo com um texto da análise do PDF.
 * `pagina` 0/ausente = qualquer página com o mesmo marcador.
 */
export function casarCampoComTexto(
  campo: ProvaPdfCampo,
  textos: ProvaPdfTexto[],
): ProvaPdfTexto | null {
  const pagina = paginaEfetiva(campo.pagina);
  if (pagina > 0) {
    const exato = textos.find(
      (t) => t.marcador === campo.marcador && t.pagina === pagina,
    );
    if (exato) return exato;
  }
  return textos.find((t) => t.marcador === campo.marcador) ?? null;
}

export type ProvaPdfCamposHidratados = {
  /** Mapa chave → campo (inclui linhas vazias da análise e órfãos). */
  mapa: Record<string, ProvaPdfCampo>;
  /** Bindings salvos cujo marcador não existe mais na análise. */
  orfaos: ProvaPdfCampo[];
};

/**
 * Reidrata o estado do painel a partir da resposta da API.
 * Garante que templates salvos apareçam nas linhas do grid e que órfãos
 * continuem editáveis.
 */
export function hidratarCampos(data: ProvaPdfModelo): ProvaPdfCamposHidratados {
  const textos = data.analise?.textos ?? [];
  const mapa: Record<string, ProvaPdfCampo> = {};
  for (const t of textos) {
    mapa[chaveTexto(t)] = campoVazio(t);
  }

  const orfaos: ProvaPdfCampo[] = [];
  for (const c of data.campos ?? []) {
    if (!c?.marcador || !String(c.template ?? "").trim()) continue;
    const match = casarCampoComTexto(c, textos);
    if (match) {
      mapa[chaveTexto(match)] = {
        ...campoVazio(match),
        ...c,
        marcador: match.marcador,
        pagina: match.pagina,
      };
    } else {
      const pagina = paginaEfetiva(c.pagina) || 1;
      const orfao: ProvaPdfCampo = { ...c, pagina };
      orfaos.push(orfao);
      mapa[chaveTexto(orfao)] = orfao;
    }
  }

  return { mapa, orfaos };
}

/** Variáveis `{x}` usadas nos templates (para os valores de teste da prévia). */
export function variaveisDosTemplates(campos: ProvaPdfCampo[]): string[] {
  const out = new Set<string>();
  for (const c of campos) {
    for (const m of c.template.matchAll(/\{([^{}]+)\}/g)) {
      const nome = m[1]?.trim();
      if (nome) out.add(nome);
    }
  }
  return [...out];
}
