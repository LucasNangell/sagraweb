import { formatDateForInput } from "@/lib/format";
import type { FormatoLookupItem } from "./formatoDimensions";
import { resolveFormatoDimensions } from "./formatoDimensions";
import { classifyCoresKind } from "./techSpec";
import type { GerenciaFormState, GerenciaOsDetails } from "./types";

export { formatDateForInput };

export function toCheck(val: unknown): boolean {
  if (typeof val === "string") {
    const v = val.toLowerCase().trim();
    return v === "1" || v === "true" || v === "sim" || v === "s";
  }
  return val === 1 || val === true;
}

export function strField(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

/** Cota estimada: arredonda para cima e exibe sem casas decimais (pt-BR: 1.234). */
export function formatCotaEstimada(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return Math.ceil(value).toLocaleString("pt-BR");
}

/** Converte valor exibido (pt-BR, inteiro) de volta para número (save/API). */
export function parseCotaEstimadaValue(raw: string): number {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return 0;
  const n = parseFloat(trimmed.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function formatCotaEstimadaFromUnknown(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return formatCotaEstimada(value);
  const n = parseCotaEstimadaValue(String(value));
  if (!Number.isFinite(n)) return strField(value);
  return formatCotaEstimada(n);
}

function joinCapaMioloValues(...values: string[]): string {
  return values.map((v) => v.trim()).filter(Boolean).join(", ");
}

/** Monta PapelDescricao a partir dos papéis selecionados em Capa/Miolo. */
export function buildPapelDescFromCapaMiolo(
  form: Pick<
    GerenciaFormState,
    "val_papel_capa1" | "val_papel_capa2" | "val_papel_mio" | "val_papel_mio2"
  >,
): string {
  const capa = joinCapaMioloValues(
    form.val_papel_capa1,
    form.val_papel_capa2,
  );
  const miolo = joinCapaMioloValues(form.val_papel_mio, form.val_papel_mio2);
  const parts: string[] = [];
  if (capa) parts.push(`Capa: ${capa}`);
  if (miolo) parts.push(`Miolo: ${miolo}`);
  return parts.join(", ");
}

/** Monta CoresDescricao a partir das cores selecionadas em Capa/Miolo. */
export function buildCoresDescFromCapaMiolo(
  form: Pick<
    GerenciaFormState,
    "val_cores_capa1" | "val_cores_capa2" | "val_cores_mio" | "val_cores_mio2"
  >,
): string {
  const capa = joinCapaMioloValues(form.val_cores_capa1, form.val_cores_capa2);
  const miolo = joinCapaMioloValues(form.val_cores_mio, form.val_cores_mio2);
  const parts: string[] = [];
  if (capa) parts.push(`Capa: ${capa}`);
  if (miolo) parts.push(`Miolo: ${miolo}`);
  return parts.join(", ");
}

const PAPEL_CAPA_MIOLO_KEYS = [
  "val_papel_capa1",
  "val_papel_capa2",
  "val_papel_mio",
  "val_papel_mio2",
] as const;

const CORES_CAPA_MIOLO_KEYS = [
  "val_cores_capa1",
  "val_cores_capa2",
  "val_cores_mio",
  "val_cores_mio2",
] as const;

export function isPapelCapaMioloKey(
  key: keyof GerenciaFormState,
): key is (typeof PAPEL_CAPA_MIOLO_KEYS)[number] {
  return (PAPEL_CAPA_MIOLO_KEYS as readonly string[]).includes(key);
}

export function isCoresCapaMioloKey(
  key: keyof GerenciaFormState,
): key is (typeof CORES_CAPA_MIOLO_KEYS)[number] {
  return (CORES_CAPA_MIOLO_KEYS as readonly string[]).includes(key);
}

/** Atualiza txt_papel_desc / txt_cores_desc quando um campo Capa/Miolo muda. */
/** Preenche altura/largura quando o formato é pré-definido ou contém medidas (ex.: 210 x 297). */
export function patchFormatoDimensions(
  prev: GerenciaFormState,
  formato: string,
  predefinidos?: FormatoLookupItem[],
): Partial<GerenciaFormState> {
  const dims = resolveFormatoDimensions(formato, predefinidos);
  if (!dims) {
    return { val_formato: formato };
  }
  return {
    val_formato: formato,
    calc_altura: String(dims.altura),
    calc_largura: String(dims.largura),
  };
}

export function patchCapaMioloDescFields(
  prev: GerenciaFormState,
  key: keyof GerenciaFormState,
  value: GerenciaFormState[keyof GerenciaFormState],
): Partial<GerenciaFormState> {
  const merged = { ...prev, [key]: value } as GerenciaFormState;
  if (isPapelCapaMioloKey(key)) {
    return { [key]: value, txt_papel_desc: buildPapelDescFromCapaMiolo(merged) };
  }
  if (isCoresCapaMioloKey(key)) {
    return { [key]: value, txt_cores_desc: buildCoresDescFromCapaMiolo(merged) };
  }
  return { [key]: value };
}

export function calculateCoefA4(altura: number, largura: number): number {
  const areaA4 = 210 * 297;
  const areaProd = altura * largura;
  if (!areaProd) return 0;
  return areaA4 / areaProd;
}

/** Coeficiente A4 arredondado para 1 casa decimal (usado na exibição e nos cálculos de cota). */
export function roundCoefA4(coef: number): number {
  if (!Number.isFinite(coef) || coef === 0) return 0;
  return Math.round(coef * 10) / 10;
}

/** Exibição pt-BR: separador de milhares "." e 1 casa decimal ",". */
export function formatCoefA4Display(coef: number): string {
  const rounded = roundCoefA4(coef);
  if (rounded === 0) return "0";
  return rounded.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Converte valor exibido (pt-BR) de volta para número (save/API). */
export function parseCoefA4Value(raw: string): number {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return 0;
  const n = parseFloat(trimmed.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const PAPELARIA_OS_MIN = 5000;

let gerenciaCoefA4PorProdutoCache: Record<string, number> = {};

/** Mapa produto → coeficiente A4 (papelaria), carregado da API na gerência. */
export function setGerenciaCoefA4PorProduto(
  map: Record<string, number>,
): void {
  gerenciaCoefA4PorProdutoCache = map;
}

type GerenciaCoefA4Form = Pick<
  GerenciaFormState,
  "val_produto" | "calc_altura" | "calc_largura"
>;

/** Produto de papelaria cadastrado em tabCoefA4Produto usa tabela; demais: altura × largura. */
export function resolveGerenciaCoefA4(
  form: GerenciaCoefA4Form,
  coefA4PorProduto?: Record<string, number>,
): number {
  const produto = String(form.val_produto ?? "").trim();
  const map = coefA4PorProduto ?? gerenciaCoefA4PorProdutoCache;
  if (produto) {
    const tableCoef = map[produto];
    if (tableCoef != null && tableCoef > 0) {
      return tableCoef;
    }
  }
  const altura = parseFloat(form.calc_altura || "0") || 0;
  const largura = parseFloat(form.calc_largura || "0") || 0;
  return calculateCoefA4(altura, largura);
}

/** Coeficiente A4 efetivo para cota e tiragem máxima (valor exibido, 1 casa decimal). */
export function resolveGerenciaCoefA4ForCalcs(
  form: GerenciaCoefA4Form,
  coefA4PorProduto?: Record<string, number>,
): number {
  return roundCoefA4(resolveGerenciaCoefA4(form, coefA4PorProduto));
}

const DEPUTADO_POLYCHROME_QUOTA_FACTOR = 4;

type GerenciaPaginasForm = Pick<
  GerenciaFormState,
  | "val_pgs"
  | "calc_capa_color"
  | "calc_capa_pb"
  | "calc_miolo_color"
  | "calc_miolo_pb"
  | "calc_encarte_color"
  | "calc_encarte_pb"
>;

function parseGerenciaPageBreakdown(form: GerenciaPaginasForm) {
  const capaColor = parseInt(form.calc_capa_color || "0", 10) || 0;
  const capaPB = parseInt(form.calc_capa_pb || "0", 10) || 0;
  const mioloColor = parseInt(form.calc_miolo_color || "0", 10) || 0;
  const mioloPB = parseInt(form.calc_miolo_pb || "0", 10) || 0;
  const encarteColor = parseInt(form.calc_encarte_color || "0", 10) || 0;
  const encartePB = parseInt(form.calc_encarte_pb || "0", 10) || 0;
  const color = capaColor + mioloColor + encarteColor;
  const pb = capaPB + mioloPB + encartePB;
  const classified = color + pb;
  const pgsRaw = String(form.val_pgs ?? "").trim();
  const hasPgsField = pgsRaw !== "";
  const parsedPgs = hasPgsField ? parseInt(pgsRaw, 10) || 0 : classified;
  return { color, pb, classified, parsedPgs };
}

type GerenciaCotaForm = GerenciaPaginasForm &
  Pick<
    GerenciaFormState,
    | "req_categoria"
    | "op_os"
    | "val_cores"
    | "txt_cores_desc"
    | "val_cores_capa1"
    | "val_cores_capa2"
    | "val_cores_mio"
    | "val_cores_mio2"
  >;

const GERENCIA_CORES_HINT_KEYS = [
  "val_cores",
  "txt_cores_desc",
  "val_cores_capa1",
  "val_cores_capa2",
  "val_cores_mio",
  "val_cores_mio2",
] as const satisfies readonly (keyof GerenciaCotaForm)[];

/** Infere P/B ou policromia a partir dos campos de cor da OS. */
export function inferCoresKindFromForm(
  form: Pick<GerenciaCotaForm, (typeof GERENCIA_CORES_HINT_KEYS)[number]>,
): "PB" | "COLOR" | null {
  let sawColor = false;
  let sawPb = false;
  for (const key of GERENCIA_CORES_HINT_KEYS) {
    const kind = classifyCoresKind(String(form[key] ?? ""));
    if (kind === "COLOR") sawColor = true;
    if (kind === "PB") sawPb = true;
  }
  if (sawColor) return "COLOR";
  if (sawPb) return "PB";
  return null;
}

function applyDeputadoPolychromeQuota(
  physical: number,
  color: number,
  pb: number,
  coresKind: "PB" | "COLOR" | null,
): number {
  const outras = Math.max(0, physical - color - pb);

  if (color === 0 && pb === 0 && physical > 0) {
    if (coresKind === "COLOR") {
      return physical * DEPUTADO_POLYCHROME_QUOTA_FACTOR;
    }
    return physical;
  }

  let effectiveColor = color;
  let effectivePb = pb;
  if (outras > 0) {
    if (coresKind === "COLOR") effectiveColor += outras;
    else if (coresKind === "PB") effectivePb += outras;
    else effectiveColor += outras;
  }

  return (
    effectivePb + effectiveColor * DEPUTADO_POLYCHROME_QUOTA_FACTOR
  );
}

/** OS reprográfica de Deputado (<5000): policromia consome 4× na cota. */
export function isDeputadoOsQuotaRule(
  form: Pick<GerenciaFormState, "req_categoria" | "op_os">,
): boolean {
  if (form.req_categoria.trim().toLowerCase() !== "deputado") return false;
  const nro = parseInt(String(form.op_os ?? "").trim(), 10);
  return Number.isFinite(nro) && nro > 0 && nro < PAPELARIA_OS_MIN;
}

export function getGerenciaTotalPaginas(
  form: GerenciaPaginasForm,
  options?: { totalPaginas?: number },
): number {
  const { parsedPgs } = parseGerenciaPageBreakdown(form);
  return options?.totalPaginas ?? parsedPgs;
}

/** Páginas efetivas para cota/tiragem máxima (policromia ×4 só em OS Deputado <5000). */
export function getGerenciaCotaPaginas(
  form: GerenciaCotaForm,
  options?: { totalPaginas?: number },
): number {
  const physical = getGerenciaTotalPaginas(form, options);
  if (!isDeputadoOsQuotaRule(form)) return physical;

  const { color, pb } = parseGerenciaPageBreakdown(form);
  return applyDeputadoPolychromeQuota(
    physical,
    color,
    pb,
    inferCoresKindFromForm(form),
  );
}

/** Tiragem máxima possível com a cota informada: cota = (páginas × tiragem) / coef → tiragem = (cota × coef) / páginas */
export function calculateMaxTiragemFromCota(
  cotaAtual: number,
  totalPaginas: number,
  coef: number,
): number {
  if (!cotaAtual || !totalPaginas || !coef) return 0;
  return Math.floor((cotaAtual * coef) / totalPaginas);
}

export function parseCotaAtualValue(raw: string): number {
  const n = parseCotaEstimadaValue(raw);
  return n > 0 ? n : 0;
}

export function computeTiragemMaximaFromForm(
  form: Pick<
    GerenciaFormState,
    | "op_cota_atual"
    | "req_categoria"
    | "op_os"
    | "val_produto"
    | "val_pgs"
    | "calc_capa_color"
    | "calc_capa_pb"
    | "calc_miolo_color"
    | "calc_miolo_pb"
    | "calc_encarte_color"
    | "calc_encarte_pb"
    | "calc_altura"
    | "calc_largura"
    | "val_cores"
    | "txt_cores_desc"
    | "val_cores_capa1"
    | "val_cores_capa2"
    | "val_cores_mio"
    | "val_cores_mio2"
  >,
): string {
  const cota = parseCotaAtualValue(form.op_cota_atual);
  if (!cota) return "";
  const totalPaginas = getGerenciaCotaPaginas(form);
  const coef = resolveGerenciaCoefA4ForCalcs(form);
  const max = calculateMaxTiragemFromCota(cota, totalPaginas, coef);
  return max > 0 ? String(max) : "";
}

/** Aplica tiragem máxima em final, detalhes técnicos e cálculos. */
export function applyUsarTodaCota(
  form: GerenciaFormState,
): Partial<GerenciaFormState> {
  const tiragemMax = computeTiragemMaximaFromForm(form);
  if (!tiragemMax) return {};
  const merged: GerenciaFormState = {
    ...form,
    op_tiragem_pret: tiragemMax,
    op_tiragem_final: tiragemMax,
    val_tiragem: tiragemMax,
    calc_tiragem: tiragemMax,
  };
  return {
    op_tiragem_pret: tiragemMax,
    op_tiragem_final: tiragemMax,
    val_tiragem: tiragemMax,
    calc_tiragem: tiragemMax,
    ...recalculateGerenciaCalcs(merged),
  };
}

export function patchTiragemMaximaFromCota(
  form: GerenciaFormState,
): Partial<GerenciaFormState> {
  if (!form.op_cota_atual.trim()) return {};
  return { op_tiragem_pret: computeTiragemMaximaFromForm(form) };
}

export function recalculateGerenciaCalcs(
  form: Pick<
    GerenciaFormState,
    | "req_categoria"
    | "op_os"
    | "val_produto"
    | "val_pgs"
    | "calc_capa_color"
    | "calc_capa_pb"
    | "calc_miolo_color"
    | "calc_miolo_pb"
    | "calc_encarte_color"
    | "calc_encarte_pb"
    | "calc_tiragem"
    | "calc_altura"
    | "calc_largura"
    | "val_cores"
    | "txt_cores_desc"
    | "val_cores_capa1"
    | "val_cores_capa2"
    | "val_cores_mio"
    | "val_cores_mio2"
  >,
  options?: { totalPaginas?: number },
): Pick<GerenciaFormState, "calc_total_paginas" | "calc_coef_a4" | "calc_cota_total"> {
  const totalPaginas = getGerenciaTotalPaginas(form, options);
  const cotaPaginas = getGerenciaCotaPaginas(form, options);
  const tiragem = parseFloat(form.calc_tiragem || "0") || 0;
  const rawCoef = resolveGerenciaCoefA4(form);
  const coef = roundCoefA4(rawCoef);
  const cota = coef ? (cotaPaginas * tiragem) / coef : 0;

  return {
    calc_total_paginas: String(totalPaginas),
    calc_coef_a4: formatCoefA4Display(rawCoef),
    calc_cota_total: Number.isFinite(cota) ? formatCotaEstimada(cota) : "0",
  };
}

export function detailsToForm(data: GerenciaOsDetails): Partial<GerenciaFormState> {
  const calc = data.Calculos;
  return {
    req_codigo: strField(data.CodigoRequisicao),
    req_categoria: strField(data.CategoriaLink),
    req_solicitante: strField(data.NomeUsuario),
    req_titular: strField(data.Titular),
    req_orgao_interessado: strField(data.OrgInteressado),
    req_sigla: strField(data.SiglaOrgao),
    req_gabinete: strField(data.GabSalaUsuario),
    req_andar: strField(data.Andar),
    req_local: strField(data.Localizacao),
    req_ramal: strField(data.RamalUsuario),

    op_os: strField(data.NroProtocolo),
    op_ano: strField(data.AnoProtocolo),
    op_data_entrada: formatDateForInput(data.DataEntrada ?? undefined),
    op_processo: strField(data.ProcessoSolicit),
    op_cs: strField(data.CSnro),
    op_tiragem_pret: strField(data.TiragemSolicitada),
    op_tiragem_final: strField(data.TiragemFinal),

    val_titulo: strField(data.Titulo),
    val_produto: strField(data.TipoPublicacaoLink),
    val_formato: strField(data.FormatoLink),
    val_maquina: strField(data.MaquinaLink),
    val_tiragem: strField(data.Tiragem),
    val_pgs: strField(data.Pags),
    chk_fv: toCheck(data.FrenteVerso),
    val_modelos: strField(data.ModelosArq),
    val_prioridade: strField(data.EntregPrazoLink) || "Normal",
    val_data: formatDateForInput(data.EntregData ?? undefined),

    val_papel: strField(data.PapelLink),
    txt_papel_desc: strField(data.PapelDescricao),
    val_cores: strField(data.Cores),
    txt_cores_desc: strField(data.CoresDescricao),
    txt_acabamento: strField(data.DescAcabamento),
    txt_obs: strField(data.Observ),
    txt_contato: strField(data.ContatoTrab),

    mat_amostra: toCheck(data.MaterialFornecido),
    mat_fotolito: toCheck(data.Fotolito),
    mat_dobra: toCheck(data.ModeloDobra),
    mat_original: toCheck(data.ProvaImpressa),
    mat_insumos: strField(data.InsumosFornecidos),

    el_brasao: toCheck(data.ElemGrafBrasao),
    el_timbre: toCheck(data.ElemGrafTimbre),
    el_arte: toCheck(data.ElemGrafArteGab),
    el_assinatura: toCheck(data.ElemGrafAssinatura),

    calc_capa_color: calc ? strField(calc.capa_color) : "",
    calc_capa_pb: calc ? strField(calc.capa_pb) : "",
    calc_miolo_color: calc ? strField(calc.miolo_color) : "",
    calc_miolo_pb: calc ? strField(calc.miolo_pb) : "",
    calc_encarte_color: calc ? strField(calc.encarte_color) : "",
    calc_encarte_pb: calc ? strField(calc.encarte_pb) : "",
    calc_altura: calc ? strField(calc.altura_mm) : "",
    calc_largura: calc ? strField(calc.largura_mm) : "",
    calc_tiragem: calc ? strField(calc.tiragem) : strField(data.Tiragem),
    calc_cota_total:
      calc?.cota_total != null && String(calc.cota_total).trim() !== ""
        ? formatCotaEstimadaFromUnknown(calc.cota_total)
        : (() => {
            const cota = data.CotaRepro;
            return cota != null && cota !== ""
              ? formatCotaEstimadaFromUnknown(cota)
              : "";
          })(),
    chk_debitar_cgraf: toCheck(data.DebitarCGRAF),
    ...(data.CotaAtualSaldo != null &&
    Number.isFinite(Number(data.CotaAtualSaldo)) &&
    Number(data.CotaAtualSaldo) >= 0
      ? { op_cota_atual: formatCotaEstimada(Number(data.CotaAtualSaldo)) }
      : {}),
  };
}
