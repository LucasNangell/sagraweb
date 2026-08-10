import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  FlaskConical,
  Loader2,
  RefreshCw,
  ScanSearch,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  analiseLabPageUrl,
  createAnaliseLabMark,
  deleteAnaliseLabMark,
  fetchAnaliseLabInfo,
  fetchAnaliseLabManifest,
  reprocessAnaliseLab,
  saveAnaliseLab,
  type AnaliseLabMark,
  type AnaliseLabMarkCor,
  type AnaliseLabEdge,
  type SaveAnaliseLabPayload,
} from "@/api/analiseLab";
import { ProvaWebViewerShell } from "@/features/prova-web/ProvaWebViewerShell";
import logoUrl from "@/logo.png";

import { AnaliseLabInspector } from "./AnaliseLabInspector";
import { AnaliseLabMarksLayer } from "./AnaliseLabMarksLayer";
import {
  AnaliseLabMarkTools,
  type AnaliseLabTool,
} from "./AnaliseLabMarkTools";
import { AnaliseLabSourcePicker } from "./AnaliseLabSourcePicker";
import { pageSizeMm } from "./analiseLabGeometry";

interface AnaliseLabPageProps {
  ano: number;
  osId: number;
}

type LabTab = "inspecao" | "folhear";

function isInFlight(status?: string): boolean {
  return status === "pending" || status === "running";
}

