import type { ClientAnalysisItem } from "@/api/client-portal";

/** Normaliza flags tinyint/string vindas da API MySQL. */
export function isDbTruthy(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  }
  return Boolean(value);
}

export function normalizeClientItem(item: ClientAnalysisItem): ClientAnalysisItem {
  return {
    ...item,
    desconsiderado: isDbTruthy(item.desconsiderado),
    resolver: isDbTruthy(item.resolver),
    resolucaoObrigatoria: isDbTruthy(item.resolucaoObrigatoria),
  };
}

export function itemStatusLabel(item: ClientAnalysisItem): string {
  if (isDbTruthy(item.desconsiderado)) return "Desconsiderado";
  if (isDbTruthy(item.resolver)) return "Resolvido";
  return "Pendente";
}

export function isItemPending(item: ClientAnalysisItem): boolean {
  return !isDbTruthy(item.desconsiderado) && !isDbTruthy(item.resolver);
}

/** Cadeado fechado na análise — não pode desconsiderar. */
export function isItemLocked(item: ClientAnalysisItem): boolean {
  return isDbTruthy(item.resolucaoObrigatoria);
}

export function canDisregardItem(item: ClientAnalysisItem): boolean {
  return isItemPending(item) && !isItemLocked(item);
}

export function groupByComponente(
  items: ClientAnalysisItem[],
): Record<string, ClientAnalysisItem[]> {
  return items.reduce<Record<string, ClientAnalysisItem[]>>((acc, item) => {
    const g = item.componenteOrigem || "Outros";
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});
}

export function groupHasPendingUpload(groupItems: ClientAnalysisItem[]): boolean {
  return groupItems.some(isItemPending);
}

export function componenteGroupKey(componente?: string | null): string {
  const label = (componente ?? "").trim();
  return label || "Outros";
}

export function buildUploadedComponentSet(componentesEnviados?: string[]): Set<string> {
  return new Set((componentesEnviados ?? []).map((c) => componenteGroupKey(c)));
}

/** Grupo já recebeu arquivo corrigido do cliente. */
export function isGroupFileUploaded(
  group: string,
  uploadedComponents: ReadonlySet<string>,
): boolean {
  return uploadedComponents.has(group);
}

/** Exibe botão de envio: itens pendentes e arquivo ainda não enviado para o grupo. */
export function groupNeedsFileUpload(
  group: string,
  groupItems: ClientAnalysisItem[],
  uploadedComponents: ReadonlySet<string>,
): boolean {
  return groupHasPendingUpload(groupItems) && !isGroupFileUploaded(group, uploadedComponents);
}

export function isItemBlockedByFileUpload(
  item: ClientAnalysisItem,
  uploadedComponents: ReadonlySet<string>,
): boolean {
  if (!isItemPending(item)) return false;
  const group = componenteGroupKey(item.componenteOrigem);
  return isGroupFileUploaded(group, uploadedComponents);
}
