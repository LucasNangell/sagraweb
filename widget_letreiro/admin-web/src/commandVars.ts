const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const CAPTURE_LINE_RE = /^\s*(?:#|REM|::)\s*letreiro-capture:\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/i;
const CAPTURE_STORAGE_KEY = "letreiro_captured_vars";

export type CapturedOption = { value: string; label: string };

export type CapturedVarSet = {
  sourceName: string;
  sourceCommandId: number;
  options: CapturedOption[];
};

export type CapturedVars = Record<string, CapturedVarSet>;

export function extractCommandVars(content: string | null | undefined): string[] {
  const seen: string[] = [];
  const re = new RegExp(VAR_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(content ?? ""))) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

export function sanitizeVarValue(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\0/g, "").replace(/\r\n|\r|\n/g, " ");
}

export function applyCommandVars(
  content: string | null | undefined,
  values: Record<string, string>,
): { ok: true; content: string } | { ok: false; missing: string[] } {
  const names = extractCommandVars(content);
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    clean[key.trim()] = sanitizeVarValue(value).trim();
  }
  const missing = names.filter((name) => !clean[name]);
  if (missing.length) return { ok: false, missing };
  const re = new RegExp(VAR_RE.source, "g");
  return {
    ok: true,
    content: (content ?? "").replace(re, (_all, name: string) => clean[name] ?? ""),
  };
}

export function readCaptureVar(content: string | null | undefined): string {
  for (const line of (content ?? "").split(/\r?\n/)) {
    const match = line.match(CAPTURE_LINE_RE);
    if (match) return match[1];
  }
  return "";
}

export function stripCaptureLine(content: string | null | undefined): string {
  return (content ?? "")
    .split(/\r?\n/)
    .filter((line) => !CAPTURE_LINE_RE.test(line))
    .join("\n")
    .replace(/^\n+/, "");
}

export function writeCaptureVar(
  content: string | null | undefined,
  kind: string,
  name: string,
): string {
  const body = stripCaptureLine(content);
  const cleaned = (name ?? "").trim();
  if (!cleaned || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)) return body;
  const directive = kind === "ps1" ? `# letreiro-capture: ${cleaned}` : `REM letreiro-capture: ${cleaned}`;
  return body ? `${directive}\n${body}` : `${directive}\n`;
}

function optionFromUnknown(row: unknown): CapturedOption | null {
  if (row == null) return null;
  if (typeof row === "string" || typeof row === "number") {
    const value = String(row).trim();
    return value ? { value, label: value } : null;
  }
  if (typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  const valueRaw = rec.Id ?? rec.id ?? rec.value ?? rec.PID ?? rec.pid ?? rec.Value;
  const title = rec.MainWindowTitle ?? rec.title ?? rec.Title ?? rec.ProcessName ?? rec.name ?? rec.Name ?? rec.label;
  const value = valueRaw == null ? "" : String(valueRaw).trim();
  if (!value) return null;
  const extra = title == null ? "" : String(title).trim();
  return { value, label: extra ? `${value} — ${extra}` : value };
}

function isSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  return /^[-_=]{2,}([\s-_=]*)$/.test(trimmed) && /[-_=]{2,}/.test(trimmed);
}

function parseTableOptions(stdout: string): CapturedOption[] {
  const lines = stdout
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => line.trim());
  const sepIdx = lines.findIndex(isSeparatorLine);
  const dataLines = sepIdx >= 0 ? lines.slice(sepIdx + 1) : lines.filter((line, i) => {
    if (i === 0 && /^\s*id\b/i.test(line)) return false;
    return true;
  });
  const options: CapturedOption[] = [];
  const seen = new Set<string>();
  for (const line of dataLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(ok|fail|timeout)\b/i.test(trimmed)) continue;
    if (/^stderr:/i.test(trimmed)) break;
    const match = trimmed.match(/^(\S+)\s*(.*)$/);
    if (!match) continue;
    const value = match[1];
    if (/^-+$/.test(value) || /^id$/i.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    const rest = match[2].replace(/\s+/g, " ").trim();
    options.push({ value, label: rest ? `${value} — ${rest}` : value });
  }
  return options;
}

export function parseCaptureOptions(stdout: string | null | undefined): CapturedOption[] {
  const text = (stdout ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const fromJson = rows.map(optionFromUnknown).filter((row): row is CapturedOption => !!row);
      if (fromJson.length) return fromJson;
    } catch {
      /* tabela */
    }
  }
  return parseTableOptions(text);
}

export function loadCapturedVars(): CapturedVars {
  try {
    const raw = sessionStorage.getItem(CAPTURE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CapturedVars;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCapturedVars(vars: CapturedVars): void {
  try {
    sessionStorage.setItem(CAPTURE_STORAGE_KEY, JSON.stringify(vars));
  } catch {
    /* quota / private mode */
  }
}

export function applyCapturesFromJobs(
  prev: CapturedVars,
  jobs: { name?: string; status?: string; stdout?: string }[],
  catalog: { id: number; name: string; content: string }[],
): CapturedVars {
  let next = prev;
  for (const job of jobs) {
    if ((job.status ?? "").toLowerCase() !== "ok") continue;
    const cmd = catalog.find((item) => item.name === job.name);
    if (!cmd) continue;
    const varName = readCaptureVar(cmd.content);
    if (!varName) continue;
    next = {
      ...next,
      [varName]: {
        sourceName: cmd.name,
        sourceCommandId: cmd.id,
        options: parseCaptureOptions(job.stdout),
      },
    };
  }
  return next;
}
