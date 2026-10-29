const TOKEN_KEY = "letreiro_admin_t";

function readToken(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("t") ?? "";
  if (fromUrl) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    const url = new URL(window.location.href);
    url.searchParams.delete("t");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    return fromUrl;
  }
  return sessionStorage.getItem(TOKEN_KEY) ?? "";
}

const token = readToken();

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("X-Letreiro-Admin-Token", token);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      if (parsed.detail) detail = parsed.detail;
    } catch {
      /* keep raw */
    }
    throw new ApiError(res.status, detail || `HTTP ${res.status}`);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export type Instance = {
  hostName: string;
  windowsUser: string;
  nome: string;
  setor: string;
  version: string;
  ponto: string;
  lastSeen?: string | null;
  online: boolean;
  hasConfig: boolean;
};

export type Command = {
  id: number;
  name: string;
  kind: string;
  content: string;
  timeoutSec: number;
};

export type Job = {
  id: number;
  name: string;
  kind: string;
  hostName: string;
  windowsUser: string;
  status: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  createdAt?: string | null;
};

export type BoardColumn = {
  id?: string;
  title?: string;
  statuses?: string[];
  sector?: string;
  source?: string;
  hideWhenEmpty?: boolean;
  notify?: boolean;
  ponto?: string;
  observacao?: string;
  animation?: string;
};

export type AppConfig = {
  apiBaseUrl?: string;
  sslVerify?: boolean;
  ponto?: string;
  nome?: string;
  password?: string;
  pollIntervalSec?: number;
  window?: {
    width?: number;
    x?: number | null;
    opacity?: number;
    speedPxPerSec?: number;
    transparentBg?: boolean;
    notificationsEnabled?: boolean;
    notificationWidth?: number;
    notificationHeight?: number;
    notificationTitleFontSize?: number;
    notificationSituationFontSize?: number;
    notificationPadX?: number;
    notificationTextGap?: number;
    notificationOffsetRight?: number;
    notificationOffsetBottom?: number;
    notificationAnimation?: string;
    notificationVisual?: import("./notificationStyle").NotificationVisual;
    tickerHtml?: boolean;
    tickerCardModel?: string;
  };
  board?: {
    sector?: string;
    columnCount?: number;
    columns?: BoardColumn[];
    showOs?: boolean;
    showSp?: boolean;
  };
};

export type ConfigProfile = {
  id: number;
  name: string;
  payload: AppConfig;
};

export const api = {
  instances: () => request<{ instances: Instance[] }>("/api/letreiro/instances"),
  saveProfile: (hostName: string, targetUser: string, nome: string, setor: string) =>
    request("/api/letreiro/instances", {
      method: "PUT",
      body: JSON.stringify({ hostName, targetUser, nome, setor, windowsUser: "" }),
    }),
  getConfig: (host: string, user: string) =>
    request<{ payload: AppConfig | null }>(
      `/api/letreiro/config?host=${encodeURIComponent(host)}&user=${encodeURIComponent(user)}`,
    ),
  putConfig: (payload: AppConfig, hostName?: string, targetUser?: string, applyToAll = false) =>
    request("/api/letreiro/config", {
      method: "PUT",
      body: JSON.stringify({ payload, hostName, targetUser, applyToAll, windowsUser: "" }),
    }),
  commands: () => request<{ commands: Command[] }>("/api/letreiro/commands"),
  createCommand: (command: Omit<Command, "id">) =>
    request<{ id: number }>("/api/letreiro/commands", {
      method: "POST",
      body: JSON.stringify({ ...command, windowsUser: "" }),
    }),
  updateCommand: (command: Command) =>
    request(`/api/letreiro/commands/${command.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...command, windowsUser: "" }),
    }),
  deleteCommand: (id: number) =>
    request(`/api/letreiro/commands/${id}?windowsUser=`, { method: "DELETE" }),
  runCommand: (
    id: number,
    targets: { hostName: string; windowsUser: string }[],
    allOnline: boolean,
    variables: Record<string, string> = {},
  ) =>
    request<{ queued: number }>(`/api/letreiro/commands/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ windowsUser: "", allOnline, targets, variables }),
    }),
  runAdhoc: (
    kind: string,
    content: string,
    name: string,
    targets: { hostName: string; windowsUser: string }[],
    allOnline: boolean,
    timeoutSec = 60,
  ) =>
    request<{ queued: number }>("/api/letreiro/jobs/run", {
      method: "POST",
      body: JSON.stringify({ windowsUser: "", kind, content, name, allOnline, targets, timeoutSec }),
    }),
  jobs: () => request<{ jobs: Job[] }>("/api/letreiro/jobs"),
  clearJobs: () => request("/api/letreiro/jobs?windowsUser=", { method: "DELETE" }),
  settings: () => request<{ commandPollIntervalSec: number }>("/api/letreiro/settings"),
  saveSettings: (commandPollIntervalSec: number) =>
    request("/api/letreiro/settings", {
      method: "PUT",
      body: JSON.stringify({ windowsUser: "", commandPollIntervalSec }),
    }),
  me: () => request<{ isAdmin: boolean }>("/local/me"),
  localConfig: () => request<AppConfig>("/local/config"),
  saveLocalConfig: (payload: AppConfig) =>
    request<AppConfig>("/local/config", { method: "PUT", body: JSON.stringify(payload) }),
  restoreBoard: () => request<AppConfig>("/local/restore-board", { method: "POST", body: "{}" }),
  configProfiles: () => request<{ profiles: ConfigProfile[] }>("/local/config-profiles"),
  saveConfigProfile: (name: string, payload?: AppConfig) =>
    request<ConfigProfile>("/local/config-profiles", {
      method: "POST",
      body: JSON.stringify({ name, payload }),
    }),
  updateConfigProfile: (id: number, name: string, payload?: AppConfig) =>
    request<ConfigProfile>(`/local/config-profiles/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, payload }),
    }),
  deleteConfigProfile: (id: number) =>
    request("/local/config-profiles/" + id, { method: "DELETE" }),
  previewNotification: (size?: {
    width?: number;
    height?: number;
    titleFontSize?: number;
    situationFontSize?: number;
    padX?: number;
    textGap?: number;
    priority?: string;
    offsetRight?: number;
    offsetBottom?: number;
    animation?: string;
    visual?: import("./notificationStyle").NotificationVisual;
  }) =>
    request<{ status: string }>("/local/preview-notification", {
      method: "POST",
      body: JSON.stringify(size ?? {}),
    }),
  painelPresets: () =>
    request<{ presets: { id: number; nome: string; payload: unknown }[] }>("/api/letreiro/painel-presets"),
  setores: () => request<{ setores: string[] }>("/local/setores"),
  situacoes: () => request<{ situacoes: string[] }>("/local/situacoes"),
};
