import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Inbox, Loader2, Save, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuthStore } from "@/features/auth/authStore";
import { useSupportUiStore } from "@/features/support/supportUiStore";
import { supportWsLog } from "@/lib/supportWsDebug";

import {
  fetchAdminSupportMessage,
  fetchAdminSupportMessages,
  fetchAdminSupportSettings,
  replyAdminSupportMessage,
  resolveAdminSupportMessage,
  saveAdminSupportSettings,
} from "@/api/support";
import { queryKeys } from "@/api/query-keys";
import type { SupportMessageStatus } from "@/api/support";
import {
  supportTicketQueryKey,
  useSupportChatRealtime,
} from "@/features/support/hooks/useSupportChatRealtime";
import { SupportTypingIndicator } from "./SupportTypingIndicator";
import { SupportReplyForm, SupportThreadView } from "./SupportThreadView";
import { cn } from "@sagra/ui";

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

interface AdminSupportMessagesPageProps {
  initialTicketId?: number;
}

export function AdminSupportMessagesPage({
  initialTicketId,
}: AdminSupportMessagesPageProps) {
  const [statusFilter, setStatusFilter] = useState<SupportMessageStatus | "all">("aberto");
  const [selectedId, setSelectedId] = useState<number | null>(initialTicketId ?? null);
  const [resposta, setResposta] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [usuarioChatEnabled, setUsuarioChatEnabled] = useState(true);
  const [clienteChatEnabled, setClienteChatEnabled] = useState(true);
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const ponto = user?.ponto != null ? String(user.ponto) : null;
  const setViewingTicket = useSupportUiStore((s) => s.setViewingTicket);

  const settingsQuery = useQuery({
    queryKey: queryKeys.support.adminSettings,
    queryFn: fetchAdminSupportSettings,
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }
    setUsuarioChatEnabled(settingsQuery.data.usuario_chat_enabled);
    setClienteChatEnabled(settingsQuery.data.cliente_chat_enabled);
  }, [settingsQuery.data]);

  const saveSettingsMutation = useMutation({
    mutationFn: () =>
      saveAdminSupportSettings({
        usuario_chat_enabled: usuarioChatEnabled,
        cliente_chat_enabled: clienteChatEnabled,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.support.adminSettings });
      await qc.invalidateQueries({ queryKey: queryKeys.support.settings });
      await qc.invalidateQueries({ queryKey: queryKeys.support.clienteSettings });
    },
  });

  const listQuery = useQuery({
    queryKey: queryKeys.support.adminMessages(
      statusFilter === "all" ? undefined : statusFilter,
    ),
    queryFn: () =>
      fetchAdminSupportMessages(statusFilter === "all" ? undefined : statusFilter),
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.support.adminTicket(selectedId ?? 0),
    queryFn: () => fetchAdminSupportMessage(selectedId!),
    enabled: selectedId != null,
  });

  const items = listQuery.data ?? [];
  const selected = detailQuery.data ?? null;

  useEffect(() => {
    if (initialTicketId) {
      setSelectedId(initialTicketId);
      setStatusFilter("aberto");
    }
  }, [initialTicketId]);

  useEffect(() => {
    setViewingTicket("admin", selectedId);
    return () => setViewingTicket("admin", null);
  }, [selectedId, setViewingTicket]);

  useEffect(() => {
    setResposta("");
    setFeedback(null);
  }, [selectedId]);

  const replyMutation = useMutation({
    mutationFn: ({ id, text }: { id: number; text: string }) =>
      replyAdminSupportMessage(id, text),
    onSuccess: async () => {
      setFeedback(null);
      setResposta("");
      await qc.invalidateQueries({ queryKey: ["support", "adminMessages"] });
      if (selectedId) {
        await qc.invalidateQueries({
          queryKey: queryKeys.support.adminTicket(selectedId),
        });
      }
    },
    onError: (err: Error) => {
      setFeedback(err.message || "Não foi possível enviar a resposta.");
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) => resolveAdminSupportMessage(id),
    onSuccess: async () => {
      setFeedback("Conversa marcada como resolvida.");
      await qc.invalidateQueries({ queryKey: ["support", "adminMessages"] });
      if (selectedId) {
        await qc.invalidateQueries({
          queryKey: queryKeys.support.adminTicket(selectedId),
        });
      }
    },
    onError: (err: Error) => {
      setFeedback(err.message || "Não foi possível encerrar a conversa.");
    },
  });

  const { remoteTyping, handleInputActivity, stopTyping } = useSupportChatRealtime({
    ticketId: selectedId,
    ponto,
    role: "admin",
    authorLabel: user?.nome ?? "Suporte",
    enabled: selectedId != null && selected?.Status !== "resolvido",
    ticketQueryKey: supportTicketQueryKey("admin", selectedId ?? 0),
    debugScope: "ADMIN SUPPORT WS",
    onSupportIncoming: (ticketToRefresh) => {
      supportWsLog("ADMIN SUPPORT PAGE", "support_incoming → invalidate", {
        ticket_id: ticketToRefresh,
      });
      void qc.invalidateQueries({ queryKey: ["support", "adminMessages"] });
      const tid = ticketToRefresh ?? selectedId;
      if (tid) {
        void qc.invalidateQueries({ queryKey: queryKeys.support.adminTicket(tid) });
      }
    },
  });

  const handleReply = () => {
    if (!selected || selected.Status !== "aberto") {
      return;
    }
    stopTyping();
    setFeedback(null);
    replyMutation.mutate({ id: selected.Id, text: resposta.trim() });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto p-4">
        <header className="shrink-0 border-b border-slate-200 pb-3">
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <Inbox className="size-5 text-secondary-blue" />
            Mensagens ao suporte
          </h1>
          <p className="mt-0.5 text-xs text-slate-600">
            Converse com os usuários até resolver o problema. Encerre a conversa quando
            concluída.
          </p>
          <section className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Settings2 className="size-4 text-secondary-blue" aria-hidden />
                Disponibilidade dos chats
              </h2>
              <button
                type="button"
                disabled={saveSettingsMutation.isPending || settingsQuery.isPending}
                onClick={() => void saveSettingsMutation.mutate()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-green px-3 text-xs font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
              >
                {saveSettingsMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-3.5" aria-hidden />
                )}
                Salvar
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 rounded border-slate-300"
                  checked={usuarioChatEnabled}
                  onChange={(e) => setUsuarioChatEnabled(e.target.checked)}
                />
                <span className="min-w-0 text-xs">
                  <span className="block font-medium text-slate-800">
                    Chat dos usuários (sidebar)
                  </span>
                  <span className="mt-0.5 block text-slate-600">
                    Exibe &quot;Mensagem ao suporte&quot; no menu Ajuda e permite novas conversas.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 rounded border-slate-300"
                  checked={clienteChatEnabled}
                  onChange={(e) => setClienteChatEnabled(e.target.checked)}
                />
                <span className="min-w-0 text-xs">
                  <span className="block font-medium text-slate-800">
                    Chat dos clientes (Problemas Técnicos)
                  </span>
                  <span className="mt-0.5 block text-slate-600">
                    Exibe botão e chat flutuante no portal do cliente em Problemas Técnicos.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <div className="mt-3 flex flex-wrap gap-2">
            {(["aberto", "resolvido", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setStatusFilter(key);
                  setSelectedId(null);
                }}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs font-medium",
                  statusFilter === key
                    ? "border-secondary-blue bg-secondary-blue/10 text-secondary-blue"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50",
                )}
              >
                {key === "aberto"
                  ? "Em aberto"
                  : key === "resolvido"
                    ? "Resolvidas"
                    : "Todas"}
              </button>
            ))}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section className="min-h-0 rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
              Conversas ({items.length})
            </div>
            {listQuery.isLoading ? (
              <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" />
                Carregando…
              </div>
            ) : items.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">Nenhuma conversa neste filtro.</p>
            ) : (
              <ul className="max-h-[32rem] overflow-y-auto">
                {items.map((item) => (
                  <li key={item.Id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.Id)}
                      className={cn(
                        "w-full border-b border-slate-50 px-3 py-3 text-left text-sm hover:bg-slate-50",
                        selectedId === item.Id ? "bg-secondary-blue/5" : "",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-slate-800">{item.Assunto}</span>
                        <span
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                            item.Status === "aberto"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800",
                          )}
                        >
                          {item.Status === "aberto" ? "aberto" : "resolvido"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.NomeUsuario ?? item.Ponto} · {item.Tipo} ·{" "}
                        {formatDate(item.DataCriacao)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="min-h-0 rounded-lg border border-slate-200 bg-white">
            {selectedId == null ? (
              <p className="p-8 text-center text-sm text-slate-500">
                Selecione uma conversa para visualizar o histórico.
              </p>
            ) : detailQuery.isLoading ? (
              <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" />
                Carregando conversa…
              </div>
            ) : selected ? (
              <div className="flex h-full flex-col">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="text-base font-semibold text-slate-800">{selected.Assunto}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {selected.NomeUsuario ?? selected.Ponto} · {selected.Tipo} ·{" "}
                    {formatDate(selected.DataCriacao)}
                  </p>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                  <SupportThreadView ticket={selected} scrollable className="min-h-0 flex-1" />
                  <SupportTypingIndicator typing={remoteTyping} className="shrink-0 px-1" />
                  {selected.Status === "aberto" ? (
                    <>
                      <SupportReplyForm
                        value={resposta}
                        onChange={setResposta}
                        onInputActivity={handleInputActivity}
                        onSubmit={handleReply}
                        pending={replyMutation.isPending}
                        feedback={replyMutation.isError ? feedback : null}
                        label="Responder ao usuário"
                        placeholder="Digite sua resposta…"
                        submitLabel="Enviar resposta"
                      />
                      <button
                        type="button"
                        onClick={() => resolveMutation.mutate(selected.Id)}
                        disabled={resolveMutation.isPending}
                        className="inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                      >
                        {resolveMutation.isPending ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <CheckCircle2 className="size-4" aria-hidden />
                        )}
                        Marcar como resolvido
                      </button>
                    </>
                  ) : (
                    <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      Resolvida por {selected.ResolvidoPor ?? "—"} em{" "}
                      {formatDate(selected.DataResolucao)}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="p-8 text-center text-sm text-slate-500">Conversa não encontrada.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
