/**
 * Campos do produto real (Corel já existente na pasta da SP).
 *
 * Espelho de `app/backend/services/papelaria_campos_produto.py`: objetos do
 * Corel cujo texto não cabe no template do modelo viram campos próprios, um por
 * ocorrência (face + posição). Esses campos aparecem no formulário do SEFOC e no
 * portal de aprovação do cliente.
 */
import type {
  PapelariaCamposProduto,
  PapelariaCamposProdutoEntrada,
  PapelariaCorelDiferenca,
  PapelariaField,
} from "./types";

export const CAMPOS_PRODUTO_DADOS_KEY = "__campos_produto";

const QUEBRAS_COREL = new RegExp("\r\n|\r|\u000b|\u2028|\u2029", "g");
const ESPACOS = new RegExp("[ \t\u00a0]+", "g");
const NL = String.fromCharCode(10);

/** Mesma normalização do backend (quebras do Corel, espaços repetidos). */
export function normalizarTextoCorel(texto: string | null | undefined): string {
  const linhas = String(texto ?? "")
    .replace(QUEBRAS_COREL, NL)
    .split(NL)
    .map((l) => l.replace(ESPACOS, " ").trim());
  while (linhas.length && !linhas[linhas.length - 1]) linhas.pop();
  while (linhas.length && !linhas[0]) linhas.shift();
  return linhas.join(NL);
}

function chaveNome(nome: string): string {
  return nome.trim().toLowerCase().replace(/\s+/g, "");
}

export function slugObjeto(nome: string): string {
  const slug = nome
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || "campo";
}

/** Valor escolhido por ocorrência: chave `${campo}#${indice}`. */
export function chaveEscolha(campo: string, indice: number): string {
  return `${campo}#${indice}`;
}

/** Valor inicial do modal: o texto que já está no Corel (produto real). */
export function escolhasIniciais(
  diferencas: PapelariaCorelDiferenca[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dif of diferencas) {
    (dif.ocorrencias ?? []).forEach((oc, i) => {
      out[chaveEscolha(dif.campo, i)] = oc.original;
    });
  }
  return out;
}

export function escolherTodos(
  diferencas: PapelariaCorelDiferenca[],
  origem: "original" | "novo",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dif of diferencas) {
    (dif.ocorrencias ?? []).forEach((oc, i) => {
      out[chaveEscolha(dif.campo, i)] = origem === "original" ? oc.original : oc.novo;
    });
  }
  return out;
}

function linhas(texto: string): number {
  return Math.max(2, Math.min(8, texto.split("\n").length));
}

/**
 * Monta os campos do produto a partir das escolhas do modal.
 *
 * Objeto em que todas as ocorrências ficam iguais ao que o formulário
 * aplicaria continua usando o template do modelo; os demais viram campos do
 * produto (um por ocorrência). Objetos do produto anterior que não aparecem
 * nas diferenças são mantidos.
 */
export function construirCamposProduto(
  diferencas: PapelariaCorelDiferenca[],
  escolhas: Record<string, string>,
  opts: { arquivo?: string | null; anterior?: PapelariaCamposProduto | null } = {},
): { camposProduto: PapelariaCamposProduto | null; valores: Record<string, string> } {
  const anterior = opts.anterior ?? null;
  const objetos: Record<string, PapelariaCamposProdutoEntrada[]> = {};
  const campos: PapelariaField[] = [];
  const valores: Record<string, string> = {};
  const usadas = new Set<string>();
  const nomesDif = new Set(diferencas.map((d) => chaveNome(d.campo)));

  for (const [nome, entradas] of Object.entries(anterior?.objetos ?? {})) {
    if (nomesDif.has(chaveNome(nome))) continue;
    objetos[nome] = entradas;
    for (const e of entradas) {
      usadas.add(e.key);
      const def = anterior?.campos.find((c) => c.key === e.key);
      if (def) campos.push(def);
    }
  }

  for (const dif of diferencas) {
    const ocs = dif.ocorrencias ?? [];
    if (dif.editavel === false || ocs.length === 0) continue;
    const finais = ocs.map((oc, i) => escolhas[chaveEscolha(dif.campo, i)] ?? oc.original);
    const igualFormulario = ocs.every(
      (oc, i) =>
        !oc.key &&
        normalizarTextoCorel(finais[i]) === normalizarTextoCorel(oc.novo),
    );
    if (igualFormulario) continue;

    let n = 1;
    const entradas: PapelariaCamposProdutoEntrada[] = [];
    ocs.forEach((oc, i) => {
      let key = oc.key ?? "";
      if (!key || usadas.has(key)) {
        do {
          key = `obj_${slugObjeto(dif.campo)}_${n++}`;
        } while (usadas.has(key));
      }
      usadas.add(key);
      entradas.push({
        face: oc.face,
        x: Number(oc.x ?? 0),
        y: Number(oc.y ?? 0),
        key,
      });
      const valor = finais[i] ?? "";
      valores[key] = valor;
      campos.push({
        key,
        label: `${dif.rotulo} — ${oc.rotulo}`,
        type: "textarea",
        rows: linhas(valor),
      });
    });
    objetos[dif.campo] = entradas;
  }

  if (Object.keys(objetos).length === 0) {
    return { camposProduto: null, valores };
  }
  return {
    camposProduto: {
      arquivo: opts.arquivo ?? anterior?.arquivo ?? "",
      objetos,
      campos,
    },
    valores,
  };
}

