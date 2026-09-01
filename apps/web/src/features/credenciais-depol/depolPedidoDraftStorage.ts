/** Persistência local do rascunho do pedido DEPOL (sobrevive a refresh/navegação). */

export type CredenciaisDepolDraftItem = {
  key: string;
  modelo_arquivo: string;
  linha1: string;
  linha2: string;
  linha3: string;
};

export const DEPOL_DRAFT_STORAGE_STAFF =
  "sagra.credenciais-depol.pedido-draft.staff";
export const DEPOL_DRAFT_STORAGE_CLIENTE =
  "sagra.credenciais-depol.pedido-draft.cliente";

export function clienteDepolDraftStorageKey(clienteId: number): string {
  const id = Number.isFinite(clienteId) && clienteId > 0 ? Math.trunc(clienteId) : 0;
  return `${DEPOL_DRAFT_STORAGE_CLIENTE}.${id}`;
}

function isDraftItem(v: unknown): v is CredenciaisDepolDraftItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.key === "string" &&
    typeof o.modelo_arquivo === "string" &&
    typeof o.linha1 === "string" &&
    typeof o.linha2 === "string" &&
    typeof o.linha3 === "string"
  );
}

/** Valida e normaliza um valor já parseado (API ou JSON). */
export function normalizeDepolPedidoDraft(data: unknown): CredenciaisDepolDraftItem[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isDraftItem).map((item) => ({
    key: item.key,
    modelo_arquivo: item.modelo_arquivo,
    linha1: item.linha1,
    linha2: item.linha2,
    linha3: item.linha3,
  }));
}

/** Valida e normaliza o JSON do localStorage. */
export function parseDepolPedidoDraft(raw: string | null): CredenciaisDepolDraftItem[] {
  if (!raw) return [];
  try {
    return normalizeDepolPedidoDraft(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function loadDepolPedidoDraft(storageKey: string): CredenciaisDepolDraftItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return parseDepolPedidoDraft(localStorage.getItem(storageKey));
  } catch {
    return [];
  }
}

/** Carrega o rascunho do cliente; migra a chave antiga compartilhada se existir. */
export function loadClienteDepolPedidoDraft(clienteId: number): CredenciaisDepolDraftItem[] {
  const key = clienteDepolDraftStorageKey(clienteId);
  const scoped = loadDepolPedidoDraft(key);
  if (scoped.length) return scoped;
  const legacy = loadDepolPedidoDraft(DEPOL_DRAFT_STORAGE_CLIENTE);
  if (!legacy.length) return [];
  saveDepolPedidoDraft(key, legacy);
  clearDepolPedidoDraft(DEPOL_DRAFT_STORAGE_CLIENTE);
  return legacy;
}

export function saveDepolPedidoDraft(
  storageKey: string,
  items: CredenciaisDepolDraftItem[],
): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (!items.length) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    // quota / private mode — não bloqueia o fluxo
  }
}

export function clearDepolPedidoDraft(storageKey: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
}

/** Conta remota prevalece; se estiver vazia, o localStorage é enviado ao servidor. */
export function resolveHydratedDepolDraft(
  local: CredenciaisDepolDraftItem[],
  remote: CredenciaisDepolDraftItem[],
): { items: CredenciaisDepolDraftItem[]; shouldPushLocalToRemote: boolean } {
  if (remote.length > 0) {
    return { items: remote, shouldPushLocalToRemote: false };
  }
  if (local.length > 0) {
    return { items: local, shouldPushLocalToRemote: true };
  }
  return { items: [], shouldPushLocalToRemote: false };
}
