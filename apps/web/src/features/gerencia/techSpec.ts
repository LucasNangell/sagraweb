import type { GerenciaFormState } from "./types";

export type ComponenteTipo = "CAPA" | "MIOLO" | "ENCARTE";

export interface TechSpecLote {
  id: string;
  paginas: number;
  maquina_link: string;
  papel_link: string;
  cores_link: string;
  papel_desc: string;
  cores_desc: string;
}

export interface TechSpecComponente {
  /** ID estável no MySQL (tab_os_componentes). */
  componente_id?: number;
  /** Nome livre exibido ao usuário. */
  nome: string;
  /** Slot legado CAPA/MIOLO/ENCARTE (opcional). */
  tipo?: ComponenteTipo;
  lotes: TechSpecLote[];
}

export interface TechSpec {
  version: 1;
  componentes: TechSpecComponente[];
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
  };
}

export function createEmptyTechSpec(): TechSpec {
  return { version: 1, componentes: [] };
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

function normalizeLote(l: Partial<TechSpecLote>): TechSpecLote {
  return {
    id: l.id ?? newLoteId(),
    paginas: Number(l.paginas) || 0,
    maquina_link: l.maquina_link ?? "",
    papel_link: l.papel_link ?? "",
    cores_link: l.cores_link ?? "",
    papel_desc: l.papel_desc ?? "",
    cores_desc: l.cores_desc ?? "",
  };
}

function normalizeComponente(comp: TechSpecComponente): TechSpecComponente {
  const tipo = comp.tipo;
  const nome =
    (comp.nome || "").trim() ||
    (tipo ? COMPONENTE_LABELS[tipo] : "") ||
    "Componente";
  return {
    ...comp,
    nome,
    tipo,
    lotes: (comp.lotes?.length > 0 ? comp.lotes : [createDefaultLote()]).map(
      (l) => normalizeLote(l),
    ),
  };
}

export function ensureTechSpecIntegrity(spec: TechSpec): TechSpec {
  return {
    ...spec,
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
  }>,
  options?: { stripIds?: boolean },
): TechSpec {
  if (!rows.length) return createEmptyTechSpec();
  return ensureTechSpecIntegrity({
    version: 1,
    componentes: rows.map((row) => {
      const comp: TechSpecComponente = {
        nome: row.nome,
        tipo: (row.tipo as ComponenteTipo | undefined) || undefined,
        lotes: (row.lotes as TechSpecLote[]) ?? [],
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
  if (
    c.includes("P/B") ||
    c.includes("PB") ||
    c.includes("1X1") ||
    c.includes("1X0") ||
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
      const pages = Number(lote.paginas) || 0;
      const kind = classifyCoresKind(lote.cores_link);
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

function pickPrimaryLote(spec: TechSpec): TechSpecLote | null {
  const order: ComponenteTipo[] = ["MIOLO", "CAPA", "ENCARTE"];
  for (const tipo of order) {
    const comp = spec.componentes.find((c) => c.tipo === tipo);
    const lote = comp?.lotes.find(
      (l) => l.papel_link || l.cores_link || l.maquina_link,
    );
    if (lote) return lote;
  }
  for (const comp of spec.componentes) {
    if (comp.lotes[0]) return comp.lotes[0];
  }
  return null;
}

function formatLoteDetail(lote: TechSpecLote, kind: "papel" | "cores"): string {
  const pages = lote.paginas > 0 ? `${lote.paginas} pág` : "";
  const link = kind === "papel" ? lote.papel_link : lote.cores_link;
  const extra = ((kind === "papel" ? lote.papel_desc : lote.cores_desc) ?? "").trim();
  return [pages, link, extra].filter(Boolean).join(" — ");
}

/** Monta PapelDescricao agregada para gravação no MDB. */
export function buildPapelDescFromTechSpec(spec: TechSpec): string {
  const parts: string[] = [];
  for (const comp of spec.componentes) {
    const lotes = comp.lotes
      .map((l) => formatLoteDetail(l, "papel"))
      .filter(Boolean);
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
    const lotes = comp.lotes
      .map((l) => formatLoteDetail(l, "cores"))
      .filter(Boolean);
    if (lotes.length) {
      parts.push(`${getComponenteLabel(comp)}: ${lotes.join("; ")}`);
    }
  }
  return parts.join(" | ");
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

/** Atualiza campos derivados do tech spec (cálculos). Não replica dados técnicos ao MDB. */
export function applyTechSpecToForm(
  form: GerenciaFormState,
  spec: TechSpec,
  options?: TechSpecChangeMeta,
): GerenciaFormState {
  const safe = ensureTechSpecIntegrity(spec);
  const calcPatch = syncCalculationsFromTechSpec(safe);

  const patch: Partial<GerenciaFormState> = { ...calcPatch };

  // Só atualiza Páginas quando o usuário edita páginas de um componente manualmente.
  if (options?.syncValPgs) {
    const totalPages = calculateTotalPagesFromTechSpec(safe);
    if (totalPages > 0) {
      patch.val_pgs = String(totalPages);
    }
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
          maquinaOs,
        ),
      );
    }
    if (form.val_pgs_capa2 || form.val_papel_capa2 || form.val_cores_capa2) {
      capaLotes.push(
        legacyRowToLote(
          form.val_pgs_capa2,
          form.val_papel_capa2,
          form.val_cores_capa2,
          maquinaOs,
        ),
      );
    }
    if (capaLotes.length) {
      componentes.push({ nome: "Capa", tipo: "CAPA", lotes: capaLotes });
    }

    const mioLotes: TechSpecLote[] = [];
    if (form.val_pgs_mio || form.val_papel_mio || form.val_cores_mio) {
      mioLotes.push(
        legacyRowToLote(form.val_pgs_mio, form.val_papel_mio, form.val_cores_mio, maquinaOs),
      );
    }
    if (form.val_pgs_mio2 || form.val_papel_mio2 || form.val_cores_mio2) {
      mioLotes.push(
        legacyRowToLote(
          form.val_pgs_mio2,
          form.val_papel_mio2,
          form.val_cores_mio2,
          maquinaOs,
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
            maquina_link: maquinaOs,
            papel_link: form.val_papel,
            cores_link: form.val_cores,
            papel_desc: match[1].trim(),
            cores_desc: "",
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
