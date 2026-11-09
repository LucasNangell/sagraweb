import { useCallback, useEffect, useRef, useState } from "react";

import {
  cancelPdfCompare,
  downloadPdfCompareReport,
  fetchPdfCompareProgress,
  fetchPdfCompareResult,
  optionsToPayload,
  startPdfCompare,
} from "./api";
import { OsPdfCompareReport } from "./OsPdfCompareReport";
import { OsPdfCompareViewer } from "./OsPdfCompareViewer";
import { OsPdfTreePicker, type AssignSlot } from "./OsPdfTreePicker";
import type { CompareOptions, CompareProgress, CompareResult, ViewMode } from "./types";
import "./os-pdf-compare.css";

interface OsPdfComparePageProps {
  ano: number;
  osId: number;
}

const DEFAULT_OPTIONS: CompareOptions = {
  dpi: 150,
  threshold: 16,
  includeUnchangedInReport: false,
};

function firstInterestingPage(pages: CompareResult["pages"]): number {
  if (!pages?.length) return 0;
  const hit = pages.find(
    (p) => p.changedPercent > 0.01 || p.status !== "compared",
  );
  return hit ? hit.index : 0;
}

export function OsPdfComparePage({ ano, osId }: OsPdfComparePageProps) {
  const [previousRelative, setPreviousRelative] = useState<string | null>(null);
  const [currentRelative, setCurrentRelative] = useState<string | null>(null);
  const [previousName, setPreviousName] = useState<string | null>(null);
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [assignSlot, setAssignSlot] = useState<AssignSlot>("previous");
  const [options, setOptions] = useState<CompareOptions>(DEFAULT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<CompareProgress | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("diff");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

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
    setInfo(null);
    setSessionId(null);
    setPageIndex(0);
    setViewMode("diff");
    setPreviousRelative(null);
    setCurrentRelative(null);
    setPreviousName(null);
    setCurrentName(null);
    setAssignSlot("previous");
  };

  const runCompare = async () => {
    if (!previousRelative || !currentRelative) {
      setError("Selecione os dois PDFs para comparar.");
      return;
    }
    setError(null);
    setInfo(null);
    setResult(null);
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
      const started = await startPdfCompare(
        ano,
        osId,
        optionsToPayload(previousRelative, currentRelative, options),
      );
      setSessionId(started.session_id);
      stopPolling();
      pollRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const prog = await fetchPdfCompareProgress(
              ano,
              osId,
              started.session_id,
            );
            setProgress(prog);
            if (!prog.done) return;
            stopPolling();
            if (prog.cancelled) {
              setBusy(false);
              setInfo("Comparação cancelada.");
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
            );
            setResult(data);
            setPageIndex(firstInterestingPage(data.pages));
            setViewMode("diff");
            setInfo(data.summary);
            setBusy(false);
            setProgress(null);
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
  };

  const onCancel = async () => {
    if (!sessionId) return;
    try {
      await cancelPdfCompare(ano, osId, sessionId);
      setInfo("Cancelando…");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onExportReport = async () => {
    if (!sessionId) return;
    setError(null);
    try {
      setProgress({
        sessionId,
        stage: "report",
        current: 0,
        total: 1,
        message: "Gerando relatório PDF…",
        pct: 5,
        done: false,
      });
      await downloadPdfCompareReport(
        ano,
        osId,
        sessionId,
        options.includeUnchangedInReport,
      );
      setInfo("Relatório baixado.");
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
        <div>
          <h1>Comparador de versões PDF</h1>
          <p className="subtitle">
            OS {osId}/{ano} — selecione dois PDFs na pasta da OS e revise as
            diferenças visualmente.
          </p>
        </div>
        <div className={`os-pdf-pill ${result?.hasResult ? "ok" : "warn"}`}>
          {result?.hasResult
            ? `${result.changedPages} alterada(s)`
            : "Seleção"}
        </div>
      </header>

      {(error || info) && (
        <div className={`os-pdf-banner ${error ? "error" : "info"}`}>
          {error || info}
        </div>
      )}

      <div className="os-pdf-layout">
        <aside className="os-pdf-panel">
          <h2>Arquivos</h2>
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
            <label className="check">
              <input
                type="checkbox"
                checked={options.includeUnchangedInReport}
                disabled={busy}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    includeUnchangedInReport: e.target.checked,
                  }))
                }
              />
              Incluir páginas sem mudança no relatório
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
            <button type="button" disabled={!busy} onClick={() => void onCancel()}>
              Cancelar
            </button>
            <button type="button" disabled={busy} onClick={clearAll}>
              Limpar
            </button>
            <button
              type="button"
              disabled={!result?.hasResult || busy}
              onClick={() => void onExportReport()}
            >
              Exportar relatório PDF
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
        </aside>

        <main className="os-pdf-panel">
          {result?.hasResult ? (
            <>
              <OsPdfCompareViewer
                pages={result.pages}
                pageIndex={pageIndex}
                onPageIndexChange={setPageIndex}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
              />
              <OsPdfCompareReport
                result={result}
                includeUnchanged={options.includeUnchangedInReport}
              />
            </>
          ) : (
            <div className="os-pdf-viewer-empty">
              {busy
                ? "Comparando…"
                : "Selecione os dois PDFs na árvore e clique em Comparar."}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
