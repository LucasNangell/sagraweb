import { matchesColumnStatus } from "../dashboard-setor/utils";
import type {
  PainelColumnConfig,
  PainelColumnDisplay,
  PainelOpItem,
  PainelPriorityType,
  PainelRawOp,
} from "./types";

export function painelOpKey(nr_os: number, ano: number): string {
  return `${nr_os}-${ano}`;
}

export function painelItemKey(os: PainelRawOp): string {
  if (os.row_kind === "sub_os" && os.sub_os_id != null) {
    const parentNro = Number(os.parent_nr_os ?? os.nr_os);
    const parentAno = Number(os.parent_ano ?? os.ano);
    return `${parentNro}-${parentAno}-sub-${os.sub_os_id}`;
  }
  return painelOpKey(os.nr_os, os.ano);
}

export function painelOsLabel(nr_os: number, ano: number): string {
  const prefix = nr_os < 5000 ? "OS" : "SP";
  return `${prefix} ${nr_os}/${String(ano).slice(-2)}`;
}

export function painelDisplayLabel(os: PainelRawOp): string {
  if (os.row_kind === "sub_os") {
    const label = os.display_label ?? os.display_nr_os;
    if (label) {
      return String(label);
    }
    const comp = os.componente_nome;
    if (comp) {
      return `${os.nr_os} [${comp}]`;
    }
  }
  return painelOsLabel(os.nr_os, os.ano);
}

export function resolvePainelPrioridade(
  op: Pick<PainelRawOp, "prioridade" | "EntregPrazoLink">,
): string | null {
  const label = op.prioridade ?? op.EntregPrazoLink ?? null;
  if (!label) {
    return null;
  }
  return String(label).trim() || null;
}

function resolvePriorityType(
  op: Pick<PainelRawOp, "prioridade" | "EntregPrazoLink">,
): PainelPriorityType {
  const score = getPrioScore(resolvePainelPrioridade(op));
  if (score === 1) {
    return "priority-high";
  }
  if (score === 2) {
    return "priority-medium";
  }
  return null;
}

function normalizeDisplaySituacao(os: PainelRawOp): string {
  let displaySituacao = os.situacao ?? "";
  const obsField =
    os.Observaçao ?? os.observacao ?? os.Observacao ?? "Sem observação";
  const obsText = String(obsField).toLowerCase();
  if (os.situacao === "Em Execução" && obsText.includes("analis")) {
    displaySituacao = "Analisar arquivo";
  }
  return displaySituacao.replace(/Pendência/g, "Pend.");
}

