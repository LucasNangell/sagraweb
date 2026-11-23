import type { ProvaPdfRegiao } from "@/api/papelariaProvaPdf";

/** Chave dos dados do job com os textos editados na prévia (`modelo:pagina:marcador` → texto). */
export const TEXTOS_DADOS_KEY = "__textos";

/** Remove pares `**…**` (mesma regra do servidor) e devolve o texto plano. */
export function semNegrito(texto: string): string {
  let out = "";
  let i = 0;
  while (i < texto.length) {
    if (texto.startsWith("**", i)) {
      const fim = texto.indexOf("**", i + 2);
      if (fim < 0) {
        out += texto.slice(i);
        break;
      }
      out += texto.slice(i + 2, fim);
      i = fim + 2;
      continue;
    }
    out += texto[i];
    i += 1;
  }
  return out;
}

function semLinhasFinaisVazias(texto: string): string {
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n");
  while (linhas.length && !(linhas[linhas.length - 1] ?? "").trim()) linhas.pop();
  return linhas.join("\n");
}

const VARIAVEL_RE = /\{([^{}]+)\}/g;
const MARCA = "\u0000";

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Nome do campo do formulário de uma variável do template. */
function chaveDoCampo(nome: string): string {
  const k = nome.trim();
  return k === "nome_acessor" ? "nome_assessor" : k;
}

/** Texto que o servidor desenharia com o template e os valores da região. */
function textoDoTemplate(template: string, valores: Record<string, string>, livre?: string): string {
  const bruto = template.replace(VARIAVEL_RE, (_m, nome: string) =>
    nome === livre ? MARCA : (valores[nome] ?? ""),
  );
  return semLinhasFinaisVazias(semNegrito(bruto));
}

export type EdicaoTexto =
  /** O texto novo só muda uma variável: atualiza o campo do formulário. */
  | { tipo: "variavel"; chave: string; valor: string }
  /** Qualquer outra mudança: o texto do campo passa a ser o digitado. */
  | { tipo: "texto"; texto: string };

/**
 * Decide como aplicar o texto digitado na prévia. Quando a mudança cabe numa
 * única variável do template (ex.: trocar só o nome numa linha
 * «Dep. {nome}/{uf}»), atualiza o campo do formulário — assim o formulário e
 * as outras partes que usam a variável acompanham. Senão, guarda o texto
 * digitado para aquele campo do PDF.
 */
export function interpretarEdicao(
  regiao: ProvaPdfRegiao,
  novoTexto: string,
  camposEditaveis: ReadonlySet<string>,
): EdicaoTexto {
  const texto = semLinhasFinaisVazias(novoTexto);
  const template = regiao.template ?? "";
  const valores = regiao.valores ?? {};
  if (!regiao.editado && template && textoDoTemplate(template, valores) === regiao.texto) {
    const nomes = [...new Set([...template.matchAll(VARIAVEL_RE)].map((m) => m[1] ?? ""))];
    const mudancas: Array<{ chave: string; valor: string }> = [];
    for (const nome of nomes) {
      const chave = chaveDoCampo(nome);
      if (!camposEditaveis.has(chave)) continue;
      const molde = textoDoTemplate(template, valores, nome);
      if (!molde.includes(MARCA)) continue;
      // A mesma variável repetida deve receber o mesmo valor (\1).
      const corpo = molde
        .split(MARCA)
        .map(escapar)
        .reduce((acc, parte, i) => (i === 0 ? parte : `${acc}${i === 1 ? "([\\s\\S]*)" : "\\1"}${parte}`), "");
      const m = new RegExp(`^${corpo}$`).exec(texto);
      const valor = m?.[1];
      if (valor !== undefined && valor !== (valores[nome] ?? "")) mudancas.push({ chave, valor });
    }
    // Ambíguo (mais de uma variável explicaria o texto) → texto livre.
    const [unica] = mudancas;
    if (mudancas.length === 1 && unica) return { tipo: "variavel", chave: unica.chave, valor: unica.valor };
  }
  return { tipo: "texto", texto: manterNegrito(texto, regiao) };
}

/**
 * Mantém em negrito os trechos que já eram negrito no texto original e
 * continuam no texto digitado.
 */
export function manterNegrito(texto: string, regiao: Pick<ProvaPdfRegiao, "texto" | "negrito">): string {
  const trechos = (regiao.negrito ?? [])
    .map(([a, b]) => regiao.texto.slice(a, b))
    .filter((t) => t.trim());
  if (!trechos.length) return texto;
  let out = "";
  let resto = texto;
  for (const trecho of trechos) {
    const i = resto.indexOf(trecho);
    if (i < 0) continue;
    out += `${resto.slice(0, i)}**${trecho}**`;
    resto = resto.slice(i + trecho.length);
  }
  return out + resto;
}

/** Textos editados → valor da chave `__textos` (vazio quando não há edição). */
export function textosParaDados(textos: Record<string, string>): string | null {
  return Object.keys(textos).length ? JSON.stringify(textos) : null;
}
