import { ChevronLeft, ChevronRight, FolderTree } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  cancelPdfCompare,
  downloadPdfCompareReport,
  fetchPdfCompareProgress,
  fetchPdfCompareResult,
  joinOsAbsolutePath,
  optionsToPayload,
  startPdfCompare,
  type CompareExecution,
} from "./api";
import { OsPdfComparePagesColumn } from "./OsPdfComparePagesColumn";
import { OsPdfCompareReport } from "./OsPdfCompareReport";
import { OsPdfCompareViewer } from "./OsPdfCompareViewer";
import { OsPdfTreePicker, type AssignSlot } from "./OsPdfTreePicker";
import type { CompareOptions, CompareProgress, CompareResult, ViewMode } from "./types";
import "./os-pdf-compare.css";

interface OsPdfComparePageProps {
  ano: number;
  osId: number;
  initialPreviousRelative?: string | null;
  initialCurrentRelative?: string | null;
  autoStart?: boolean;
}

const DEFAULT_OPTIONS: CompareOptions = {
  dpi: 150,
  threshold: 16,
  includeUnchangedInReport: false,
};

function fileNameFromRelative(relative: string): string {
  const parts = relative.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || relative;
}

function firstInterestingPage(pages: CompareResult["pages"]): number {
  if (!pages?.length) return 0;
  const hit = pages.find(
    (p) => p.changedPercent > 0.01 || p.status !== "compared",
  );
  return hit ? hit.index : 0;
}

