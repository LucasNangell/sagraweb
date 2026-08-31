import type { GerenciaFormState } from "./types";

export type ComponenteTipo = "CAPA" | "MIOLO" | "ENCARTE";

export const GENERICO_NOME = "Arquivo";

export interface TechSpecAcabamento {
  catalog_id?: number;
  label: string;
  variacao_id?: number;
  variacao_label?: string;
  obs?: string;
}

export interface TechSpecLote {
  id: string;
  paginas: number;
  maquina_link: string;
  papel_link: string;
  cores_link: string;
  papel_desc: string;
  cores_desc: string;
  /** Frente/verso em cores, ex. 4/0, 1/1, 4/4. */
  impressao?: string;
  frente_verso: boolean;
  acabamentos: TechSpecAcabamento[];
}

export interface TechSpecComponente {
  /** ID estável no MySQL (tab_os_componentes). */
  componente_id?: number;
  /** Nome livre exibido ao usuário. */
  nome: string;
  /** Slot legado CAPA/MIOLO/ENCARTE (opcional). */
  tipo?: ComponenteTipo;
  lotes: TechSpecLote[];
  /** Acabamentos do memo DescAcabamento rotulado (não são o específico do lote). */
  acabamentos?: TechSpecAcabamento[];
  /** Legado (capa): migrado para impressao N/0. Não gravar em saves novos. */
  verso_em_branco?: boolean;
}

export interface TechSpec {
  version: 1;
  componentes: TechSpecComponente[];
  /** Inclusão pelo campo OS Acabamentos — aplica-se a todos os componentes. */
  acabamentosGerais?: TechSpecAcabamento[];
}

export const COMPONENTE_TIPOS: ComponenteTipo[] = ["CAPA", "MIOLO", "ENCARTE"];

export const COMPONENTE_LABELS: Record<ComponenteTipo, string> = {
  CAPA: "Capa",
  MIOLO: "Miolo",
  ENCARTE: "Encarte",
};

let loteIdCounter = 0;

export function newLoteId(): string {
  loteIdCounter += 1;
  return `lote_${Date.now()}_${loteIdCounter}`;
}

export function createDefaultLote(maquinaLink = ""): TechSpecLote {
  return {
    id: newLoteId(),
    paginas: 0,
    maquina_link: maquinaLink,
    papel_link: "",
    cores_link: "",
    papel_desc: "",
    cores_desc: "",
    impressao: "",
    frente_verso: false,
    acabamentos: [],
  };
}

export function createEmptyTechSpec(): TechSpec {
  return { version: 1, componentes: [], acabamentosGerais: [] };
}

export function getComponenteLabel(comp: TechSpecComponente): string {
  const nome = (comp.nome || "").trim();
  if (nome) return nome;
  if (comp.tipo) return COMPONENTE_LABELS[comp.tipo];
  return "Componente";
}

export function getComponenteKey(comp: TechSpecComponente): string {
  if (comp.componente_id != null) return `id:${comp.componente_id}`;
  if (comp.tipo) return `tipo:${comp.tipo}`;
  return `nome:${comp.nome}`;
}

export function createComponente(
  tipo: ComponenteTipo,
  options?: { paginasInicial?: number },
): TechSpecComponente {
  const lote = createDefaultLote();
  if (tipo === "CAPA") {
    lote.paginas = 4;
  } else if (options?.paginasInicial != null && options.paginasInicial > 0) {
    lote.paginas = options.paginasInicial;
  }
  return { nome: COMPONENTE_LABELS[tipo], tipo, lotes: [lote] };
}

