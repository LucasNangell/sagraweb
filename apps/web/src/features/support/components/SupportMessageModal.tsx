import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ArrowLeft, Loader2, MessageSquare, X } from "lucide-react";

import { useEffect, useState } from "react";



import { queryKeys } from "@/api/query-keys";

import {

  fetchAssignedSupportTicket,

  fetchUserSupportTicket,

  fetchUserSupportTickets,

  replyAssignedSupportMessage,

  replyUserSupportTicket,

  submitSupportMessage,

} from "@/api/support";

import type { SupportMessage, SupportMessageTipo } from "@/api/support";

import { useAuthStore } from "@/features/auth/authStore";

import {

  supportTicketQueryKey,

  useSupportChatRealtime,

} from "@/features/support/hooks/useSupportChatRealtime";

import { useSupportUiStore } from "@/features/support/supportUiStore";

import {

  supportTicketStatusLabel,

  supportTicketStatusTone,

  supportTipoLabel,

} from "@/features/support/utils/supportDisplayUtils";

import { SupportTypingIndicator } from "./SupportTypingIndicator";

import {

  SupportReplyForm,

  SupportThreadView,

  type SupportReplySendState,

} from "./SupportThreadView";

import { cn } from "@sagra/ui";



type ModalView = "menu" | "new" | "list" | "thread";



