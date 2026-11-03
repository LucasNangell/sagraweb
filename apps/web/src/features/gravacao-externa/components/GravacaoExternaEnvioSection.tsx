import { cn } from "@sagra/ui";
import { Check, FileDown, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
import {
  isPdfFilename,
  isTifFilename,
} from "../utils/plateFilenameUtils";
import { GravacaoObservacaoBox } from "./GravacaoObservacaoBox";
import {
  GravacaoExternaArquivosPanel,
  SEM_MAQUINA_KEY,
  type PreviewSelection,
} from "./GravacaoExternaPreview";

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
  canDownload: boolean;
  previewSelection: PreviewSelection | null;
  onSelectPreview: (selection: PreviewSelection) => void;
  onDownloaded: () => void;
  downloadedArquivoIds?: ReadonlySet<number>;
  onArquivoDownloaded?: (arquivoId: number) => void;
  onArquivosDownloaded?: (arquivoIds: number[]) => void;
}

export function GravacaoExternaEnvioSection({
  item,
  detail,
  failed = false,
  showOrigem,
  focused,
  onFocus,
  canDownload,
  previewSelection,
  onSelectPreview,
  onDownloaded,
  downloadedArquivoIds,
  onArquivoDownloaded,
  onArquivosDownloaded,
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

  const runZipDownload = async (opts?: {
    maquina?: string | null;
    arquivoIds?: number[];
    filenameSuffix?: string;
  }) => {
    if (downloadBusy) return;
    setDownloadError(null);
    setDownloadProgress(null);
    downloadAbortRef.current?.abort();
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    const componente = gravacaoComponenteLabel(item.componente);
    const suffix = opts?.filenameSuffix
      ? `_${opts.filenameSuffix}`
      : componente
        ? `_${componente.toLowerCase()}`
        : "";
    const fallbackFilename = `gravacao_externa_OS_${String(item.nr_os).padStart(5, "0")}_${item.ano}${suffix}.zip`;
    try {
      await downloadGravacaoExternaZipAll({
        ano: item.ano,
        nrOs: item.nr_os,
        gravacaoExternaId: sessionId,
        maquina: opts?.maquina,
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
      const allArquivos = detail?.arquivos ?? [];
      const ids =
        opts?.arquivoIds ??
        allArquivos
          .filter((a) => {
            const nome = String(a.nome ?? "");
            return isPdfFilename(nome) || isTifFilename(nome);
          })
          .map((a) => a.id);
      // Marca PDF/TIF baixados para atualizar badges "Baixado" na hora.
      onArquivosDownloaded?.(ids.length > 0 ? ids : allArquivos.map((a) => a.id));
      onDownloaded();
    } catch (e) {
      if (controller.signal.aborted) return;
      setDownloadPhase("error");
      setDownloadError(e instanceof Error ? e.message : "Não foi possível baixar os arquivos.");
    }
  };

  const handleDownloadAll = () => {
    void runZipDownload();
  };

  const handleDownloadMachine = (machineKey: string, arquivoIds: number[]) => {
    const filenameSuffix =
      machineKey === SEM_MAQUINA_KEY
        ? "espelhos"
        : machineKey.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "maquina";
    void runZipDownload({
      maquina: machineKey,
      arquivoIds,
      filenameSuffix,
    });
  };

  const componente = gravacaoComponenteLabel(item.componente);
  const arquivos = detail?.arquivos ?? [];
  const sectionLabel = [gravacaoFornecedorLabel(item), componente].filter(Boolean).join(" · ");
  const arquivosTitle =
    arquivos.length === 1
      ? "1 Arquivo para download"
      : `${arquivos.length} Arquivos para download`;

  const allDownloadableDownloaded = useMemo(() => {
    const downloadable = arquivos.filter((arquivo) => {
      const nome = String(arquivo.nome ?? "");
      return isPdfFilename(nome) || isTifFilename(nome);
    });
    if (downloadable.length === 0) return false;
    return downloadable.every(
      (arquivo) =>
        Boolean(arquivo.baixado_em) || (downloadedArquivoIds?.has(arquivo.id) ?? false),
    );
  }, [arquivos, downloadedArquivoIds]);

  const downloadAllLabel =
    downloadPhase === "error"
      ? "Tentar novamente"
      : downloadPhase === "saving"
        ? "Salvando…"
        : downloadBusy
          ? "Preparando…"
          : allDownloadableDownloaded
            ? "Arquivos baixados"
            : "Baixar todos";

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
      {detail ? (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-800">{arquivosTitle}</h3>
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
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold leading-none",
                  allDownloadableDownloaded && downloadPhase !== "error" && !downloadBusy
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800",
                  "cursor-pointer hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
                )}
                title={
                  allDownloadableDownloaded
                    ? "Baixar arquivos novamente"
                    : "Baixar todos os arquivos em ZIP"
                }
                aria-label={downloadAllLabel}
              >
                {downloadBusy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : allDownloadableDownloaded && downloadPhase !== "error" ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <FileDown className="size-3.5" aria-hidden />
                )}
                {downloadAllLabel}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showOrigem ? (
        <div className="min-w-0">
          <span className="truncate text-sm font-semibold text-neutral-800" title={sectionLabel}>
            {sectionLabel}
          </span>
        </div>
      ) : null}

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
            chapasPorMaquina={
              item.chapas_por_maquina?.length
                ? item.chapas_por_maquina
                : detail?.chapas_por_maquina ?? []
            }
            canDownload={canDownload}
            getDownloadUrl={(a, n, arquivoId) =>
              gravacaoExternaDownloadUrl(a, n, arquivoId, sessionId)
            }
            downloadedArquivoIds={downloadedArquivoIds}
            onArquivoDownloaded={onArquivoDownloaded}
            onDownloadMachine={canDownload ? handleDownloadMachine : undefined}
            machineDownloadBusy={downloadBusy}
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
