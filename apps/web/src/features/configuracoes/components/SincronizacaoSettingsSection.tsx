import { cn } from "@sagra/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  approveSyncPendingDelete,
  controlSyncService,
  fetchSyncAdminStatus,
  fetchSyncPendingDeletes,
  rejectSyncPendingDelete,
  saveSyncPolicy,
  type SyncDeletePolicy,
  type SyncMode,
  type SyncPolicyRow,
  type SyncTableName,
} from "@/api/adminSync";

import {
  ConfigErrorState,
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
  ConfigSubsection,
} from "./ConfigSectionLayout";

const STATUS_QUERY = ["admin", "sync", "status"] as const;
const PENDING_QUERY = ["admin", "sync", "pending-deletes"] as const;

const TABLE_LABELS: Record<SyncTableName, string> = {
  tabProtocolos: "tabProtocolos (OS)",
  tabDetalhesServico: "tabDetalhesServico",
  tabAndamento: "tabAndamento",
};

function statusBadgeClass(healthy: boolean, status: string | null): string {
  if (healthy) return "bg-emerald-100 text-emerald-800";
  if (status === "Stopped") return "bg-slate-200 text-slate-700";
  return "bg-red-100 text-red-800";
}

export function SincronizacaoSettingsSection() {
  const qc = useQueryClient();
  const statusQuery = useQuery({
    queryKey: [...STATUS_QUERY],
    queryFn: fetchSyncAdminStatus,
    refetchInterval: 10000,
  });
  const pendingQuery = useQuery({
    queryKey: [...PENDING_QUERY],
    queryFn: () => fetchSyncPendingDeletes(),
    refetchInterval: 10000,
  });

  const [draft, setDraft] = useState<SyncPolicyRow[]>([]);

  useEffect(() => {
    if (!statusQuery.data?.policies) return;
    setDraft(statusQuery.data.policies.map((p) => ({ ...p })));
  }, [statusQuery.data?.policies]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveSyncPolicy(
        draft.map((p) => ({
          table_name: p.table_name,
          enabled: p.enabled,
          mode: p.mode,
          delete_policy: p.delete_policy,
        })),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...STATUS_QUERY] });
      window.alert("Política de sincronização salva. O serviço aplica no próximo ciclo.");
    },
    onError: (err: Error) => {
      window.alert(`Falha ao salvar: ${err.message}`);
    },
  });

  const serviceMutation = useMutation({
    mutationFn: ({
      name,
      action,
    }: {
      name: string;
      action: "start" | "stop" | "restart";
    }) => controlSyncService(name, action),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: [...STATUS_QUERY] });
      window.alert(`Comando ${vars.action} enviado para ${vars.name}.`);
    },
    onError: (err: Error) => {
      window.alert(`Falha no controle do serviço: ${err.message}`);
    },
  });

  const decideMutation = useMutation({
    mutationFn: ({
      nro,
      ano,
      approve,
    }: {
      nro: number;
      ano: number;
      approve: boolean;
    }) =>
      approve
        ? approveSyncPendingDelete(nro, ano)
        : rejectSyncPendingDelete(nro, ano),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...PENDING_QUERY] });
      void qc.invalidateQueries({ queryKey: [...STATUS_QUERY] });
    },
    onError: (err: Error) => {
      window.alert(`Falha: ${err.message}`);
    },
  });

  const syncSvc = statusQuery.data?.services.sync_andamentos;
  const monitorSvc = statusQuery.data?.services.monitor_sync;
  const hb = syncSvc?.heartbeat;
  const counts = statusQuery.data?.pending_counts;

  const updateDraft = (
    table: SyncTableName,
    patch: Partial<Pick<SyncPolicyRow, "enabled" | "mode" | "delete_policy">>,
  ) => {
    setDraft((prev) =>
      prev.map((row) => (row.table_name === table ? { ...row, ...patch } : row)),
    );
  };

  const dirty = useMemo(() => {
    const server = statusQuery.data?.policies ?? [];
    if (server.length !== draft.length) return false;
    return draft.some((d, i) => {
      const s = server[i];
      if (!s || s.table_name !== d.table_name) return true;
      return (
        s.enabled !== d.enabled ||
        s.mode !== d.mode ||
        s.delete_policy !== d.delete_policy
      );
    });
  }, [draft, statusQuery.data?.policies]);

  const confirmService = (
    name: string,
    action: "start" | "stop" | "restart",
  ) => {
    const labels = { start: "iniciar", stop: "parar", restart: "reiniciar" };
    if (
      !window.confirm(
        `Confirma ${labels[action]} o serviço ${name}?`,
      )
    ) {
      return;
    }
    serviceMutation.mutate({ name, action });
  };

  return (
    <div className="flex flex-col gap-4">
      <ConfigSection>
        <ConfigSectionHeader
          title="Serviços de sincronização"
          description="Status do Windows Service (NSSM), heartbeat e divergência MDB↔MySQL."
          icon={<RefreshCw className="size-4" aria-hidden />}
          actions={
            <button
              type="button"
              onClick={() => void statusQuery.refetch()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="size-3.5" />
              Atualizar
            </button>
          }
        />
        <ConfigSectionBody>
          {statusQuery.isPending ? (
            <ConfigLoadingState>
              <Loader2 className="size-4 animate-spin" />
              Carregando status…
            </ConfigLoadingState>
          ) : statusQuery.isError ? (
            <ConfigErrorState>
              Não foi possível carregar o status do sync.
            </ConfigErrorState>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <ServiceCard
                title="SAGRA-SyncAndamentos"
                service={syncSvc}
                heartbeat={hb}
                busy={serviceMutation.isPending}
                onStart={() =>
                  confirmService("SAGRA-SyncAndamentos", "start")
                }
                onStop={() => confirmService("SAGRA-SyncAndamentos", "stop")}
                onRestart={() =>
                  confirmService("SAGRA-SyncAndamentos", "restart")
                }
              />
              <ServiceCard
                title="SAGRA-MonitorSyncAndamentos"
                service={monitorSvc}
                busy={serviceMutation.isPending}
                onStart={() =>
                  confirmService("SAGRA-MonitorSyncAndamentos", "start")
                }
                onStop={() =>
                  confirmService("SAGRA-MonitorSyncAndamentos", "stop")
                }
                onRestart={() =>
                  confirmService("SAGRA-MonitorSyncAndamentos", "restart")
                }
              />
            </div>
          )}
          {counts ? (
            <p className="mt-3 text-xs text-slate-600">
              Fila de exclusões OS: pendentes {counts.pending ?? 0}, quarentena{" "}
              {counts.blocked ?? 0}, aprovadas {counts.approved ?? 0}.
            </p>
          ) : null}
        </ConfigSectionBody>
      </ConfigSection>

      <ConfigSection>
        <ConfigSectionHeader
          title="Política por tabela"
          description="Unidirecional = MDB→MySQL. Bidirecional = MySQL↔MDB (andamentos). Exclusão de OS inicia em dryrun."
          icon={<Save className="size-4" aria-hidden />}
          actions={
            <button
              type="button"
              disabled={saveMutation.isPending || !dirty}
              onClick={() => void saveMutation.mutate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-green px-3 text-xs font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
            >
              {saveMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Salvar política
            </button>
          }
        />
        <ConfigSectionBody>
          {draft.length === 0 ? (
            <ConfigLoadingState>
              <Loader2 className="size-4 animate-spin" />
              Carregando políticas…
            </ConfigLoadingState>
          ) : (
            <ul className="flex flex-col gap-3">
              {draft.map((row) => (
                <li key={row.table_name}>
                  <ConfigSubsection tone="muted">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {TABLE_LABELS[row.table_name]}
                        </p>
                        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-slate-300"
                            checked={row.enabled}
                            onChange={(e) =>
                              updateDraft(row.table_name, {
                                enabled: e.target.checked,
                              })
                            }
                          />
                          Sincronização habilitada
                        </label>
                      </div>
                      <div className="flex flex-col gap-2 text-xs">
                        <fieldset className="flex flex-wrap gap-3">
                          <legend className="sr-only">Modo</legend>
                          {(["uni", "bi"] as SyncMode[]).map((m) => (
                            <label
                              key={m}
                              className="flex cursor-pointer items-center gap-1.5"
                            >
                              <input
                                type="radio"
                                name={`mode-${row.table_name}`}
                                className="size-3.5"
                                checked={row.mode === m}
                                onChange={() =>
                                  updateDraft(row.table_name, { mode: m })
                                }
                              />
                              {m === "uni"
                                ? "Unidirecional (MDB→MySQL)"
                                : "Bidirecional"}
                            </label>
                          ))}
                        </fieldset>
                        <label className="flex items-center gap-2">
                          Exclusão
                          <select
                            className="rounded border border-slate-300 px-2 py-1"
                            value={row.delete_policy}
                            onChange={(e) =>
                              updateDraft(row.table_name, {
                                delete_policy: e.target
                                  .value as SyncDeletePolicy,
                              })
                            }
                          >
                            <option value="off">Desligada</option>
                            <option value="dryrun">Somente detectar</option>
                            <option value="on">Ativa</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  </ConfigSubsection>
                </li>
              ))}
            </ul>
          )}
        </ConfigSectionBody>
      </ConfigSection>

      <ConfigSection>
        <ConfigSectionHeader
          title="Exclusões de OS pendentes"
          description="OS ausente no Access após travas de segurança. Aprovar executa no próximo ciclo do serviço (com reverificação)."
          icon={<XCircle className="size-4" aria-hidden />}
        />
        <ConfigSectionBody>
          {pendingQuery.isPending ? (
            <ConfigLoadingState>
              <Loader2 className="size-4 animate-spin" />
              Carregando fila…
            </ConfigLoadingState>
          ) : (pendingQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-xs text-slate-600">Nenhuma exclusão pendente.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-semibold">OS</th>
                    <th className="px-2 py-2 font-semibold">Título</th>
                    <th className="px-2 py-2 font-semibold">Andamentos</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Motivo</th>
                    <th className="px-2 py-2 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingQuery.data?.items.map((item) => (
                    <tr
                      key={`${item.nro}-${item.ano}`}
                      className="border-b border-slate-100"
                    >
                      <td className="px-2 py-2 font-mono">
                        {item.nro}/{item.ano}
                      </td>
                      <td className="px-2 py-2">{item.titulo || "—"}</td>
                      <td className="px-2 py-2">{item.andamentos_count ?? 0}</td>
                      <td className="px-2 py-2">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            item.status === "blocked"
                              ? "bg-amber-100 text-amber-800"
                              : item.status === "approved"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-slate-100 text-slate-700",
                          )}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate px-2 py-2 text-slate-600">
                        {item.motivo || "—"}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={decideMutation.isPending}
                            className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-800"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Aprovar exclusão da OS ${item.nro}/${item.ano} no MySQL?`,
                                )
                              ) {
                                decideMutation.mutate({
                                  nro: item.nro,
                                  ano: item.ano,
                                  approve: true,
                                });
                              }
                            }}
                          >
                            <CheckCircle2 className="size-3" />
                            Aprovar
                          </button>
                          <button
                            type="button"
                            disabled={decideMutation.isPending}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700"
                            onClick={() =>
                              decideMutation.mutate({
                                nro: item.nro,
                                ano: item.ano,
                                approve: false,
                              })
                            }
                          >
                            Rejeitar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ConfigSectionBody>
      </ConfigSection>
    </div>
  );
}