const VAR_RE = /\{([^{}]+)\}/g;
const DERIVADAS = new Set(["artigo", "genero_curto"]);

function variaveis(template: string): Set<string> {
  const out = new Set<string>();
  for (const m of String(template ?? "").matchAll(VAR_RE)) {
    const v = m[1].trim() === "nome_acessor" ? "nome_assessor" : m[1].trim();
    if (!DERIVADAS.has(v)) out.add(v);
  }
  return out;
}

/** Variáveis usadas só por objetos que viraram campos do produto. */
export function variaveisOcultas(
  camposModelo: Record<string, string> | null | undefined,
  produto: PapelariaCamposProduto | null | undefined,
): Set<string> {
  if (!produto) return new Set();
  const tirar = new Set(Object.keys(produto.objetos).map(chaveNome));
  const usadas = new Set<string>();
  const tiradas = new Set<string>();
  for (const [nome, tpl] of Object.entries(camposModelo ?? {})) {
    const alvo = tirar.has(chaveNome(nome)) ? tiradas : usadas;
    for (const v of variaveis(tpl)) alvo.add(v);
  }
  return new Set([...tiradas].filter((v) => !usadas.has(v)));
}

/** Campos exibidos: modelo sem as variáveis ocultas + campos do produto. */
export function camposVisiveis(
  camposFormulario: PapelariaField[] | null | undefined,
  camposModelo: Record<string, string> | null | undefined,
  produto: PapelariaCamposProduto | null | undefined,
): PapelariaField[] {
  if (!produto) return camposFormulario ?? [];
  const ocultas = variaveisOcultas(camposModelo, produto);
  return [
    ...(camposFormulario ?? []).filter((f) => !ocultas.has(f.key)),
    ...produto.campos,
  ];
}

/** Templates do modelo com os objetos do produto apontando para seus campos (prévia textual). */
export function camposModeloComProduto(
  camposModelo: Record<string, string> | null | undefined,
  produto: PapelariaCamposProduto | null | undefined,
): Record<string, string> {
  const out = { ...(camposModelo ?? {}) };
  if (!produto) return out;
  for (const [nome, entradas] of Object.entries(produto.objetos)) {
    const alvo = Object.keys(out).find((k) => chaveNome(k) === chaveNome(nome)) ?? nome;
    const frente = entradas.filter((e) => e.face === "Frente");
    const verso = entradas.filter((e) => e.face === "Verso");
    out[alvo] =
      frente.length === 1 && verso.length === 1 && entradas.length === 2
        ? `Frente:\n{${frente[0].key}}\nVerso:\n{${verso[0].key}}`
        : entradas.map((e) => `{${e.key}}`).join("\n");
  }
  return out;
}

function faceIndex(face: string): number {
  if (face === "Frente") return 0;
  if (face === "Verso") return 1;
  const m = /^Página (\d+)$/.exec(face);
  return m ? Number(m[1]) - 1 : 0;
}

/** Prévia ao vivo: elemento do objeto passa a mostrar o campo da sua face. */
export function previewConfigComProduto(
  previewConfigJson: string | null | undefined,
  produto: PapelariaCamposProduto | null | undefined,
): string | null | undefined {
  if (!previewConfigJson || !produto) return previewConfigJson;
  let cfg: { faces?: Array<{ elementos?: Array<{ id?: string; template?: string }> }> };
  try {
    cfg = JSON.parse(previewConfigJson);
  } catch {
    return previewConfigJson;
  }
  const porNome = new Map(
    Object.entries(produto.objetos).map(([n, l]) => [chaveNome(n), l]),
  );
  (cfg.faces ?? []).forEach((face, idx) => {
    for (const el of face.elementos ?? []) {
      const lista = porNome.get(chaveNome(String(el.id ?? "")));
      if (!lista?.length) continue;
      const daFace = lista.filter((e) => faceIndex(e.face) === idx);
      el.template = `{${(daFace[0] ?? lista[0]).key}}`;
    }
  });
  return JSON.stringify(cfg);
}

/** Remove do formulário os valores dos campos do produto (voltar ao modelo). */
export function semValoresDoProduto(
  valores: Record<string, string>,
  produto: PapelariaCamposProduto | null | undefined,
): Record<string, string> {
  if (!produto) return valores;
  const chaves = new Set(produto.campos.map((c) => c.key));
  return Object.fromEntries(Object.entries(valores).filter(([k]) => !chaves.has(k)));
}
