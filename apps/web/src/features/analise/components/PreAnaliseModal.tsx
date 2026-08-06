import { cn } from "@sagra/ui";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { PreAnaliseCheckResult, PreAnaliseLiveState } from "../preAnaliseTypes";
import {
  countProblemItems,
  countProblemResults,
  countFilesWithProblems,
  filterProblemResults,
  formatPreAnaliseDuration,
  groupProblemsByFile,
  type PreAnaliseProblemaItem,
} from "../preAnaliseUtils";
import "./preAnaliseModal.css";

function ProblemaItemRow({ item }: { item: PreAnaliseProblemaItem }) {
  const isError = item.severidade === "error";

  return (
    <li
      className={cn(
        "rounded border px-2.5 py-2 text-xs leading-snug",
        isError
          ? "border-red-200 bg-red-50 text-red-900"
          : "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {item.verificacao}
      </p>
      <p className="mt-0.5 font-semibold">{item.titulo}</p>
      <p className="mt-0.5">{item.descricao}</p>
    </li>
  );
}

function RelatorioPorArquivo({
  results,
}: {
  results: PreAnaliseCheckResult[];
}) {
  const grupos = useMemo(() => groupProblemsByFile(results), [results]);

  if (grupos.length === 0) {
    return null;
  }

  return (
    <ul className="space-y-4">
      {grupos.map((grupo) => (
        <li
          key={grupo.arquivo}
          className="rounded-lg border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-sm font-bold text-slate-800">{grupo.rotulo}</p>
            <p className="text-[11px] text-slate-500">
              {grupo.itens.length} alerta{grupo.itens.length === 1 ? "" : "s"}
            </p>
          </div>
          <ul className="space-y-1.5 p-3">
            {grupo.itens.map((item) => (
              <ProblemaItemRow key={item.id} item={item} />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function RelatorioPorVerificacao({
  results,
}: {
  results: PreAnaliseCheckResult[];
}) {
  return (
    <ul className="space-y-3">
      {results.map((result) => (
        <li
          key={result.check_id}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
        >
          <p className="font-semibold text-slate-800">{result.check_nome}</p>
          <p
            className={cn(
              "mt-0.5 text-xs",
              result.status === "error"
                ? "text-red-800"
                : result.status === "warning"
                  ? "text-amber-800"
                  : "text-green-800",
            )}
          >
            {result.mensagem}
          </p>
        </li>
      ))}
    </ul>
  );
}

export interface PreAnaliseModalProps {
  open: boolean;
  running: boolean;
  live: PreAnaliseLiveState;
  results: PreAnaliseCheckResult[];
  versaoLabel: string;
  onCancel: () => void;
  onClose: () => void;
}

export function PreAnaliseModal({
  open,
  running,
  live,
  results,
  versaoLabel,
  onCancel,
  onClose,
}: PreAnaliseModalProps) {
  const [showFullReport, setShowFullReport] = useState(false);
  const [displayRemainingSec, setDisplayRemainingSec] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (!open) setShowFullReport(false);
  }, [open]);

  useEffect(() => {
    if (!running) {
      setDisplayRemainingSec(null);
      return;
    }
    if (live.remainingSec != null) {
      setDisplayRemainingSec(live.remainingSec);
    }
  }, [running, live.remainingSec]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setDisplayRemainingSec((prev) =>
        prev != null && prev > 0 ? prev - 1 : prev,
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (!open) return null;

  const complete = !running && live.phase === "complete";
  const failed = live.phase === "failed";
  const cancelled = !running && live.phase === "cancelled";
  const problemResults = filterProblemResults(results);
  const problemCheckCount = countProblemResults(results);
  const problemItemCount = countProblemItems(problemResults);
  const problemFileCount = countFilesWithProblems(problemResults);

  const displayResults = showFullReport ? results : problemResults;

  const progressPct =
    live.totalChecks > 0
      ? Math.min(
          running ? 95 : 100,
          Math.round((live.completedChecks / live.totalChecks) * 100),
        )
      : live.phase === "complete"
        ? 100
        : 0;

  return (
    <div
      className="fixed inset-0 z-[175] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pre-analise-title"
    >
      <div className="pre-analise-modal flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 id="pre-analise-title" className="text-lg font-bold text-slate-800">
              Pré-análise automática
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Versão: <strong>{versaoLabel || "—"}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="shrink-0 px-5 pt-4">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-secondary-blue transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {running
              ? live.totalChecks > 0
                ? `${live.completedChecks} de ${live.totalChecks} verificações`
                : "Análise em andamento…"
              : failed
                ? "Análise interrompida."
                : cancelled
                  ? "Análise cancelada."
                  : "Análise concluída."}
          </p>
          {running && displayRemainingSec != null ? (
            <p className="mt-2 text-sm font-medium text-secondary-blue">
              Tempo restante estimado:{" "}
              <span className="tabular-nums">
                {formatPreAnaliseDuration(displayRemainingSec)}
              </span>
              {live.hasTimingHistory &&
              (live.timingSampleCount ?? 0) > 0 ? (
                <span className="ml-1 text-xs font-normal text-slate-500">
                  (baseado em {live.timingSampleCount} medições de arquivos
                  similares)
                </span>
              ) : live.hasTimingHistory ? (
                <span className="ml-1 text-xs font-normal text-slate-500">
                  (baseado em análises anteriores)
                </span>
              ) : (
                <span className="ml-1 text-xs font-normal text-slate-500">
                  (estimativa inicial — melhora após cada execução)
                </span>
              )}
            </p>
          ) : null}
        </div>

        <div
          className="pre-analise-modal__scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4"
          role="region"
          aria-label="Progresso e resultados da pré-análise"
        >
          {running ? (
            <div className="flex items-start gap-3 rounded-lg border border-secondary-blue/30 bg-slate-50 px-4 py-3">
              <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-secondary-blue" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800">
                  {live.currentCheckName ?? "Verificando…"}
                </p>
                {live.currentDetail ? (
                  <p className="mt-1 text-xs leading-snug text-slate-600">
                    {live.currentDetail}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {failed && live.errorMessage ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>{live.errorMessage}</p>
            </div>
          ) : null}

          {cancelled && live.errorMessage ? (
            <div className="flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-800">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-slate-600" />
              <p>{live.errorMessage}</p>
            </div>
          ) : null}

          {(complete || cancelled) && results.length > 0 ? (
            <div className="space-y-4">
              {problemCheckCount === 0 ? (
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-lg border px-3 py-3 text-sm",
                    cancelled
                      ? "border-slate-300 bg-slate-50 text-slate-800"
                      : "border-green-200 bg-green-50 text-green-900",
                  )}
                >
                  <CheckCircle2
                    className={cn(
                      "mt-0.5 size-5 shrink-0",
                      cancelled ? "text-slate-600" : undefined,
                    )}
                  />
                  <div>
                    <p className="font-semibold">
                      {cancelled
                        ? "Verificações parciais sem alerta"
                        : "Nenhum problema detectado"}
                    </p>
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        cancelled ? "text-slate-600" : "text-green-800",
                      )}
                    >
                      {cancelled
                        ? `${results.length} verificação(ões) concluída(s) antes do cancelamento, sem alertas nas concluídas.`
                        : `Todas as ${results.length} verificações foram concluídas sem alertas.`}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-700">
                    <span className="font-semibold text-amber-900">
                      {problemItemCount} alerta
                      {problemItemCount === 1 ? "" : "s"}
                    </span>
                    {problemFileCount > 0 ? (
                      <span className="text-slate-600">
                        {" "}
                        em {problemFileCount} arquivo
                        {problemFileCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {showFullReport ? null : (
                      <span className="text-slate-600">
                        {" "}
                        — agrupados por arquivo abaixo.
                      </span>
                    )}
                  </p>

                  {showFullReport ? (
                    <RelatorioPorVerificacao results={displayResults} />
                  ) : (
                    <RelatorioPorArquivo results={displayResults} />
                  )}
                </>
              )}

              <button
                type="button"
                onClick={() => setShowFullReport((v) => !v)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {showFullReport ? (
                  <>
                    <ChevronUp className="size-4" />
                    Ver problemas por arquivo
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-4" />
                    Ver relatório por verificação ({results.length} itens)
                  </>
                )}
              </button>
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3">
          {running ? (
            <button
              type="button"
              onClick={onCancel}
              className="min-w-[100px] rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancelar análise
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="min-w-[100px] rounded-lg bg-primary-green px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}