function formatDate(value: string | null | undefined): string {

  if (!value) {

    return "";

  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");

}



const STATUS_BADGE: Record<ReturnType<typeof supportTicketStatusTone>, string> = {

  open: "bg-amber-100 text-amber-800",

  waiting: "bg-sky-100 text-sky-800",

  answered: "bg-emerald-100 text-emerald-800",

  resolved: "bg-slate-200 text-slate-700",

};



export function SupportMessageModal() {

  const open = useSupportUiStore((s) => s.modalOpen);

  const initialTicketId = useSupportUiStore((s) => s.initialTicketId);

  const modalKind = useSupportUiStore((s) => s.modalKind);

  const closeModal = useSupportUiStore((s) => s.closeModal);

  const isAssigned = modalKind === "assigned";

  const user = useAuthStore((s) => s.user);

  const ponto = user?.ponto != null ? String(user.ponto) : null;

  const qc = useQueryClient();



  const [view, setView] = useState<ModalView>("menu");

  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);

  const [tipo, setTipo] = useState<SupportMessageTipo>("problema");

  const [assunto, setAssunto] = useState("");

  const [mensagem, setMensagem] = useState("");

  const [replyText, setReplyText] = useState("");

  const [feedback, setFeedback] = useState<string | null>(null);

  const [scrollToEndSignal, setScrollToEndSignal] = useState(0);

  const [replySendState, setReplySendState] = useState<SupportReplySendState>("idle");



  const threadViewActive = open && view === "thread" && selectedTicketId != null;

  const chatRole = isAssigned ? "assigned" : "usuario";

  const ticketQueryKey = supportTicketQueryKey(chatRole, selectedTicketId ?? 0);



  const { remoteTyping, handleInputActivity, stopTyping, wsStatus } = useSupportChatRealtime({

    ticketId: threadViewActive ? selectedTicketId : null,

    ponto,

    role: chatRole,

    authorLabel: user?.nome ?? ponto ?? "Usuário",

    enabled: threadViewActive,

    ticketQueryKey,

  });



  const openTicketsQuery = useQuery({

    queryKey: queryKeys.support.userTickets("aberto"),

    queryFn: () => fetchUserSupportTickets("aberto"),

    enabled: open && (view === "list" || view === "thread"),

    refetchInterval: open && view === "list" ? 30_000 : false,

  });



  const ticketQuery = useQuery({

    queryKey: isAssigned

      ? queryKeys.support.assignedTicket(selectedTicketId ?? 0)

      : queryKeys.support.userTicket(selectedTicketId ?? 0),

    queryFn: () =>

      isAssigned

        ? fetchAssignedSupportTicket(selectedTicketId!)

        : fetchUserSupportTicket(selectedTicketId!),

    enabled: threadViewActive,

    refetchInterval: (query) => {

      if (!threadViewActive) {

        return false;

      }

      const data = query.state.data as SupportMessage | undefined;

      if (data?.Status === "resolvido") {

        return false;

      }

      return wsStatus === "connected" ? 30_000 : 15_000;

    },

  });



  const setViewingTicket = useSupportUiStore((s) => s.setViewingTicket);



  useEffect(() => {

    if (!open) {

      setView("menu");

      setSelectedTicketId(null);

      setTipo("problema");

      setAssunto("");

      setMensagem("");

      setReplyText("");

      setFeedback(null);

      setReplySendState("idle");

      setViewingTicket("usuario", null);

      setViewingTicket("assigned", null);

      return;

    }

    if (initialTicketId) {

      setSelectedTicketId(initialTicketId);

      setView("thread");

    }

  }, [open, initialTicketId, setViewingTicket]);



  useEffect(() => {

    if (!open || view !== "thread" || selectedTicketId == null) {

      setViewingTicket("usuario", null);

      setViewingTicket("assigned", null);

      return;

    }

    if (isAssigned) {

      setViewingTicket("assigned", selectedTicketId);

      setViewingTicket("usuario", null);

      return;

    }

    setViewingTicket("usuario", selectedTicketId);

    setViewingTicket("assigned", null);

  }, [open, view, selectedTicketId, isAssigned, setViewingTicket]);



  const createMutation = useMutation({

    mutationFn: submitSupportMessage,

    onSuccess: async (created) => {

      setFeedback(null);

      setAssunto("");

      setMensagem("");

      setTipo("problema");

      qc.setQueryData(queryKeys.support.userTicket(created.Id), created);

      await qc.invalidateQueries({ queryKey: ["support", "userTickets"] });

      setSelectedTicketId(created.Id);

      setView("thread");

    },

    onError: (err: Error) => {

      setFeedback(err.message || "Não foi possível enviar a mensagem.");

    },

  });



  const replyMutation = useMutation({

    mutationFn: ({ id, text }: { id: number; text: string }) =>

      isAssigned

        ? replyAssignedSupportMessage(id, text)

        : replyUserSupportTicket(id, text),

    onMutate: () => {

      setReplySendState("sending");

      setFeedback(null);

    },

    onSuccess: async (updated) => {

      setReplyText("");

      setFeedback(null);

      setReplySendState("sent");

      setScrollToEndSignal((n) => n + 1);

      window.setTimeout(() => setReplySendState("idle"), 2500);

      if (isAssigned) {

        qc.setQueryData(queryKeys.support.assignedTicket(updated.Id), updated);

        await qc.invalidateQueries({ queryKey: ["support", "assignedTickets"] });

      } else {

        qc.setQueryData(queryKeys.support.userTicket(updated.Id), updated);

        await qc.invalidateQueries({ queryKey: ["support", "userTickets"] });

      }

    },

    onError: (err: Error) => {

      setReplySendState("error");

      setFeedback(err.message || "Não foi possível enviar a mensagem.");

    },

  });



  const selectedTicket = ticketQuery.data;



  if (!open) {

    return null;

  }



  const handleCreate = (e: React.FormEvent) => {

    e.preventDefault();

    setFeedback(null);

    createMutation.mutate({ tipo, assunto: assunto.trim(), mensagem: mensagem.trim() });

  };



  const handleReply = () => {

    if (!selectedTicketId || !replyText.trim()) {

      return;

    }

    stopTyping();

    replyMutation.mutate({ id: selectedTicketId, text: replyText.trim() });

  };



  const threadHeaderTitle = isAssigned ? "Dúvida do cliente" : "Suporte";

  const statusTone = selectedTicket ? supportTicketStatusTone(selectedTicket) : "open";



  return (

    <div

      className="fixed inset-0 z-[10003] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"

      role="dialog"

      aria-modal="true"

      aria-labelledby="support-modal-title"

    >

      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-xl bg-white shadow-xl sm:max-h-[90vh] sm:rounded-lg">

        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">

          <div className="min-w-0 flex-1">

            <div className="flex items-center gap-2">

              {view !== "menu" && !isAssigned ? (

                <button

                  type="button"

                  onClick={() => {

                    if (view === "thread") {

                      setView("list");

                      setSelectedTicketId(null);

                    } else {

                      setView("menu");

                    }

                    setFeedback(null);

                  }}

                  className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100"

                  aria-label="Voltar"

                >

                  <ArrowLeft className="size-5" />

                </button>

              ) : null}

              <h2

                id="support-modal-title"

                className="flex min-w-0 items-center gap-2 text-base font-semibold text-slate-800"

              >

                <MessageSquare className="size-5 shrink-0 text-secondary-blue" aria-hidden />

                <span className="truncate">

                  {view === "new"

                    ? "Nova mensagem"

                    : view === "list"

                      ? "Minhas conversas"

                      : view === "thread"

                        ? threadHeaderTitle

                        : "Mensagem ao suporte"}

                </span>

              </h2>

            </div>

            {view === "thread" && selectedTicket ? (

              <div className="mt-1.5 space-y-0.5 pl-0 sm:pl-7">

                <p className="truncate text-sm text-slate-600">{selectedTicket.Assunto}</p>

                <div className="flex flex-wrap items-center gap-2 text-xs">

                  <span

                    className={cn(

                      "rounded-full px-2 py-0.5 font-medium",

                      STATUS_BADGE[statusTone],

                    )}

                  >

                    {supportTicketStatusLabel(selectedTicket)}

                  </span>

                  <span className="text-slate-500">{supportTipoLabel(selectedTicket.Tipo)}</span>

                  {isAssigned && selectedTicket.OsNro ? (

                    <span className="text-slate-500">

                      OS {selectedTicket.OsNro}/{selectedTicket.OsAno}

                    </span>

                  ) : null}

                </div>

              </div>

            ) : null}

          </div>

          <button

            type="button"

            onClick={closeModal}

            className="ml-2 shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100"

            aria-label="Fechar"

          >

            <X className="size-5" />

          </button>

        </div>



        <div className="min-h-0 flex-1 overflow-y-auto p-4">

          {view === "menu" && !isAssigned ? (

            <div className="space-y-2">

              <button

                type="button"

                onClick={() => {

                  setView("new");

                  setFeedback(null);

                }}

                className="w-full rounded-md border border-slate-200 px-4 py-3 text-left text-sm hover:bg-slate-50"

              >

                <span className="font-medium text-slate-800">Nova mensagem</span>

                <span className="mt-0.5 block text-xs text-slate-500">

                  Reportar um problema ou enviar sugestão

                </span>

              </button>

              <button

                type="button"

                onClick={() => {

                  setView("list");

                  setFeedback(null);

                }}

                className="w-full rounded-md border border-slate-200 px-4 py-3 text-left text-sm hover:bg-slate-50"

              >

                <span className="font-medium text-slate-800">Minhas conversas</span>

                <span className="mt-0.5 block text-xs text-slate-500">

                  Continuar conversas em aberto com o suporte

                </span>

              </button>

            </div>

          ) : null}



          {view === "new" ? (

            <form onSubmit={handleCreate} className="space-y-4">

              <div>

                <label className="mb-1 block text-sm font-medium text-slate-700">Tipo</label>

                <select

                  value={tipo}

                  onChange={(e) => setTipo(e.target.value as SupportMessageTipo)}

                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"

                >

                  <option value="problema">Problema</option>

                  <option value="sugestao">Sugestão</option>

                </select>

              </div>

              <div>

                <label className="mb-1 block text-sm font-medium text-slate-700">Assunto</label>

                <input

                  type="text"

                  value={assunto}

                  onChange={(e) => setAssunto(e.target.value)}

                  required

                  minLength={3}

                  maxLength={255}

                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"

                />

              </div>

              <div>

                <label className="mb-1 block text-sm font-medium text-slate-700">

                  Descrição

                </label>

                <textarea

                  value={mensagem}

                  onChange={(e) => setMensagem(e.target.value)}

                  required

                  minLength={10}

                  rows={6}

                  className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm"

                />

              </div>

              {feedback ? (

                <p

                  className={cn(

                    "text-sm",

                    createMutation.isSuccess ? "text-emerald-700" : "text-red-600",

                  )}

                >

                  {feedback}

                </p>

              ) : null}

              <button

                type="submit"

                disabled={createMutation.isPending}

                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"

              >

                {createMutation.isPending ? (

                  <Loader2 className="size-4 animate-spin" aria-hidden />

                ) : null}

                Enviar

              </button>

            </form>

          ) : null}



          {view === "list" ? (

            openTicketsQuery.isLoading ? (

              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">

                <Loader2 className="size-4 animate-spin" />

                Carregando…

              </div>

            ) : (openTicketsQuery.data ?? []).length === 0 ? (

              <p className="py-6 text-center text-sm text-slate-500">

                Nenhuma conversa em aberto. Envie uma nova mensagem ao suporte.

              </p>

            ) : (

              <ul className="space-y-2">

                {(openTicketsQuery.data ?? []).map((item) => (

                  <li key={item.Id}>

                    <button

                      type="button"

                      onClick={() => {

                        setSelectedTicketId(item.Id);

                        setView("thread");

                        setFeedback(null);

                        setReplySendState("idle");

                      }}

                      className="w-full rounded-md border border-slate-200 px-3 py-3 text-left text-sm hover:bg-slate-50"

                    >

                      <span className="font-medium text-slate-800">{item.Assunto}</span>

                      <span className="mt-1 block text-xs text-slate-500">

                        {supportTipoLabel(item.Tipo)} · {formatDate(item.DataCriacao)}

                      </span>

                    </button>

                  </li>

                ))}

              </ul>

            )

          ) : null}



          {view === "thread" ? (

            ticketQuery.isLoading ? (

              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">

                <Loader2 className="size-4 animate-spin" />

                Carregando conversa…

              </div>

            ) : selectedTicket ? (

              <div className="flex min-h-[20rem] flex-col gap-3">

                <SupportThreadView

                  ticket={selectedTicket}

                  scrollable

                  className="min-h-0 flex-1"

                  scrollToEndSignal={scrollToEndSignal}

                />

                <SupportTypingIndicator typing={remoteTyping} className="shrink-0 px-1" />

                {selectedTicket.Status === "aberto" ? (

                  <SupportReplyForm

                    value={replyText}

                    onChange={setReplyText}

                    onInputActivity={handleInputActivity}

                    onSubmit={handleReply}

                    pending={replyMutation.isPending}

                    sendState={replySendState}

                    feedback={replyMutation.isError ? feedback : null}

                    onRetry={handleReply}

                    label="Continuar conversa"

                    placeholder="Escreva sua resposta ou complemento…"

                    submitLabel="Enviar mensagem"

                  />

                ) : (

                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">

                    Esta conversa foi encerrada pelo suporte.

                  </p>

                )}

              </div>

            ) : (

              <p className="text-sm text-slate-500">Conversa não encontrada.</p>

            )

          ) : null}

        </div>

      </div>

    </div>

  );

}


