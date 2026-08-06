import { cn } from "@sagra/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  XCircle,
} from "lucide-react";

import {
  cancelPapelariaJobAdmin,
  fetchPapelariaWorkerQueueAdmin,
  movePapelariaJobAdmin,
} from "@/api/adminSystem";
import type {
  PapelariaAdminJobStatus,
  PapelariaAdminQueueJob,
} from "@/features/configuracoes/types";

import {
  ConfigErrorState,
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
} from "./ConfigSectionLayout";

const QUEUE_QUERY_KEY = ["admin", "papelaria-worker-queue"] as const;

const STATUS_LABEL: Record<PapelariaAdminJobStatus, string> = {
  pending: "Na fila",
  processing: "Processando",
  completed: "Concluído",
  failed: "Erro",
  cancelled: "Cancelado",
};

const STATUS_CLASS: Record<PapelariaAdminJobStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  processing: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-neutral-200 text-neutral-600",
};

export function PapelariaWorkerQueueSection() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [...QUEUE_QUERY_KEY],
    queryFn: fetchPapelariaWorkerQueueAdmin,
    refetchInterval: 5000,
  });

  const invalidateQueue = () => {
    void qc.invalidateQueries({ queryKey: [...QUEUE_QUERY_KEY] });
  };

  const cancelMutation = useMutation({
    mutationFn: cancelPapelariaJobAdmin,
    onSuccess: invalidateQueue,
  });

  const moveMutation = useMutation({
    mutationFn: ({
      jobId,
      direction,
    }: {
      jobId: number;
      direction: "up" | "down";
    }) => movePapelariaJobAdmin(jobId, direction),
    onSuccess: invalidateQueue,
  });

  const data = query.data;
  const pendingJobs = (data?.fila ?? []).filter((j) => j.status === "pending");
  const busyJobId =
    cancelMutation.isPending && cancelMutation.variables != null
      ? cancelMutation.variables
      : moveMutation.isPending
        ? moveMutation.variables?.jobId
        : null;

  const handleCancel = (job: PapelariaAdminQueueJob) => {
    const label =
      job.status === "processing" ? "processamento em andamento" : "job na fila";
    if (
      !window.confirm(
        `Cancelar job #${job.id} (OS ${job.nro_protocolo}/${job.ano_protocolo})?\n${label}`,
      )
    ) {
      return;
    }
    cancelMutation.mutate(job.id);
  };

  const handleMove = (jobId: number, direction: "up" | "down") => {
    moveMutation.mutate({ jobId, direction });
  };

  return (
    <ConfigSection>
      <ConfigSectionHeader
        title="Fila do worker CorelDRAW"
        description="Monitoramento da fila, cancelamento e reordenação de jobs pending. Atualiza a cada 5 segundos."
        icon={<Printer className="size-4" aria-hidden />}
        actions={
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {query.isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Atualizar
          </button>
        }
      />

      <ConfigSectionBody>
      {(cancelMutation.isError || moveMutation.isError) && (
        <ConfigErrorState className="mb-3 text-xs">
          {(cancelMutation.error ?? moveMutation.error) instanceof Error
            ? (cancelMutation.error ?? moveMutation.error)!.message
            : "Erro na operação."}
        </ConfigErrorState>
      )}

      {query.isPending ? (
        <ConfigLoadingState>
          <Loader2 className="size-4 animate-spin" />
          Carregando fila…
        </ConfigLoadingState>
      ) : query.isError ? (
        <ConfigErrorState className="text-xs">
          {query.error instanceof Error
            ? query.error.message
            : "Erro ao carregar fila do worker."}
        </ConfigErrorState>
      ) : data ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span>Atualizado em {data.atualizado_em}</span>
            <span className="text-slate-300">|</span>
            <span>
              Workers online:{" "}
              <strong className="text-slate-700">{data.workers_online}</strong>
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Na fila" value={data.totais.pending} tone="amber" />
            <StatCard
              label="Processando"
              value={data.totais.processing}
              tone="blue"
            />
            <StatCard
              label="Concluídos"
              value={data.totais.completed}
              tone="green"
            />
            <StatCard label="Erros" value={data.totais.failed} tone="red" />
            <StatCard
              label="Cancelados"
              value={data.totais.cancelled}
              tone="neutral"
            />
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">
              Workers
            </h3>
            {data.workers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
                Nenhum heartbeat registrado.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Worker</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">CPU %</th>
                      <th className="px-3 py-2">RAM %</th>
                      <th className="px-3 py-2">Carga</th>
                      <th className="px-3 py-2">Último heartbeat</th>
                      <th className="px-3 py-2">Há (s)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.workers.map((w) => (
                      <tr key={w.worker_id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono font-medium text-slate-800">
                          {w.worker_id}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                              w.online
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-neutral-200 text-neutral-600",
                            )}
                          >
                            {w.online ? "Online" : "Offline"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {w.cpu_percent != null ? `${w.cpu_percent}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {w.memory_percent != null ? `${w.memory_percent}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {w.load_score != null ? `${w.load_score}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {w.heartbeat_em}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {w.seconds_since_heartbeat}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <ActiveQueueTable
            jobs={data.fila}
            pendingJobs={pendingJobs}
            busyJobId={busyJobId}
            onCancel={handleCancel}
            onMove={handleMove}
          />

          <JobsTable
            title="Últimos finalizados"
            emptyMessage="Nenhum job finalizado recentemente."
            jobs={data.recentes}
            showConcluido
          />
        </div>
      ) : null}
      </ConfigSectionBody>
    </ConfigSection>
  );
}

function ActiveQueueTable({
  jobs,
  pendingJobs,
  busyJobId,
  onCancel,
  onMove,
}: {
  jobs: PapelariaAdminQueueJob[];
  pendingJobs: PapelariaAdminQueueJob[];
  busyJobId: number | null | undefined;
  onCancel: (job: PapelariaAdminQueueJob) => void;
  onMove: (jobId: number, direction: "up" | "down") => void;
}) {
  const pendingIndex = new Map(pendingJobs.map((j, i) => [j.id, i]));

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
        <FileText className="size-3.5" aria-hidden />
        Fila ativa
        <span className="font-normal normal-case text-slate-400">
          ({jobs.length})
        </span>
      </h3>
      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
          Nenhum job na fila ou em processamento.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Job</th>
                <th className="px-3 py-2">OS</th>
                <th className="px-3 py-2">Modelo</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Fila</th>
                <th className="px-3 py-2">Worker</th>
                <th className="px-3 py-2">Solicitante</th>
                <th className="px-3 py-2">Solicitado</th>
                <th className="px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const pIdx = pendingIndex.get(job.id);
                const isPending = job.status === "pending";
                const canMove = isPending && pIdx !== undefined;
                const isBusy = busyJobId === job.id;

                return (
                  <tr key={job.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-mono font-medium text-slate-800">
                      #{job.id}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                      {job.nro_protocolo}/{job.ano_protocolo}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-slate-600">
                      {job.arquivo_modelo}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          STATUS_CLASS[job.status],
                        )}
                      >
                        {STATUS_LABEL[job.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {job.ordem_fila ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-600">
                      {job.worker_id ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {job.solicitado_por}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                      {job.solicitado_em ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {canMove && (
                          <>
                            <button
                              type="button"
                              title="Subir na fila"
                              disabled={isBusy || pIdx === 0}
                              onClick={() => onMove(job.id, "up")}
                              className="inline-flex size-7 items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                            >
                              <ChevronUp className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Descer na fila"
                              disabled={
                                isBusy || pIdx === pendingJobs.length - 1
                              }
                              onClick={() => onMove(job.id, "down")}
                              className="inline-flex size-7 items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                            >
                              <ChevronDown className="size-3.5" />
                            </button>
                          </>
                        )}
                        {(isPending || job.status === "processing") && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onCancel(job)}
                            className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            {isBusy ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <XCircle className="size-3" />
                            )}
                            Cancelar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "blue" | "green" | "red" | "neutral";
}) {
  const toneClass = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    red: "border-red-200 bg-red-50 text-red-900",
    neutral: "border-slate-200 bg-slate-50 text-slate-800",
  }[tone];

  return (
    <div className={cn("rounded-lg border px-3 py-2", toneClass)}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
        {label}
      </p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function JobsTable({
  title,
  emptyMessage,
  jobs,
  showConcluido = false,
}: {
  title: string;
  emptyMessage: string;
  jobs: PapelariaAdminQueueJob[];
  showConcluido?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
        <FileText className="size-3.5" aria-hidden />
        {title}
        <span className="font-normal normal-case text-slate-400">
          ({jobs.length})
        </span>
      </h3>
      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Job</th>
                <th className="px-3 py-2">OS</th>
                <th className="px-3 py-2">Modelo</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Fila</th>
                <th className="px-3 py-2">Worker</th>
                <th className="px-3 py-2">Solicitante</th>
                <th className="px-3 py-2">
                  {showConcluido ? "Concluído" : "Solicitado"}
                </th>
                <th className="px-3 py-2">Erro</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono font-medium text-slate-800">
                    #{job.id}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                    {job.nro_protocolo}/{job.ano_protocolo}
                  </td>
                  <td className="max-w-[140px] truncate px-3 py-2 text-slate-600">
                    {job.arquivo_modelo}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        STATUS_CLASS[job.status],
                      )}
                    >
                      {STATUS_LABEL[job.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {job.ordem_fila ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-600">
                    {job.worker_id ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {job.solicitado_por}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                    {showConcluido
                      ? (job.concluido_em ?? job.solicitado_em ?? "—")
                      : (job.solicitado_em ?? "—")}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-[10px] text-red-700">
                    {job.erro ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
