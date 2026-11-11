/**
 * Layout customizável (campos exibidos, ordem e larguras) da lista de OS da home.
 * Persistido por usuário na preferência `os_home_table_layout` (+ cache em localStorage).
 *
 * A lista sempre ocupa 100% da largura disponível: `widths` são pesos (px no momento
 * em que foram configurados) e cada coluna recebe `peso / soma dos pesos visíveis`
 * da largura atual — logo as larguras acompanham proporcionalmente o tamanho da janela.
 */

export const OS_HOME_TABLE_LAYOUT_STORAGE_KEY = "sagra-os-home-table-layout";

export const OS_HOME_TABLE_COLUMN_IDS = [
  "nr_os",
  "ano",
  "data_entrada",
  "produto",
  "solicitante",
  "titulo",
  "situacao",
  "setor",
  "prioridade",
  "data_entrega",
  // Campos adicionais (ocultos por padrão; o usuário adiciona em "Configurar lista").
  "formato",
  "entreg_periodo",
  "last_update",
  "andamento_usuario",
  "observacao",
  "sub_os_count",
] as const;

export type OsHomeTableColumnId = (typeof OS_HOME_TABLE_COLUMN_IDS)[number];

export const OS_HOME_TABLE_COLUMN_LABELS: Record<OsHomeTableColumnId, string> = {
  nr_os: "Nr OS",
  ano: "Ano",
  data_entrada: "Entrada",
  produto: "Produto",
  solicitante: "Solicitante",
  titulo: "Título",
  situacao: "Situação",
  setor: "Setor",
  prioridade: "Prioridade",
  data_entrega: "Data",
  formato: "Formato",
  entreg_periodo: "Período entrega",
  last_update: "Último andamento",
  andamento_usuario: "Usuário do andamento",
  observacao: "Obs. do andamento",
  sub_os_count: "Qtd. Sub OS",
};

/** Colunas exibidas quando o usuário ainda não configurou a lista. */
export const OS_HOME_TABLE_DEFAULT_VISIBLE_COLUMNS: ReadonlySet<OsHomeTableColumnId> =
  new Set([
    "nr_os",
    "ano",
    "data_entrada",
    "produto",
    "solicitante",
    "titulo",
    "situacao",
    "setor",
    "prioridade",
    "data_entrega",
  ]);

/** Colunas ordenáveis no servidor (espelha `OsSortColumn`). */
export const OS_HOME_TABLE_SORTABLE_COLUMNS: ReadonlySet<OsHomeTableColumnId> = new Set([
  "nr_os",
  "ano",
  "data_entrada",
  "produto",
  "solicitante",
  "titulo",
  "situacao",
  "setor",
  "prioridade",
  "data_entrega",
]);

export const OS_HOME_TABLE_DEFAULT_WIDTHS: Record<OsHomeTableColumnId, number> = {
  nr_os: 64,
  ano: 48,
  data_entrada: 76,
  produto: 150,
  solicitante: 200,
  titulo: 350,
  situacao: 140,
  setor: 100,
  prioridade: 95,
  data_entrega: 76,
  formato: 110,
  entreg_periodo: 90,
  last_update: 120,
  andamento_usuario: 130,
  observacao: 220,
  sub_os_count: 70,
};

/** Largura mínima (px) aplicada ao redimensionar. */
export const OS_HOME_TABLE_MIN_WIDTHS: Record<OsHomeTableColumnId, number> = {
  nr_os: 56,
  ano: 40,
  data_entrada: 60,
  produto: 80,
  solicitante: 80,
  titulo: 80,
  situacao: 70,
  setor: 60,
  prioridade: 60,
  data_entrega: 60,
  formato: 60,
  entreg_periodo: 60,
  last_update: 70,
  andamento_usuario: 70,
  observacao: 80,
  sub_os_count: 50,
};

export const OS_HOME_TABLE_MAX_WIDTH = 4000;

/** Colunas que não podem ser ocultadas (identidade da linha + expand de Sub OS). */
export const OS_HOME_TABLE_REQUIRED_COLUMNS: ReadonlySet<OsHomeTableColumnId> = new Set([
  "nr_os",
]);

