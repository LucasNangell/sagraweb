import { apiFetch, apiUrl } from "@/api/client";

import { timingFieldsFromEvent } from "@/features/analise/preAnaliseUtils";

import type {
  PreAnaliseCheckMeta,
  PreAnaliseCheckResult,
  PreAnaliseLiveState,
  PreAnaliseStreamEvent,
} from "@/features/analise/preAnaliseTypes";

export interface PreAnaliseEstimateResponse {
  status: string;
  total_sec: number;
  setup_sec?: number;
  has_history?: boolean;
  sample_count?: number;
  workload?: {
    pdf_count: number;
    total_pages: number;
    formato_bucket: string;
  };
}

const STREAM_TIMEOUT_MS = 180_000;

export interface PreAnaliseRunOptions {
  /** Sinal para cancelar a requisição (botão Cancelar). */
  signal?: AbortSignal;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function wasUserCancel(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted);
}

export async function fetchPreAnaliseChecks(
  signal?: AbortSignal,
): Promise<PreAnaliseCheckMeta[]> {
  const data = await apiFetch<{ checks?: PreAnaliseCheckMeta[] }>(
    "/analise/pre-analise/checks",
    { signal },
  );
  return data.checks ?? [];
}

export async function streamPreAnaliseRunAll(
  ano: number,
  osId: number,
  versaoLabel: string,
  onEvent: (event: PreAnaliseStreamEvent) => void,
  options?: PreAnaliseRunOptions & { timeoutMs?: number },
): Promise<PreAnaliseCheckResult[]> {
  const timeoutMs = options?.timeoutMs ?? STREAM_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const results: PreAnaliseCheckResult[] = [];

  const onExternalAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetch(
      apiUrl(`/analise/${ano}/${osId}/pre-analise/run-all/stream`),
      {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/x-ndjson",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ versao_label: versaoLabel }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      try {
        const parsed = JSON.parse(text) as { detail?: string };
        if (typeof parsed.detail === "string" && parsed.detail.trim()) {
          if (response.status === 404 && parsed.detail === "Not Found") {
            throw new Error(
              "Rota da API não encontrada. Reinicie o backend (porta 8001) após atualizar o código.",
            );
          }
          throw new Error(parsed.detail);
        }
      } catch (err) {
        if (err instanceof Error && !err.message.startsWith("API ")) {
          throw err;
        }
      }
      throw new Error(`API ${response.status}: ${text.slice(0, 200)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Resposta sem stream de progresso.");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const event = JSON.parse(trimmed) as PreAnaliseStreamEvent;
          onEvent(event);
          if (event.type === "progress") {
            results.push(event.result);
          }
          if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }

      const tail = buffer.trim();
      if (tail) {
        const event = JSON.parse(tail) as PreAnaliseStreamEvent;
        onEvent(event);
        if (event.type === "progress") {
          results.push(event.result);
        }
        if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        if (wasUserCancel(options?.signal)) {
          return results;
        }
        throw new Error(
          "A pré-análise excedeu o tempo máximo. Tente novamente ou use uma pasta com menos arquivos.",
        );
      }
      throw err;
    }

    return results;
  } catch (err) {
    if (isAbortError(err) && wasUserCancel(options?.signal)) {
      return results;
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
    options?.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export interface PreAnaliseSnapshotIndexEntry {
  versao_label: string;
  alert_count: number;
  executed_at?: string;
}

export interface PreAnaliseSnapshotResponse {
  status: string;
  found: boolean;
  stale?: boolean;
  versao_label?: string;
  results?: PreAnaliseCheckResult[];
  executed_at?: string;
  alert_count?: number;
  executed_by?: string | null;
}

export async function fetchPreAnaliseSnapshotIndex(
  ano: number,
  osId: number,
  signal?: AbortSignal,
): Promise<PreAnaliseSnapshotIndexEntry[]> {
  const data = await apiFetch<{
    snapshots?: PreAnaliseSnapshotIndexEntry[];
  }>(`/analise/${ano}/${osId}/pre-analise/snapshots`, { signal });
  return data.snapshots ?? [];
}

export async function fetchPreAnaliseSnapshot(
  ano: number,
  osId: number,
  versaoLabel: string,
  signal?: AbortSignal,
): Promise<PreAnaliseSnapshotResponse> {
  return apiFetch<PreAnaliseSnapshotResponse>(
    `/analise/${ano}/${osId}/pre-analise/snapshot`,
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versao_label: versaoLabel }),
    },
  );
}

export async function fetchPreAnaliseEstimate(
  ano: number,
  osId: number,
  versaoLabel: string,
  signal?: AbortSignal,
): Promise<PreAnaliseEstimateResponse> {
  return apiFetch<PreAnaliseEstimateResponse>(
    `/analise/${ano}/${osId}/pre-analise/estimate`,
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versao_label: versaoLabel }),
    },
  );
}

export function initialPreAnaliseLiveState(): PreAnaliseLiveState {
  return {
    phase: "loading",
    currentCheckName: "Preparando verificações…",
    currentDetail: null,
    completedChecks: 0,
    totalChecks: 0,
    estimatedTotalSec: null,
    remainingSec: null,
    elapsedSec: null,
    hasTimingHistory: false,
    timingSampleCount: 0,
  };
}

export async function runPreAnaliseAll(
  ano: number,
  osId: number,
  versaoLabel: string,
  setLive: (state: PreAnaliseLiveState) => void,
  options?: PreAnaliseRunOptions,
): Promise<{
  live: PreAnaliseLiveState;
  results: PreAnaliseCheckResult[];
  error?: string;
  cancelled?: boolean;
}> {
  let live = initialPreAnaliseLiveState();
  const patch = (partial: Partial<PreAnaliseLiveState>) => {
    live = { ...live, ...partial };
    setLive(live);
  };
  patch(live);

  let checks: PreAnaliseCheckMeta[] = [];
  try {
    checks = await fetchPreAnaliseChecks(options?.signal);
  } catch (err) {
    if (isAbortError(err) && wasUserCancel(options?.signal)) {
      live = {
        phase: "cancelled",
        currentCheckName: null,
        currentDetail: "Pré-análise cancelada.",
        completedChecks: 0,
        totalChecks: 0,
        errorMessage: "Pré-análise cancelada pelo usuário.",
      };
      setLive(live);
      return { live, results: [], cancelled: true };
    }
    const message =
      err instanceof Error ? err.message : "Não foi possível carregar as verificações.";
    live = {
      phase: "failed",
      currentCheckName: null,
      currentDetail: message,
      completedChecks: 0,
      totalChecks: 0,
      errorMessage: message,
    };
    setLive(live);
    return { live, results: [], error: message };
  }

  if (checks.length === 0) {
    const message = "Nenhuma verificação de pré-análise disponível.";
    live = {
      phase: "failed",
      currentCheckName: null,
      currentDetail: message,
      completedChecks: 0,
      totalChecks: 0,
      errorMessage: message,
    };
    setLive(live);
    return { live, results: [], error: message };
  }

  const totalChecks = checks.length;
  patch({
    phase: "running",
    currentCheckName: "Preparando análise…",
    currentDetail: null,
    completedChecks: 0,
    totalChecks,
  });

  try {
    const estimate = await fetchPreAnaliseEstimate(
      ano,
      osId,
      versaoLabel,
      options?.signal,
    );
    if (typeof estimate.total_sec === "number") {
      patch({
        estimatedTotalSec: estimate.total_sec,
        remainingSec: estimate.total_sec,
        hasTimingHistory: Boolean(estimate.has_history),
        timingSampleCount:
          typeof estimate.sample_count === "number"
            ? estimate.sample_count
            : 0,
      });
    }
  } catch {
    /* estimativa opcional — o stream envia timing após carregar PDFs */
  }

  const applyTiming = (partial: Partial<PreAnaliseLiveState>) => {
    patch(partial);
  };

  const onStream = (event: PreAnaliseStreamEvent) => {
    const timing = timingFieldsFromEvent(event);
    if (event.type === "heartbeat") {
      applyTiming({
        phase: "running",
        remainingSec: timing.remainingSec ?? live.remainingSec,
        elapsedSec: timing.elapsedSec ?? live.elapsedSec,
        estimatedTotalSec:
          timing.estimatedTotalSec ?? live.estimatedTotalSec,
        hasTimingHistory:
          timing.hasTimingHistory ?? live.hasTimingHistory,
        timingSampleCount:
          timing.timingSampleCount ?? live.timingSampleCount,
      });
      return;
    }
    if (event.type === "start") {
      patch({
        phase: "running",
        totalChecks: event.total,
        completedChecks: 0,
        currentCheckName: "Carregando PDFs na pasta…",
        currentDetail: null,
        ...timing,
      });
      return;
    }
    if (event.type === "running") {
      patch({
        phase: "running",
        totalChecks: event.total,
        completedChecks: event.index,
        currentCheckName: event.check_nome ?? "Verificando…",
        currentDetail: null,
        ...timing,
      });
      return;
    }
    if (event.type === "progress") {
      patch({
        phase: "running",
        totalChecks: event.total,
        completedChecks: event.index + 1,
        currentCheckName: event.check_nome,
        currentDetail: event.result.mensagem,
        ...timing,
      });
    }
  };

  try {
    const results = await streamPreAnaliseRunAll(
      ano,
      osId,
      versaoLabel,
      onStream,
      options,
    );

    if (wasUserCancel(options?.signal)) {
      live = {
        phase: "cancelled",
        currentCheckName: null,
        currentDetail: "Pré-análise cancelada.",
        completedChecks: results.length,
        totalChecks: live.totalChecks || totalChecks,
        errorMessage:
          results.length > 0
            ? `Cancelada após ${results.length} de ${live.totalChecks || totalChecks} verificações.`
            : "Pré-análise cancelada pelo usuário.",
      };
      setLive(live);
      return { live, results, cancelled: true };
    }

    live = {
      phase: "complete",
      currentCheckName: null,
      currentDetail: null,
      completedChecks: results.length,
      totalChecks: live.totalChecks || results.length,
    };
    setLive(live);
    return { live, results };
  } catch (err) {
    if (isAbortError(err) && wasUserCancel(options?.signal)) {
      live = {
        phase: "cancelled",
        currentCheckName: null,
        currentDetail: "Pré-análise cancelada.",
        completedChecks: live.completedChecks,
        totalChecks: live.totalChecks || totalChecks,
        errorMessage: "Pré-análise cancelada pelo usuário.",
      };
      setLive(live);
      return { live, results: [], cancelled: true };
    }

    const message =
      err instanceof Error ? err.message : "Erro ao executar pré-análise.";
    live = {
      phase: "failed",
      currentCheckName: null,
      currentDetail: message,
      completedChecks: live.completedChecks,
      totalChecks: live.totalChecks || totalChecks,
      errorMessage: message,
    };
    setLive(live);
    return { live, results: [], error: message };
  }
}