function normalizeEntrega(os: PainelRawOp): string | null {
  let normalizedEntrega =
    os.EntregData ??
    os.ENTREGDATA ??
    os.entregData ??
    os.DataEntrega ??
    os.data_entrega ??
    os.dt_entrega ??
    os.PrevisaoEntrega ??
    os.dt_entrega_prevista ??
    null;

  if (!normalizedEntrega) {
    const keys = Object.keys(os);
    const dateKey =
      keys.find(
        (k) =>
          k.toLowerCase().includes("entreg") && k.toLowerCase().includes("data"),
      ) ??
      keys.find(
        (k) =>
          k.toLowerCase().includes("data") && k.toLowerCase().includes("entrega"),
      );
    if (dateKey) {
      normalizedEntrega = String(os[dateKey] ?? "");
    }
  }

  if (normalizedEntrega && typeof normalizedEntrega === "string") {
    const dateMatch =
      normalizedEntrega.match(/(\d{4})-(\d{2})-(\d{2})/) ??
      normalizedEntrega.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (dateMatch) {
      if (dateMatch[1]!.length === 4) {
        return `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`;
      }
      return `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
    }
  }

  return normalizedEntrega ? String(normalizedEntrega) : null;
}

function normalizeSolicitante(os: PainelRawOp): string {
  let normalizedSolicitante =
    os.nome_usuario ??
    os.NomeUsuario ??
    os.NOMEUSUARIO ??
    os.Nomeusuario ??
    os.usuario ??
    os.Usuario ??
    os.USUARIO ??
    os.solicitante ??
    os.Solicitante ??
    null;

  if (!normalizedSolicitante) {
    const keys = Object.keys(os);
    const nameKey =
      keys.find(
        (k) =>
          k.toLowerCase().includes("nome") && k.toLowerCase().includes("usuario"),
      ) ?? keys.find((k) => k.toLowerCase().includes("usuario"));
    if (nameKey) {
      normalizedSolicitante = String(os[nameKey] ?? "");
    }
  }

  return normalizedSolicitante ? String(normalizedSolicitante) : "Não inf.";
}

function normalizeTurno(os: PainelRawOp): string | null {
  let normalizedTurno =
    os.EntregPeriodo ??
    os.ENTREGPERIODO ??
    os.entreg_periodo ??
    os.periodo ??
    os.Periodo ??
    null;

  if (!normalizedTurno) {
    const keys = Object.keys(os);
    const periodKey =
      keys.find(
        (k) =>
          k.toLowerCase().includes("entreg") &&
          k.toLowerCase().includes("periodo"),
      ) ?? keys.find((k) => k.toLowerCase().includes("periodo"));
    if (periodKey) {
      normalizedTurno = String(os[periodKey] ?? "");
    }
  }

  return normalizedTurno ? String(normalizedTurno) : null;
}

function findColumnIndex(
  columns: PainelColumnConfig[],
  item: PainelOpItem,
): number {
  return columns.findIndex((col) => {
    const osSector = item.fetchedSector ?? item.setor ?? "";
    const sectorMatches = col.sectors?.includes(osSector) ?? false;
    return (
      sectorMatches &&
      col.statuses.some((statusFilter) =>
        matchesColumnStatus(item.situacao ?? "", statusFilter),
      )
    );
  });
}

export function isPainelOs(nr_os: number): boolean {
  return nr_os < 5000;
}

export function matchesPainelOsSpFilter(
  op: Pick<PainelRawOp, "nr_os">,
  includeOs: boolean,
  includeSp: boolean,
): boolean {
  const isOs = isPainelOs(op.nr_os);
  if (!includeOs && isOs) {
    return false;
  }
  if (!includeSp && !isOs) {
    return false;
  }
  return true;
}

export function filterPainelRawByOsSp(
  items: PainelRawOp[],
  includeOs: boolean,
  includeSp: boolean,
): PainelRawOp[] {
  return items.filter((op) => matchesPainelOsSpFilter(op, includeOs, includeSp));
}

export function getPrioScore(prioridade: string | null | undefined): number {
  if (!prioridade) {
    return 3;
  }
  if (prioridade.includes("Prometido")) {
    return 1;
  }
  if (prioridade.includes("Solicitado")) {
    return 2;
  }
  return 3;
}

export function parseDateToMillis(dateStr: string | null | undefined): number {
  if (!dateStr || typeof dateStr !== "string") {
    return Infinity;
  }
  const parts = dateStr.split("/");
  if (parts.length !== 3) {
    return Infinity;
  }
  const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  return Number.isNaN(d.getTime()) ? Infinity : d.getTime();
}

export function masterSort(a: PainelOpItem, b: PainelOpItem): number {
  const sA = getPrioScore(resolvePainelPrioridade(a));
  const sB = getPrioScore(resolvePainelPrioridade(b));
  if (sA !== sB) {
    return sA - sB;
  }

  const dA = parseDateToMillis(a.normalizedEntrega);
  const dB = parseDateToMillis(b.normalizedEntrega);
  if (dA !== dB) {
    return dA - dB;
  }

  if (a.fetchedSector === b.fetchedSector) {
    const hasPcpA = Number.isFinite(Number(a.pcp_ordem));
    const hasPcpB = Number.isFinite(Number(b.pcp_ordem));
    if (hasPcpA && hasPcpB && a.pcp_ordem !== b.pcp_ordem) {
      return Number(a.pcp_ordem) - Number(b.pcp_ordem);
    }
    if (hasPcpA !== hasPcpB) {
      return hasPcpA ? -1 : 1;
    }
  }

  const tA = a.nr_os < 5000 ? 1 : 2;
  const tB = b.nr_os < 5000 ? 1 : 2;
  if (tA !== tB) {
    return tA - tB;
  }

  if (a.ano !== b.ano) {
    return b.ano - a.ano;
  }
  return b.nr_os - a.nr_os;
}

export interface ProcessPainelDataResult {
  columns: PainelColumnDisplay[];
  unmappedItems: PainelOpItem[];
  hiddenCount: number;
  hasNewPriorityAlert: boolean;
}

export function processPainelData(
  rawData: PainelRawOp[],
  configColumns: PainelColumnConfig[],
  masterOpsMap: Map<string, PainelOpItem>,
): ProcessPainelDataResult {
  const incomingIds = new Set<string>();
  let hasNewPriorityAlert = false;

  const tempColumns: PainelColumnDisplay[] = configColumns.map((c) => ({
    ...c,
    items: [],
  }));
  const tempUnmapped: PainelOpItem[] = [];
  let hidden = 0;

  for (const [sourceOrder, os] of rawData.entries()) {
    const uniqueKey = painelItemKey(os);
    incomingIds.add(uniqueKey);

    const prioridadeLabel = resolvePainelPrioridade(os);
    const priorityType = resolvePriorityType(os);
    const displaySituacao = normalizeDisplaySituacao(os);
    const normalizedEntrega = normalizeEntrega(os);
    const normalizedSolicitante = normalizeSolicitante(os);
    const normalizedTurno = normalizeTurno(os);
    const pcpOrder = Number.isFinite(Number(os.pcp_ordem))
      ? Number(os.pcp_ordem)
      : null;

    let item: PainelOpItem;
    if (masterOpsMap.has(uniqueKey)) {
      item = masterOpsMap.get(uniqueKey)!;
      item.situacao = os.situacao;
      item.displaySituacao = displaySituacao;
      item.prioridade = prioridadeLabel ?? os.prioridade;
      item.priorityType = priorityType;
      item.last_update = os.last_update;
      item.normalizedEntrega = normalizedEntrega;
      item.normalizedSolicitante = normalizedSolicitante;
      item.normalizedTurno = normalizedTurno;
      item.sourceOrder = sourceOrder;
      item.pcp_ordem = pcpOrder;
      item.fetchedSector = os.fetchedSector;
      item.setor = os.setor;
      item.titulo = os.titulo ?? os.Titulo ?? item.titulo;
      item.produto = os.produto ?? os.Produto ?? os.prod_nome ?? item.produto;
      item.Observaçao = os.Observaçao ?? os.observacao ?? os.Observacao;
      item.TipoPublicacaoLink = os.TipoPublicacaoLink;
      item.EntregPrazoLink = os.EntregPrazoLink;
      item.isNew = false;
    } else {
      item = {
        ...os,
        prioridade: prioridadeLabel ?? os.prioridade,
        uniqueKey,
        priorityType,
        isNew: true,
        pcp_ordem: pcpOrder,
        sourceOrder,
        displaySituacao,
        normalizedEntrega,
        normalizedSolicitante,
        normalizedTurno,
        Observaçao: os.Observaçao ?? os.observacao ?? os.Observacao,
        lastColumnId: null,
      };
      masterOpsMap.set(uniqueKey, item);
    }

    const colIndex = findColumnIndex(configColumns, item);
    const currentColumnId = colIndex !== -1 ? configColumns[colIndex]!.id : "unmapped";

    if (colIndex !== -1) {
      tempColumns[colIndex]!.items.push(item);

      const columnMuted = configColumns[colIndex]!.muted ?? false;
      const columnChanged = item.lastColumnId !== currentColumnId;

      if (columnChanged && !columnMuted) {
        hasNewPriorityAlert = true;
        item.isNew = true;
      }
    } else {
      hidden += 1;
      tempUnmapped.push(item);
    }

    item.lastColumnId = currentColumnId;
  }

  for (const key of masterOpsMap.keys()) {
    if (!incomingIds.has(key)) {
      masterOpsMap.delete(key);
    }
  }

  return {
    columns: tempColumns,
    unmappedItems: tempUnmapped,
    hiddenCount: hidden,
    hasNewPriorityAlert,
  };
}

export function buildAllOpsList(
  masterOpsMap: Map<string, PainelOpItem>,
  showExpCorrespondencia: boolean,
): PainelOpItem[] {
  const filteredAll = Array.from(masterOpsMap.values()).filter((item) => {
    const s = item.situacao ?? "";
    if (s === "Entregue" || s === "Cancelada" || s === "Cancelado") {
      return false;
    }

    const opSector = (item.setor ?? "").trim();
    const isExcludedSector =
      opSector === "Expedição" || opSector === "Correspondência";
    if (!showExpCorrespondencia && isExcludedSector) {
      return false;
    }

    return true;
  });

  filteredAll.sort(masterSort);
  return filteredAll;
}

export function sortColumnItems(columns: PainelColumnDisplay[]): PainelColumnDisplay[] {
  return columns.map((col) => ({
    ...col,
    items: [...col.items].sort(masterSort),
  }));
}

export const PAINEL_MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export const PAINEL_COLUMN_HEADER_CLASSES = [
  "column-header-first",
  "column-header-second",
  "column-header-third",
  "column-header-fourth",
  "column-header-fifth",
  "column-header-sixth",
  "column-header-seventh",
  "column-header-eighth",
] as const;

export function parseOpDateMonth(op: PainelRawOp): number | null {
  const dateStr =
    op.DataEntrada ??
    op.DATAENTRADA ??
    op.dataentrada ??
    op.data_entrada ??
    op.data_emissao ??
    op.dt_emissao ??
    op.last_update;

  if (!dateStr) {
    return null;
  }

  let d: Date;
  if (String(dateStr).includes("/")) {
    const parts = String(dateStr).split(" ")[0]!.split("/");
    d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  } else {
    d = new Date(String(dateStr));
  }

  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.getMonth();
}

export function getOpCategoryLabel(op: PainelRawOp): string {
  const situ = (op.situacao ?? op.SituacaoLink ?? "").trim();
  if (situ === "Entregue") {
    return "Entregue";
  }
  if (situ === "Cancelado" || situ === "Cancelada") {
    return "Cancelado";
  }
  return "Em andamento";
}

export function validateImportedConfig(raw: unknown): asserts raw is {
  columnCount: number;
  columns: PainelColumnConfig[];
} {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("columnCount" in raw) ||
    !("columns" in raw) ||
    !Array.isArray((raw as { columns: unknown }).columns)
  ) {
    throw new Error("Arquivo de configuração inválido ou corrompido.");
  }
}
