import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@sagra/ui";

import { fetchPapelariaJob } from "@/api/papelaria";
import { queryKeys } from "@/api/query-keys";
import { OsFolderBrowserModal } from "@/features/os/components/OsFolderBrowserModal";
import type { OsSearchRow } from "@/features/os/types";

import { sameOsRow } from "../papelariaSelection";
import { setPapelariaNavigationContext } from "../papelariaSession";
import { isWaitingImposicaoApogee } from "../papelariaImposicaoStatus";
import {
  overlayPhaseFromJobStatus,
  papelariaSpStatusKey,
  type PapelariaSpLaneOverlay,
  type PapelariaSpPipelineLane,
} from "../papelariaSpPipelineUi";
import { PapelariaCorelPanel } from "./PapelariaCorelPanel";
import { PapelariaSpList } from "./PapelariaSpList";

type MobilePane = "lista" | "trabalho";

type TrackedLaneJob = {
  lane: PapelariaSpPipelineLane;
  jobId: number;
};

export function PapelariaPage() {
  /** Só preenche o formulário/visualização após clique na lista de SPs. */
  const [selected, setSelected] = useState<OsSearchRow | null>(null);
  const [listExpanded, setListExpanded] = useState(false);
  const [formHost, setFormHost] = useState<HTMLDivElement | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("lista");
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [provaOverlayBySp, setProvaOverlayBySp] = useState<
    Record<string, PapelariaSpLaneOverlay>
  >({});
  const [imposicaoOverlayBySp, setImposicaoOverlayBySp] = useState<
    Record<string, PapelariaSpLaneOverlay>
  >({});
  /** Jobs em voo por SP+lane — continuam polled ao trocar de SP. */
  const [trackedBySp, setTrackedBySp] = useState<
    Record<string, TrackedLaneJob>
  >({});
  const queryClient = useQueryClient();

  useEffect(() => {
    const onFolder = () => {
      if (!selected) return;
      setFolderBrowserOpen(true);
    };
    window.addEventListener("sagra:os-folder-browser", onFolder);
    return () =>
      window.removeEventListener("sagra:os-folder-browser", onFolder);
  }, [selected]);

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

  /** Quando a lista traz a linha completa, sincroniza metadados e alterna a expansão. */
  const handleSelectFromList = (row: OsSearchRow) => {
    if (sameOsRow(selected, row) && selected) {
      setSelected({ ...selected, ...row });
      setListExpanded((open) => !open);
      return;
    }
    setListExpanded(true);
    handleSelect(row);
  };

  const invalidateSpStatusResumo = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["papelaria", "spStatusResumo"],
    });
  }, [queryClient]);

  const handleSpPipelineStatusChange = useCallback(
    (
      ano: number,
      nro: number,
      lane: PapelariaSpPipelineLane,
      phase: string | null,
      jobId?: number | null,
      versao?: number | null,
    ) => {
      const key = papelariaSpStatusKey(ano, nro);
      const setOverlay =
        lane === "prova" ? setProvaOverlayBySp : setImposicaoOverlayBySp;

      setOverlay((prev) => {
        if (phase === null) {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }
        const nextVal: PapelariaSpLaneOverlay = {
          phase,
          jobId: jobId ?? null,
          versao: versao ?? null,
        };
        const cur = prev[key];
        if (
          cur &&
          cur.phase === nextVal.phase &&
          cur.jobId === nextVal.jobId &&
          cur.versao === nextVal.versao
        ) {
          return prev;
        }
        return { ...prev, [key]: nextVal };
      });

      setTrackedBySp((prev) => {
        const inFlight =
          phase === "queued" ||
          phase === "processing" ||
          phase === "waiting_apogee";
        if (inFlight) {
          if (jobId == null || jobId <= 0) return prev;
          const cur = prev[key];
          if (cur && cur.jobId === jobId && cur.lane === lane) return prev;
          return { ...prev, [key]: { lane, jobId } };
        }
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });

      if (
        phase === "approved" ||
        phase === "ready_send" ||
        phase === "ready" ||
        phase === "pending" ||
        phase === null
      ) {
        invalidateSpStatusResumo();
      }
    },
    [invalidateSpStatusResumo],
  );

  const trackedEntries = useMemo(
    () => Object.entries(trackedBySp),
    [trackedBySp],
  );

  const trackedJobQueries = useQueries({
    queries: trackedEntries.map(([, tracked]) => ({
      queryKey: queryKeys.papelaria.job(tracked.jobId),
      queryFn: () => fetchPapelariaJob(tracked.jobId),
      refetchInterval: 2_000,
    })),
  });

  useEffect(() => {
    trackedEntries.forEach(([spKey, tracked], index) => {
      const job = trackedJobQueries[index]?.data;
      if (!job) return;
      const waitingApogee = isWaitingImposicaoApogee(job);
      const phase = overlayPhaseFromJobStatus(tracked.lane, job.status, {
        waitingApogee,
        approvedProva: job.prova_revisao === "approved",
      });
      const setOverlay =
        tracked.lane === "prova"
          ? setProvaOverlayBySp
          : setImposicaoOverlayBySp;

      if (phase === null) {
        setOverlay((prev) => {
          if (!(spKey in prev)) return prev;
          const next = { ...prev };
          delete next[spKey];
          return next;
        });
        setTrackedBySp((prev) => {
          if (!(spKey in prev)) return prev;
          const next = { ...prev };
          delete next[spKey];
          return next;
        });
        invalidateSpStatusResumo();
        return;
      }

      setOverlay((prev) => {
        const nextVal: PapelariaSpLaneOverlay = {
          phase,
          jobId: job.id,
          versao: typeof job.versao === "number" ? job.versao : null,
        };
        const cur = prev[spKey];
        if (
          cur &&
          cur.phase === nextVal.phase &&
          cur.jobId === nextVal.jobId &&
          cur.versao === nextVal.versao
        ) {
          return prev;
        }
        return { ...prev, [spKey]: nextVal };
      });

      if (
        phase === "queued" ||
        phase === "processing" ||
        phase === "waiting_apogee"
      ) {
        return;
      }
      setTrackedBySp((prev) => {
        if (!(spKey in prev)) return prev;
        const next = { ...prev };
        delete next[spKey];
        return next;
      });
      invalidateSpStatusResumo();
    });
  }, [trackedEntries, trackedJobQueries, invalidateSpStatusResumo]);

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
            ["trabalho", "Prévia / Prova"],
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
            "flex min-h-[min(70vh,720px)] w-full min-w-0 flex-col gap-2 md:h-full md:min-h-0 md:w-[696px] md:shrink-0 lg:w-[768px]",
            mobilePane !== "lista" && "max-md:hidden",
          )}
        >
          <PapelariaSpList
            selected={selected}
            expanded={listExpanded}
            onSelect={handleSelectFromList}
            provaOverlayBySp={provaOverlayBySp}
            imposicaoOverlayBySp={imposicaoOverlayBySp}
            className="min-h-0 flex-1 basis-0"
          />
          <div
            ref={setFormHost}
            className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col"
            data-testid="papelaria-form-host"
          />
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
            formHost={formHost}
            dockForm
            onSpPipelineStatusChange={handleSpPipelineStatusChange}
          />
        </div>
      </div>

      <OsFolderBrowserModal
        row={selected}
        open={folderBrowserOpen}
        onClose={() => setFolderBrowserOpen(false)}
      />
    </div>
  );
}
