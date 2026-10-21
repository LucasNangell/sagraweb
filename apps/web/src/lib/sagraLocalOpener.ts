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
