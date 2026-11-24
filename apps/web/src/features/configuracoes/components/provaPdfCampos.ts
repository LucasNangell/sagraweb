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
    juntar: [],
  };
}

const PT_PARA_MM = 25.4 / 72;

/**
 * Texto logo abaixo (mesma página, até ~2,5 linhas de distância) — candidato
 * a ser juntado ao campo, como a segunda linha do rodapé.
 */
export function textoAbaixo(
  t: ProvaPdfTexto,
  textos: ProvaPdfTexto[],
  ignorar: ReadonlySet<string> = new Set(),
): ProvaPdfTexto | null {
  const alturaLinha = Math.max(1, t.tamanho * PT_PARA_MM);
  const candidatos = textos.filter(
    (o) =>
      o !== t &&
      o.pagina === t.pagina &&
      !ignorar.has(chaveTexto(o)) &&
      o.y_mm > t.y_mm + 0.1 &&
      o.y_mm - t.y_mm <= alturaLinha * 2.5,
  );
  candidatos.sort((a, b) => a.y_mm - b.y_mm);
  return candidatos[0] ?? null;
}

/** Entrelinha (× tamanho da fonte) que reproduz a distância entre duas linhas do PDF. */
export function entrelinhaEntre(cima: ProvaPdfTexto, baixo: ProvaPdfTexto): number {
  const tamanhoMm = cima.tamanho * PT_PARA_MM;
  if (!(tamanhoMm > 0)) return 1.2;
  const valor = (baixo.y_mm - cima.y_mm) / tamanhoMm;
  return Math.round(Math.min(3, Math.max(0.8, valor)) * 100) / 100;
}

/**
 * Junta o texto de baixo ao campo: um campo só, de várias linhas. O template
 * ganha a linha de baixo (o template dela, ou o texto do PDF) e a entrelinha
 * passa a ser a do modelo.
 */
export function juntarCampos(
  campo: ProvaPdfCampo,
  dono: ProvaPdfTexto,
  abaixo: ProvaPdfTexto,
  campoAbaixo: ProvaPdfCampo | undefined,
): ProvaPdfCampo {
  const cima = campo.template.trim() ? campo.template : dono.marcador;
  const baixo = campoAbaixo?.template.trim() ? campoAbaixo.template : abaixo.marcador;
  const juntar = [...(campo.juntar ?? []), abaixo.marcador, ...(campoAbaixo?.juntar ?? [])];
  return {
    ...campo,
    template: `${cima}
${baixo}`,
    juntar: [...new Set(juntar)],
    entrelinha: (campo.juntar ?? []).length ? campo.entrelinha : entrelinhaEntre(dono, abaixo),
  };
}

/** Dono (chave) de cada texto juntado a outro campo. */
export function juntadosPorDono(
  campos: Record<string, ProvaPdfCampo>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [chave, c] of Object.entries(campos)) {
    if (!c.template.trim()) continue;
    for (const m of c.juntar ?? []) out.set(chaveTexto({ marcador: m, pagina: c.pagina }), chave);
  }
  return out;
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
