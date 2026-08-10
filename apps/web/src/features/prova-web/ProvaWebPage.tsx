import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  FolderOpen,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { ProofPreviewPagesData } from "@/api/proof-portal";
import {
  approveProvaWeb,
  discardProvaWeb,
  fetchProvaWebInfo,
  fetchProvaWebManifest,
  provaWebPageUrl,
  reprocessProvaWeb,
  type ProvaWebManifest,
  type ProvaWebRenderStatus,
} from "@/api/provaWeb";
import { ClienteProofMockupPanel } from "@/features/cliente/components/proof/ClienteProofMockupPanel";
import logoUrl from "@/logo.png";

import { ProvaWebFilePicker } from "./ProvaWebFilePicker";
import { ProvaWebGeneratedModal } from "./ProvaWebGeneratedModal";
import { ProvaWebViewerShell } from "./ProvaWebViewerShell";
import { pdfSourcesFromRecord } from "./provaWebPdfSources";

interface ProvaWebPageProps {
  ano: number;
  osId: number;
}

function isRenderInFlight(status: ProvaWebRenderStatus | undefined): boolean {
  return status === "pending" || status === "running";
}

function isRenderReady(status: ProvaWebRenderStatus | undefined): boolean {
  return !status || status === "ready";
}

export function ProvaWebPage({ ano, osId }: ProvaWebPageProps) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvedModal, setApprovedModal] = useState<{
    portalUrl: string;
    versao: number;
  } | null>(null);

  const infoQuery = useQuery({
    queryKey: ["prova-web-info", ano, osId],
    queryFn: () => fetchProvaWebInfo(ano, osId),
    retry: 1,
    refetchInterval: (query) => {
      const status = query.state.data?.record?.renderStatus;
      return isRenderInFlight(status) ? 2000 : false;
    },
  });

  const info = infoQuery.data;
  const record = info?.record ?? null;
  const hasRecord = Boolean(record);
  const isDraft = Boolean(record?.isDraft || record?.status === "rascunho");
  const showPicker = pickerOpen || (Boolean(info) && !hasRecord);
  const portalUrl = info?.portalUrl?.trim() || "";
  const renderStatus = record?.renderStatus;
  const renderInFlight = isRenderInFlight(renderStatus);
  const renderReady = isRenderReady(renderStatus);
  const renderError =
    renderStatus === "error"
      ? record?.renderError?.trim() || "Falha ao gerar as páginas da prova."
      : null;
  const progress = record?.renderProgress;
  const progressLabel =
    progress &&
    typeof progress.done === "number" &&
    typeof progress.total === "number" &&
    progress.total > 0
      ? `${progress.done} / ${progress.total} páginas`
      : null;

  const manifestQuery = useQuery({
    queryKey: ["prova-web-manifest", ano, osId],
    queryFn: () => fetchProvaWebManifest(ano, osId),
    enabled: hasRecord && !showPicker && renderReady && !renderError,
    retry: 1,
    staleTime: 60_000,
  });

  /** Só o viewer/mockup trava a janela; picker/assistente precisam de scroll. */
  const lockViewport = Boolean(
    info && hasRecord && !showPicker && manifestQuery.data,
  );

  useEffect(() => {
    document.title = `Prova WEB — OS ${osId}/${ano}`;
  }, [ano, osId]);

  const invalidateProvaQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ["prova-web-info", ano, osId] });
    void queryClient.invalidateQueries({
      queryKey: ["prova-web-manifest", ano, osId],
    });
  };

  const handleSaved = () => {
    setPickerOpen(false);
    setActionError(null);
    invalidateProvaQueries();
  };

  const handleCopyLink = async () => {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      window.alert("Não foi possível copiar o link.");
    }
  };

  const handleApprove = async () => {
    if (!record?.versao || actionBusy || !renderReady) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await approveProvaWeb(ano, osId, record.versao);
      invalidateProvaQueries();
      const url = res.portalUrl?.trim() || "";
      if (url) {
        setApprovedModal({
          portalUrl: url,
          versao: res.versao ?? record.versao,
        });
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao aprovar a prova.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleDiscard = async () => {
    if (!record?.versao || actionBusy) return;
    const versao = record.versao;
    const ok = window.confirm(
      `Descartar o rascunho da Prova ${versao}? Os arquivos renderizados serão apagados e a versão deixará de existir.`,
    );
    if (!ok) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await discardProvaWeb(ano, osId, versao);
      setPickerOpen(true);
      invalidateProvaQueries();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao descartar a prova.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleReprocess = async () => {
    if (!record?.versao || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await reprocessProvaWeb(ano, osId, record.versao);
      invalidateProvaQueries();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao reiniciar a geração.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div
      className={
        lockViewport
          ? "flex h-dvh max-h-dvh flex-col overflow-hidden bg-sagra-bg text-sagra-text"
          : "flex min-h-dvh flex-col bg-sagra-bg text-sagra-text"
      }
    >
      <header className="flex h-14 shrink-0 items-center gap-3 bg-secondary-blue px-3 text-white shadow-md sm:h-16 sm:px-4">
        <img
          src={logoUrl}
          alt="DEAPA"
          className="h-8 w-auto shrink-0 object-contain sm:h-10"
        />
        <BookOpen className="hidden size-5 shrink-0 text-primary-green sm:block" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-wide sm:text-base">
            Prova WEB — OS {osId}/{ano}
            {record?.versao != null ? ` · Prova ${record.versao}` : ""}
            {isDraft && !showPicker ? (
              <span className="ml-2 inline-block rounded bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary-blue">
                Rascunho
              </span>
            ) : null}
            {renderInFlight && !showPicker ? (
              <span className="ml-2 inline-block rounded bg-sky-300/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary-blue">
                Gerando
              </span>
            ) : null}
          </h1>
          {info && (info.titulo || info.produto) && (
            <p className="truncate text-xs text-white/70">
              {[info.titulo, info.produto].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {hasRecord && !showPicker && (
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {isDraft ? (
              <>
                <button
                  type="button"
                  disabled={actionBusy || !renderReady}
                  onClick={() => void handleApprove()}
                  className="flex items-center gap-1.5 rounded-md border border-primary-green/80 bg-primary-green/20 px-2 py-1.5 text-sm font-medium hover:bg-primary-green/30 disabled:opacity-50 sm:px-3"
                  title={
                    !renderReady
                      ? "Aguarde a geração das páginas"
                      : "Aprovar e gerar link do cliente"
                  }
                >
                  {actionBusy ? (
                    <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                  ) : (
                    <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                  )}
                  <span className="hidden sm:inline">Aprovar</span>
                </button>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void handleDiscard()}
                  className="flex items-center gap-1.5 rounded-md border border-white/30 px-2 py-1.5 text-sm font-medium hover:bg-white/10 disabled:opacity-50 sm:px-3"
                >
                  <Trash2 className="size-4 shrink-0" aria-hidden />
                  <span className="hidden sm:inline">Descartar</span>
                </button>
                <button
                  type="button"
                  disabled={actionBusy || renderInFlight}
                  onClick={() => {
                    setActionError(null);
                    setPickerOpen(true);
                  }}
                  className="flex items-center gap-1.5 rounded-md border border-white/30 px-2 py-1.5 text-sm font-medium hover:bg-white/10 disabled:opacity-50 sm:gap-2 sm:px-3"
                >
                  <Pencil className="size-4 shrink-0" aria-hidden />
                  <span className="hidden sm:inline">Editar</span>
                </button>
              </>
            ) : (
              <>
                {portalUrl ? (
                  <button
                    type="button"
                    onClick={() => void handleCopyLink()}
                    className="flex items-center gap-1.5 rounded-md border border-white/30 px-2 py-1.5 text-sm font-medium hover:bg-white/10 sm:px-3"
                    title={portalUrl}
                  >
                    {linkCopied ? (
                      <Check className="size-4 shrink-0 text-primary-green" aria-hidden />
                    ) : (
                      <Copy className="size-4 shrink-0" aria-hidden />
                    )}
                    <span className="hidden sm:inline">
                      {linkCopied ? "Copiado" : "Copiar link do cliente"}
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex items-center gap-1.5 rounded-md border border-white/30 px-2 py-1.5 text-sm font-medium hover:bg-white/10 sm:gap-2 sm:px-3"
                >
                  <FolderOpen className="size-4 shrink-0" aria-hidden />
                  <span className="hidden sm:inline">Trocar arquivo</span>
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {actionError && hasRecord && !showPicker ? (
        <p className="shrink-0 bg-red-50 px-4 py-2 text-center text-sm text-sagra-danger">
          {actionError}
        </p>
      ) : null}

      <main
        className={
          lockViewport
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        {infoQuery.isLoading && (
          <CenteredState>
            <Loader2
              className="size-8 animate-spin text-primary-green"
              aria-hidden
            />
            <p className="text-sm text-neutral-600">Carregando dados da OS…</p>
          </CenteredState>
        )}

        {infoQuery.isError && (
          <CenteredState>
            <p className="text-sm font-medium text-sagra-danger">
              {infoQuery.error instanceof Error
                ? infoQuery.error.message
                : "Erro ao carregar a OS."}
            </p>
            <RetryButton onClick={() => void infoQuery.refetch()} />
          </CenteredState>
        )}

        {info && showPicker && (
          <ProvaWebFilePicker
            ano={ano}
            osId={osId}
            info={info}
            onSaved={handleSaved}
            onViewExisting={() => setPickerOpen(false)}
            onCancel={hasRecord ? () => setPickerOpen(false) : undefined}
          />
        )}

        {info && !showPicker && hasRecord && (
          <>
            {renderInFlight && (
              <CenteredState>
                <Loader2
                  className="size-8 animate-spin text-primary-green"
                  aria-hidden
                />
                <p className="text-sm text-neutral-600">
                  Gerando as páginas da prova em segundo plano…
                </p>
                {progressLabel ? (
                  <p className="text-xs font-medium text-neutral-700">
                    {progressLabel}
                  </p>
                ) : null}
                <p className="max-w-md text-center text-xs text-neutral-500">
                  Você pode continuar usando o restante do sistema. Esta tela
                  atualiza automaticamente ao concluir.
                </p>
              </CenteredState>
            )}

            {!renderInFlight && renderError && (
              <CenteredState>
                <p className="max-w-md text-center text-sm font-medium text-sagra-danger">
                  {renderError}
                </p>
                <div className="flex gap-2">
                  <RetryButton
                    onClick={() => void handleReprocess()}
                    label={actionBusy ? "Reiniciando…" : "Tentar novamente"}
                    disabled={actionBusy}
                  />
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="rounded-lg border border-sagra-border bg-white px-3 py-1.5 text-xs text-neutral-700 shadow-sm hover:bg-neutral-50"
                  >
                    Escolher outro arquivo
                  </button>
                </div>
              </CenteredState>
            )}

            {renderReady && !renderError && manifestQuery.isLoading && (
              <CenteredState>
                <Loader2
                  className="size-8 animate-spin text-primary-green"
                  aria-hidden
                />
                <p className="text-sm text-neutral-600">
                  Carregando visualização…
                </p>
              </CenteredState>
            )}

            {renderReady && !renderError && manifestQuery.isError && (
              <CenteredState>
                <p className="max-w-md text-center text-sm font-medium text-sagra-danger">
                  {manifestQuery.error instanceof Error
                    ? manifestQuery.error.message
                    : "Erro ao carregar a prova."}
                </p>
                <div className="flex gap-2">
                  <RetryButton onClick={() => void manifestQuery.refetch()} />
                  <RetryButton
                    onClick={() => void handleReprocess()}
                    label="Regenerar páginas"
                    disabled={actionBusy}
                  />
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="rounded-lg border border-sagra-border bg-white px-3 py-1.5 text-xs text-neutral-700 shadow-sm hover:bg-neutral-50"
                  >
                    Escolher outro arquivo
                  </button>
                </div>
              </CenteredState>
            )}

            {renderReady &&
              !renderError &&
              manifestQuery.data &&
              (info.isPapelaria ? (
                <PapelariaMockupStage
                  ano={ano}
                  osId={osId}
                  manifest={manifestQuery.data}
                  produtoFallback={info.produto}
                />
              ) : (
                <ProvaWebViewerShell
                  ano={ano}
                  osId={osId}
                  manifest={manifestQuery.data}
                  pdfSources={pdfSourcesFromRecord(info.record)}
                />
              ))}
          </>
        )}
      </main>

      {approvedModal && (
        <ProvaWebGeneratedModal
          open
          ano={ano}
          osId={osId}
          portalUrl={approvedModal.portalUrl}
          versao={approvedModal.versao}
          onDone={() => setApprovedModal(null)}
        />
      )}
    </div>
  );
}

function PapelariaMockupStage({
  ano,
  osId,
  manifest,
  produtoFallback,
}: {
  ano: number;
  osId: number;
  manifest: ProvaWebManifest;
  produtoFallback?: string;
}) {
  const previewData: ProofPreviewPagesData = {
    isPapelaria: true,
    pages: manifest.pages.map((p) => ({
      page: p.page,
      url: provaWebPageUrl(ano, osId, p.page, manifest.cacheKey),
    })),
    total_pages: manifest.pageCount,
    truncated: manifest.truncated,
    mockupConfigJson: manifest.mockupConfigJson,
    produto: manifest.produto,
    arquivoModelo: manifest.arquivoModelo,
    frenteVerso: manifest.frenteVerso,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <ClienteProofMockupPanel
        previewData={previewData}
        isLoading={false}
        isError={false}
        produtoFallback={produtoFallback}
        fillHeight
        className="flex-1"
      />
    </div>
  );
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
      {children}
    </div>
  );
}

function RetryButton({
  onClick,
  label = "Tentar novamente",
  disabled = false,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-sagra-border bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50"
    >
      <RefreshCw className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}