export function OsPdfComparePage({
  ano,
  osId,
  initialPreviousRelative = null,
  initialCurrentRelative = null,
  autoStart = false,
}: OsPdfComparePageProps) {
  const [previousRelative, setPreviousRelative] = useState<string | null>(
    initialPreviousRelative,
  );
  const [currentRelative, setCurrentRelative] = useState<string | null>(
    initialCurrentRelative,
  );
  const [previousName, setPreviousName] = useState<string | null>(
    initialPreviousRelative ? fileNameFromRelative(initialPreviousRelative) : null,
  );
  const [currentName, setCurrentName] = useState<string | null>(
    initialCurrentRelative ? fileNameFromRelative(initialCurrentRelative) : null,
  );
  const [assignSlot, setAssignSlot] = useState<AssignSlot>("previous");
  const [options, setOptions] = useState<CompareOptions>(DEFAULT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<CompareProgress | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("diff");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [execution, setExecution] = useState<CompareExecution | null>(null);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const pollRef = useRef<number | null>(null);
  const autoStartedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const onSelectPdf = (relative: string, name: string) => {
    if (assignSlot === "previous") {
      setPreviousRelative(relative);
      setPreviousName(name);
      setAssignSlot("current");
    } else {
      setCurrentRelative(relative);
      setCurrentName(name);
      setAssignSlot("previous");
    }
  };

  const clearAll = () => {
    stopPolling();
    setBusy(false);
    setProgress(null);
    setResult(null);
    setError(null);
    setSessionId(null);
    setExecution(null);
    setPageIndex(0);
    setViewMode("diff");
    setPreviousRelative(null);
    setCurrentRelative(null);
    setPreviousName(null);
    setCurrentName(null);
    setAssignSlot("previous");
    setFilesCollapsed(false);
    setReportOpen(false);
  };

  const runCompare = useCallback(async () => {
    if (!previousRelative || !currentRelative) {
      setError("Selecione os dois PDFs para comparar.");
      return;
    }
    setError(null);
    setResult(null);
    setReportOpen(false);
    setExecution(null);
    setBusy(true);
    setProgress({
      sessionId: "",
      stage: "queued",
      current: 0,
      total: 0,
      message: "Iniciando comparação…",
      pct: 0,
      done: false,
    });
    try {
      const absolutePaths =
        rootPath
          ? {
              previous: joinOsAbsolutePath(rootPath, previousRelative),
              current: joinOsAbsolutePath(rootPath, currentRelative),
            }
          : null;
      const started = await startPdfCompare(
        ano,
        osId,
        optionsToPayload(previousRelative, currentRelative, options),
        absolutePaths,
      );
      setSessionId(started.session_id);
      setExecution(started.execution);
      setProgress({
        sessionId: started.session_id,
        stage: "queued",
        current: 0,
        total: 0,
        message:
          started.execution === "local"
            ? "Processando neste computador…"
            : "Processando no servidor…",
        pct: 0,
        done: false,
      });
      stopPolling();
      pollRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const prog = await fetchPdfCompareProgress(
              ano,
              osId,
              started.session_id,
              started.execution,
            );
            const where =
              started.execution === "local"
                ? "neste computador"
                : "no servidor";
            setProgress({
              ...prog,
              message: prog.message
                ? `${prog.message} (${where})`
                : `Processando ${where}…`,
            });
            if (!prog.done) return;
            stopPolling();
            if (prog.cancelled) {
              setBusy(false);
              setError("Comparação cancelada.");
              return;
            }
            if (prog.error) {
              setBusy(false);
              setError(prog.error);
              return;
            }
            const data = await fetchPdfCompareResult(
              ano,
              osId,
              started.session_id,
              started.execution,
            );
            setResult(data);
            setPageIndex(firstInterestingPage(data.pages));
            setViewMode("diff");
            setBusy(false);
            setProgress(null);
            setFilesCollapsed(true);
          } catch (err) {
            stopPolling();
            setBusy(false);
            setError(err instanceof Error ? err.message : String(err));
          }
        })();
      }, 700);
    } catch (err) {
      setBusy(false);
      setProgress(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [
    ano,
    currentRelative,
    options,
    osId,
    previousRelative,
    rootPath,
    stopPolling,
  ]);

  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    if (!previousRelative || !currentRelative) return;
    if (rootPath) {
      autoStartedRef.current = true;
      void runCompare();
      return;
    }
    // Sem root ainda: aguarda browse publicar rootPath; senão cai no servidor.
    const timer = window.setTimeout(() => {
      if (autoStartedRef.current) return;
      autoStartedRef.current = true;
      void runCompare();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [autoStart, currentRelative, previousRelative, rootPath, runCompare]);

  const onCancel = async () => {
    if (!sessionId || !execution) return;
    try {
      await cancelPdfCompare(ano, osId, sessionId, execution);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onExportReport = async () => {
    if (!sessionId || !execution) return;
    setError(null);
    try {
      setProgress({
        sessionId,
        stage: "report",
        current: 0,
        total: 1,
        message:
          execution === "local"
            ? "Gerando relatório neste computador…"
            : "Gerando relatório no servidor…",
        pct: 5,
        done: false,
      });
      await downloadPdfCompareReport(
        ano,
        osId,
        sessionId,
        options.includeUnchangedInReport,
        execution,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  const canCompare = !!previousRelative && !!currentRelative && !busy;

  return (
    <div className="os-pdf-compare-page">
      <header className="os-pdf-hero">
        <div className="os-pdf-hero-copy">
          <h1>Comparador de versões PDF</h1>
          <p className="subtitle">
            {previousRelative && currentRelative
              ? `Comparação entre os PDFs da OS ${osId}/${ano}`
              : `OS ${osId}/${ano} — selecione dois PDFs na pasta da OS e revise as diferenças visualmente.`}
          </p>
        </div>
        <div
          className={
            "os-pdf-viewmode-menu" + (result?.hasResult ? "" : " is-disabled")
          }
          aria-label="Modo de visualização"
        >
          <span className="os-pdf-viewmode-title">Modo de visualização</span>
          <div className="os-pdf-viewmode-track" role="tablist">
            {(
              [
                ["diff", "Diferença"],
                ["blend", "Sobreposição"],
                ["flicker", "Alternar"],
                ["side", "Lado a lado"],
                ["previous", "Versão anterior"],
                ["current", "Versão atual"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={viewMode === mode}
                className={viewMode === mode ? "active" : ""}
                disabled={!result?.hasResult || busy}
                onClick={() => setViewMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="os-pdf-hero-spacer" aria-hidden />
      </header>

      {error ? <div className="os-pdf-banner error">{error}</div> : null}

      <div
        className={
          "os-pdf-layout" +
          (filesCollapsed ? " files-collapsed" : "") +
          (result?.hasResult ? " has-pages" : "")
        }
      >
        <aside
          className={
            "os-pdf-panel os-pdf-files-panel" +
            (filesCollapsed ? " is-collapsed" : "")
          }
        >
          {filesCollapsed ? (
            <button
              type="button"
              className="os-pdf-files-rail"
              onClick={() => setFilesCollapsed(false)}
              title="Expandir arquivos"
              aria-label="Expandir coluna de arquivos"
            >
              <ChevronRight className="size-4" aria-hidden />
              <FolderTree className="size-4" aria-hidden />
              <span>Arquivos</span>
            </button>
          ) : (
            <>
              <div className="os-pdf-files-header">
                <h2>Arquivos</h2>
                <button
                  type="button"
                  className="os-pdf-files-toggle"
                  onClick={() => setFilesCollapsed(true)}
                  title="Recolher arquivos"
                  aria-label="Recolher coluna de arquivos"
                  disabled={!result?.hasResult}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
              </div>
              <div className="os-pdf-slots">
                <div className="os-pdf-slot">
                  <label>Versão anterior</label>
                  <div className="path" title={previousRelative || undefined}>
                    {previousName || "—"}
                  </div>
                </div>
                <div className="os-pdf-slot">
                  <label>Versão atual</label>
                  <div className="path" title={currentRelative || undefined}>
                    {currentName || "—"}
                  </div>
                </div>
              </div>

              <OsPdfTreePicker
                ano={ano}
                osId={osId}
                previousRelative={previousRelative}
                currentRelative={currentRelative}
                assignSlot={assignSlot}
                onAssignSlotChange={setAssignSlot}
                onSelectPdf={onSelectPdf}
                onRootPath={setRootPath}
                disabled={busy}
              />

              <div className="os-pdf-options">
                <label>
                  Resolução
                  <select
                    value={options.dpi}
                    disabled={busy}
                    onChange={(e) =>
                      setOptions((o) => ({ ...o, dpi: Number(e.target.value) }))
                    }
                  >
                    <option value={150}>150 DPI (rápido)</option>
                    <option value={300}>300 DPI (alta fidelidade)</option>
                  </select>
                </label>
                <label>
                  Tolerância ({options.threshold})
                  <input
                    type="range"
                    min={4}
                    max={48}
                    value={options.threshold}
                    disabled={busy}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        threshold: Number(e.target.value),
                      }))
                    }
                  />
                </label>
              </div>

              <div className="os-pdf-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!canCompare}
                  onClick={() => void runCompare()}
                >
                  Comparar
                </button>
                <button
                  type="button"
                  disabled={!busy}
                  onClick={() => void onCancel()}
                >
                  Cancelar
                </button>
                <button type="button" disabled={busy} onClick={clearAll}>
                  Limpar
                </button>
              </div>

              {progress && (
                <div className="os-pdf-progress">
                  <div className="bar">
                    <span style={{ width: `${Math.max(2, progress.pct)}%` }} />
                  </div>
                  <div className="msg">{progress.message}</div>
                </div>
              )}
            </>
          )}
        </aside>

        {result?.hasResult ? (
          <OsPdfComparePagesColumn
            pages={result.pages}
            pageIndex={pageIndex}
            onPageIndexChange={setPageIndex}
          />
        ) : null}

        <main className="os-pdf-panel os-pdf-panel-main">
          {result?.hasResult ? (
            <OsPdfCompareViewer
              pages={result.pages}
              pageIndex={pageIndex}
              onPageIndexChange={setPageIndex}
              viewMode={viewMode}
              previousName={previousName || result.previousName}
              currentName={currentName || result.currentName}
              changedPages={result.changedPages}
              dpi={result.dpi}
            />
          ) : (
            <div className="os-pdf-viewer-empty">
              {busy
                ? "Comparando…"
                : "Selecione os dois PDFs na árvore e clique em Comparar."}
            </div>
          )}
        </main>
      </div>

      {result?.hasResult && !reportOpen ? (
        <button
          type="button"
          className="os-pdf-report-fab"
          onClick={() => setReportOpen(true)}
        >
          Exibir relatório
        </button>
      ) : null}

      {result?.hasResult && reportOpen ? (
        <OsPdfCompareReport
          result={result}
          includeUnchanged={options.includeUnchangedInReport}
          onIncludeUnchangedChange={(value) =>
            setOptions((o) => ({ ...o, includeUnchangedInReport: value }))
          }
          onExport={() => void onExportReport()}
          exportDisabled={busy}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </div>
  );
}