export interface OsHomeTableLayout {
  order: OsHomeTableColumnId[];
  visibility: Record<OsHomeTableColumnId, boolean>;
  /** Pesos relativos (px no momento da configuração). */
  widths: Record<OsHomeTableColumnId, number>;
}

export function isOsHomeTableColumnId(value: unknown): value is OsHomeTableColumnId {
  return (
    typeof value === "string" &&
    (OS_HOME_TABLE_COLUMN_IDS as readonly string[]).includes(value)
  );
}

export function isOsHomeTableColumnRequired(id: string): boolean {
  return isOsHomeTableColumnId(id) && OS_HOME_TABLE_REQUIRED_COLUMNS.has(id);
}

export function isOsHomeTableColumnSortable(id: string): boolean {
  return isOsHomeTableColumnId(id) && OS_HOME_TABLE_SORTABLE_COLUMNS.has(id);
}

export function clampOsHomeTableWidth(id: OsHomeTableColumnId, width: number): number {
  const min = OS_HOME_TABLE_MIN_WIDTHS[id];
  return Math.round(Math.min(OS_HOME_TABLE_MAX_WIDTH, Math.max(min, width)));
}

export function defaultOsHomeTableLayout(): OsHomeTableLayout {
  const visibility = {} as Record<OsHomeTableColumnId, boolean>;
  for (const id of OS_HOME_TABLE_COLUMN_IDS) {
    visibility[id] = OS_HOME_TABLE_DEFAULT_VISIBLE_COLUMNS.has(id);
  }
  return {
    order: [...OS_HOME_TABLE_COLUMN_IDS],
    visibility,
    widths: { ...OS_HOME_TABLE_DEFAULT_WIDTHS },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Saneia um layout vindo do servidor/localStorage:
 * - ids desconhecidos são ignorados; ids novos do código entram no fim com default;
 * - colunas obrigatórias são sempre visíveis;
 * - larguras inválidas voltam ao default e as válidas são limitadas a [min, max].
 */
export function mergeOsHomeTableLayout(raw: unknown): OsHomeTableLayout {
  const base = defaultOsHomeTableLayout();
  if (!isRecord(raw)) {
    return base;
  }

  const order: OsHomeTableColumnId[] = [];
  if (Array.isArray(raw.order)) {
    for (const id of raw.order) {
      if (isOsHomeTableColumnId(id) && !order.includes(id)) {
        order.push(id);
      }
    }
  }
  for (const id of OS_HOME_TABLE_COLUMN_IDS) {
    if (!order.includes(id)) {
      order.push(id);
    }
  }

  const visibility = { ...base.visibility };
  if (isRecord(raw.visibility)) {
    for (const id of OS_HOME_TABLE_COLUMN_IDS) {
      const value = raw.visibility[id];
      if (typeof value === "boolean") {
        visibility[id] = value;
      }
    }
  }
  for (const id of OS_HOME_TABLE_REQUIRED_COLUMNS) {
    visibility[id] = true;
  }

  const widths = { ...base.widths };
  if (isRecord(raw.widths)) {
    for (const id of OS_HOME_TABLE_COLUMN_IDS) {
      const value = raw.widths[id];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        widths[id] = clampOsHomeTableWidth(id, value);
      }
    }
  }

  return { order, visibility, widths };
}

/** Lê o cache local (rápido, antes do GET do servidor). */
export function readLocalOsHomeTableLayout(): OsHomeTableLayout {
  try {
    const raw = localStorage.getItem(OS_HOME_TABLE_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return defaultOsHomeTableLayout();
    }
    return mergeOsHomeTableLayout(JSON.parse(raw));
  } catch {
    return defaultOsHomeTableLayout();
  }
}

/** Colunas visíveis na ordem configurada. */
export function visibleOsHomeTableColumns(
  layout: Pick<OsHomeTableLayout, "order" | "visibility">,
): OsHomeTableColumnId[] {
  return layout.order.filter((id) => layout.visibility[id]);
}

/** Percentual (0–100) da largura da lista para cada coluna visível. */
export function osHomeTableColumnPercents(
  layout: OsHomeTableLayout,
): Map<OsHomeTableColumnId, number> {
  const visible = visibleOsHomeTableColumns(layout);
  const total = visible.reduce((sum, id) => sum + layout.widths[id], 0);
  const result = new Map<OsHomeTableColumnId, number>();
  for (const id of visible) {
    result.set(id, total > 0 ? (layout.widths[id] / total) * 100 : 100 / visible.length);
  }
  return result;
}

/** Normaliza o estado de visibilidade do TanStack Table de volta para o layout. */
export function normalizeOsHomeTableVisibility(
  next: Record<string, boolean>,
  prev: Record<OsHomeTableColumnId, boolean>,
): Record<OsHomeTableColumnId, boolean> {
  const visibility = { ...prev };
  for (const id of OS_HOME_TABLE_COLUMN_IDS) {
    const value = next[id];
    if (typeof value === "boolean") {
      visibility[id] = value;
    }
  }
  for (const id of OS_HOME_TABLE_REQUIRED_COLUMNS) {
    visibility[id] = true;
  }
  return visibility;
}

/**
 * Redimensiona a borda entre `leftId` e `rightId` (vizinhas): o que uma ganha a outra
 * perde, demais colunas intactas — a lista continua ocupando 100% da largura.
 */
export function resizeOsHomeTableColumnPair(
  startLeft: number,
  startRight: number,
  leftId: OsHomeTableColumnId,
  rightId: OsHomeTableColumnId,
  delta: number,
): { left: number; right: number } {
  const total = startLeft + startRight;
  const minLeft = OS_HOME_TABLE_MIN_WIDTHS[leftId];
  const minRight = OS_HOME_TABLE_MIN_WIDTHS[rightId];
  if (total <= minLeft + minRight) {
    return { left: Math.round(startLeft), right: Math.round(startRight) };
  }
  const left = Math.min(total - minRight, Math.max(minLeft, startLeft + delta));
  const roundedLeft = Math.round(left);
  return { left: roundedLeft, right: Math.round(total) - roundedLeft };
}

/** Move `activeId` para a posição de `overId` na ordem completa. */
export function moveOsHomeTableColumn(
  order: readonly OsHomeTableColumnId[],
  activeId: string,
  overId: string,
): OsHomeTableColumnId[] {
  const from = order.indexOf(activeId as OsHomeTableColumnId);
  const to = order.indexOf(overId as OsHomeTableColumnId);
  if (from < 0 || to < 0 || from === to) {
    return [...order];
  }
  const next = [...order];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return [...order];
  }
  next.splice(to, 0, moved);
  return next;
}

