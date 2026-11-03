import type { Instance, Job } from "./api";

export const DESKTOP_JOB_PREFIX = "sagra-desktop/";
export const QUICK_BUTTONS_KEY = "letreiro_quick_commands_v1";
export type WindowAction = "maximize" | "minimize" | "fullscreen" | "foreground" | "close" | "restore";
export type DesktopWindow = { handle: string; processId: number; processStart: string; title: string; processName: string; state: string; fullscreen: boolean };
export type WindowResult = { type: "windows"; windows: DesktopWindow[]; capturedAt: string; truncated: boolean };
export type ScreenshotResult = { type: "screenshot"; mime: "image/jpeg" | "image/png"; image: string; width: number; height: number; originalWidth: number; originalHeight: number; capturedAt: string };
export type ActionResult = { type: "action"; message: string };

export function desktopTargetKey(row: Pick<Instance, "hostName" | "windowsUser">) {
  return `${row.hostName.trim().toLowerCase()}\n${row.windowsUser.trim().replaceAll("/", "\\").toLowerCase()}`;
}

export function desktopTargetGuard(target: Pick<Instance, "hostName" | "windowsUser">) {
  const host = target.hostName.trim();
  const user = target.windowsUser.trim().replaceAll("/", "\\");
  if (!host || !user || host.length > 128 || user.length > 128 || /[\x00-\x1f]/.test(host + user)) throw new Error("Identidade da estação inválida.");
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  return `$ErrorActionPreference = 'Stop'\n$expectedClientHost = ${literal(host)}\n$expectedClientUser = ${literal(user)}\nif ([Environment]::MachineName -ine $expectedClientHost) { throw 'Esta tarefa pertence a outro computador.' }\n$actualClientUser = [Environment]::UserName\nif ($expectedClientUser.Contains('\\')) { $actualClientUser = [Environment]::UserDomainName + '\\' + $actualClientUser }\nif ($actualClientUser -ine $expectedClientUser) { throw 'Esta tarefa pertence a outra conta do Windows.' }\n`;
}

export function matchesDesktopJob(job: Job, name: string, target: Pick<Instance, "hostName" | "windowsUser">) {
  return job.name === name && desktopTargetKey(job) === desktopTargetKey(target);
}

export function isDesktopJob(job: Pick<Job, "name">) { return job.name.startsWith(DESKTOP_JOB_PREFIX); }

export function desktopJobLabel(job: Pick<Job, "name">) {
  return job.name.startsWith(`${DESKTOP_JOB_PREFIX}screenshot/`) ? "Captura de tela" : job.name.startsWith(`${DESKTOP_JOB_PREFIX}windows/`) ? "Consulta de janelas" : "Controle de janela";
}

export function validWindowIdentity(row: Pick<DesktopWindow, "handle" | "processId" | "processStart">) {
  return typeof row.handle === "string" && /^[1-9]\d{0,18}$/.test(row.handle) && BigInt(row.handle) <= 9223372036854775807n
    && Number.isSafeInteger(row.processId) && row.processId > 0 && row.processId <= 2147483647
    && typeof row.processStart === "string" && /^[1-9]\d{0,18}$/.test(row.processStart) && BigInt(row.processStart) <= 3155378975999999999n;
}

function validJpeg(image: string, width: number, height: number) {
  try {
    const bytes = atob(image);
    if (bytes.length < 100 || bytes.length > 45000 || bytes.charCodeAt(0) !== 255 || bytes.charCodeAt(1) !== 216 || bytes.charCodeAt(2) !== 255
      || bytes.charCodeAt(bytes.length - 2) !== 255 || bytes.charCodeAt(bytes.length - 1) !== 217) return false;
    const byte = (i: number) => bytes.charCodeAt(i);
    for (let offset = 2; offset + 3 < bytes.length;) {
      if (byte(offset++) !== 255) return false;
      while (byte(offset) === 255) offset++;
      const marker = byte(offset++);
      if (marker === 218 || marker === 217) return false;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = byte(offset) * 256 + byte(offset + 1);
      if (length < 2 || offset + length > bytes.length) return false;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        return length >= 8 && byte(offset + 3) * 256 + byte(offset + 4) === height && byte(offset + 5) * 256 + byte(offset + 6) === width;
      }
      offset += length;
    }
    return false;
  } catch { return false; }
}

