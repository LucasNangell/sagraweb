import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@sagra/ui";

import { fetchPapelariaJob } from "@/api/papelaria";
import { queryKeys } from "@/api/query-keys";
import { OsHistoryPanel } from "@/features/os/components/OsHistoryPanel";
import type { OsSearchRow } from "@/features/os/types";

import {
  osRowFromPapelariaSession,
  sameOsRow,
} from "../papelariaSelection";
import { setPapelariaNavigationContext } from "../papelariaSession";
import {
  papelariaSpJobUiFromJobStatus,
  papelariaSpJobUiKey,
  type PapelariaSpJobUiStatus,
} from "../papelariaSpJobUi";
import { PapelariaCorelPanel } from "./PapelariaCorelPanel";
import { PapelariaSpList } from "./PapelariaSpList";

type MobilePane = "lista" | "trabalho";

export function PapelariaPage() {
  const [selected, setSelected] = useState<OsSearchRow | null>(() =>
    osRowFromPapelariaSession(),
  );
  const [mobilePane, setMobilePane] = useState<MobilePane>(() =>
    osRowFromPapelariaSession() ? "trabalho" : "lista",
  );
  const [jobUiBySp, setJobUiBySp] = useState<
    Record<string, PapelariaSpJobUiStatus>
  >({});
  /** Jobs em voo por SP — continuam sendo polled mesmo ao trocar de SP. */
  const [trackedJobIdsBySp, setTrackedJobIdsBySp] = useState<
    Record<string, number>
  >({});

  const osId = selected ? String(selected.nr_os) : null;
  const osAno = selected ? String(selected.ano) : null;
  const osPanelKey = `${osAno ?? ""}-${osId ?? ""}`;

  const handleSelect = (row: OsSearchRow) => {
    setPapelariaNavigationContext({
      nr_os: row.nr_os,
      ano: row.ano,
    });
    setSelected(row);
    setMobilePane("trabalho");
  };

  /** Quando a lista traz a linha completa, sincroniza metadados da seleção stub. */
  const handleSelectFromList = (row: OsSearchRow) => {
    if (sameOsRow(selected, row) && selected) {
      setSelected({ ...selected, ...row });
      return;
    }
    handleSelect(row);
  };

  const handleSpJobUiStatusChange = useCallback(
    (
      ano: number,
      nro: number,
      status: PapelariaSpJobUiStatus | null,
      jobId?: number | null,
    ) => {
      const key = papelariaSpJobUiKey(ano, nro);
      setJobUiBySp((prev) => {
        if (status === null) {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }
        if (prev[key] === status) return prev;
        return { ...prev, [key]: status };
      });

      setTrackedJobIdsBySp((prev) => {
        if (
          status === "pending" ||
          status === "generating"
        ) {
          if (jobId == null || jobId <= 0) return prev;
          if (prev[key] === jobId) return prev;
          return { ...prev, [key]: jobId };
        }
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [],
  );

  const trackedEntries = useMemo(
    () => Object.entries(trackedJobIdsBySp),
    [trackedJobIdsBySp],
  );

  const trackedJobQueries = useQueries({
    queries: trackedEntries.map(([spKey, jobId]) => ({
      queryKey: queryKeys.papelaria.job(jobId),
      queryFn: () => fetchPapelariaJob(jobId),
      refetchInterval: 2_000,
      meta: { spKey, jobId },
    })),
  });

  useEffect(() => {
    trackedEntries.forEach(([spKey], index) => {
      const job = trackedJobQueries[index]?.data;
      if (!job) return;
      const ui = papelariaSpJobUiFromJobStatus(job.status);
      setJobUiBySp((prev) => {
        if (ui === null) {
          if (!(spKey in prev)) return prev;
          const next = { ...prev };
          delete next[spKey];
          return next;
        }
        if (prev[spKey] === ui) return prev;
        return { ...prev, [spKey]: ui };
      });
      if (ui === "pending" || ui === "generating") return;
      setTrackedJobIdsBySp((prev) => {
        if (!(spKey in prev)) return prev;
        const next = { ...prev };
        delete next[spKey];
        return next;
      });
    });
  }, [trackedEntries, trackedJobQueries]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto md:h-full md:overflow-hidden">
      <div
        className="flex shrink-0 gap-1 rounded-lg border border-sagra-border bg-white p-1 shadow-sm md:hidden"
        role="tablist"
        aria-label="Painéis da papelaria"
      >
        {(
          [
            ["lista", "Lista de SPs"],
            ["trabalho", "Formulário / Prova"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mobilePane === id}
            onClick={() => setMobilePane(id)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-[0.7rem] font-semibold transition-colors",
              mobilePane === id
                ? "bg-secondary-blue text-white"
                : "text-neutral-600 hover:bg-slate-50",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row md:overflow-hidden">
        <div
          className={cn(
            "flex min-h-[min(55vh,560px)] w-full min-w-0 flex-col gap-2 md:min-h-0 md:w-[408px] md:shrink-0 lg:w-[480px]",
            mobilePane !== "lista" && "max-md:hidden",
          )}
        >
          <PapelariaSpList
            selected={selected}
            onSelect={handleSelectFromList}
            jobUiBySp={jobUiBySp}
            className="min-h-[200px] flex-1 md:min-h-0"
          />
          <section className="flex min-h-[260px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-sagra-border border-t-4 border-t-secondary-blue bg-white shadow-sm md:min-h-[280px]">
            <OsHistoryPanel
              key={
                selected
                  ? `history-${selected.ano}-${selected.nr_os}`
                  : "history-none"
              }
              selected={selected}
              embedded
              listLayout="compact"
            />
          </section>
        </div>
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            mobilePane !== "trabalho" && "max-md:hidden",
          )}
        >
          <PapelariaCorelPanel
            key={osPanelKey}
            osId={osId}
            osAno={osAno}
            onSpJobUiStatusChange={handleSpJobUiStatusChange}
          />
        </div>
      </div>
    </div>
  );
}
