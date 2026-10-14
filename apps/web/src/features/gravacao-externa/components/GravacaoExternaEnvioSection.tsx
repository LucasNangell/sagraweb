import { cn } from "@sagra/ui";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  gravacaoExternaDownloadUrl,
  type GravacaoExternaDetail,
  type GravacaoExternaOsItem,
} from "@/api/gravacaoExterna";
import {
  downloadGravacaoExternaZipAll,
  type DownloadAllPhase,
  type DownloadAllProgress,
} from "@/features/gravacao-externa/utils/downloadGravacaoExternaZipAll";

import { gravacaoComponenteLabel } from "../utils/groupGravacaoItemsByOs";
import { GravacaoExternaStatusBadge } from "./GravacaoExternaActions";
import { GravacaoObservacaoBox } from "./GravacaoObservacaoBox";
import { GravacaoExternaArquivosPanel, type PreviewSelection } from "./GravacaoExternaPreview";

export const SEM_FORNECEDOR_LABEL = "Sem fornecedor";

export function gravacaoFornecedorKey(item: GravacaoExternaOsItem): string {
  return item.fornecedor_ponto?.trim() || "";
}

export function gravacaoFornecedorLabel(item: GravacaoExternaOsItem): string {
  return item.fornecedor_nome?.trim() || item.fornecedor_ponto?.trim() || SEM_FORNECEDOR_LABEL;
}

function formatDownloadBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface GravacaoExternaEnvioSectionProps {
  item: GravacaoExternaOsItem;
  detail: GravacaoExternaDetail | undefined;
  failed?: boolean;
  /** Exibe componente/fornecedor no cabeçalho quando a OS tem mais de um envio visível. */
  showOrigem: boolean;
  focused: boolean;
  onFocus: () => void;
  /** Somente o fornecedor conclui a gravação. */
  canConcluir: boolean;
  canDownload: boolean;
  concluindo: boolean;
  onConcluir: () => void;
  previewSelection: PreviewSelection | null;
  onSelectPreview: (selection: PreviewSelection) => void;
  onDownloaded: () => void;
}