export function AnaliseLabPage({ ano, osId }: AnaliseLabPageProps) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [optimisticGenerating, setOptimisticGenerating] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<LabTab>("inspecao");
  const [pageIndex, setPageIndex] = useState(0);

  const [tool, setTool] = useState<AnaliseLabTool>("offset_corte");
  const [edge, setEdge] = useState<AnaliseLabEdge>("top");
  const [offsetMm, setOffsetMm] = useState(7);
  const [applyAllPages, setApplyAllPages] = useState(true);
  const [cor, setCor] = useState<AnaliseLabMarkCor>("red");
  const [rotulo, setRotulo] = useState("corte 7mm");
  const [stepMm, setStepMm] = useState(10);
  const [localMarks, setLocalMarks] = useState<AnaliseLabMark[] | null>(null);

  const infoQuery = useQuery({
    queryKey: ["analise-lab-info", ano, osId],
    queryFn: () => fetchAnaliseLabInfo(ano, osId),
    retry: 1,
    refetchInterval: (q) => {
      const status = q.state.data?.session?.renderStatus;
      if (optimisticGenerating || isInFlight(status)) return 1500;
      return false;
    },
  });

  const info = infoQuery.data;
  const session = info?.session ?? null;
  const hasSession = Boolean(session);
  const renderStatus = session?.renderStatus;
  const renderInFlight = optimisticGenerating || isInFlight(renderStatus);
  const renderReady = !optimisticGenerating && renderStatus === "ready";
  const renderError =
    !optimisticGenerating && renderStatus === "error"
      ? session?.renderError || "Falha ao gerar as páginas."
      : null;

  const showPicker =
    !optimisticGenerating && (pickerOpen || (Boolean(info) && !hasSession));

  useEffect(() => {
    document.title = `Análise Lab — OS ${osId}/${ano}`;
  }, [ano, osId]);

  useEffect(() => {
    if (!optimisticGenerating) return;
    if (
      renderStatus === "ready" ||
      renderStatus === "error" ||
      renderStatus === "cancelled"
    ) {
      setOptimisticGenerating(false);
    }
  }, [optimisticGenerating, renderStatus]);

  useEffect(() => {
    if (info?.marks) setLocalMarks(info.marks);
  }, [info?.marks]);

  const marks = localMarks ?? info?.marks ?? [];

  const manifestQuery = useQuery({
    queryKey: ["analise-lab-manifest", ano, osId],
    queryFn: () => fetchAnaliseLabManifest(ano, osId),
    enabled: hasSession && !showPicker && renderReady && !renderError,
    retry: 1,
    staleTime: 60_000,
  });

  const progress = session?.renderProgress;
  const progressLabel =
    progress &&
    typeof progress.done === "number" &&
    typeof progress.total === "number" &&
    progress.total > 0
      ? `${progress.done} / ${progress.total} páginas`
      : null;

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["analise-lab-info", ano, osId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["analise-lab-manifest", ano, osId],
    });
  };

  const handleGenerateStarted = () => {
    setPickerOpen(false);
    setOptimisticGenerating(true);
    setActionError(null);
    queryClient.removeQueries({ queryKey: ["analise-lab-manifest", ano, osId] });
  };

  const handleGenerate = async (payload: SaveAnaliseLabPayload) => {
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await saveAnaliseLab(ano, osId, payload);
      queryClient.setQueryData(["analise-lab-info", ano, osId], (prev: typeof info) => {
        if (!prev) return prev;
        return { ...prev, session: res.session, marks: prev.marks ?? [] };
      });
      setOptimisticGenerating(true);
      invalidate();
    } catch (err) {
      setOptimisticGenerating(false);
      setPickerOpen(true);
      setActionError(
        err instanceof Error ? err.message : "Erro ao iniciar o laboratório.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const pageNumero = useMemo(() => {
    const pages = manifestQuery.data?.pages ?? [];
    return pages[pageIndex]?.page ?? pageIndex + 1;
  }, [manifestQuery.data?.pages, pageIndex]);

  const addMark = async (payload: {
    tipo: AnaliseLabMark["tipo"];
    geometria: Record<string, number | string>;
    pagina?: number;
  }) => {
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await createAnaliseLabMark(ano, osId, {
        pagina: payload.pagina ?? (applyAllPages ? 0 : pageNumero),
        tipo: payload.tipo as "offset_corte",
        geometria: payload.geometria,
        rotulo: rotulo || null,
        cor,
      });
      setLocalMarks((prev) => [...(prev ?? []), res.mark]);
      invalidate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao gravar marca.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteMark = async (id: number) => {
    setActionBusy(true);
    try {
      await deleteAnaliseLabMark(ano, osId, id);
      setLocalMarks((prev) => (prev ?? []).filter((m) => m.id !== id));
      invalidate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao excluir marca.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const renderPageOverlay = (
    page: { page: number; width: number; height: number; widthPt: number; heightPt: number },
    size: { width: number; height: number },
  ) => {
    const { widthMm, heightMm } = pageSizeMm(page.widthPt, page.heightPt);
    return (
      <AnaliseLabMarksLayer
        marks={marks}
        pageNumber={page.page}
        pageWidthMm={widthMm}
        pageHeightMm={heightMm}
        displayWidth={size.width}
        displayHeight={size.height}
        includeMedidas={false}
      />
    );
  };

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-sagra-bg text-sagra-text">
      <header className="flex h-14 shrink-0 items-center gap-3 bg-secondary-blue px-3 text-white shadow-md sm:h-16 sm:px-4">
        <img
          src={logoUrl}
          alt="DEAPA"
          className="h-8 w-auto shrink-0 object-contain sm:h-10"
        />
        <FlaskConical className="hidden size-5 shrink-0 text-primary-green sm:block" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-wide sm:text-base">
            Análise Lab — OS {osId}/{ano}
            {session?.versaoLabel ? ` · ${session.versaoLabel}` : ""}
            {renderInFlight ? (
              <span className="ml-2 inline-block rounded bg-sky-300/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary-blue">
                Gerando
              </span>
            ) : null}
          </h1>
          {info && (info.titulo || info.produto) ? (
            <p className="truncate text-xs text-white/70">
              {[info.titulo, info.produto].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        {hasSession && !showPicker ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTab("inspecao")}
              className={
                tab === "inspecao"
                  ? "rounded-md bg-primary-green/30 px-2 py-1.5 text-sm"
                  : "rounded-md border border-white/30 px-2 py-1.5 text-sm hover:bg-white/10"
              }
            >
              <ScanSearch className="mr-1 inline size-4" aria-hidden />
              Inspeção
            </button>
            <button
              type="button"
              onClick={() => setTab("folhear")}
              className={
                tab === "folhear"
                  ? "rounded-md bg-primary-green/30 px-2 py-1.5 text-sm"
                  : "rounded-md border border-white/30 px-2 py-1.5 text-sm hover:bg-white/10"
              }
            >
              <BookOpen className="mr-1 inline size-4" aria-hidden />
              Folhear
            </button>
            <button
              type="button"
              disabled={actionBusy || renderInFlight}
              onClick={() => setPickerOpen(true)}
              className="rounded-md border border-white/30 px-2 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              Trocar arquivo
            </button>
          </div>
        ) : null}
      </header>

      {actionError ? (
        <p className="shrink-0 bg-red-50 px-4 py-2 text-center text-sm text-sagra-danger">
          {actionError}
        </p>
      ) : null}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {infoQuery.isLoading ? (
          <Centered>
            <Loader2 className="size-8 animate-spin text-primary-green" aria-hidden />
            <p className="text-sm text-neutral-600">Carregando…</p>
          </Centered>
        ) : null}

        {infoQuery.isError ? (
          <Centered>
            <p className="text-sm text-sagra-danger">
              {infoQuery.error instanceof Error
                ? infoQuery.error.message
                : "Erro ao carregar."}
            </p>
            <button
              type="button"
              onClick={() => void infoQuery.refetch()}
              className="inline-flex items-center gap-1 rounded border border-sagra-border bg-white px-3 py-1.5 text-xs"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Tentar novamente
            </button>
          </Centered>
        ) : null}

        {info && showPicker ? (
          <AnaliseLabSourcePicker
            ano={ano}
            osId={osId}
            saving={actionBusy}
            onGenerateStarted={handleGenerateStarted}
            onGenerate={(p) => void handleGenerate(p)}
          />
        ) : null}

        {info && !showPicker && (hasSession || optimisticGenerating) ? (
          <>
            {renderInFlight ? (
              <Centered>
                <Loader2 className="size-8 animate-spin text-primary-green" aria-hidden />
                <p className="text-sm text-neutral-600">
                  {optimisticGenerating && !isInFlight(renderStatus)
                    ? "Iniciando a geração do laboratório…"
                    : "Gerando páginas em segundo plano…"}
                </p>
                {progressLabel ? (
                  <p className="text-xs font-medium text-neutral-700">
                    {progressLabel}
                  </p>
                ) : null}
              </Centered>
            ) : null}

            {renderError ? (
              <Centered>
                <p className="text-sm text-sagra-danger">{renderError}</p>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => {
                    void (async () => {
                      setActionBusy(true);
                      try {
                        await reprocessAnaliseLab(ano, osId);
                        setOptimisticGenerating(true);
                        invalidate();
                      } catch (err) {
                        setActionError(
                          err instanceof Error
                            ? err.message
                            : "Erro ao reprocessar.",
                        );
                      } finally {
                        setActionBusy(false);
                      }
                    })();
                  }}
                  className="rounded border border-sagra-border bg-white px-3 py-1.5 text-xs"
                >
                  Tentar novamente
                </button>
              </Centered>
            ) : null}

            {renderReady && manifestQuery.isLoading ? (
              <Centered>
                <Loader2 className="size-8 animate-spin text-primary-green" aria-hidden />
                <p className="text-sm text-neutral-600">Carregando visualização…</p>
              </Centered>
            ) : null}

            {renderReady && manifestQuery.data ? (
              <div className="flex min-h-0 flex-1 overflow-hidden">
                {tab === "inspecao" ? (
                  <>
                    <AnaliseLabInspector
                      pages={manifestQuery.data.pages}
                      pageIndex={pageIndex}
                      onPageIndexChange={setPageIndex}
                      resolveUrl={(page) =>
                        analiseLabPageUrl(
                          ano,
                          osId,
                          page,
                          manifestQuery.data.cacheKey,
                        )
                      }
                      marks={marks}
                      tool={tool}
                      applyAllPages={applyAllPages}
                      cor={cor}
                      rotulo={rotulo}
                      onCreateGeometryMark={(args) =>
                        void addMark({
                          tipo: args.tipo,
                          geometria: args.geometria,
                        })
                      }
                    />
                    <AnaliseLabMarkTools
                      tool={tool}
                      onToolChange={setTool}
                      edge={edge}
                      onEdgeChange={setEdge}
                      offsetMm={offsetMm}
                      onOffsetMmChange={setOffsetMm}
                      applyAllPages={applyAllPages}
                      onApplyAllPagesChange={setApplyAllPages}
                      cor={cor}
                      onCorChange={setCor}
                      rotulo={rotulo}
                      onRotuloChange={setRotulo}
                      stepMm={stepMm}
                      onStepMmChange={setStepMm}
                      marks={marks}
                      onDeleteMark={(id) => void handleDeleteMark(id)}
                      busy={actionBusy}
                      onAddOffset={() =>
                        void addMark({
                          tipo: "offset_corte",
                          geometria: { edge, offsetMm },
                        })
                      }
                      onAddFaixa={() =>
                        void addMark({
                          tipo: "faixa",
                          geometria: { edge, fromMm: 0, toMm: offsetMm },
                        })
                      }
                      onAddGrade={() =>
                        void addMark({
                          tipo: "grade",
                          geometria: { stepMm },
                        })
                      }
                    />
                  </>
                ) : (
                  <ProvaWebViewerShell
                    ano={ano}
                    osId={osId}
                    manifest={manifestQuery.data}
                    buildPageUrl={(page) =>
                      analiseLabPageUrl(
                        ano,
                        osId,
                        page,
                        manifestQuery.data.cacheKey,
                      )
                    }
                    renderPageOverlay={renderPageOverlay}
                  />
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
      {children}
    </div>
  );
}