export function createNamedComponente(
  nome: string,
  options?: { paginasInicial?: number },
): TechSpecComponente {
  const lote = createDefaultLote();
  if (options?.paginasInicial != null && options.paginasInicial > 0) {
    lote.paginas = options.paginasInicial;
  }
  return { nome: nome.trim(), lotes: [lote] };
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Máquina OS "A/B" com Capa+Miolo: esquerda = capa, direita = miolo.
 * Sufixo curto sem dígito herda o prefixo ("Digital Cor/PB" → Digital PB).
 */
export function splitCapaMioloMaquina(
  raw: string,
): { capa: string; miolo: string } | null {
  const trimmed = raw.trim();
  const idx = trimmed.indexOf("/");
  if (idx <= 0 || idx >= trimmed.length - 1) return null;
  const capa = trimmed.slice(0, idx).trim();
  const right = trimmed.slice(idx + 1).trim();
  if (!capa || !right) return null;

  const leftParts = capa.split(/\s+/).filter(Boolean);
  const prefix = leftParts.slice(0, -1).join(" ");
  const inheritPrefix =
    Boolean(prefix) &&
    !right.includes(" ") &&
    !/\d/.test(right) &&
    !stripAccents(right)
      .toLowerCase()
      .startsWith(stripAccents(prefix).toLowerCase());
  const miolo = inheritPrefix ? `${prefix} ${right}`.trim() : right;
  return { capa, miolo };
}

function maquinaForTipo(osMaquina: string, tipo?: ComponenteTipo): string {
  const combined = osMaquina.trim();
  const split = splitCapaMioloMaquina(combined);
  if (split && tipo === "CAPA") return split.capa;
  if (split && tipo === "MIOLO") return split.miolo;
  return combined;
}

function maquinaLooksCombined(value: string, osCombined: string): boolean {
  const current = value.trim();
  if (!current) return true;
  if (current === osCombined.trim()) return true;
  return current.includes("/");
}

function applyCapaMioloMaquinaSplit(spec: TechSpec, osMaquina: string): TechSpec {
  const split = splitCapaMioloMaquina(osMaquina);
  if (!split) return spec;
  const hasCapa = spec.componentes.some((c) => c.tipo === "CAPA");
  const hasMiolo = spec.componentes.some((c) => c.tipo === "MIOLO");
  if (!hasCapa || !hasMiolo) return spec;

  return {
    ...spec,
    componentes: spec.componentes.map((comp) => {
      if (comp.tipo !== "CAPA" && comp.tipo !== "MIOLO") return comp;
      const next = comp.tipo === "CAPA" ? split.capa : split.miolo;
      return {
        ...comp,
        lotes: comp.lotes.map((lote) =>
          maquinaLooksCombined(lote.maquina_link, osMaquina)
            ? { ...lote, maquina_link: next }
            : lote,
        ),
      };
    }),
  };
}

export function isGenericoComponente(comp: TechSpecComponente): boolean {
  const nome = stripAccents((comp.nome || "").trim()).toLowerCase();
  return nome === "arquivo" || nome === "generico";
}

export function hasGenericoComponente(spec: TechSpec): boolean {
  return spec.componentes.some(isGenericoComponente);
}

export function createGenericoComponente(options?: {
  paginas?: number;
  maquina?: string;
  papel?: string;
  cores?: string;
  papelDesc?: string;
  coresDesc?: string;
  frenteVerso?: boolean;
}): TechSpecComponente {
  const lote = createDefaultLote(options?.maquina ?? "");
  lote.paginas = options?.paginas && options.paginas > 0 ? options.paginas : 0;
  lote.papel_link = options?.papel ?? "";
  lote.cores_link = options?.cores ?? "";
  lote.papel_desc = options?.papelDesc ?? "";
  lote.cores_desc = options?.coresDesc ?? "";
  lote.frente_verso = Boolean(options?.frenteVerso);
  lote.impressao = inferImpressaoFromLote(lote);
  return {
    nome: GENERICO_NOME,
    lotes: [lote],
  };
}

export function acabamentoKey(item: TechSpecAcabamento): string {
  if (item.variacao_id != null) return `v:${item.variacao_id}`;
  if (item.catalog_id != null) return `c:${item.catalog_id}`;
  return `l:${item.label}`;
}

function mergeAcabamentos(
  ...lists: Array<TechSpecAcabamento[] | undefined>
): TechSpecAcabamento[] {
  const out: TechSpecAcabamento[] = [];
  const seen = new Map<string, number>();
  for (const list of lists) {
    for (const item of list ?? []) {
      const normalized = normalizeAcabamento(item);
      if (!normalized) continue;
      const key = acabamentoKey(normalized);
      const existingIdx = seen.get(key);
      if (existingIdx != null) {
        if (!out[existingIdx].obs && normalized.obs) {
          out[existingIdx] = { ...out[existingIdx], obs: normalized.obs };
        }
        continue;
      }
      seen.set(key, out.length);
      out.push(normalized);
    }
  }
  return out;
}

export function lotePapelValue(lote: Pick<TechSpecLote, "papel_link" | "papel_desc">): string {
  return (lote.papel_link || lote.papel_desc || "").trim();
}

export function loteCoresValue(lote: Pick<TechSpecLote, "cores_link" | "cores_desc">): string {
  return (lote.cores_link || lote.cores_desc || "").trim();
}

const IMPRESSAO_XY_RE = /(\d)\s*[xX×/]\s*(\d)/;

export type ImpressaoSpec = { frente: number; verso: number };

export const IMPRESSAO_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let frente = 1; frente <= 4; frente += 1) {
    for (let verso = 0; verso <= 4; verso += 1) {
      out.push(`${frente}/${verso}`);
    }
  }
  return out;
})();

export function parseImpressao(raw: string | undefined | null): ImpressaoSpec | null {
  if (!raw) return null;
  const match = IMPRESSAO_XY_RE.exec(String(raw).replace(/\s/g, ""));
  if (!match) return null;
  const frente = Number(match[1]);
  const verso = Number(match[2]);
  if (frente < 1 || frente > 4 || verso < 0 || verso > 4) return null;
  return { frente, verso };
}

export function formatImpressao(frente: number, verso: number): string {
  return `${frente}/${verso}`;
}

export function flagsFromImpressao(value: string): {
  cor: boolean;
  frente_verso: boolean;
  verso_cor: boolean;
} {
  const parsed = parseImpressao(value);
  if (!parsed) return { cor: false, frente_verso: false, verso_cor: false };
  return {
    cor: parsed.frente >= 4,
    frente_verso: parsed.verso > 0,
    verso_cor: parsed.verso >= 4,
  };
}

export function impressaoFromFlags(
  cor: boolean,
  frenteVerso: boolean,
  versoCor: boolean,
): string {
  const frente = cor ? 4 : 1;
  const verso = !frenteVerso ? 0 : versoCor ? 4 : 1;
  return formatImpressao(frente, verso);
}

function frenteFromCoresKind(kind: "PB" | "COLOR" | null): number {
  return kind === "COLOR" ? 4 : 1;
}

/** Infere N/M a partir do catálogo de cores, F/V e flag legado verso em branco. */
export function inferImpressaoFromLote(
  lote: Pick<
    TechSpecLote,
    "impressao" | "cores_link" | "cores_desc" | "frente_verso"
  >,
  options?: { versoEmBranco?: boolean },
): string {
  const explicit = parseImpressao(lote.impressao);
  if (explicit) return formatImpressao(explicit.frente, explicit.verso);

  const coresText = loteCoresValue(lote);
  if (options?.versoEmBranco) {
    return formatImpressao(frenteFromCoresKind(classifyCoresKind(coresText)), 0);
  }

  const fromCores = parseImpressao(coresText);
  if (fromCores) return formatImpressao(fromCores.frente, fromCores.verso);

  const kind = classifyCoresKind(coresText);
  if (!kind) return "";
  const frente = frenteFromCoresKind(kind);
  return formatImpressao(frente, lote.frente_verso ? frente : 0);
}

/** Ao mudar o catálogo de cores: 4x4/1x1 vira N/M; senão só o dígito da frente. */
export function impressaoAfterCoresChange(
  lote: Pick<TechSpecLote, "impressao" | "frente_verso">,
  coresValue: string,
): string {
  const fromCatalog = parseImpressao(coresValue);
  if (fromCatalog) return formatImpressao(fromCatalog.frente, fromCatalog.verso);
  const kind = classifyCoresKind(coresValue);
  if (!kind) return lote.impressao?.trim() || "";
  const current = parseImpressao(lote.impressao);
  if (kind === "PB") {
    const verso = current && current.verso > 0 ? 1 : lote.frente_verso ? 1 : 0;
    return formatImpressao(1, verso);
  }
  const frente = 4;
  const verso = current ? current.verso : lote.frente_verso ? frente : 0;
  return formatImpressao(frente, verso);
}

