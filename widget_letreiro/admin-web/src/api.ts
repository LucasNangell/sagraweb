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

export class HtmlApiResponse extends Error {
  constructor() {
    super("O servidor retornou uma página HTML em vez de uma resposta da API.");
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("X-Letreiro-Admin-Token", token);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Não foi possível conectar ao letreiro neste computador. Abra o SAGRA Letreiro e volte a abrir a administração.");
    throw error;
  }
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
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) throw new HtmlApiResponse();
    throw new Error("O servidor retornou uma resposta inválida da API.", { cause: error });
  }
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

export type StationGroupMember = {
  hostName: string;
  windowsUser: string;
};

export type StationGroup = {
  id: number;
  name: string;
  members: StationGroupMember[];
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
  sound?: string;
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
    notificationSound?: string;
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

export type ConfigProfileAssignment = {
  hostName: string;
  windowsUser: string;
  profileId: number;
  profileName: string;
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
  groups: () => request<{ groups: StationGroup[] }>("/api/letreiro/groups"),
  createGroup: (name: string, members: StationGroupMember[]) =>
    request<{ id: number }>("/api/letreiro/groups", {
      method: "POST",
      body: JSON.stringify({ windowsUser: "", name, members }),
    }),
  updateGroup: (id: number, name: string, members: StationGroupMember[]) =>
    request(`/api/letreiro/groups/${id}`, {
      method: "PUT",
      body: JSON.stringify({ windowsUser: "", name, members }),
    }),
  deleteGroup: (id: number) =>
    request(`/api/letreiro/groups/${id}?windowsUser=`, { method: "DELETE" }),
  runCommand: (
    id: number,
    targets: { hostName: string; windowsUser: string }[],
    allOnline: boolean,
    variables: Record<string, string> = {},
    groupIds: number[] = [],
  ) =>
    request<{ queued: number }>(`/api/letreiro/commands/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ windowsUser: "", allOnline, targets, variables, groupIds }),
    }),
  runAdhoc: (
    kind: string,
    content: string,
    name: string,
    targets: { hostName: string; windowsUser: string }[],
    allOnline: boolean,
    timeoutSec = 60,
    groupIds: number[] = [],
  ) =>
    request<{ queued: number }>("/api/letreiro/jobs/run", {
      method: "POST",
      body: JSON.stringify({ windowsUser: "", kind, content, name, allOnline, targets, timeoutSec, groupIds }),
    }),
  jobs: () => request<{ jobs: Job[] }>("/api/letreiro/jobs"),
  screenshotResult: (id: number) => request<{ stdout: string }>(`/api/letreiro/jobs/${id}/result`),
  screenshotCapability: async () => {
    try {
      return await request<{ highQuality: boolean }>("/api/letreiro/screenshot-capability");
    } catch (error) {
      if (error instanceof HtmlApiResponse || (error instanceof ApiError && error.status === 404)) return { highQuality: false };
      throw error;
    }
  },
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
  configProfileAssignments: () =>
    request<{ assignments: ConfigProfileAssignment[] }>("/local/config-profile-assignments"),
  setConfigProfileAssignment: (hostName: string, windowsUser: string, profileId: number) =>
    request<ConfigProfileAssignment>("/local/config-profile-assignments", {
      method: "PUT",
      body: JSON.stringify({ hostName, windowsUser, profileId }),
    }),
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
    sound?: string;
    visual?: import("./notificationStyle").NotificationVisual;
  }) =>
    request<{ status: string }>("/local/preview-notification", {
      method: "POST",
      body: JSON.stringify(size ?? {}),
    }),
  painelPresets: () =>
    request<{ presets: { id: number; nome: string; payload: unknown }[] }>("/api/letreiro/painel-presets"),
  listSounds: () => request<{ sounds: import("./notificationSounds").LetreiroSound[] }>("/api/letreiro/sounds"),
  uploadSound: async (file: File) => {
    const contentBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
      reader.onload = () => {
        const raw = String(reader.result ?? "");
        const comma = raw.indexOf(",");
        resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
      };
      reader.readAsDataURL(file);
    });
    return request<{ status: string; sound: import("./notificationSounds").LetreiroSound }>("/api/letreiro/sounds", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name || "som.mp3",
        contentBase64,
        windowsUser: "",
      }),
    });
  },
  deleteSound: (id: string) =>
    request(`/api/letreiro/sounds/${encodeURIComponent(id)}?windowsUser=`, { method: "DELETE" }),
  soundUrl: (id: string) => `/api/letreiro/sounds/${encodeURIComponent(id)}`,
  setores: () => request<{ setores: string[] }>("/local/setores"),
  situacoes: () => request<{ situacoes: string[] }>("/local/situacoes"),
};
