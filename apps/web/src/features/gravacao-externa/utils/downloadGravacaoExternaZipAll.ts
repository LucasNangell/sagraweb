/** Download grande sem carregar o ZIP inteiro em Blob no JS. */

export type DownloadAllPhase = "idle" | "preparing" | "saving" | "started" | "error";

function filenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

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
};

type ShowSaveFilePicker = (options?: SaveFilePickerOptions) => Promise<{
  createWritable: () => Promise<FileSystemWritableFileStream>;
}>;

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

/**
 * Baixa o ZIP de todos os arquivos.
 * Preferencial: File System Access + pipe (sem OOM).
 * Fallback: dispara download no navegador (segundo request).
 */
export async function downloadGravacaoExternaZipAll(
  url: string,
  opts: {
    fallbackFilename: string;
    onPhase?: (phase: DownloadAllPhase) => void;
  },
): Promise<void> {
  const { fallbackFilename, onPhase } = opts;
  onPhase?.("preparing");

  const res = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "application/zip, application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  if (!res.ok) {
    const message = await parseDownloadError(res);
    onPhase?.("error");
    throw new Error(message);
  }

  const filename = filenameFromContentDisposition(
    res.headers.get("Content-Disposition"),
    fallbackFilename,
  );
  const picker = getShowSaveFilePicker();

  if (picker && res.body) {
    onPhase?.("saving");
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: "Arquivo ZIP",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await res.body.pipeTo(writable as unknown as WritableStream<Uint8Array>);
      onPhase?.("idle");
      return;
    } catch (err) {
      // Usuário cancelou o diálogo de salvar → abortar sem fallback (já consumimos o body).
      if (err instanceof DOMException && err.name === "AbortError") {
        onPhase?.("idle");
        return;
      }
      // Se o picker falhar de outra forma, não dá para reutilizar res.body.
      onPhase?.("error");
      throw err instanceof Error ? err : new Error("Falha ao salvar o arquivo.");
    }
  }

  // Sem FS Access: não bufferizar o body em Blob. Cancela a leitura e deixa o navegador baixar.
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
  onPhase?.("started");
  triggerBrowserDownload(url);
}
