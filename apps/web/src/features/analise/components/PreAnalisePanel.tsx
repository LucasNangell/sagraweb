import { cn } from "@sagra/ui";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  ScanSearch,
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
import "./preAnalisePanel.css";

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

function RelatorioPorArquivo({ results }: { results: PreAnaliseCheckResult[] }) {
  const grupos = useMemo(() => groupProblemsByFile(results), [results]);
  if (grupos.length === 0) return null;

  return (
    <ul className="space-y-3">
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

function RelatorioPorVerificacao({ results }: { results: PreAnaliseCheckResult[] }) {
  return (
    <ul className="space-y-2">
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

function formatSavedAt(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export interface PreAnalisePanelProps {
  running: boolean;
  loadingSnapshot?: boolean;
  live: PreAnaliseLiveState;
  results: PreAnaliseCheckResult[];
  versaoLabel: string;
  savedAt?: string | null;
  onRun: () => void;
  onCancel: () => void;
  canRun: boolean;
}

export function PreAnalisePanel({
  running,
  loadingSnapshot = false,
  live,
  results,
  versaoLabel,
  savedAt,
  onRun,
  onCancel,
  canRun,
}: PreAnalisePanelProps) {
  const [showFullReport, setShowFullReport] = useState(false);
  const [displayRemainingSec, setDisplayRemainingSec] = useState<number | null>(
    null,
  );

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

  const complete = !running && live.phase === "complete";
  const failed = live.phase === "failed";
  const cancelled = !running && live.phase === "cancelled";
  const problemResults = filterProblemResults(results);
  const problemCheckCount = countProblemResults(results);
  const problemItemCount = countProblemItems(problemResults);
  const problemFileCount = countFilesWithProblems(problemResults);
  const displayResults = showFullReport ? results : problemResults;
  const idle =
    !running &&
    !loadingSnapshot &&
    results.length === 0 &&
    live.phase !== "failed" &&
    !cancelled;
  const savedAtLabel = formatSavedAt(savedAt);

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
    <div className="flex min-h-0 flex-col gap-3">
      <div className="rounded-lg border border-secondary-blue/25 bg-gradient-to-r from-slate-50 to-blue-50/40 px-3 py-2.5">
        <p className="text-xs text-slate-600">
          Versão analisada: <strong className="text-slate-800">{versaoLabel || "—"}</strong>
        </p>
        {loadingSnapshot ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
            <Loader2 className="size-3.5 animate-spin text-secondary-blue" />
            Carregando pré-análise salva…
          </p>
        ) : null}
        {idle ? (
          <p className="mt-1 text-sm text-slate-700">
            Execute as verificações automáticas nos PDFs desta versão. Os alertas
            aparecem aqui, agrupados por arquivo. Uma nova execução substitui o
            resultado salvo desta versão.
          </p>
        ) : null}
        {!idle && !running && savedAtLabel ? (
          <p className="mt-1 text-[11px] text-slate-500">
            Salva em <strong className="text-slate-700">{savedAtLabel}</strong>
            {complete ? " — execute novamente para atualizar." : null}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canRun || running || loadingSnapshot}
            onClick={onRun}
            className="inline-flex items-center gap-1.5 rounded-md border border-secondary-blue bg-white px-3 py-1.5 text-xs font-semibold text-secondary-blue hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ScanSearch className="size-3.5" />
            )}
            {running ? "Analisando…" : "Executar pré-análise"}
          </button>
          {running ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </div>

      {!idle ? (
        <>
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-secondary-blue transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
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
              <p className="mt-1 text-xs font-medium text-secondary-blue">
                Tempo restante estimado:{" "}
                <span className="tabular-nums">
                  {formatPreAnaliseDuration(displayRemainingSec)}
                </span>
              </p>
            ) : null}
          </div>

          <div
            className="pre-analise-panel__scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
            role="region"
            aria-label="Resultados da pré-análise"
          >
            {running ? (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-secondary-blue/30 bg-slate-50 px-3 py-2">
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-secondary-blue" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">
                    {live.currentCheckName ?? "Verificando…"}
                  </p>
                  {live.currentDetail ? (
                    <p className="mt-0.5 text-xs text-slate-600">{live.currentDetail}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {failed && live.errorMessage ? (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p>{live.errorMessage}</p>
              </div>
            ) : null}

            {cancelled && live.errorMessage ? (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-800">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-slate-600" />
                <p>{live.errorMessage}</p>
              </div>
            ) : null}

            {(complete || cancelled) && results.length > 0 ? (
              <div className="space-y-3">
                {problemCheckCount === 0 ? (
                  <div
                    className={cn(
                      "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                      cancelled
                        ? "border-slate-300 bg-slate-50 text-slate-800"
                        : "border-green-200 bg-green-50 text-green-900",
                    )}
                  >
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    <p className="font-semibold">
                      {cancelled
                        ? "Verificações parciais sem alerta"
                        : "Nenhum problema detectado"}
                    </p>
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
                    </p>
                    {showFullReport ? (
                      <RelatorioPorVerificacao results={displayResults} />
                    ) : (
                      <RelatorioPorArquivo results={displayResults} />
                    )}
                    <button
                      type="button"
                      onClick={() => setShowFullReport((v) => !v)}
                      className="flex w-full items-center justify-center gap-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {showFullReport ? (
                        <>
                          <ChevronUp className="size-3.5" />
                          Ver por arquivo
                        </>
                      ) : (
                        <>
                          <ChevronDown className="size-3.5" />
                          Ver por verificação ({results.length})
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