/** Move a coluna uma posição entre as visíveis (`-1` = esquerda, `1` = direita). */
export function shiftOsHomeTableColumn(
  layout: OsHomeTableLayout,
  id: OsHomeTableColumnId,
  direction: -1 | 1,
): OsHomeTableLayout {
  const visible = visibleOsHomeTableColumns(layout);
  const index = visible.indexOf(id);
  const neighbor = visible[index + direction];
  if (index < 0 || neighbor === undefined) {
    return layout;
  }
  return { ...layout, order: moveOsHomeTableColumn(layout.order, id, neighbor) };
}

/** Exibe a coluna, posicionando-a ao final das colunas visíveis. */
export function addOsHomeTableColumn(
  layout: OsHomeTableLayout,
  id: OsHomeTableColumnId,
): OsHomeTableLayout {
  if (layout.visibility[id]) {
    return layout;
  }
  const visible = visibleOsHomeTableColumns(layout);
  const last = visible.at(-1);
  const order = layout.order.filter((item) => item !== id);
  const insertAt = last === undefined ? order.length : order.indexOf(last) + 1;
  order.splice(insertAt, 0, id);
  return {
    ...layout,
    order,
    visibility: { ...layout.visibility, [id]: true },
  };
}

/** Oculta a coluna (exceto obrigatórias). */
export function removeOsHomeTableColumn(
  layout: OsHomeTableLayout,
  id: OsHomeTableColumnId,
): OsHomeTableLayout {
  if (OS_HOME_TABLE_REQUIRED_COLUMNS.has(id) || !layout.visibility[id]) {
    return layout;
  }
  return { ...layout, visibility: { ...layout.visibility, [id]: false } };
}
