import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Inbox, Loader2, MessageSquarePlus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";



import { queryKeys } from "@/api/query-keys";

import {

  fetchUserSupportTicket,

  fetchUserSupportTickets,

  replyUserSupportTicket,

  submitSupportMessage,

} from "@/api/support";

import type { SupportMessage, SupportMessageStatus, SupportMessageTipo } from "@/api/support";

import { useAuthStore } from "@/features/auth/authStore";

import { useUserSupportPageWebSocket } from "@/features/support/hooks/useUserSupportPageWebSocket";

import { useSupportUiStore } from "@/features/support/supportUiStore";

import {

  supportTicketPreview,

  supportTicketStatusLabel,

  supportTicketStatusTone,

  supportTipoLabel,

} from "@/features/support/utils/supportDisplayUtils";

import { SUPPORT_FRONT_FIX_VERSION } from "@/features/support/supportFixVersion";

import { supportWsLog } from "@/lib/supportWsDebug";

import { cn } from "@sagra/ui";



import { SupportTypingIndicator } from "./SupportTypingIndicator";

import {

  SupportReplyForm,

  SupportThreadView,

  type SupportReplySendState,

} from "./SupportThreadView";



function formatDate(value: string | null | undefined): string {

  if (!value) {

    return "—";

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



interface UserSupportMessagesPageProps {

  initialTicketId?: number;

}



export function UserSupportMessagesPage({ initialTicketId }: UserSupportMessagesPageProps) {

  const [statusFilter, setStatusFilter] = useState<SupportMessageStatus | "all">("aberto");

  const [selectedId, setSelectedId] = useState<number | null>(initialTicketId ?? null);

  const [mobileThreadOpen, setMobileThreadOpen] = useState(Boolean(initialTicketId));

  const [showNewForm, setShowNewForm] = useState(false);

  const [tipo, setTipo] = useState<SupportMessageTipo>("problema");

  const [assunto, setAssunto] = useState("");

  const [mensagem, setMensagem] = useState("");

  const [replyText, setReplyText] = useState("");

  const [feedback, setFeedback] = useState<string | null>(null);

  const [scrollToEndSignal, setScrollToEndSignal] = useState(0);

  const [replySendState, setReplySendState] = useState<SupportReplySendState>("idle");



  const qc = useQueryClient();

  const navigate = useNavigate();

  const user = useAuthStore((s) => s.user);

  const ponto = user?.ponto != null ? String(user.ponto) : null;

  const setViewingTicket = useSupportUiStore((s) => s.setViewingTicket);



  const pageMountLoggedRef = useRef(false);



  const listQuery = useQuery({

    queryKey: queryKeys.support.userTickets(statusFilter === "all" ? undefined : statusFilter),

    queryFn: () => fetchUserSupportTickets(statusFilter === "all" ? undefined : statusFilter),

    refetchInterval: 10_000,

  });



  const { remoteTyping, handleInputActivity, stopTyping } = useUserSupportPageWebSocket({

    ponto,

    selectedTicketId: selectedId,

    authorLabel: user?.nome ?? ponto ?? "Usuário",

  });



  useEffect(() => {

    if (!pageMountLoggedRef.current) {

      pageMountLoggedRef.current = true;

      supportWsLog("USER SUPPORT PAGE", "montada", {

        version: SUPPORT_FRONT_FIX_VERSION,

        ponto,

        user: user?.nome,

        selectedTicketId: selectedId,

      });

    }

  }, [ponto, selectedId, user?.nome]);



  useEffect(() => {

    if (selectedId == null) {

      return;

    }

    supportWsLog("USER SUPPORT PAGE", "ticket selecionado", { selectedTicketId: selectedId });

  }, [selectedId]);



  const detailQuery = useQuery({

    queryKey: queryKeys.support.userTicket(selectedId ?? 0),

    queryFn: () => fetchUserSupportTicket(selectedId!),

    enabled: selectedId != null,

    refetchInterval: (query) => {

      if (selectedId == null) {

        return false;

      }

      const data = query.state.data as SupportMessage | undefined;

      if (data?.Status === "resolvido") {

        return false;

      }

      return 10_000;

    },

  });



  const items = listQuery.data ?? [];

  const selected = detailQuery.data ?? null;



  useEffect(() => {

    if (initialTicketId) {

      setSelectedId(initialTicketId);

      setStatusFilter("aberto");

      setMobileThreadOpen(true);

      setShowNewForm(false);

    }

  }, [initialTicketId]);



  useEffect(() => {

    setViewingTicket("usuario", selectedId);

    return () => setViewingTicket("usuario", null);

  }, [selectedId, setViewingTicket]);



  useEffect(() => {

    setReplyText("");

    setFeedback(null);

    setReplySendState("idle");

  }, [selectedId]);



  const createMutation = useMutation({

    mutationFn: submitSupportMessage,

    onSuccess: async (created) => {

      setFeedback(null);

      setAssunto("");

      setMensagem("");

      setTipo("problema");

      setShowNewForm(false);

      qc.setQueryData(queryKeys.support.userTicket(created.Id), created);

      await qc.invalidateQueries({ queryKey: ["support", "userTickets"] });

      setSelectedId(created.Id);
      setMobileThreadOpen(true);
      setStatusFilter("aberto");
      void navigate({ to: "/mensagens", search: { ticket: created.Id }, replace: true });

    },

    onError: (err: Error) => {

      setFeedback(err.message || "Não foi possível enviar a mensagem.");

    },

  });



  const replyMutation = useMutation({

    mutationFn: ({ id, text }: { id: number; text: string }) =>

      replyUserSupportTicket(id, text),

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

      qc.setQueryData(queryKeys.support.userTicket(updated.Id), updated);

      await qc.invalidateQueries({ queryKey: ["support", "userTickets"] });

    },

    onError: (err: Error) => {

      setReplySendState("error");

      setFeedback(err.message || "Não foi possível enviar a mensagem.");

    },

  });



  const selectTicket = (id: number) => {
    setSelectedId(id);
    setViewingTicket("usuario", id);
    setShowNewForm(false);
    setMobileThreadOpen(true);
    void navigate({ to: "/mensagens", search: { ticket: id }, replace: true });
  };



  const openNewForm = () => {

    setShowNewForm(true);

    setSelectedId(null);

    setMobileThreadOpen(true);

    setFeedback(null);

  };



  const backToListMobile = () => {

    setMobileThreadOpen(false);

    setShowNewForm(false);

  };



  const handleCreate = (e: React.FormEvent) => {

    e.preventDefault();

    setFeedback(null);

    createMutation.mutate({ tipo, assunto: assunto.trim(), mensagem: mensagem.trim() });

  };



  const handleReply = () => {

    if (!selected || !replyText.trim()) {

      return;

    }

    stopTyping();

    replyMutation.mutate({ id: selected.Id, text: replyText.trim() });

  };



  const showListPanel = !mobileThreadOpen;

  const showDetailPanel = mobileThreadOpen;



  return (

    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto p-4">

        <header className="shrink-0 border-b border-slate-200 pb-3">

          <div className="flex flex-wrap items-start justify-between gap-3">

            <div>

              <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">

                <Inbox className="size-5 text-secondary-blue" />

                Mensagens ao suporte

              </h1>

              <p className="mt-0.5 text-xs text-slate-600">

                Converse com a equipe de suporte. Suas mensagens ficam vinculadas à sua conta.

              </p>

            </div>

            <button

              type="button"

              onClick={openNewForm}

              className="inline-flex items-center gap-2 rounded-lg bg-primary-green px-3 py-2 text-sm font-semibold text-white hover:bg-primary-green/90"

            >

              <Plus className="size-4" aria-hidden />

              Nova mensagem

            </button>

          </div>



          <div className="mt-3 flex flex-wrap gap-2">

            {(["aberto", "resolvido", "all"] as const).map((key) => (

              <button

                key={key}

                type="button"

                onClick={() => {

                  setStatusFilter(key);

                  if (!initialTicketId) {

                    setSelectedId(null);

                    setMobileThreadOpen(false);

                  }

                  setShowNewForm(false);

                }}

                className={cn(

                  "rounded-md border px-3 py-1.5 text-xs font-medium",

                  statusFilter === key

                    ? "border-secondary-blue bg-secondary-blue/10 text-secondary-blue"

                    : "border-slate-200 text-slate-600 hover:bg-slate-50",

                )}

              >

                {key === "aberto" ? "Em aberto" : key === "resolvido" ? "Resolvidas" : "Todas"}

              </button>

            ))}

          </div>

        </header>



        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">

          <section

            className={cn(

              "min-h-0 rounded-lg border border-slate-200 bg-white",

              showListPanel ? "flex flex-col" : "hidden md:flex md:flex-col",

            )}

          >

            <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">

              Minhas conversas ({items.length})

            </div>

            {listQuery.isLoading ? (

              <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">

                <Loader2 className="size-4 animate-spin" />

                Carregando…

              </div>

            ) : items.length === 0 ? (

              <div className="flex flex-col items-center gap-3 p-8 text-center">

                <MessageSquarePlus className="size-10 text-slate-300" aria-hidden />

                <p className="text-sm text-slate-500">

                  Nenhuma conversa neste filtro. Abra um chamado para falar com o suporte.

                </p>

                <button

                  type="button"

                  onClick={openNewForm}

                  className="rounded-md bg-primary-green px-4 py-2 text-sm font-semibold text-white"

                >

                  Nova mensagem

                </button>

              </div>

            ) : (

              <ul className="max-h-[32rem] overflow-y-auto md:max-h-none md:flex-1">

                {items.map((item) => {

                  const tone = supportTicketStatusTone(item);

                  return (

                    <li key={item.Id}>

                      <button

                        type="button"

                        onClick={() => selectTicket(item.Id)}

                        className={cn(

                          "w-full border-b border-slate-50 px-3 py-3 text-left text-sm hover:bg-slate-50",

                          selectedId === item.Id ? "bg-secondary-blue/5" : "",

                        )}

                      >

                        <div className="flex items-start justify-between gap-2">

                          <span className="font-medium text-slate-800">{item.Assunto}</span>

                          <span

                            className={cn(

                              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",

                              STATUS_BADGE[tone],

                            )}

                          >

                            {item.Status === "resolvido"

                              ? "Resolvido"

                              : supportTicketStatusLabel(item)}

                          </span>

                        </div>

                        <p className="mt-1 line-clamp-2 text-xs text-slate-600">

                          {supportTicketPreview(item)}

                        </p>

                        <p className="mt-1 text-[11px] text-slate-400">

                          {supportTipoLabel(item.Tipo)} · {formatDate(item.DataCriacao)}

                        </p>

                      </button>

                    </li>

                  );

                })}

              </ul>

            )}

          </section>



          <section

            className={cn(

              "min-h-0 rounded-lg border border-slate-200 bg-white",

              showDetailPanel ? "flex flex-col" : "hidden md:flex md:flex-col",

            )}

          >

            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 md:hidden">

              <button

                type="button"

                onClick={backToListMobile}

                className="rounded p-1 text-slate-500 hover:bg-slate-100"

                aria-label="Voltar para lista"

              >

                <ArrowLeft className="size-5" />

              </button>

              <span className="text-sm font-medium text-slate-700">

                {showNewForm ? "Nova mensagem" : "Conversa"}

              </span>

            </div>



            {showNewForm ? (

              <div className="flex flex-1 flex-col p-4">

                <h2 className="mb-4 hidden text-base font-semibold text-slate-800 md:block">

                  Nova mensagem ao suporte

                </h2>

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

                    <label className="mb-1 block text-sm font-medium text-slate-700">

                      Assunto

                    </label>

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

                      Mensagem

                    </label>

                    <textarea

                      value={mensagem}

                      onChange={(e) => setMensagem(e.target.value)}

                      required

                      minLength={10}

                      rows={6}

                      className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm"

                      placeholder="Descreva o problema ou sugestão com detalhes…"

                    />

                  </div>

                  {feedback ? <p className="text-sm text-red-600">{feedback}</p> : null}

                  <button

                    type="submit"

                    disabled={createMutation.isPending}

                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-green px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"

                  >

                    {createMutation.isPending ? (

                      <Loader2 className="size-4 animate-spin" aria-hidden />

                    ) : null}

                    Enviar chamado

                  </button>

                </form>

              </div>

            ) : selectedId == null ? (

              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">

                <Inbox className="size-10 text-slate-300" aria-hidden />

                <p className="text-sm text-slate-500">Selecione uma conversa ou crie uma nova.</p>

              </div>

            ) : detailQuery.isLoading ? (

              <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-slate-500">

                <Loader2 className="size-4 animate-spin" />

                Carregando conversa…

              </div>

            ) : selected ? (

              <div className="flex min-h-0 flex-1 flex-col">

                <div className="border-b border-slate-100 px-4 py-3">

                  <div className="flex flex-wrap items-center gap-2">

                    <h2 className="text-base font-semibold text-slate-800">{selected.Assunto}</h2>

                    <span

                      className={cn(

                        "rounded-full px-2 py-0.5 text-[11px] font-medium",

                        STATUS_BADGE[supportTicketStatusTone(selected)],

                      )}

                    >

                      {supportTicketStatusLabel(selected)}

                    </span>

                  </div>

                  <p className="mt-1 text-xs text-slate-500">

                    {supportTipoLabel(selected.Tipo)} · Aberto em{" "}

                    {formatDate(selected.DataCriacao)}

                  </p>

                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">

                  <SupportThreadView

                    ticket={selected}

                    scrollable

                    className="min-h-0 flex-1"

                    scrollToEndSignal={scrollToEndSignal}

                  />

                  <SupportTypingIndicator typing={remoteTyping} className="shrink-0 px-1" />

                  {selected.Status === "aberto" ? (

                    <SupportReplyForm

                      value={replyText}

                      onChange={setReplyText}

                      onInputActivity={handleInputActivity}

                      onSubmit={handleReply}

                      pending={replyMutation.isPending}

                      sendState={replySendState}

                      feedback={replyMutation.isError ? feedback : null}

                      onRetry={handleReply}

                      label="Sua resposta"

                      placeholder="Escreva sua resposta ou complemento…"

                      submitLabel="Enviar mensagem"

                    />

                  ) : (

                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">

                      Esta conversa foi encerrada pelo suporte

                      {selected.DataResolucao

                        ? ` em ${formatDate(selected.DataResolucao)}`

                        : ""}

                      .

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