/** Ao marcar/desmarcar F/V: verso 0 ou, se ligar, o verso anterior (ou igual à frente). */
export function impressaoAfterFvChange(
  lote: Pick<TechSpecLote, "impressao" | "cores_link" | "cores_desc">,
  frenteVerso: boolean,
): string {
  const current =
    parseImpressao(lote.impressao) || parseImpressao(loteCoresValue(lote));
  const kind = classifyCoresKind(loteCoresValue(lote));
  const frente = current?.frente ?? frenteFromCoresKind(kind);
  if (!frenteVerso) return formatImpressao(frente, 0);
  const verso = current && current.verso > 0 ? current.verso : frente;
  return formatImpressao(frente, verso);
}

export function loteIsVersoZero(
  lote: Pick<TechSpecLote, "impressao" | "cores_link" | "cores_desc">,
  comp?: Pick<TechSpecComponente, "tipo" | "verso_em_branco">,
): boolean {
  const explicit = parseImpressao(lote.impressao);
  if (explicit) return explicit.verso === 0;
  if (comp?.verso_em_branco) return true;
  const fromCores = parseImpressao(lote.cores_link) || parseImpressao(lote.cores_desc);
  return fromCores != null && fromCores.verso === 0;
}

export interface LabeledMemoSegment {
  tipo?: ComponenteTipo;
  nome: string;
  value: string;
}

const LABEL_TO_TIPO: Record<string, ComponenteTipo> = {
  capa: "CAPA",
  miolo: "MIOLO",
  encarte: "ENCARTE",
};

/** Quebra memos Access (`Capa: …` / `Miolo: …`) em segmentos por componente. */
export function parseLabeledMemo(text: string | undefined): LabeledMemoSegment[] {
  const src = String(text ?? "").trim();
  if (!src) return [];
  const re = /(Capa|Miolo|Encarte)\s*:/gi;
  const hits: { index: number; tipo: ComponenteTipo; nome: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const tipo = LABEL_TO_TIPO[match[1].toLowerCase()];
    if (!tipo) continue;
    hits.push({
      index: match.index,
      tipo,
      nome: COMPONENTE_LABELS[tipo],
    });
  }
  if (!hits.length) return [];
  const segments: LabeledMemoSegment[] = [];
  for (let i = 0; i < hits.length; i++) {
    const colonAt = src.indexOf(":", hits[i].index);
    const start = colonAt >= 0 ? colonAt + 1 : hits[i].index;
    const end = i + 1 < hits.length ? hits[i + 1].index : src.length;
    const value = src
      .slice(start, end)
      .replace(/^[|\s,;]+|[|\s,;]+$/g, "")
      .trim();
    if (value) {
      segments.push({ tipo: hits[i].tipo, nome: hits[i].nome, value });
    }
  }
  return segments;
}

export function memoHasComponentLabels(text: string | undefined): boolean {
  return parseLabeledMemo(text).length > 0;
}

