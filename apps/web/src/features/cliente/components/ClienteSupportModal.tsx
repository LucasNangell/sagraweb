import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fetchClienteOpenSupportTicket,
  fetchClienteSupportTicket,
  replyClienteSupportTicket,
  submitClienteSupportMessage,
} from "@/api/cliente-support";
import { queryKeys } from "@/api/query-keys";
import { useClienteStore } from "@/features/cliente/clienteStore";
import { useClienteSupportUiStore } from "@/features/cliente/clienteSupportUiStore";
import { useClienteSupportChatRealtime } from "@/features/cliente/hooks/useClienteSupportChatRealtime";
import { SupportReplyForm, SupportThreadView } from "@/features/support/components/SupportThreadView";
import { SupportTypingIndicator } from "@/features/support/components/SupportTypingIndicator";

export function ClienteSupportModal() {
  const open = useClienteSupportUiStore((s) => s.modalOpen);
  const ano = useClienteSupportUiStore((s) => s.ano);
  const nrOs = useClienteSupportUiStore((s) => s.nrOs);
  const versao = useClienteSupportUiStore((s) => s.versao);
  const initialTicketId = useClienteSupportUiStore((s) => s.ticketId);
  const closeModal = useClienteSupportUiStore((s) => s.closeModal);
  const user = useClienteStore((s) => s.user);
  const qc = useQueryClient();

  const [ticketId, setTicketId] = useState<number | null>(null);
  const [assunto, setAssunto] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [replyText, setReplyText] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [scrollToEndSignal, setScrollToEndSignal] = useState(0);

  const threadActive = open && ticketId != null;

  const { remoteTyping, handleInputActivity, stopTyping, wsStatus } =
    useClienteSupportChatRealtime({
      ticketId,
      clienteId: user?.id ?? null,
      authorLabel: user?.nome ?? user?.gabinete ?? "Cliente",
      enabled: threadActive,
    });

  const openTicketQuery = useQuery({
    queryKey:
      ano != null && nrOs != null
        ? queryKeys.support.clienteOpenTicket(ano, nrOs)
        : ["support", "clienteOpenTicket", "idle"],
    queryFn: () => fetchClienteOpenSupportTicket(ano!, nrOs!),
    enabled: open && ano != null && nrOs != null && ticketId == null,
  });

  const ticketQuery = useQuery({
    queryKey: queryKeys.support.clienteTicket(ticketId ?? 0),
    queryFn: () => fetchClienteSupportTicket(ticketId!),
    enabled: threadActive,
    refetchInterval: (query) => {
      if (!threadActive) {
        return false;
      }
      const data = query.state.data;
      if (data?.Status === "resolvido") {
        return false;
      }
      return wsStatus === "connected" ? 30_000 : 15_000;
    },
  });

  useEffect(() => {
    if (!open) {
      setTicketId(null);
      setAssunto("");
      setMensagem("");
      setReplyText("");
      setFeedback(null);
      return;
    }
    if (initialTicketId) {
      setTicketId(initialTicketId);
    }
  }, [open, initialTicketId]);

  useEffect(() => {
    if (!open || ticketId != null || openTicketQuery.isLoading) {
      return;
    }
    if (openTicketQuery.data?.Id) {
      setTicketId(openTicketQuery.data.Id);
    }
  }, [open, openTicketQuery.data, openTicketQuery.isLoading, ticketId]);

  const createMutation = useMutation({
    mutationFn: submitClienteSupportMessage,
    onSuccess: (created) => {
      setTicketId(created.Id);
      setMensagem("");
      setAssunto("");
      setFeedback(null);
      qc.setQueryData(queryKeys.support.clienteTicket(created.Id), created);
      if (ano != null && nrOs != null) {
        void qc.invalidateQueries({
          queryKey: queryKeys.support.clienteOpenTicket(ano, nrOs),
        });
      }
    },
    onError: (err: Error) => setFeedback(err.message),
  });

  const replyMutation = useMutation({
    mutationFn: ({ id, text }: { id: number; text: string }) =>
      replyClienteSupportTicket(id, text),
    onSuccess: async (updated) => {
      setReplyText("");
      setFeedback(null);
      setScrollToEndSignal((n) => n + 1);
      qc.setQueryData(queryKeys.support.clienteTicket(updated.Id), updated);
    },
    onError: (err: Error) => setFeedback(err.message),
  });

  const ticket = ticketQuery.data;
  const isOpen = ticket?.Status === "aberto";

  if (!open || ano == null || nrOs == null) {
    return null;
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    createMutation.mutate({
      ano,
      nr_os: nrOs,
      assunto: assunto.trim(),
      mensagem: mensagem.trim(),
      versao,
    });
  };

  const handleReply = () => {
    if (!ticketId) {
      return;
    }
    stopTyping();
    setFeedback(null);
    replyMutation.mutate({ id: ticketId, text: replyText.trim() });
  };

  return (
    <div
      className="fixed inset-0 z-[10006] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cliente-support-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2
            id="cliente-support-title"
            className="flex items-center gap-2 text-base font-semibold text-slate-800"
          >
            <MessageSquare className="size-5 text-secondary-blue" aria-hidden />
            Dúvidas — OS {nrOs}/{ano}
          </h2>
          <button
            type="button"
            onClick={closeModal}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {openTicketQuery.isLoading || (ticketId != null && ticketQuery.isLoading) ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              Carregando conversa…
            </div>
          ) : ticketId == null ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <p className="text-sm text-slate-600">
                Envie sua dúvida ao responsável pelos problemas técnicos desta OS.
              </p>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Assunto</label>
                <input
                  type="text"
                  value={assunto}
                  onChange={(e) => setAssunto(e.target.value)}
                  required
                  minLength={3}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Ex.: Dúvida sobre item da PTV"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Mensagem</label>
                <textarea
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  required
                  minLength={3}
                  rows={5}
                  className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              {feedback ? <p className="text-sm text-red-600">{feedback}</p> : null}
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
          ) : ticket ? (
            <div className="flex min-h-[18rem] flex-col gap-3">
              <p className="shrink-0 text-xs text-slate-500">
                {ticket.Assunto} · {isOpen ? "Em aberto" : "Encerrada"}
              </p>
              <SupportThreadView
                ticket={ticket}
                scrollable
                className="min-h-0 flex-1"
                scrollToEndSignal={scrollToEndSignal}
              />
              <SupportTypingIndicator typing={remoteTyping} className="shrink-0 px-1" />
              {isOpen ? (
                <SupportReplyForm
                  value={replyText}
                  onChange={setReplyText}
                  onInputActivity={handleInputActivity}
                  onSubmit={handleReply}
                  pending={replyMutation.isPending}
                  feedback={replyMutation.isError ? feedback : null}
                  label="Sua mensagem"
                  placeholder="Escreva sua dúvida ou complemento…"
                  submitLabel="Enviar"
                />
              ) : (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Esta conversa foi encerrada pelo suporte.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