function validPng(image: string, width: number, height: number) {
  try {
    const bytes = atob(image);
    if (bytes.length < 45 || bytes.length > 45000 || bytes.slice(0, 8) !== "\x89PNG\r\n\x1a\n" || bytes.slice(12, 16) !== "IHDR" || bytes.slice(-8, -4) !== "IEND") return false;
    const num = (i: number) => (((bytes.charCodeAt(i) * 256 + bytes.charCodeAt(i + 1)) * 256 + bytes.charCodeAt(i + 2)) * 256 + bytes.charCodeAt(i + 3));
    return num(8) === 13 && num(16) === width && num(20) === height;
  } catch { return false; }
}

export function windowActionScript(template: string, row: DesktopWindow, action: WindowAction) {
  if (!validWindowIdentity(row) || !["maximize", "minimize", "fullscreen", "foreground", "close", "restore"].includes(action)) throw new Error("Janela ou ação inválida. Atualize a lista.");
  return `${template}\n$message = [SagraDesktop]::Act([long]${row.handle}, [int]${row.processId}, [long]${row.processStart}, '${action}')\n@{ type = 'action'; message = $message } | ConvertTo-Json -Compress`;
}

export function parseDesktopResult(raw: string): WindowResult | ScreenshotResult | ActionResult {
  if (raw.length > 64 * 1024) throw new Error("Resposta do client excedeu o limite permitido.");
  let value: unknown;
  try { value = JSON.parse(raw.replace(/^\uFEFF/, "").trim()); } catch { throw new Error("O client retornou uma resposta inválida. Atualize a lista ou tente novamente."); }
  if (!value || typeof value !== "object") throw new Error("Resposta inválida do client.");
  const row = value as Record<string, unknown>;
  if (row.type === "windows" && Array.isArray(row.windows) && row.windows.length <= 100 && typeof row.capturedAt === "string" && Number.isFinite(Date.parse(row.capturedAt))) {
    const windows: DesktopWindow[] = row.windows.map((item: unknown) => {
      if (!item || typeof item !== "object") throw new Error("Lista de janelas inválida.");
      const w = item as DesktopWindow;
      if (!validWindowIdentity(w) || typeof w.title !== "string" || w.title.length > 200 || typeof w.processName !== "string" || w.processName.length > 260 || !["normal", "minimized", "maximized"].includes(w.state) || typeof w.fullscreen !== "boolean") throw new Error("Janela inválida na resposta do client.");
      return { handle: w.handle, processId: w.processId, processStart: w.processStart, title: w.title, processName: w.processName, state: w.state, fullscreen: w.fullscreen };
    });
    return { type: "windows", windows, capturedAt: row.capturedAt, truncated: row.truncated === true };
  }
  if (row.type === "screenshot" && (row.mime === "image/jpeg" || row.mime === "image/png") && typeof row.image === "string" && row.image.length <= 60000 && row.image.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(row.image)
      && Number.isInteger(row.width) && Number(row.width) > 0 && Number(row.width) <= 32767 && Number.isInteger(row.height) && Number(row.height) > 0 && Number(row.height) <= 32767 && Number(row.width) * Number(row.height) <= 64000000
      && Number.isInteger(row.originalWidth) && Number(row.originalWidth) > 0 && Number(row.originalWidth) <= 64000000 && Number.isInteger(row.originalHeight) && Number(row.originalHeight) > 0 && Number(row.originalHeight) <= 64000000
      && typeof row.capturedAt === "string" && Number.isFinite(Date.parse(row.capturedAt)) && (row.mime === "image/jpeg" ? validJpeg(row.image, Number(row.width), Number(row.height)) : validPng(row.image, Number(row.width), Number(row.height)))) return row as ScreenshotResult;
  if (row.type === "action" && typeof row.message === "string" && row.message.length <= 500) return { type: "action", message: row.message };
  throw new Error("Resposta do client incompatível com esta ação.");
}

export function parseQuickButtons(raw: string | null): number[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0))].slice(0, 20) : [];
  } catch { return []; }
}