function ServiceCard({
  title,
  service,
  heartbeat,
  busy,
  onStart,
  onStop,
  onRestart,
}: {
  title: string;
  service?: {
    exists: boolean;
    status: string | null;
    healthy: boolean;
    data_stale?: boolean;
    mdb_count?: number | null;
    mysql_count?: number | null;
  };
  heartbeat?: {
    present: boolean;
    phase: string | null;
    age_sec: number | null;
    cycles: number | null;
    consecutive_errors: number | null;
    last_error: string | null;
    stale: boolean;
  } | null;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const status = service?.status ?? "—";
  const healthy = Boolean(service?.healthy);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <span
            className={cn(
              "mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold",
              statusBadgeClass(healthy, service?.status ?? null),
            )}
          >
            {service?.exists ? status : "Não instalado"}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={onStart}
            className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[10px] font-semibold disabled:opacity-50"
          >
            <Play className="size-3" />
            Iniciar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onStop}
            className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[10px] font-semibold disabled:opacity-50"
          >
            <Square className="size-3" />
            Parar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onRestart}
            className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[10px] font-semibold disabled:opacity-50"
          >
            <RotateCcw className="size-3" />
            Reiniciar
          </button>
        </div>
      </div>
      {heartbeat ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-600">
          <div>
            <dt className="inline text-slate-500">Fase: </dt>
            <dd className="inline font-medium text-slate-800">
              {heartbeat.present ? heartbeat.phase ?? "—" : "sem heartbeat"}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Idade: </dt>
            <dd className="inline font-medium text-slate-800">
              {heartbeat.age_sec != null ? `${heartbeat.age_sec}s` : "—"}
              {heartbeat.stale ? " (stale)" : ""}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Ciclos: </dt>
            <dd className="inline font-medium text-slate-800">
              {heartbeat.cycles ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Erros: </dt>
            <dd className="inline font-medium text-slate-800">
              {heartbeat.consecutive_errors ?? 0}
            </dd>
          </div>
        </dl>
      ) : null}
      {service?.mdb_count != null || service?.mysql_count != null ? (
        <p className="mt-2 text-[11px] text-slate-600">
          Contagem andamentos (monitor): MDB {service.mdb_count ?? "—"} / MySQL{" "}
          {service.mysql_count ?? "—"}
          {service.data_stale ? " — divergência" : ""}
        </p>
      ) : null}
    </div>
  );
}