function unlabeledMemoRemainder(text: string | undefined): string {
  const src = String(text ?? "").trim();
  if (!src) return "";
  const segments = parseLabeledMemo(src);
  if (!segments.length) return src;
  let rest = src;
  for (const seg of segments) {
    const re = new RegExp(
      `${seg.nome}\\s*:\\s*${seg.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "i",
    );
    rest = rest.replace(re, " ");
  }
  return rest.replace(/[|\s,;]+/g, " ").trim();
}

function labelsToAcabamentos(value: string): TechSpecAcabamento[] {
  return value
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((label) => ({ label }));
}

function findOrCreateComponent(
  componentes: TechSpecComponente[],
  seg: LabeledMemoSegment,
  maquina: string,
): TechSpecComponente {
  const existing = componentes.find(
    (c) => c.tipo === seg.tipo || stripAccents(c.nome).toLowerCase() === stripAccents(seg.nome).toLowerCase(),
  );
  if (existing) return existing;
  const created = seg.tipo
    ? createComponente(seg.tipo)
    : createNamedComponente(seg.nome);
  if (maquina && !created.lotes[0].maquina_link) {
    created.lotes[0].maquina_link = maquina;
  }
  componentes.push(created);
  return created;
}

function assignParsedField(
  lote: TechSpecLote,
  kind: "papel" | "cores",
  value: string,
  catalogFallback: string,
): void {
  const trimmed = value.trim();
  if (!trimmed) {
    if (kind === "papel" && catalogFallback && !lote.papel_link && !lote.papel_desc) {
      lote.papel_link = catalogFallback;
    }
    if (kind === "cores" && catalogFallback && !lote.cores_link && !lote.cores_desc) {
      lote.cores_link = catalogFallback;
    }
    return;
  }
  if (kind === "papel") {
    lote.papel_desc = trimmed;
    lote.papel_link = "";
  } else {
    lote.cores_desc = trimmed;
    lote.cores_link = "";
  }
}

function parseComponentesFromPapelCores(
  form: Pick<
    GerenciaFormState,
    "val_pgs" | "val_papel" | "val_cores" | "val_maquina" | "txt_papel_desc" | "txt_cores_desc" | "chk_fv"
  >,
): TechSpecComponente[] {
  const papelSegs = parseLabeledMemo(form.txt_papel_desc);
  const coresSegs = parseLabeledMemo(form.txt_cores_desc);
  if (!papelSegs.length && !coresSegs.length) return [];

  const componentes: TechSpecComponente[] = [];
  const seen = new Set<ComponenteTipo | string>();
  for (const seg of [...papelSegs, ...coresSegs]) {
    const key = seg.tipo ?? seg.nome;
    if (seen.has(key)) continue;
    seen.add(key);
    findOrCreateComponent(
      componentes,
      seg,
      maquinaForTipo(form.val_maquina, seg.tipo),
    );
  }

  for (const comp of componentes) {
    const lote = comp.lotes[0];
    lote.maquina_link =
      lote.maquina_link || maquinaForTipo(form.val_maquina, comp.tipo);
    lote.frente_verso = Boolean(form.chk_fv);
    const papel = papelSegs.find((s) => s.tipo === comp.tipo || s.nome === comp.nome);
    const cores = coresSegs.find((s) => s.tipo === comp.tipo || s.nome === comp.nome);
    assignParsedField(lote, "papel", papel?.value ?? "", form.val_papel.trim());
    assignParsedField(lote, "cores", cores?.value ?? "", form.val_cores.trim());
    lote.impressao = inferImpressaoFromLote(lote);
  }

  const papelRest = unlabeledMemoRemainder(form.txt_papel_desc);
  const coresRest = unlabeledMemoRemainder(form.txt_cores_desc);
  if (papelRest || coresRest) {
    const gen = createGenericoComponente({
      maquina: form.val_maquina,
      papelDesc: papelRest,
      coresDesc: coresRest,
      frenteVerso: form.chk_fv,
    });
    componentes.push(gen);
  }

  const totalPages = parseInt(String(form.val_pgs || "").trim(), 10) || 0;
  if (componentes.length === 1) {
    if (totalPages > 0 && componentes[0].lotes[0].paginas <= 0) {
      componentes[0].lotes[0].paginas = totalPages;
    }
  } else {
    const capa = componentes.find((c) => c.tipo === "CAPA");
    const miolo = componentes.find((c) => c.tipo === "MIOLO");
    if (capa && capa.lotes[0].paginas <= 0) capa.lotes[0].paginas = 4;
    const used = componentes.reduce(
      (sum, c) => sum + c.lotes.reduce((s, l) => s + (Number(l.paginas) || 0), 0),
      0,
    );
    const leftover = Math.max(0, totalPages - used);
    if (leftover > 0 && miolo && miolo.lotes[0].paginas <= 0) {
      miolo.lotes[0].paginas = leftover;
    }
  }

  return componentes;
}

/** Remove o wrapper "Arquivo:" / "Genérico:" gravado por flatten antigo. */
function unwrapGenericoAcabamentoMemo(raw: string): string {
  const match = raw.trim().match(/^(?:Arquivo|Gen[eé]rico)\s*:\s*/i);
  if (!match) return raw.trim();
  return raw
    .trim()
    .slice(match[0].length)
    .replace(/^[ \t]+/gm, "")
    .trim();
}

function hydrateDescAcabamento(
  spec: TechSpec,
  form?: Pick<GerenciaFormState, "txt_acabamento" | "val_maquina">,
): TechSpec {
  const hasAny =
    (spec.acabamentosGerais ?? []).length > 0 ||
    spec.componentes.some(
      (c) =>
        (c.acabamentos ?? []).length > 0 ||
        c.lotes.some((l) => (l.acabamentos ?? []).length > 0),
    );
  if (hasAny) return spec;
  const raw = form?.txt_acabamento?.trim();
  if (!raw) return spec;

  const segs = parseLabeledMemo(raw);
  if (!segs.length) {
    const unlabeled = unwrapGenericoAcabamentoMemo(raw);
    return { ...spec, acabamentosGerais: unlabeled ? [{ label: unlabeled }] : [] };
  }

  const componentes = spec.componentes.map((c) => ({ ...c, lotes: c.lotes.map((l) => ({ ...l })) }));
  const maquinaOs = form?.val_maquina?.trim() ?? "";
  for (const seg of segs) {
    const comp = findOrCreateComponent(
      componentes,
      seg,
      maquinaForTipo(maquinaOs, seg.tipo),
    );
    comp.acabamentos = mergeAcabamentos(comp.acabamentos, labelsToAcabamentos(seg.value));
  }
  const rest = unlabeledMemoRemainder(raw);
  return {
    ...spec,
    componentes,
    acabamentosGerais: rest ? [{ label: rest }] : spec.acabamentosGerais ?? [],
  };
}

function applyOsFrenteVerso(spec: TechSpec, chkFv: boolean | undefined): TechSpec {
  if (!chkFv) return spec;
  const anyTrue = spec.componentes.some((c) => c.lotes.some((l) => l.frente_verso));
  if (anyTrue) return spec;
  return {
    ...spec,
    componentes: spec.componentes.map((c) => ({
      ...c,
      lotes: c.lotes.map((l) => {
        const impressao = impressaoAfterFvChange(l, true);
        return { ...l, frente_verso: true, impressao };
      }),
    })),
  };
}

function shouldRepairLabeledGenerico(spec: TechSpec): boolean {
  if (spec.componentes.length !== 1) return false;
  const only = spec.componentes[0];
  if (!isGenericoComponente(only)) return false;
  const lote = only.lotes[0];
  if (!lote) return false;
  return (
    memoHasComponentLabels(lote.papel_desc) ||
    memoHasComponentLabels(lote.cores_desc)
  );
}

function migrateLegacyAcabamentosToLote(comp: TechSpecComponente): TechSpecComponente {
  const lotes = comp.lotes.length ? comp.lotes : [createDefaultLote()];
  const firstHasKey = lotes.some((l) => Array.isArray(l.acabamentos));
  if (firstHasKey) return { ...comp, lotes };
  const legacy = comp.acabamentos ?? [];
  if (!legacy.length) return { ...comp, lotes };
  const [first, ...rest] = lotes;
  return {
    ...comp,
    acabamentos: [],
    lotes: [{ ...first, acabamentos: mergeAcabamentos(first.acabamentos, legacy) }, ...rest],
  };
}

export function ensureGenericoComponentes(
  spec: TechSpec,
  form?: Pick<
    GerenciaFormState,
    | "val_pgs"
    | "val_papel"
    | "val_cores"
    | "val_maquina"
    | "txt_acabamento"
    | "txt_papel_desc"
    | "txt_cores_desc"
    | "chk_fv"
  >,
): TechSpec {
  let safe = ensureTechSpecIntegrity(spec);

  if (shouldRepairLabeledGenerico(safe) && form) {
    const lote = safe.componentes[0].lotes[0];
    safe = ensureTechSpecIntegrity({
      version: 1,
      componentes: [],
      acabamentosGerais: safe.acabamentosGerais ?? [],
    });
    const parsed = parseComponentesFromPapelCores({
      ...form,
      txt_papel_desc: lote.papel_desc || form.txt_papel_desc,
      txt_cores_desc: lote.cores_desc || form.txt_cores_desc,
    });
    if (parsed.length) {
      safe = { ...safe, componentes: parsed };
    }
  }

  if (safe.componentes.length === 0 && form) {
    const parsed = parseComponentesFromPapelCores(form);
    if (parsed.length) {
      safe = { ...safe, componentes: parsed };
    }
  }

  if (safe.componentes.length === 0) {
    const paginas = form ? parseInt(String(form.val_pgs || "").trim(), 10) || 0 : 0;
    safe = {
      ...safe,
      componentes: [
        createGenericoComponente({
          paginas,
          maquina: form?.val_maquina,
          papel: form?.val_papel,
          cores: form?.val_cores,
          papelDesc: memoHasComponentLabels(form?.txt_papel_desc)
            ? ""
            : form?.txt_papel_desc,
          coresDesc: memoHasComponentLabels(form?.txt_cores_desc)
            ? ""
            : form?.txt_cores_desc,
          frenteVerso: form?.chk_fv,
        }),
      ],
    };
  }

  safe = hydrateDescAcabamento(safe, form);
  safe = applyOsFrenteVerso(safe, form?.chk_fv);
  if (form?.val_maquina) {
    safe = applyCapaMioloMaquinaSplit(safe, form.val_maquina);
  }
  const nonempty = safe.componentes.filter((c) => {
    if (!isGenericoComponente(c) || safe.componentes.length === 1) return true;
    const lote = c.lotes[0];
    return Boolean(
      lote?.paginas ||
        lote?.papel_link ||
        lote?.papel_desc ||
        lote?.cores_link ||
        lote?.cores_desc ||
        (c.acabamentos ?? []).length ||
        lote?.acabamentos?.length,
    );
  });
  return ensureTechSpecIntegrity({ ...safe, componentes: nonempty });
}

function normalizeLote(
  l: Partial<TechSpecLote> & Record<string, unknown>,
  options?: { versoEmBranco?: boolean },
): TechSpecLote {
  const rawAcab = Array.isArray(l.acabamentos) ? l.acabamentos : undefined;
  const base: TechSpecLote = {
    id: (l.id as string) ?? newLoteId(),
    paginas: Number(l.paginas) || 0,
    maquina_link: (l.maquina_link as string) ?? "",
    papel_link: (l.papel_link as string) ?? "",
    cores_link: (l.cores_link as string) ?? "",
    papel_desc: (l.papel_desc as string) ?? "",
    cores_desc: (l.cores_desc as string) ?? "",
    impressao: typeof l.impressao === "string" ? l.impressao : "",
    frente_verso: Boolean(l.frente_verso),
    acabamentos: (rawAcab ?? []).map(normalizeAcabamento).filter((item): item is TechSpecAcabamento => item != null),
  };
  const impressao = inferImpressaoFromLote(base, options);
  const parsed = parseImpressao(impressao);
  return {
    ...base,
    impressao,
    frente_verso: parsed ? parsed.verso > 0 : base.frente_verso,
  };
}

function loteRawHasAcabamentosKey(l: Partial<TechSpecLote> & Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(l, "acabamentos");
}

function normalizeAcabamento(
  item: Partial<TechSpecAcabamento>,
): TechSpecAcabamento | null {
  const label = (item.label || "").trim();
  const variacaoLabel = (item.variacao_label || "").trim();
  if (!label && !variacaoLabel) return null;
  const obs = (item.obs || "").trim();
  return {
    catalog_id: item.catalog_id,
    label: label || variacaoLabel,
    variacao_id: item.variacao_id,
    variacao_label: variacaoLabel || undefined,
    obs: obs || undefined,
  };
}

function normalizeComponente(comp: TechSpecComponente): TechSpecComponente {
  const tipo = comp.tipo;
  let nome =
    (comp.nome || "").trim() ||
    (tipo ? COMPONENTE_LABELS[tipo] : "") ||
    "Componente";
  if (isGenericoComponente({ ...comp, nome })) {
    nome = GENERICO_NOME;
  }
  const rawLotes = comp.lotes?.length > 0 ? comp.lotes : [createDefaultLote()];
  const newFormat = rawLotes.some((l) => loteRawHasAcabamentosKey(l));
  const migrated = newFormat ? comp : migrateLegacyAcabamentosToLote(comp);
  const lotesSource = migrated.lotes?.length > 0 ? migrated.lotes : [createDefaultLote()];
  const acabamentos = (migrated.acabamentos ?? [])
    .map((item) => normalizeAcabamento(item))
    .filter((item): item is TechSpecAcabamento => item != null);
  const { verso_em_branco: legacyVerso, ...rest } = migrated;
  const versoEmBranco = Boolean(legacyVerso);
  return {
    ...rest,
    nome,
    tipo,
    lotes: lotesSource.map((l) => normalizeLote(l, { versoEmBranco })),
    acabamentos,
  };
}

export function ensureTechSpecIntegrity(spec: TechSpec): TechSpec {
  return {
    ...spec,
    acabamentosGerais: mergeAcabamentos(spec.acabamentosGerais),
    componentes: spec.componentes.map((c) => normalizeComponente(c)),
  };
}

/** Converte componentes persistidos no MySQL para TechSpec da Gerência. */
export function techSpecFromComponentesApi(
  rows: Array<{
    id: number;
    nome: string;
    tipo?: string | null;
    lotes?: TechSpecLote[];
    acabamentos?: TechSpecAcabamento[];
    acabamentos_gerais?: TechSpecAcabamento[];
    acabamentosGerais?: TechSpecAcabamento[];
    verso_em_branco?: boolean;
  }>,
  options?: { stripIds?: boolean },
): TechSpec {
  if (!rows.length) return createEmptyTechSpec();
  const gerais = rows
    .map((row) => row.acabamentos_gerais ?? row.acabamentosGerais ?? [])
    .find((list) => list.length > 0);
  return ensureTechSpecIntegrity({
    version: 1,
    acabamentosGerais: gerais ?? [],
    componentes: rows.map((row) => {
      const tipo = (row.tipo as ComponenteTipo | undefined) || undefined;
      const comp: TechSpecComponente = {
        nome: row.nome,
        tipo: tipo && COMPONENTE_TIPOS.includes(tipo) ? tipo : undefined,
        lotes: (row.lotes as TechSpecLote[]) ?? [],
        acabamentos: row.acabamentos ?? [],
        verso_em_branco: Boolean(row.verso_em_branco),
      };
      if (!options?.stripIds) {
        comp.componente_id = row.id;
      }
      return normalizeComponente(comp);
    }),
  });
}

export function classifyCoresKind(cores: string): "PB" | "COLOR" | null {
  const c = (cores || "").trim().toUpperCase();
  if (!c) return null;
  const parsed = parseImpressao(c);
  if (parsed) {
    if (parsed.frente >= 4 || parsed.verso >= 4) return "COLOR";
    if (parsed.frente === 1 && parsed.verso <= 1) return "PB";
    return null;
  }
  if (
    c.includes("P/B") ||
    c.includes("PB") ||
    c.includes("1X1") ||
    c.includes("1X0") ||
    c.includes("1/1") ||
    c.includes("1/0") ||
    c === "PRETO" ||
    c.includes("PRETO") ||
    c.includes("RELEV")
  ) {
    return "PB";
  }
  if (c.includes("4") || c.includes("CMYK") || c.includes("POLIC")) {
    return "COLOR";
  }
  return null;
}

export function calculateTotalPagesFromTechSpec(spec: TechSpec): number {
  return spec.componentes.reduce(
    (sum, comp) =>
      sum + comp.lotes.reduce((s, l) => s + (Number(l.paginas) || 0), 0),
    0,
  );
}

/** Páginas físicas que entram na cota: verso 0 (N/0) conta só a frente. */
export function printedPagesForCota(
  paginas: number,
  versoZero: boolean,
): number {
  const pages = Math.max(0, Number(paginas) || 0);
  if (!versoZero) return pages;
  return Math.ceil(pages / 2);
}

export function isCapaVersoEmBranco(comp: TechSpecComponente): boolean {
  if (comp.tipo !== "CAPA") return false;
  if (comp.verso_em_branco) return true;
  return comp.lotes.some((l) => loteIsVersoZero(l, comp));
}

/** Soma de páginas impressas (cota), sem alterar o total físico da OS. */
export function calculateCotaPagesFromTechSpec(spec: TechSpec): number {
  return spec.componentes.reduce(
    (sum, comp) =>
      sum +
      comp.lotes.reduce(
        (s, l) =>
          s + printedPagesForCota(Number(l.paginas) || 0, loteIsVersoZero(l, comp)),
        0,
      ),
    0,
  );
}

/** Páginas restantes para novo componente (total da OS − já alocadas). */
export function calculateRemainingPages(totalPaginas: number, spec: TechSpec): number {
  if (totalPaginas <= 0) return 0;
  return Math.max(0, totalPaginas - calculateTotalPagesFromTechSpec(spec));
}

export type TechSpecChangeMeta = {
  /** Atualiza campo Páginas da OS com a soma dos componentes (edição manual). */
  syncValPgs?: boolean;
};

export interface ComponenteCalcResumo {
  tipo?: ComponenteTipo;
  label: string;
  color: number;
  pb: number;
  /** Páginas sem cor classificada no lote (cores não selecionada). */
  outras: number;
  total: number;
}

/** Resumo de páginas por componente a partir dos lotes (variações). */
export function computeComponentCalcs(spec: TechSpec): ComponenteCalcResumo[] {
  return spec.componentes.map((comp) => {
    let color = 0;
    let pb = 0;
    let outras = 0;
    for (const lote of comp.lotes) {
      const pages = printedPagesForCota(
        Number(lote.paginas) || 0,
        loteIsVersoZero(lote, comp),
      );
      const kind =
        classifyCoresKind(lote.impressao || "") ||
        classifyCoresKind(lote.cores_link) ||
        classifyCoresKind(lote.cores_desc);
      if (kind === "PB") pb += pages;
      else if (kind === "COLOR") color += pages;
      else outras += pages;
    }
    return {
      tipo: comp.tipo,
      label: getComponenteLabel(comp),
      color,
      pb,
      outras,
      total: color + pb + outras,
    };
  });
}

function resumoToCalcFields(rows: ComponenteCalcResumo[]): Pick<
  GerenciaFormState,
  | "calc_capa_color"
  | "calc_capa_pb"
  | "calc_miolo_color"
  | "calc_miolo_pb"
  | "calc_encarte_color"
  | "calc_encarte_pb"
> {
  const find = (tipo: ComponenteTipo) =>
    rows.find((r) => r.tipo === tipo) ?? { color: 0, pb: 0 };

  const capa = find("CAPA");
  const miolo = find("MIOLO");
  const encarte = find("ENCARTE");

  return {
    calc_capa_color: String(capa.color),
    calc_capa_pb: String(capa.pb),
    calc_miolo_color: String(miolo.color),
    calc_miolo_pb: String(miolo.pb),
    calc_encarte_color: String(encarte.color),
    calc_encarte_pb: String(encarte.pb),
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function collectLoteFieldValues(
  spec: TechSpec,
  pick: (lote: TechSpecLote) => string,
): string[] {
  return uniqueNonEmpty(spec.componentes.flatMap((c) => c.lotes.map(pick)));
}

/** MaquinaLink da OS: uma máquina ou "Maquina1/Maquina2" se os componentes divergem. */
export function buildMaquinaLinkFromTechSpec(spec: TechSpec): string {
  return collectLoteFieldValues(spec, (lote) => lote.maquina_link).join("/");
}

/** PapelLink da OS: o papel único ou "Diversos". */
export function buildPapelLinkFromTechSpec(spec: TechSpec): string {
  const values = collectLoteFieldValues(spec, lotePapelValue);
  if (values.length > 1) return "Diversos";
  return values[0] ?? "";
}

/** Cores da OS: a cor única ou "Diversas". */
export function buildCoresLinkFromTechSpec(spec: TechSpec): string {
  const values = collectLoteFieldValues(spec, loteCoresValue);
  if (values.length > 1) return "Diversas";
  return values[0] ?? "";
}

function formatFieldValue(lote: TechSpecLote, kind: "papel" | "cores"): string {
  return kind === "papel" ? lotePapelValue(lote) : loteCoresValue(lote);
}

/** Monta PapelDescricao agregada para gravação no MDB. */
export function buildPapelDescFromTechSpec(spec: TechSpec): string {
  const parts: string[] = [];
  for (const comp of spec.componentes) {
    const lotes = comp.lotes.map((l) => formatFieldValue(l, "papel")).filter(Boolean);
    if (lotes.length) {
      parts.push(`${getComponenteLabel(comp)}: ${lotes.join("; ")}`);
    }
  }
  return parts.join(" | ");
}

/** Monta CoresDescricao agregada para gravação no MDB. */
export function buildCoresDescFromTechSpec(spec: TechSpec): string {
  const parts: string[] = [];
  for (const comp of spec.componentes) {
    const lotes = comp.lotes.map((l) => formatFieldValue(l, "cores")).filter(Boolean);
    if (lotes.length) {
      parts.push(`${getComponenteLabel(comp)}: ${lotes.join("; ")}`);
    }
  }
  return parts.join(" | ");
}

export function formatAcabamentoLabel(item: TechSpecAcabamento): string {
  const base = (item.label || "").trim();
  const variacao = (item.variacao_label || "").trim();
  let name = base || variacao;
  if (base && variacao) {
    name = variacao.toLowerCase().includes(base.toLowerCase())
      ? variacao
      : `${base} ${variacao}`;
  }
  const obs = (item.obs || "").trim();
  return obs ? `${name} (${obs})` : name;
}

export function collectComponenteAcabamentos(
  spec: TechSpec,
  comp: TechSpecComponente,
): TechSpecAcabamento[] {
  return mergeAcabamentos(
    spec.acabamentosGerais,
    comp.acabamentos,
    ...comp.lotes.map((l) => l.acabamentos),
  );
}

function formatGeraisAcabamentos(spec: TechSpec): string {
  return (spec.acabamentosGerais ?? [])
    .map((item) => formatAcabamentoLabel(item))
    .filter(Boolean)
    .join("\n");
}

function hasAcabamentoEspecifico(spec: TechSpec): boolean {
  return spec.componentes.some(
    (comp) =>
      (comp.acabamentos ?? []).length > 0 ||
      comp.lotes.some((lote) => (lote.acabamentos ?? []).length > 0),
  );
}

/** Monta DescAcabamento agregado para gravação no MDB e o campo OS Acabamentos. */
export function buildDescAcabamentoFromTechSpec(spec: TechSpec): string {
  const safe = ensureTechSpecIntegrity(spec);
  if (hasGenericoComponente(safe) || !hasAcabamentoEspecifico(safe)) {
    return formatGeraisAcabamentos(safe);
  }
  const parts: string[] = [];
  for (const comp of safe.componentes) {
    const labels = collectComponenteAcabamentos(safe, comp)
      .map((item) => formatAcabamentoLabel(item))
      .filter(Boolean);
    if (!labels.length) continue;
    parts.push(`${getComponenteLabel(comp)}:\n  ${labels.join("\n  ")}`);
  }
  if (parts.length) return parts.join("\n");
  return formatGeraisAcabamentos(safe);
}

export function specHasFrenteVerso(spec: TechSpec): boolean {
  return spec.componentes.some((c) => c.lotes.some((l) => l.frente_verso));
}

export function syncCalculationsFromTechSpec(
  spec: TechSpec,
): Pick<
  GerenciaFormState,
  | "calc_capa_color"
  | "calc_capa_pb"
  | "calc_miolo_color"
  | "calc_miolo_pb"
  | "calc_encarte_color"
  | "calc_encarte_pb"
> {
  return resumoToCalcFields(computeComponentCalcs(spec));
}

/** Linhas para exibição: componentes do spec ou fallback dos campos salvos. */
export function getCalculosDisplayRows(
  spec: TechSpec,
  form: Pick<
    GerenciaFormState,
    | "calc_capa_color"
    | "calc_capa_pb"
    | "calc_miolo_color"
    | "calc_miolo_pb"
    | "calc_encarte_color"
    | "calc_encarte_pb"
  >,
): ComponenteCalcResumo[] {
  if (spec.componentes.length > 0) {
    return computeComponentCalcs(spec);
  }

  const legacy: { tipo: ComponenteTipo; color: string; pb: string }[] = [
    { tipo: "CAPA", color: form.calc_capa_color, pb: form.calc_capa_pb },
    { tipo: "MIOLO", color: form.calc_miolo_color, pb: form.calc_miolo_pb },
    { tipo: "ENCARTE", color: form.calc_encarte_color, pb: form.calc_encarte_pb },
  ];

  return legacy
    .map(({ tipo, color, pb }) => {
      const c = parseInt(color || "0", 10) || 0;
      const p = parseInt(pb || "0", 10) || 0;
      if (c === 0 && p === 0) return null;
      return {
        tipo,
        label: COMPONENTE_LABELS[tipo],
        color: c,
        pb: p,
        outras: 0,
        total: c + p,
      };
    })
    .filter((r): r is ComponenteCalcResumo => r !== null);
}

/** Atualiza cálculos e campos legados (Pags, papel, cores, máquina, acabamento) para o MDB. */
export function applyTechSpecToForm(
  form: GerenciaFormState,
  spec: TechSpec,
  options?: TechSpecChangeMeta,
): GerenciaFormState {
  const safe = ensureTechSpecIntegrity(spec);
  const calcPatch = syncCalculationsFromTechSpec(safe);
  const totalPages = calculateTotalPagesFromTechSpec(safe);

  const patch: Partial<GerenciaFormState> = {
    ...calcPatch,
    val_pgs: String(totalPages),
    val_maquina: buildMaquinaLinkFromTechSpec(safe),
    val_papel: buildPapelLinkFromTechSpec(safe),
    val_cores: buildCoresLinkFromTechSpec(safe),
    txt_papel_desc: buildPapelDescFromTechSpec(safe),
    txt_cores_desc: buildCoresDescFromTechSpec(safe),
    txt_acabamento: buildDescAcabamentoFromTechSpec(safe),
    chk_fv: specHasFrenteVerso(safe),
  };

  if (options?.syncValPgs && totalPages > 0) {
    patch.val_pgs = String(totalPages);
  }

  return { ...form, ...patch };
}

function hasLegacyCapaMioloData(form: GerenciaFormState): boolean {
  const keys = [
    "val_pgs_capa1",
    "val_papel_capa1",
    "val_cores_capa1",
    "val_pgs_capa2",
    "val_papel_capa2",
    "val_cores_capa2",
    "val_pgs_mio",
    "val_papel_mio",
    "val_cores_mio",
    "val_pgs_mio2",
    "val_papel_mio2",
    "val_cores_mio2",
  ] as const;
  return keys.some((k) => String(form[k] ?? "").trim() !== "");
}

function legacyRowToLote(
  pgs: string,
  papel: string,
  cores: string,
  maquina = "",
): TechSpecLote {
  return {
    id: newLoteId(),
    paginas: parseInt(pgs || "0", 10) || 0,
    maquina_link: maquina.trim(),
    papel_link: papel.trim(),
    cores_link: cores.trim(),
    papel_desc: "",
    cores_desc: "",
    impressao: "",
    frente_verso: false,
    acabamentos: [],
  };
}

/** Reconstrói tech spec a partir dos campos legados (capa/miolo) ou descrições salvas. */
export function inferTechSpecFromForm(form: GerenciaFormState): TechSpec {
  const maquinaOs = form.val_maquina.trim();
  if (hasLegacyCapaMioloData(form)) {
    const componentes: TechSpecComponente[] = [];
    const capaLotes: TechSpecLote[] = [];
    if (form.val_pgs_capa1 || form.val_papel_capa1 || form.val_cores_capa1) {
      capaLotes.push(
        legacyRowToLote(
          form.val_pgs_capa1,
          form.val_papel_capa1,
          form.val_cores_capa1,
          maquinaForTipo(maquinaOs, "CAPA"),
        ),
      );
    }
    if (form.val_pgs_capa2 || form.val_papel_capa2 || form.val_cores_capa2) {
      capaLotes.push(
        legacyRowToLote(
          form.val_pgs_capa2,
          form.val_papel_capa2,
          form.val_cores_capa2,
          maquinaForTipo(maquinaOs, "CAPA"),
        ),
      );
    }
    if (capaLotes.length) {
      componentes.push({ nome: "Capa", tipo: "CAPA", lotes: capaLotes });
    }

    const mioLotes: TechSpecLote[] = [];
    if (form.val_pgs_mio || form.val_papel_mio || form.val_cores_mio) {
      mioLotes.push(
        legacyRowToLote(
          form.val_pgs_mio,
          form.val_papel_mio,
          form.val_cores_mio,
          maquinaForTipo(maquinaOs, "MIOLO"),
        ),
      );
    }
    if (form.val_pgs_mio2 || form.val_papel_mio2 || form.val_cores_mio2) {
      mioLotes.push(
        legacyRowToLote(
          form.val_pgs_mio2,
          form.val_papel_mio2,
          form.val_cores_mio2,
          maquinaForTipo(maquinaOs, "MIOLO"),
        ),
      );
    }
    if (mioLotes.length) {
      componentes.push({ nome: "Miolo", tipo: "MIOLO", lotes: mioLotes });
    }

    if (componentes.length) {
      return { version: 1, componentes };
    }
  }

  const desc = (form.txt_papel_desc || form.txt_cores_desc || "").trim();
  if (!desc) {
    return createEmptyTechSpec();
  }

  const componentes: TechSpecComponente[] = [];
  for (const tipo of COMPONENTE_TIPOS) {
    const label = COMPONENTE_LABELS[tipo];
    const re = new RegExp(`${label}\\s*:\\s*([^|]+)`, "i");
    const match = desc.match(re);
    if (match?.[1]?.trim()) {
      componentes.push({
        nome: label,
        tipo,
        lotes: [
          {
            id: newLoteId(),
            paginas: 0,
            maquina_link: maquinaForTipo(maquinaOs, tipo),
            papel_link: form.val_papel,
            cores_link: form.val_cores,
            papel_desc: match[1].trim(),
            cores_desc: "",
            frente_verso: false,
            acabamentos: [],
          },
        ],
      });
    }
  }

  return componentes.length
    ? { version: 1, componentes }
    : createEmptyTechSpec();
}

export function techSpecStorageKey(ano: string, id: string): string {
  return `sagra_techspec_${ano}_${id}`;
}

export function loadTechSpecFromStorage(ano: string, id: string): TechSpec | null {
  try {
    const raw = localStorage.getItem(techSpecStorageKey(ano, id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TechSpec;
    if (!parsed?.componentes || !Array.isArray(parsed.componentes)) return null;
    return ensureTechSpecIntegrity(parsed);
  } catch {
    return null;
  }
}

export function saveTechSpecToStorage(ano: string, id: string, spec: TechSpec): void {
  try {
    localStorage.setItem(techSpecStorageKey(ano, id), JSON.stringify(spec));
  } catch {
    /* ignore quota errors */
  }
}
