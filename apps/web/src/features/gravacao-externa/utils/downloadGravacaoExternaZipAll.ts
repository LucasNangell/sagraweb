/** Download grande: job em background + blocos Range (sem carregar o ZIP inteiro em Blob). */

import {
  getGravacaoExternaZipStatus,
  gravacaoExternaZipDownloadUrl,
  startGravacaoExternaZip,
  type GravacaoExternaZipStatus,
} from "@/api/gravacaoExterna";

export type DownloadAllPhase = "idle" | "preparing" | "saving" | "started" | "error";

export type DownloadAllProgress = {
  phase: DownloadAllPhase;
  arquivosProntos?: number;
  totalArquivos?: number;
  bytesReceived?: number;
  totalBytes?: number;
};

const DEFAULT_CHUNK_SIZE = 16 * 1024 * 1024;
const DEFAULT_CHUNK_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_CHUNK_RETRIES = 5;

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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function quotedEtag(etag: string | null | undefined): string | null {
  if (!etag) return null;
  const trimmed = etag.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('"') ? trimmed : `"${trimmed}"`;
}

async function waitForZipReady(opts: {
  ano: number;
  nrOs: number;
  gravacaoExternaId?: number | null;
  pollIntervalMs: number;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadAllProgress) => void;
}): Promise<GravacaoExternaZipStatus> {
  let job = opts.gravacaoExternaId == null
    ? await startGravacaoExternaZip(opts.ano, opts.nrOs)
    : await startGravacaoExternaZip(opts.ano, opts.nrOs, opts.gravacaoExternaId);
  const emit = (current: GravacaoExternaZipStatus) => {
    opts.onProgress?.({
      phase: "preparing",
      arquivosProntos: current.arquivos_prontos,
      totalArquivos: current.total_arquivos,
    });
  };
  emit(job);
  while (job.status !== "pronto") {
    throwIfAborted(opts.signal);
    if (job.status === "erro") {
      throw new ApiDownloadError(job.erro?.trim() || "Falha ao preparar o ZIP.");
    }
    await sleep(opts.pollIntervalMs, opts.signal);
    job = opts.gravacaoExternaId == null
      ? await getGravacaoExternaZipStatus(opts.ano, opts.nrOs)
      : await getGravacaoExternaZipStatus(opts.ano, opts.nrOs, opts.gravacaoExternaId);
    emit(job);
  }
  return job;
}

