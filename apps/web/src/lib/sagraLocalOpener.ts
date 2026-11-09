const LOCAL_OPENER_BASE = "http://127.0.0.1:5566";
const PRINT_TIMEOUT_MS = 90_000;

export const SEPARADOR_PRINTER_STORAGE_KEY = "sagra.separador.printer";

async function postLocalOpener(
  endpoint: "open-folder" | "open-file",
  path: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_OPENER_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function tryOpenFolderLocally(path: string): Promise<boolean> {
  return postLocalOpener("open-folder", path);
}

export async function tryOpenFileLocally(path: string): Promise<boolean> {
  return postLocalOpener("open-file", path);
}

export async function openPathLocally(
  path: string,
  kind: "folder" | "file",
): Promise<boolean> {
  return kind === "file" ? tryOpenFileLocally(path) : tryOpenFolderLocally(path);
}

export type LocalPrintersResult =
  | { ok: true; printers: string[]; defaultPrinter: string | null }
  | { ok: false; error: string };

export type LocalPrintResult = { ok: true } | { ok: false; error: string };

export async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Falha ao ler o PDF"));
    };
    reader.readAsDataURL(blob);
  });
}

export async function fetchLocalPrinters(): Promise<LocalPrintersResult> {
  try {
    const res = await fetch(`${LOCAL_OPENER_BASE}/printers`, {
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 404) {
      return {
        ok: false,
        error:
          "Atualize o Folder Opener para a versão 1.2 neste computador. O Chrome não consegue forçar o papel 102 × 297 mm.",
      };
    }
    const data = (await res.json()) as {
      success?: boolean;
      printers?: string[];
      default?: string | null;
      error?: string;
    };
    if (!res.ok || data.success === false) {
      return {
        ok: false,
        error:
          data.error ||
          "Não foi possível listar as impressoras deste computador.",
      };
    }
    const printers = (data.printers ?? []).filter(
      (name) => typeof name === "string" && name.trim().length > 0,
    );
    return {
      ok: true,
      printers,
      defaultPrinter: data.default ?? null,
    };
  } catch {
    return {
      ok: false,
      error:
        "Folder Opener não está em execução neste computador (127.0.0.1:5566). Inicie a versão 1.2 ou superior.",
    };
  }
}

export type LocalPdfCompareProbe =
  | { ok: true; version: string }
  | { ok: false; error: string };

export type LocalPdfCompareStartInput = {
  previousPath: string;
  currentPath: string;
  previousRelative?: string;
  currentRelative?: string;
  dpi: number;
  threshold: number;
  includeUnchanged: boolean;
  ano?: number;
  osId?: number;
};

export async function probeLocalPdfCompare(): Promise<LocalPdfCompareProbe> {
  try {
    const res = await fetch(`${LOCAL_OPENER_BASE}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return { ok: false, error: `Folder Opener health HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      version?: string;
      pdf_compare?: boolean;
    };
    if (data.pdf_compare !== true) {
      return {
        ok: false,
        error:
          "Folder Opener sem suporte a comparação PDF (atualize para 1.3+).",
      };
    }
    return { ok: true, version: String(data.version || "1.3") };
  } catch {
    return {
      ok: false,
      error: "Folder Opener não está em execução neste computador.",
    };
  }
}

export async function startLocalPdfCompare(
  input: LocalPdfCompareStartInput,
): Promise<{ session_id: string; message: string }> {
  const res = await fetch(`${LOCAL_OPENER_BASE}/pdf-compare/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      previous_path: input.previousPath,
      current_path: input.currentPath,
      previous_relative: input.previousRelative,
      current_relative: input.currentRelative,
      dpi: input.dpi,
      threshold: input.threshold,
      include_unchanged: input.includeUnchanged,
      ano: input.ano,
      os_id: input.osId,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    session_id?: string;
    message?: string;
    error?: string;
  };
  if (!res.ok || !data.session_id) {
    throw new Error(
      data.error || `Falha ao iniciar comparação local (${res.status}).`,
    );
  }
  return {
    session_id: data.session_id,
    message: data.message || "Comparação local iniciada.",
  };
}

export async function fetchLocalPdfCompareProgress(
  sessionId: string,
): Promise<{
  sessionId: string;
  stage: string;
  current: number;
  total: number;
  message: string;
  pct: number;
  done: boolean;
  cancelled?: boolean;
  error?: string | null;
}> {
  const res = await fetch(
    `${LOCAL_OPENER_BASE}/pdf-compare/${encodeURIComponent(sessionId)}/progress`,
    { signal: AbortSignal.timeout(10000) },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      String(data.error || `Falha ao consultar progresso local (${res.status}).`),
    );
  }
  return data as {
    sessionId: string;
    stage: string;
    current: number;
    total: number;
    message: string;
    pct: number;
    done: boolean;
    cancelled?: boolean;
    error?: string | null;
  };
}

export async function fetchLocalPdfCompareResult(
  sessionId: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${LOCAL_OPENER_BASE}/pdf-compare/${encodeURIComponent(sessionId)}`,
    { signal: AbortSignal.timeout(30000) },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      String(data.error || `Falha ao obter resultado local (${res.status}).`),
    );
  }
  return data;
}

export async function cancelLocalPdfCompare(sessionId: string): Promise<void> {
  const res = await fetch(
    `${LOCAL_OPENER_BASE}/pdf-compare/${encodeURIComponent(sessionId)}/cancel`,
    { method: "POST", signal: AbortSignal.timeout(10000) },
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Falha ao cancelar (${res.status}).`);
  }
}

export async function downloadLocalPdfCompareReport(
  sessionId: string,
  includeUnchanged: boolean,
  downloadName: string,
): Promise<void> {
  const res = await fetch(
    `${LOCAL_OPENER_BASE}/pdf-compare/${encodeURIComponent(sessionId)}/report`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ include_unchanged: includeUnchanged }),
      signal: AbortSignal.timeout(180_000),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Falha ao baixar relatório local (${res.status}).`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function printPdfLocally(input: {
  printer: string;
  pdf: Blob;
  widthMm?: number;
  heightMm?: number;
}): Promise<LocalPrintResult> {
  const printer = input.printer.trim();
  if (!printer) {
    return { ok: false, error: "Selecione uma impressora." };
  }
  try {
    const pdfBase64 = await blobToBase64(input.pdf);
    const res = await fetch(`${LOCAL_OPENER_BASE}/print-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        printer,
        pdf_base64: pdfBase64,
        width_mm: input.widthMm ?? 102,
        height_mm: input.heightMm ?? 297,
      }),
      signal: AbortSignal.timeout(PRINT_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
    };
    if (!res.ok || data.success !== true) {
      return {
        ok: false,
        error: data.error || `Falha ao imprimir (${res.status}).`,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        "Não foi possível enviar o PDF ao Folder Opener. Confirme se o serviço 1.2 está ativo.",
    };
  }
}
