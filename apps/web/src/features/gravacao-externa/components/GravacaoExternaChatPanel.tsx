import { Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  GRAVACAO_EXTERNA_SAFETY_POLL_MS,
  useGravacaoExternaDetail,
  usePostGravacaoExternaMensagemMutation,
} from "@/api/hooks/useGravacaoExterna";
import { useGravacaoExternaChatRealtime } from "@/features/gravacao-externa/hooks/useGravacaoExternaChatRealtime";
import { cn } from "@sagra/ui";

const MESSAGE_MAX = 8000;
const NEAR_BOTTOM_THRESHOLD_PX = 96;

function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

interface GravacaoExternaChatPanelProps {
  ano: number;
  nrOs: number;
  currentPonto: string | null;
  compact?: boolean;
  /** Preenche a altura do container pai (coluna lateral). */
  fill?: boolean;
  /** Quando true, o hook realtime da aba/página já cobre esta conversa. */
  realtimeOwnedExternally?: boolean;
  /** Polling de segurança (ms) enquanto o painel estiver montado. */
  safetyPollMs?: number;
}

export function GravacaoExternaChatPanel({
  ano,
  nrOs,
  currentPonto,
  compact = false,
  fill = false,
  realtimeOwnedExternally = false,
  safetyPollMs = GRAVACAO_EXTERNA_SAFETY_POLL_MS,
}: GravacaoExternaChatPanelProps) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const postMutation = usePostGravacaoExternaMensagemMutation();
  const detailQuery = useGravacaoExternaDetail(ano, nrOs, true, {
    refetchInterval: safetyPollMs,
  });
  const mensagens = detailQuery.data?.mensagens ?? [];

  useGravacaoExternaChatRealtime(ano, nrOs, currentPonto, !realtimeOwnedExternally);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    scrollToBottom("auto");
  }, [mensagens.length, scrollToBottom]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || postMutation.isPending) return;
    try {
      await postMutation.mutateAsync({ ano, nrOs, mensagem: trimmed });
      setText("");
      scrollToBottom();
    } catch {
      window.alert("Não foi possível enviar a mensagem.");
    }
  };

  const cleanCurrent = (currentPonto ?? "").replace(/\D/g, "");

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-white",
        fill
          ? "h-full"
          : cn(
              "rounded-lg border border-neutral-200",
              compact ? "h-[280px]" : "h-[320px]",
            ),
      )}
    >
      <div className="border-b border-neutral-200 px-3 py-2">
        <h3 className="text-sm font-semibold text-neutral-800">Mensagens</h3>
        <p className="text-xs text-neutral-500">
          Comunicação com a CGraf
        </p>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
        onScroll={() => {
          void NEAR_BOTTOM_THRESHOLD_PX;
        }}
      >
        {detailQuery.isLoading && mensagens.length === 0 ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-primary-green" />
          </div>
        ) : mensagens.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">
            Nenhuma mensagem ainda. Inicie a conversa abaixo.
          </p>
        ) : (
          mensagens.map((msg) => {
            const mine =
              cleanCurrent &&
              msg.autor_ponto.replace(/\D/g, "") === cleanCurrent;
            return (
              <div
                key={msg.id}
                className={cn("flex", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm",
                    mine
                      ? "bg-primary-green text-white"
                      : "border border-neutral-200 bg-neutral-50 text-neutral-800",
                  )}
                >
                  <div className="mb-0.5 text-[10px] font-medium opacity-80">
                    {msg.autor_nome || msg.autor_ponto}
                    {msg.autor_papel === "lancador" ? " (lançador)" : " (operador)"}
                    {" · "}
                    {formatTime(msg.criado_em)}
                  </div>
                  <p className="whitespace-pre-wrap break-words">{msg.mensagem}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex gap-2 border-t border-neutral-200 p-2"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MESSAGE_MAX))}
          rows={2}
          placeholder="Digite sua mensagem…"
          className="min-h-[2.5rem] flex-1 resize-none rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-primary-green focus:outline-none focus:ring-1 focus:ring-primary-green"
        />
        <button
          type="submit"
          disabled={!text.trim() || postMutation.isPending}
          className="inline-flex shrink-0 items-center justify-center rounded bg-primary-green px-3 text-white hover:opacity-90 disabled:opacity-50"
          title="Enviar"
        >
          {postMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </form>
    </div>
  );
}
