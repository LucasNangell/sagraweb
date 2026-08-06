import { cn } from "@sagra/ui";
import {
  AlertCircle,
  ArrowDown,
  CheckCircle2,
  Filter,
  Inbox,
  List,
  Loader2,
  PlusCircle,
  Shield,
  Lock,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useAccessRequests,
  useAdminIpGroups,
  useAdminIpList,
  useAdminIpsMutations,
} from "@/api/hooks/useAdminIpsQueries";
import {
  ALL_PERMISSION_COLUMNS,
  buildDefaultNewIpPayload,
  isIpActive,
  readPermissionValue,
} from "@/features/admin-ips/constants";
import {
  AdminIpsPermissionsTable,
  buildUpdatePayloadFromDraft,
} from "./AdminIpsPermissionsTable";
import type {
  AccessRequestRecord,
  AdminIpsMessage,
  IpMetaDraft,
  IpPermissionRecord,
  PendingRequestMeta,
} from "../types";
import type { PermissionKey } from "@/features/auth/types";

function formatRequestDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

export function AdminIpsPage() {
  const [filterGrupo, setFilterGrupo] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [permDrafts, setPermDrafts] = useState<
    Record<number, Partial<Record<PermissionKey, boolean>>>
  >({});
  const [metaDrafts, setMetaDrafts] = useState<Record<number, IpMetaDraft>>(
    {},
  );
  const [message, setMessage] = useState<AdminIpsMessage | null>(null);

  const [newIp, setNewIp] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newGrupo, setNewGrupo] = useState("");
  const [pendingRequest, setPendingRequest] = useState<PendingRequestMeta | null>(
    null,
  );
  const [highlightForm, setHighlightForm] = useState(false);

  const [savingId, setSavingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const ipsQuery = useAdminIpList();
  const groupsQuery = useAdminIpGroups();
  const requestsQuery = useAccessRequests();
  const {
    addIpMutation,
    updateIpMutation,
    deleteIpMutation,
    deleteRequestMutation,
  } = useAdminIpsMutations();

  const ips = ipsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const requests = requestsQuery.data ?? [];

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const showSuccess = useCallback((text: string) => {
    setMessage({ type: "success", text });
  }, []);

  const showError = useCallback((text: string) => {
    setMessage({ type: "error", text });
  }, []);

  const getPermValue = useCallback(
    (ip: IpPermissionRecord, key: PermissionKey): boolean => {
      const draft = permDrafts[ip.id];
      if (draft && draft[key] !== undefined) {
        return draft[key]!;
      }
      return readPermissionValue(ip, key);
    },
    [permDrafts],
  );

  const handlePermChange = useCallback(
    (id: number, key: PermissionKey, value: boolean) => {
      setPermDrafts((prev) => ({
        ...prev,
        [id]: { ...prev[id], [key]: value },
      }));
    },
    [],
  );

  const getMetaValue = useCallback(
    (ip: IpPermissionRecord, field: keyof IpMetaDraft): string => {
      const draft = metaDrafts[ip.id];
      if (draft && draft[field] !== undefined) {
        return draft[field]!;
      }
      if (field === "ip") return ip.ip;
      if (field === "descricao") return ip.descricao ?? "";
      return ip.grupo ?? "";
    },
    [metaDrafts],
  );

  const handleMetaChange = useCallback(
    (id: number, field: keyof IpMetaDraft, value: string) => {
      setMetaDrafts((prev) => ({
        ...prev,
        [id]: { ...prev[id], [field]: value },
      }));
    },
    [],
  );

  const filteredIps = useMemo(() => {
    if (!filterGrupo) return ips;
    return ips.filter((ip) => (ip.grupo || "Sem Grupo") === filterGrupo);
  }, [filterGrupo, ips]);

  const groupedIps = useMemo((): [string, IpPermissionRecord[]][] => {
    const map = new Map<string, IpPermissionRecord[]>();
    for (const ip of filteredIps) {
      const grupo = ip.grupo?.trim() || "Sem Grupo";
      const list = map.get(grupo);
      if (list) {
        list.push(ip);
      } else {
        map.set(grupo, [ip]);
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [filteredIps]);

  const datalistGroups = useMemo(() => {
    const merged = new Set(groups);
    for (const ip of ips) {
      if (ip.grupo?.trim()) merged.add(ip.grupo.trim());
    }
    return [...merged].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [groups, ips]);

  const toggleGroup = useCallback((grupo: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(grupo)) {
        next.delete(grupo);
      } else {
        next.add(grupo);
      }
      return next;
    });
  }, []);

  const handleFillFromRequest = useCallback((req: AccessRequestRecord) => {
    setNewIp(req.ip);
    setNewDesc(req.nome);
    setNewGrupo(req.secao);
    setPendingRequest({
      requestId: req.id,
      ponto: req.ponto,
      nome: req.nome,
    });
    setHighlightForm(true);
    window.setTimeout(() => setHighlightForm(false), 2000);
  }, []);

  const resetAddForm = useCallback(() => {
    setNewIp("");
    setNewDesc("");
    setNewGrupo("");
    setPendingRequest(null);
  }, []);

  const handleAddIp = async () => {
    const ip = newIp.trim();
    const descricao = newDesc.trim();
    const grupo = newGrupo.trim() || "Sem Grupo";

    if (!ip) {
      showError("Por favor, informe um endereço IP.");
      return;
    }

    try {
      await addIpMutation.mutateAsync({
        payload: buildDefaultNewIpPayload(ip, descricao, grupo),
        options: pendingRequest
          ? { ponto: pendingRequest.ponto, nome_usuario: pendingRequest.nome }
          : undefined,
      });

      if (pendingRequest) {
        try {
          await deleteRequestMutation.mutateAsync(pendingRequest.requestId);
        } catch (error) {
          showError(
            error instanceof Error
              ? `IP salvo, mas falha ao remover solicitação: ${error.message}`
              : "IP salvo, mas falha ao remover solicitação.",
          );
          resetAddForm();
          showSuccess("IP adicionado com sucesso!");
          return;
        }
      }

      resetAddForm();
      setPermDrafts({});
      setMetaDrafts({});
      showSuccess("IP adicionado com sucesso!");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Erro ao adicionar IP.");
    }
  };

  const handleSaveIp = async (ip: IpPermissionRecord) => {
    const payload = buildUpdatePayloadFromDraft(
      ip,
      permDrafts[ip.id],
      metaDrafts[ip.id],
    );
    if (!payload.ip?.trim()) {
      showError("Por favor, informe um endereço IP.");
      return;
    }

    setSavingId(ip.id);
    try {
      await updateIpMutation.mutateAsync(payload);
      setPermDrafts((prev) => {
        const next = { ...prev };
        delete next[ip.id];
        return next;
      });
      setMetaDrafts((prev) => {
        const next = { ...prev };
        delete next[ip.id];
        return next;
      });
      showSuccess("IP atualizado!");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Erro ao salvar.");
    } finally {
      setSavingId(null);
    }
  };

  const handleToggleActive = async (ip: IpPermissionRecord) => {
    const active = isIpActive(ip.ativo);
    setTogglingId(ip.id);
    try {
      await updateIpMutation.mutateAsync({ id: ip.id, ativo: !active });
      showSuccess(active ? "IP desativado" : "IP ativado");
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Erro ao alterar status.",
      );
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteIp = async (ip: IpPermissionRecord) => {
    const ok = window.confirm(
      "Tem certeza que deseja excluir este IP?\nEsta ação não pode ser desfeita.",
    );
    if (!ok) return;

    setDeletingId(ip.id);
    try {
      await deleteIpMutation.mutateAsync(ip.id);
      setPermDrafts((prev) => {
        const next = { ...prev };
        delete next[ip.id];
        return next;
      });
      setMetaDrafts((prev) => {
        const next = { ...prev };
        delete next[ip.id];
        return next;
      });
      showSuccess("IP excluído");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Erro ao excluir.");
    } finally {
      setDeletingId(null);
    }
  };

  const listLoading = ipsQuery.isPending && ips.length === 0;
  const listFatalError = ipsQuery.isError && ips.length === 0;
  const listStaleError = ipsQuery.isError && ips.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1800px] flex-col gap-4 overflow-y-auto p-1 md:p-2">
        {message ? (
          <div
            role="status"
            className={cn(
              "rounded-lg border px-4 py-3 text-sm font-medium",
              message.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            <span className="inline-flex items-center gap-2">
              {message.type === "success" ? (
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              ) : (
                <AlertCircle className="size-4 shrink-0" aria-hidden />
              )}
              {message.text}
            </span>
          </div>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="border-b border-slate-200 px-5 py-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-pink-700">
              <Lock className="size-5" aria-hidden />
              Solicitações de Acesso Pendentes
            </h2>
          </header>
          <div className="max-h-[300px] overflow-auto border-l-[5px] border-pink-600">
            {requestsQuery.isPending && requests.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Carregando solicitações...
              </div>
            ) : requestsQuery.isError && requests.length === 0 ? (
              <p className="px-5 py-6 text-sm text-red-700">
                {requestsQuery.error instanceof Error
                  ? requestsQuery.error.message
                  : "Erro ao carregar solicitações."}
              </p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    {["Data", "IP", "Nome", "Ponto", "Seção", "Ação"].map((h) => (
                      <th
                        key={h}
                        className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold uppercase text-slate-600"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requests.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-8 text-center text-slate-500"
                      >
                        Nenhuma solicitação pendente
                      </td>
                    </tr>
                  ) : (
                    requests.map((req) => (
                      <tr key={req.id} className="border-b border-slate-100">
                        <td className="px-3 py-2">
                          {formatRequestDate(req.data_solicitacao)}
                        </td>
                        <td className="px-3 py-2 font-semibold">{req.ip}</td>
                        <td className="px-3 py-2">{req.nome}</td>
                        <td className="px-3 py-2">{req.ponto}</td>
                        <td className="px-3 py-2">{req.secao}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => handleFillFromRequest(req)}
                            className="inline-flex items-center gap-1 rounded bg-primary-green px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary-green/90"
                          >
                            <ArrowDown className="size-3.5" aria-hidden />
                            Cadastrar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section
          className={cn(
            "rounded-xl border bg-white p-5 shadow-sm transition",
            highlightForm
              ? "border-2 border-primary-green"
              : "border-slate-200",
          )}
        >
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-primary-green">
            <PlusCircle className="size-5" aria-hidden />
            Adicionar Novo IP
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.5fr_2fr_1.5fr_auto] md:items-end">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">
                Endereço IP (use % como wildcard)
              </span>
              <input
                type="text"
                value={newIp}
                onChange={(e) => setNewIp(e.target.value)}
                placeholder="Ex: 192.168.0.10 ou 10.120.1.%"
                disabled={addIpMutation.isPending}
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none ring-primary-green/30 focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">
                Descrição
              </span>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Ex: Computador da Recepção"
                disabled={addIpMutation.isPending}
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none ring-primary-green/30 focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">
                Grupo/Sala
              </span>
              <input
                type="text"
                value={newGrupo}
                onChange={(e) => setNewGrupo(e.target.value)}
                placeholder="Ex: Sala de Gerência"
                list="admin-ips-grupos-list"
                disabled={addIpMutation.isPending}
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none ring-primary-green/30 focus:ring-2"
              />
              <datalist id="admin-ips-grupos-list">
                {datalistGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
            <button
              type="button"
              onClick={() => void handleAddIp()}
              disabled={addIpMutation.isPending}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-green px-4 text-sm font-semibold text-white transition hover:bg-primary-green/90 disabled:opacity-60"
            >
              {addIpMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <PlusCircle className="size-4" aria-hidden />
              )}
              Adicionar
            </button>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="flex shrink-0 items-center justify-between bg-primary-green px-5 py-4 text-white">
            <span className="flex items-center gap-2 text-base font-semibold">
              <List className="size-5" aria-hidden />
              IPs Cadastrados e Permissões
            </span>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600">
              {ips.length} IP{ips.length !== 1 ? "s" : ""}
            </span>
          </header>

          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <Filter className="size-4 text-slate-500" aria-hidden />
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              Filtrar por Grupo:
              <select
                value={filterGrupo}
                onChange={(e) => setFilterGrupo(e.target.value)}
                className="min-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-primary-green/30 focus:ring-2"
              >
                <option value="">Todos os Grupos</option>
                {datalistGroups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {listLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
                <Loader2 className="size-8 animate-spin text-primary-green" aria-hidden />
                <p>Carregando...</p>
              </div>
            ) : listFatalError ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                <Shield className="size-10 text-sagra-danger" aria-hidden />
                <p className="text-sm font-semibold text-red-700">
                  {ipsQuery.error instanceof Error
                    ? ipsQuery.error.message
                    : "Erro ao carregar lista de IPs."}
                </p>
              </div>
            ) : filteredIps.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
                <Inbox className="size-10" aria-hidden />
                <p>
                  Nenhum IP cadastrado
                  {filterGrupo ? " neste grupo" : ""}.
                </p>
              </div>
            ) : (
              <>
                {listStaleError ? (
                  <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                    Não foi possível atualizar a lista; exibindo última versão
                    carregada.
                  </p>
                ) : null}
                <AdminIpsPermissionsTable
                  groupedIps={groupedIps}
                  collapsedGroups={collapsedGroups}
                  onToggleGroup={toggleGroup}
                  getPermValue={getPermValue}
                  onPermChange={handlePermChange}
                  getMetaValue={getMetaValue}
                  onMetaChange={handleMetaChange}
                  onSave={(ip) => void handleSaveIp(ip)}
                  onToggleActive={(ip) => void handleToggleActive(ip)}
                  onDelete={(ip) => void handleDeleteIp(ip)}
                  savingId={savingId}
                  togglingId={togglingId}
                  deletingId={deletingId}
                />
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
