const STORAGE_KEY = "sagra_painel_client_id";
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

function randomClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `painel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getPainelClientId(): string {
  const existing = localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  if (CLIENT_ID_RE.test(existing)) {
    return existing;
  }
  const created = randomClientId();
  localStorage.setItem(STORAGE_KEY, created);
  return created;
}

export function isPainelConfigUpdateMessage(
  data: unknown,
  clientId: string,
): data is {
  type: "painel_config_update";
  target_client_id?: string;
  payload?: unknown;
  sector?: string;
} {
  if (!data || typeof data !== "object") {
    return false;
  }
  const message = data as {
    type?: string;
    target_client_id?: string;
    payload?: unknown;
    sector?: string;
  };
  if (message.type !== "painel_config_update") {
    return false;
  }
  return String(message.target_client_id || "").trim() === clientId;
}