function backoffMs(attempt: number): number {
  return Math.min(8_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

async function fetchRangeChunk(opts: {
  url: string;
  start: number;
  end: number;
  etag: string | null;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);
  const timer = window.setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/zip, application/json",
      "X-Requested-With": "XMLHttpRequest",
      Range: `bytes=${opts.start}-${opts.end}`,
    };
    if (opts.etag) {
      headers["If-Range"] = opts.etag;
    }
    return await fetch(opts.url, {
      credentials: "include",
      headers,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

async function downloadZipInChunks(opts: {
  url: string;
  job: GravacaoExternaZipStatus;
  writable: FileSystemWritableFileStream;
  chunkSize: number;
  chunkTimeoutMs: number;
  maxChunkRetries: number;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadAllProgress) => void;
}): Promise<void> {
  const etag = quotedEtag(opts.job.etag);
  let offset = 0;
  const total = Math.max(0, Number(opts.job.tamanho_bytes) || 0);
  opts.onProgress?.({
    phase: "saving",
    bytesReceived: 0,
    totalBytes: total || undefined,
  });

  while (total <= 0 || offset < total) {
    throwIfAborted(opts.signal);
    const end = opts.chunkSize > 0 ? offset + opts.chunkSize - 1 : offset;
    let lastError: unknown;
    let succeeded = false;
    for (let attempt = 1; attempt <= opts.maxChunkRetries; attempt += 1) {
      throwIfAborted(opts.signal);
      try {
        const res = await fetchRangeChunk({
          url: opts.url,
          start: offset,
          end,
          etag,
          timeoutMs: opts.chunkTimeoutMs,
          signal: opts.signal,
        });
        if (res.status === 409 || (res.status >= 400 && res.status !== 504 && res.status !== 502 && res.status !== 503)) {
          const message = await parseDownloadError(res);
          throw new ApiDownloadError(message);
        }
        if (!res.ok && res.status !== 206) {
          throw new Error(`HTTP ${res.status}`);
        }
        if (res.status === 200) {
          if (offset > 0) {
            throw new ApiDownloadError(
              "O ZIP foi atualizado no servidor. Clique em Baixar todos novamente.",
            );
          }
          if (!res.body) {
            throw new Error("Resposta sem corpo.");
          }
          await res.body.pipeTo(opts.writable as unknown as WritableStream<Uint8Array>);
          return;
        }
        const buf = await res.arrayBuffer();
        if (buf.byteLength === 0) {
          throw new Error("Bloco vazio.");
        }
        await opts.writable.write?.(buf);
        offset += buf.byteLength;
        opts.onProgress?.({
          phase: "saving",
          bytesReceived: offset,
          totalBytes: total || undefined,
        });
        succeeded = true;
        break;
      } catch (err) {
        if (err instanceof ApiDownloadError) {
          throw err;
        }
        if (isAbortError(err) && opts.signal?.aborted) {
          throw err;
        }
        lastError = err;
        if (attempt < opts.maxChunkRetries) {
          await sleep(backoffMs(attempt), opts.signal);
        }
      }
    }
    if (!succeeded) {
      const message =
        lastError instanceof Error ? lastError.message : "Falha de rede no download.";
      throw new ApiDownloadError(
        `Não foi possível baixar o ZIP (${message}). Verifique a conexão e tente novamente.`,
      );
    }
    if (total <= 0) {
      break;
    }
  }
  await opts.writable.close?.();
}

/**
 * Prepara o ZIP em background e baixa em blocos com retomada.
 * Ordem: abrir picker no gesto do clique → job/poll → Range.
 * Sem FS Access / falha de gesto: download nativo do ZIP já pronto.
 */
export async function downloadGravacaoExternaZipAll(opts: {
  ano: number;
  nrOs: number;
  gravacaoExternaId?: number | null;
  fallbackFilename: string;
  onPhase?: (phase: DownloadAllPhase) => void;
  onProgress?: (progress: DownloadAllProgress) => void;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  chunkSize?: number;
  chunkTimeoutMs?: number;
  maxChunkRetries?: number;
}): Promise<void> {
  const {
    ano,
    nrOs,
    gravacaoExternaId,
    fallbackFilename,
    onPhase,
    onProgress,
    signal,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    chunkSize = DEFAULT_CHUNK_SIZE,
    chunkTimeoutMs = DEFAULT_CHUNK_TIMEOUT_MS,
    maxChunkRetries = DEFAULT_MAX_CHUNK_RETRIES,
  } = opts;

  const emit = (phase: DownloadAllPhase, extra?: Omit<DownloadAllProgress, "phase">) => {
    onPhase?.(phase);
    onProgress?.({ phase, ...extra });
  };

  const picker = getShowSaveFilePicker();
  let handle: SaveFileHandle | null = null;
  if (picker) {
    try {
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
        emit("idle");
        return;
      }
      if (!isGestureOrSecurityError(err)) {
        emit("error");
        throw err instanceof Error ? err : new Error("Falha ao abrir o diálogo de salvar.");
      }
    }
  }

  emit("preparing");
  let writable: FileSystemWritableFileStream | null = null;

  try {
    throwIfAborted(signal);
    const job = await waitForZipReady({
      ano,
      nrOs,
      gravacaoExternaId,
      pollIntervalMs,
      signal,
      onProgress,
    });
    const url = gravacaoExternaId == null
      ? gravacaoExternaZipDownloadUrl(ano, nrOs)
      : gravacaoExternaZipDownloadUrl(ano, nrOs, gravacaoExternaId);

    if (!handle) {
      emit("started");
      triggerBrowserDownload(url);
      return;
    }

    writable = await handle.createWritable();
    emit("saving", {
      bytesReceived: 0,
      totalBytes: job.tamanho_bytes ?? undefined,
    });
    await downloadZipInChunks({
      url,
      job,
      writable,
      chunkSize,
      chunkTimeoutMs,
      maxChunkRetries,
      signal,
      onProgress,
    });
    writable = null;
    emit("idle");
  } catch (err) {
    await abortWritable(writable);
    writable = null;
    if (handle) {
      await removeSavedFile(handle);
    }
    if (err instanceof ApiDownloadError) {
      emit("error");
      throw err;
    }
    if (isAbortError(err)) {
      emit("idle");
      return;
    }
    emit("error");
    throw err instanceof Error ? err : new Error("Não foi possível baixar os arquivos.");
  }
}
