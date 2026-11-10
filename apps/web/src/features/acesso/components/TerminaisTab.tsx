import { cn } from "@sagra/ui";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Inbox,
  Loader2,
  Lock,
  Monitor,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ToggleLeft,
  ToggleRight,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  useAccessRequests,
  useAdminIpGroups,
  useAdminIpList,
  useAdminIpsMutations,
} from "@/api/hooks/useAdminIpsQueries";
import type { AccessRequestRecord, IpPermissionRecord } from "@/features/acesso/types";

import { IP_PERMISSION_KEYS } from "../permissionCatalog";
import {
  countActivePermissions,
  filterTerminals,
  findTerminalByIp,
  groupTerminals,
  isTerminalActive,
  terminalGroupName,
} from "../terminalAccess";
import { useConfirm } from "./ConfirmDialog";
import { useFeedback } from "./Feedback";
import { TerminalDrawer } from "./TerminalDrawer";

type StatusFilter = "todos" | "ativos" | "inativos";

interface TerminaisTabProps {
  selectedId?: number;
  onSelect: (id: number | undefined) => void;
}

function formatRequestDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

export function TerminaisTab({ selectedId, onSelect }: TerminaisTabProps) {
  const feedback = useFeedback();
  const confirm = useConfirm();
  const ipsQuery = useAdminIpList();
  const groupsQuery = useAdminIpGroups();
  const requestsQuery = useAccessRequests();
  const { updateIpMutation, deleteRequestMutation } = useAdminIpsMutations();

  const [text, setText] = useState("");
  const [grupo, setGrupo] = useState("");
  const [status, setStatus] = useState<StatusFilter>("todos");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<{ request: AccessRequestRecord | null } | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [discardingId, setDiscardingId] = useState<number | null>(null);

  const ips = useMemo(() => ipsQuery.data ?? [], [ipsQuery.data]);
  const requests = requestsQuery.data ?? [];

  const allGroups = useMemo(() => {
    const set = new Set<string>(groupsQuery.data ?? []);
    for (const ip of ips) set.add(terminalGroupName(ip));
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [groupsQuery.data, ips]);

  const filtered = useMemo(
    () => filterTerminals(ips, { text, grupo, status }),
    [grupo, ips, status, text],
  );
  const grouped = useMemo(() => groupTerminals(filtered), [filtered]);
  const hasFilter = Boolean(text || grupo || status !== "todos");
  const clearFilters = () => {
    setText("");
    setGrupo("");
    setStatus("todos");
  };

  const selected =
    selectedId == null ? null : (ips.find((ip) => ip.id === selectedId) ?? null);

  const toggleGroup = (g: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const handleToggleActive = async (record: IpPermissionRecord) => {
    const active = isTerminalActive(record);
    if (active) {
      const ok = await confirm({
        title: `Desativar o terminal ${record.ip}?`,
        message:
          "Computadores com este IP deixam de ter acesso na rede local (a menos que outro padrão cubra o IP).",
        confirmLabel: "Desativar",
        danger: true,
      });
      if (!ok) return;
    }
    setTogglingId(record.id);
    try {
      await updateIpMutation.mutateAsync({ id: record.id, ativo: !active });
      feedback.success(active ? "Terminal desativado." : "Terminal ativado.");
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao alterar status.");
    } finally {
      setTogglingId(null);
    }
  };

  const handleApprove = (req: AccessRequestRecord) => {
    const existing = findTerminalByIp(ips, req.ip);
    if (existing) {
      feedback.error(
        `O IP ${req.ip} já está cadastrado${existing.descricao ? ` (${existing.descricao})` : ""}. Abra o terminal para ajustar e descarte a solicitação.`,
      );
      onSelect(existing.id);
      return;
    }
    setCreating({ request: req });
  };

  const handleDiscard = async (req: AccessRequestRecord) => {
    const ok = await confirm({
      title: `Descartar a solicitação de ${req.nome}?`,
      message: `IP ${req.ip} · ponto ${req.ponto}. Nenhum terminal é cadastrado.`,
      confirmLabel: "Descartar",
      danger: true,
    });
    if (!ok) return;
    setDiscardingId(req.id);
    try {
      await deleteRequestMutation.mutateAsync(req.id);
      feedback.success("Solicitação descartada.");
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : "Erro ao descartar a solicitação.");
    } finally {
      setDiscardingId(null);
    }
  };

  const listLoading = ipsQuery.isPending && ips.length === 0;
  const listFatalError = ipsQuery.isError && ips.length === 0;
  const listStaleError = ipsQuery.isError && ips.length > 0;

  const selectClass =
    "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-1 pb-4 md:p-2">
      {requests.length > 0 || requestsQuery.isError ? (
        <section className="shrink-0 rounded-xl border border-pink-200 bg-white shadow-sm">
          <header className="flex items-center gap-2 border-b border-pink-100 px-4 py-3 text-sm font-semibold text-pink-700">
            <Lock className="size-4" aria-hidden />
            Solicitações de acesso pendentes
            <span className="rounded-full bg-pink-100 px-2 py-0.5 text-xs">{requests.length}</span>
          </header>
          {requestsQuery.isError && requests.length === 0 ? (
            <p className="px-4 py-3 text-sm text-red-700">
              {requestsQuery.error instanceof Error
                ? requestsQuery.error.message
                : "Erro ao carregar solicitações."}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {requests.map((req) => (
                <li
                  key={req.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-slate-800">{req.nome}</span>
                    <span className="text-slate-500"> · ponto {req.ponto} · {req.secao}</span>
                    <span className="block text-xs text-slate-500">
                      <span className="font-mono">{req.ip}</span> ·{" "}
                      {formatRequestDate(req.data_solicitacao)}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleApprove(req)}
                      className="sagra-btn sagra-btn--primary sagra-btn--sm"
                    >
                      Aprovar e cadastrar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDiscard(req)}
                      disabled={discardingId === req.id}
                      className="sagra-btn sagra-btn--outline sagra-btn--sm"
                      aria-label={`Descartar solicitação de ${req.nome}`}
                    >
                      {discardingId === req.id ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <X className="size-4" aria-hidden />
                      )}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="flex shrink-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-3">
          <label className="relative min-w-[12rem] flex-1">
            <span className="sr-only">Buscar terminal</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="IP, descrição ou grupo…"
              className="h-9 w-full rounded-md border border-slate-300 pl-8 pr-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
            />
          </label>
          <select
            aria-label="Filtrar por grupo"
            value={grupo}
            onChange={(e) => setGrupo(e.target.value)}
            className={selectClass}
          >
            <option value="">Todos os grupos</option>
            {allGroups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className={selectClass}
          >
            <option value="todos">Ativos e inativos</option>
            <option value="ativos">Só ativos</option>
            <option value="inativos">Só inativos</option>
          </select>
          {hasFilter ? (
            <button
              type="button"
              onClick={clearFilters}
              className="h-9 px-2 text-sm font-semibold text-secondary-blue hover:underline"
            >
              Limpar
            </button>
          ) : null}
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => void ipsQuery.refetch()}
              disabled={ipsQuery.isFetching}
              className="sagra-btn sagra-btn--outline sagra-btn--sm"
            >
              <RefreshCw className={cn("size-4", ipsQuery.isFetching && "animate-spin")} aria-hidden />
              Atualizar
            </button>
            <button
              type="button"
              onClick={() => setCreating({ request: null })}
              className="sagra-btn sagra-btn--primary sagra-btn--sm"
            >
              <PlusCircle className="size-4" aria-hidden />
              Novo terminal
            </button>
          </span>
        </div>

        <p className="px-4 pt-2 text-xs text-slate-500">
          {listLoading
            ? "Carregando…"
            : `${filtered.length} de ${ips.length} termina${ips.length !== 1 ? "is" : "l"} · ${IP_PERMISSION_KEYS.length} permissões possíveis por terminal`}
        </p>

        {listStaleError ? (
          <p className="mx-3 mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Não foi possível atualizar a lista; exibindo a última versão carregada.
          </p>
        ) : null}

        {listLoading ? (
          <ul className="space-y-2 p-4" aria-label="Carregando terminais">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="h-10 animate-pulse rounded-md bg-slate-100" />
            ))}
          </ul>
        ) : listFatalError ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <ShieldAlert className="size-10 text-red-600" aria-hidden />
            <p className="text-sm font-semibold text-red-700">
              {ipsQuery.error instanceof Error
                ? ipsQuery.error.message
                : "Erro ao carregar a lista de terminais."}
            </p>
            <button
              type="button"
              onClick={() => void ipsQuery.refetch()}
              className="sagra-btn sagra-btn--primary sagra-btn--md"
            >
              <RefreshCw className="size-4" aria-hidden />
              Tentar novamente
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-slate-500">
            <Inbox className="size-10 opacity-60" aria-hidden />
            <p className="text-sm">
              {ips.length === 0 ? "Nenhum terminal cadastrado." : "Nenhum terminal com esses filtros."}
            </p>
            <button
              type="button"
              onClick={() => (ips.length === 0 ? setCreating({ request: null }) : clearFilters())}
              className="text-sm font-semibold text-secondary-blue hover:underline"
            >
              {ips.length === 0 ? "Cadastrar terminal" : "Limpar filtros"}
            </button>
          </div>
        ) : (
          <div className="pb-2">
            {grouped.map(([g, records]) => {
              const isCollapsed = collapsed.has(g);
              return (
                <div key={g} className="border-b border-slate-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleGroup(g)}
                    aria-expanded={!isCollapsed}
                    className="flex w-full items-center justify-between gap-2 border-l-4 border-primary-green bg-slate-100 px-4 py-2 text-left text-sm font-bold text-slate-700 hover:bg-slate-200/70"
                  >
                    <span className="flex items-center gap-2">
                      <FolderOpen className="size-4 text-primary-green" aria-hidden />
                      {g}
                    </span>
                    <span className="flex items-center gap-2 text-xs font-normal">
                      <span className="rounded-full bg-white px-2 py-0.5 text-slate-500">
                        {records.length}
                      </span>
                      <ChevronDown
                        className={cn("size-4 transition-transform", isCollapsed && "-rotate-90")}
                        aria-hidden
                      />
                    </span>
                  </button>
                  {!isCollapsed ? (
                    <ul className="divide-y divide-slate-100">
                      {records.map((record) => {
                        const active = isTerminalActive(record);
                        return (
                          <li
                            key={record.id}
                            className={cn(
                              "flex items-center gap-3 px-4 py-2 hover:bg-slate-50",
                              selectedId === record.id && "bg-sky-50",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => onSelect(record.id)}
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            >
                              <Monitor
                                className={cn(
                                  "size-4 shrink-0",
                                  active ? "text-primary-green" : "text-slate-300",
                                )}
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1 md:grid md:grid-cols-[minmax(9rem,14rem)_1fr_auto] md:items-center md:gap-4">
                                <span className="block truncate font-mono text-sm font-semibold text-slate-800">
                                  {record.ip}
                                </span>
                                <span className="block truncate text-xs text-slate-600 md:text-sm">
                                  {record.descricao || "Sem descrição"}
                                </span>
                                <span className="mt-0.5 flex flex-wrap gap-1 md:mt-0">
                                  <span
                                    className={cn(
                                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                      active
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-red-100 text-red-800",
                                    )}
                                  >
                                    {active ? "Ativo" : "Inativo"}
                                  </span>
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                    {countActivePermissions(record)}/{IP_PERMISSION_KEYS.length}
                                  </span>
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleActive(record)}
                              disabled={togglingId === record.id}
                              title={active ? "Desativar" : "Ativar"}
                              aria-label={`${active ? "Desativar" : "Ativar"} terminal ${record.ip}`}
                              className="shrink-0 rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                            >
                              {togglingId === record.id ? (
                                <Loader2 className="size-5 animate-spin" aria-hidden />
                              ) : active ? (
                                <ToggleRight className="size-5 text-primary-green" aria-hidden />
                              ) : (
                                <ToggleLeft className="size-5" aria-hidden />
                              )}
                            </button>
                            <ChevronRight
                              className="hidden size-4 shrink-0 text-slate-400 sm:block"
                              aria-hidden
                            />
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selected ? (
        <TerminalDrawer
          key={`edit-${selected.id}`}
          mode="edit"
          record={selected}
          allTerminals={ips}
          groups={allGroups}
          onClose={() => onSelect(undefined)}
        />
      ) : null}
      {creating ? (
        <TerminalDrawer
          key={`create-${creating.request?.id ?? "novo"}`}
          mode="create"
          request={creating.request}
          allTerminals={ips}
          groups={allGroups}
          onClose={() => setCreating(null)}
        />
      ) : null}
    </div>
  );
}
