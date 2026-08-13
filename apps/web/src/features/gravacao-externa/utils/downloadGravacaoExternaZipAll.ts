/** Download grande: gesto → rede → gravação (sem carregar o ZIP inteiro em Blob). */

export type DownloadAllPhase = "idle" | "preparing" | "saving" | "started" | "error";

async function parseDownloadError(res: Response): Promise<string> {
  const text = await res.text().catch(() => res.statusText);
  try {
    const data = JSON.parse(text) as { detail?: unknown; message?: string };
    if (typeof data.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
  } catch {
    /* ignore */
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 200) || `Erro ${res.status}`;
}

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
};

type FileSystemWritableFileStream = WritableStream<Uint8Array> & {
  write?: (data: Blob | BufferSource | string) => Promise<void>;
  close?: () => Promise<void>;
  abort?: (reason?: unknown) => Promise<void>;
};

type SaveFileHandle = {
  createWritable: () => Promise<FileSystemWritableFileStream>;
  getFile?: () => Promise<File>;
  remove?: () => Promise<void>;
};

type ShowSaveFilePicker = (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;

function getShowSaveFilePicker(): ShowSaveFilePicker | null {
  const w = window as Window & { showSaveFilePicker?: ShowSaveFilePicker };
  return typeof w.showSaveFilePicker === "function" ? w.showSaveFilePicker.bind(w) : null;
}

function triggerBrowserDownload(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function isGestureOrSecurityError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  if (err.name === "SecurityError" || err.name === "NotAllowedError") return true;
  return /user gesture|user activation/i.test(err.message);
}

class ApiDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiDownloadError";
  }
}

async function abortWritable(writable: FileSystemWritableFileStream | null): Promise<void> {
  if (!writable) return;
  try {
    await writable.abort?.();
  } catch {
    try {
      await writable.close?.();
    } catch {
      /* ignore */
    }
  }
}

async function removeSavedFile(handle: SaveFileHandle): Promise<void> {
  try {
    await handle.remove?.();
  } catch {
    /* ignore — API opcional / permissão */
  }
}

/**
 * Baixa o ZIP de todos os arquivos.
 * Ordem: abrir picker no gesto do clique → fetch → pipeTo.
 * Sem FS Access / falha de gesto: um único download nativo do navegador.
 */
export async function downloadGravacaoExternaZipAll(
  url: string,
  opts: {
    fallbackFilename: string;
    onPhase?: (phase: DownloadAllPhase) => void;
  },
): Promise<void> {
  const { fallbackFilename, onPhase } = opts;
  const picker = getShowSaveFilePicker();

  let handle: SaveFileHandle | null = null;
  if (picker) {
    try {
      // Deve rodar ainda no stack do click (antes de qualquer await de rede).
      handle = await picker({
        suggestedName: fallbackFilename,
        types: [
          {
            description: "Arquivo ZIP",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
    } catch (err) {
      if (isAbortError(err)) {
        onPhase?.("idle");
        return;
      }
      // Gesto expirado / API bloqueada → download nativo (sem fetch descartável).
      if (isGestureOrSecurityError(err)) {
        onPhase?.("started");
        triggerBrowserDownload(url);
        return;
      }
      onPhase?.("error");
      throw err instanceof Error ? err : new Error("Falha ao abrir o diálogo de salvar.");
    }
  }

  if (!handle) {
    onPhase?.("started");
    triggerBrowserDownload(url);
    return;
  }

  onPhase?.("preparing");
  let writable: FileSystemWritableFileStream | null = null;

  try {
    writable = await handle.createWritable();

    const res = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/zip, application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!res.ok) {
      await abortWritable(writable);
      writable = null;
      await removeSavedFile(handle);
      const message = await parseDownloadError(res);
      onPhase?.("error");
      throw new ApiDownloadError(message);
    }

    if (!res.body) {
      await abortWritable(writable);
      writable = null;
      await removeSavedFile(handle);
      onPhase?.("started");
      triggerBrowserDownload(url);
      return;
    }

    onPhase?.("saving");
    await res.body.pipeTo(writable as unknown as WritableStream<Uint8Array>);
    writable = null;

    const expectedLen = res.headers.get("Content-Length");
    if (expectedLen && handle.getFile) {
      const expected = Number(expectedLen);
      if (Number.isFinite(expected) && expected >= 0) {
        const saved = await handle.getFile();
        if (saved.size !== expected) {
          await removeSavedFile(handle);
          onPhase?.("started");
          triggerBrowserDownload(url);
          return;
        }
      }
    }

    onPhase?.("idle");
  } catch (err) {
    await abortWritable(writable);
    writable = null;

    if (err instanceof ApiDownloadError) {
      throw err;
    }

    if (isAbortError(err)) {
      await removeSavedFile(handle);
      onPhase?.("idle");
      return;
    }

    // pipeTo / rede falhou após picker aberto → tentar gerenciador de downloads.
    await removeSavedFile(handle);
    onPhase?.("started");
    triggerBrowserDownload(url);
  }
}