export function GravacaoExternaEnvioSection({
  item,
  detail,
  failed = false,
  showOrigem,
  focused,
  onFocus,
  canConcluir,
  canDownload,
  concluindo,
  onConcluir,
  previewSelection,
  onSelectPreview,
  onDownloaded,
}: GravacaoExternaEnvioSectionProps) {
  const sessionId = item.gravacao_externa_id ?? null;
  const [downloadPhase, setDownloadPhase] = useState<DownloadAllPhase>("idle");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadAllProgress | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      downloadAbortRef.current?.abort();
    };
  }, []);

  const downloadBusy = downloadPhase === "preparing" || downloadPhase === "saving";

  const handleCancelDownload = () => {
    downloadAbortRef.current?.abort();
    downloadAbortRef.current = null;
    setDownloadPhase("idle");
    setDownloadProgress(null);
    setDownloadError(null);
  };

  const handleDownloadAll = async () => {
    if (downloadBusy) return;
    setDownloadError(null);
    setDownloadProgress(null);
    downloadAbortRef.current?.abort();
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    const componente = gravacaoComponenteLabel(item.componente);
    const fallbackFilename = `gravacao_externa_OS_${String(item.nr_os).padStart(5, "0")}_${item.ano}${
      componente ? `_${componente.toLowerCase()}` : ""
    }.zip`;
    try {
      await downloadGravacaoExternaZipAll({
        ano: item.ano,
        nrOs: item.nr_os,
        gravacaoExternaId: sessionId,
        fallbackFilename,
        signal: controller.signal,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          setDownloadProgress(progress);
        },
        onPhase: (phase) => {
          if (controller.signal.aborted) return;
          setDownloadPhase(phase);
          if (phase === "started") {
            window.setTimeout(() => {
              if (controller.signal.aborted) return;
              setDownloadPhase((current) => (current === "started" ? "idle" : current));
            }, 4000);
          }
        },
      });
      if (controller.signal.aborted) return;
      onDownloaded();
    } catch (e) {
      if (controller.signal.aborted) return;
      setDownloadPhase("error");
      setDownloadError(e instanceof Error ? e.message : "Não foi possível baixar os arquivos.");
    }
  };

  const componente = gravacaoComponenteLabel(item.componente);
  const arquivos = detail?.arquivos ?? [];
  const sectionLabel = [gravacaoFornecedorLabel(item), componente].filter(Boolean).join(" · ");

  return (
    <section
      aria-label={`Envio ${sectionLabel}`}
      onFocusCapture={onFocus}
      onPointerDownCapture={onFocus}
      className={cn(
        "space-y-2 rounded-lg border p-2",
        focused && showOrigem ? "border-primary-green/60" : "border-neutral-200",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            {showOrigem ? (
              <span className="truncate text-sm font-semibold text-neutral-800" title={sectionLabel}>
                {sectionLabel}
              </span>
            ) : null}
            <GravacaoExternaStatusBadge status={detail?.status ?? item.gravacao_status} />
          </div>
          {detail ? (
            <p className="text-xs text-neutral-500">
              Lançado por {detail.lancado_por_nome || detail.lancado_por_ponto}
            </p>
          ) : null}
        </div>
        {detail && canConcluir && (detail.status === "pendente" || detail.status === "iniciada") ? (
          <button
            type="button"
            disabled={concluindo}
            onClick={onConcluir}
            className="inline-flex items-center gap-2 rounded border border-primary-green bg-white px-4 py-2 text-sm font-medium text-primary-green hover:bg-primary-green/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {concluindo ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Gravação concluída
          </button>
        ) : null}
      </div>

      {!detail && failed ? (
        <p className="py-2 text-center text-xs text-neutral-500">
          Não foi possível carregar os arquivos deste envio.
        </p>
      ) : !detail ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-5 animate-spin text-primary-green" />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Arquivos ({arquivos.length})
            </h3>
            {arquivos.length > 0 && canDownload ? (
              <div className="flex items-center gap-1">
                {downloadBusy ? (
                  <button
                    type="button"
                    onClick={handleCancelDownload}
                    className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    Cancelar
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={downloadBusy}
                  onClick={() => void handleDownloadAll()}
                  className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                  title="Baixar todos os arquivos em ZIP"
                >
                  {downloadBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                  {downloadPhase === "error"
                    ? "Tentar novamente"
                    : downloadPhase === "saving"
                      ? "Salvando…"
                      : downloadBusy
                        ? "Preparando…"
                        : "Baixar todos"}
                </button>
              </div>
            ) : null}
          </div>
          {downloadPhase === "preparing" ? (
            <div
              className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-2">
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-amber-700" />
                <p>
                  <span className="font-semibold">Preparando arquivos para download…</span>{" "}
                  {downloadProgress?.totalArquivos
                    ? `${downloadProgress.arquivosProntos ?? 0} de ${downloadProgress.totalArquivos} arquivos.`
                    : "Aguarde a montagem do ZIP."}
                </p>
              </div>
              {downloadProgress?.totalArquivos ? (
                <div className="h-1.5 overflow-hidden rounded bg-amber-100">
                  <div
                    className="h-full bg-amber-600 transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((downloadProgress.arquivosProntos ?? 0) /
                            Math.max(1, downloadProgress.totalArquivos)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {downloadPhase === "saving" ? (
            <div
              className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-2">
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-amber-700" />
                <p>
                  <span className="font-semibold">Salvando o ZIP no local escolhido…</span>{" "}
                  {downloadProgress?.totalBytes
                    ? `${formatDownloadBytes(downloadProgress.bytesReceived ?? 0)} de ${formatDownloadBytes(downloadProgress.totalBytes)}.`
                    : "Não feche esta aba até concluir."}
                </p>
              </div>
              {downloadProgress?.totalBytes ? (
                <div className="h-1.5 overflow-hidden rounded bg-amber-100">
                  <div
                    className="h-full bg-amber-600 transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((downloadProgress.bytesReceived ?? 0) /
                            Math.max(1, downloadProgress.totalBytes)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {downloadPhase === "started" ? (
            <div
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
              role="status"
              aria-live="polite"
            >
              Download iniciado pelo navegador. Acompanhe a barra de downloads do navegador até o
              ZIP terminar por completo.
            </div>
          ) : null}
          {downloadPhase === "error" && downloadError ? (
            <div
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
              role="alert"
            >
              {downloadError}
            </div>
          ) : null}
          <GravacaoObservacaoBox observacao={detail.observacao} />
          <GravacaoExternaArquivosPanel
            ano={item.ano}
            nrOs={item.nr_os}
            arquivos={arquivos}
            selection={previewSelection?.sessionId === sessionId ? previewSelection : null}
            groupByMachine
            chapasPorMaquina={item.chapas_por_maquina ?? []}
            canDownload={canDownload}
            getDownloadUrl={(a, n, arquivoId) =>
              gravacaoExternaDownloadUrl(a, n, arquivoId, sessionId)
            }
            onSelect={(arq) => onSelectPreview({ kind: "file", arquivo: arq, sessionId })}
            onSelectComposite={(chapa) =>
              onSelectPreview({
                kind: "composite",
                groupKey: chapa.groupKey,
                chapaLabel: chapa.chapaLabel,
                displayLabel: chapa.displayLabel,
                sessionId,
              })
            }
          />
        </>
      )}
    </section>
  );
}
