import { ChevronDown, Loader2 } from "lucide-react";

import { useCallback, useEffect, useRef, useState } from "react";



import type { SupportMessage, SupportThreadMessage } from "@/api/support";

import { cn } from "@sagra/ui";



const NEAR_BOTTOM_THRESHOLD_PX = 96;

export const SUPPORT_MESSAGE_MAX_LENGTH = 8000;



function formatTime(value: string | null | undefined): string {

  if (!value) {

    return "";

  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())

    ? value

    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

}



function isSameDay(a: Date, b: Date): boolean {

  return (

    a.getFullYear() === b.getFullYear() &&

    a.getMonth() === b.getMonth() &&

    a.getDate() === b.getDate()

  );

}



function formatDateSeparator(value: string | null | undefined): string {

  if (!value) {

    return "";

  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {

    return value;

  }

  const today = new Date();

  const yesterday = new Date();

  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) {

    return "Hoje";

  }

  if (isSameDay(date, yesterday)) {

    return "Ontem";

  }

  return date.toLocaleDateString("pt-BR", {

    weekday: "long",

    day: "numeric",

    month: "long",

    year: "numeric",

  });

}



interface SupportThreadViewProps {

  ticket: SupportMessage;

  className?: string;

  scrollable?: boolean;

  /** Incrementar após envio local para forçar scroll ao final. */

  scrollToEndSignal?: number;

}



export function SupportThreadView({

  ticket,

  className,

  scrollable = false,

  scrollToEndSignal = 0,

}: SupportThreadViewProps) {

  const thread = ticket.Thread ?? [];

  const containerRef = useRef<HTMLDivElement>(null);

  const endRef = useRef<HTMLDivElement>(null);

  const isNearBottomRef = useRef(true);

  const [showNewMessages, setShowNewMessages] = useState(false);

  const prevThreadLenRef = useRef(thread.length);

  const prevLastIdRef = useRef(thread[thread.length - 1]?.Id);



  const scrollToEnd = useCallback((behavior: ScrollBehavior = "smooth") => {

    endRef.current?.scrollIntoView({ behavior, block: "end" });

    setShowNewMessages(false);

    isNearBottomRef.current = true;

  }, []);



  const handleScroll = useCallback(() => {

    const el = containerRef.current;

    if (!el) {

      return;

    }

    const nearBottom =

      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;

    isNearBottomRef.current = nearBottom;

    if (nearBottom) {

      setShowNewMessages(false);

    }

  }, []);



  useEffect(() => {

    scrollToEnd("auto");

    prevThreadLenRef.current = thread.length;

    prevLastIdRef.current = thread[thread.length - 1]?.Id;

  }, [ticket.Id, scrollToEnd]);



  useEffect(() => {

    if (scrollToEndSignal > 0) {

      scrollToEnd("smooth");

    }

  }, [scrollToEndSignal, scrollToEnd]);



  useEffect(() => {

    const lastId = thread[thread.length - 1]?.Id;

    const grew =

      thread.length > prevThreadLenRef.current || lastId !== prevLastIdRef.current;

    prevThreadLenRef.current = thread.length;

    prevLastIdRef.current = lastId;



    if (!grew || thread.length === 0) {

      return;

    }



    if (isNearBottomRef.current) {

      scrollToEnd("smooth");

    } else {

      setShowNewMessages(true);

    }

  }, [thread, scrollToEnd]);



  if (thread.length === 0) {

    return (

      <p className={cn("text-sm text-slate-500", className)}>

        Nenhuma mensagem na conversa.

      </p>

    );

  }



  let lastDateKey = "";



  const content = (

    <div className="relative space-y-2">

      {thread.map((item) => {

        const dateKey = item.DataCriacao

          ? new Date(item.DataCriacao).toDateString()

          : "";

        const showSeparator = dateKey && dateKey !== lastDateKey;

        if (showSeparator) {

          lastDateKey = dateKey;

        }

        return (

          <div key={item.Id}>

            {showSeparator ? (

              <div className="my-3 flex items-center gap-2">

                <div className="h-px flex-1 bg-slate-200" />

                <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">

                  {formatDateSeparator(item.DataCriacao)}

                </span>

                <div className="h-px flex-1 bg-slate-200" />

              </div>

            ) : null}

            <ThreadBubble item={item} />

          </div>

        );

      })}

      <div ref={endRef} className="h-px shrink-0" aria-hidden />

      {showNewMessages ? (

        <div className="sticky bottom-2 flex justify-center pt-1">

          <button

            type="button"

            onClick={() => scrollToEnd("smooth")}

            className="inline-flex items-center gap-1 rounded-full border border-secondary-blue/30 bg-white px-3 py-1.5 text-xs font-medium text-secondary-blue shadow-sm hover:bg-secondary-blue/5"

          >

            <ChevronDown className="size-3.5" aria-hidden />

            Novas mensagens

          </button>

        </div>

      ) : null}

    </div>

  );



  if (scrollable) {

    return (

      <div

        ref={containerRef}

        onScroll={handleScroll}

        className={cn("min-h-0 overflow-y-auto pr-1", className)}

      >

        {content}

      </div>

    );

  }



  return <div className={cn(className)}>{content}</div>;

}



function ThreadBubble({ item }: { item: SupportThreadMessage }) {

  const isAdmin = item.AutorTipo === "admin";

  const isCliente = item.AutorTipo === "cliente";

  const author =

    item.AutorNome ??

    (isAdmin ? "Suporte" : isCliente ? "Cliente" : item.AutorPonto ?? "Usuário");



  return (

    <div className={cn("flex", isAdmin ? "justify-start" : "justify-end")}>

      <div

        className={cn(

          "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[82%]",

          isAdmin

            ? "rounded-bl-md border border-slate-200 bg-slate-50 text-slate-800"

            : "rounded-br-md bg-secondary-blue text-white",

        )}

      >

        <p

          className={cn(

            "mb-1 text-[11px] font-semibold",

            isAdmin ? "text-slate-500" : "text-white/80",

          )}

        >

          {author}

          {item.DataCriacao ? (

            <span className="ml-2 font-normal opacity-80">{formatTime(item.DataCriacao)}</span>

          ) : null}

        </p>

        <p className={cn("whitespace-pre-wrap break-words", isAdmin ? "" : "text-white")}>

          {item.Mensagem}

        </p>

      </div>

    </div>

  );

}



export type SupportReplySendState = "idle" | "sending" | "sent" | "error";



interface SupportReplyFormProps {

  value: string;

  onChange: (value: string) => void;

  onSubmit: () => void;

  onInputActivity?: () => void;

  pending?: boolean;

  sendState?: SupportReplySendState;

  feedback?: string | null;

  label?: string;

  placeholder?: string;

  submitLabel?: string;

  onRetry?: () => void;

  disabled?: boolean;

}



export function SupportReplyForm({

  value,

  onChange,

  onSubmit,

  onInputActivity,

  pending = false,

  sendState = "idle",

  feedback = null,

  label = "Sua mensagem",

  placeholder = "Digite sua mensagem…",

  submitLabel = "Enviar",

  onRetry,

  disabled = false,

}: SupportReplyFormProps) {

  const trimmedLen = value.trim().length;

  const canSubmit = !pending && !disabled && trimmedLen >= 3;



  const handleSubmit = (e: React.FormEvent) => {

    e.preventDefault();

    if (!canSubmit) {

      return;

    }

    onSubmit();

  };



  return (

    <form onSubmit={handleSubmit} className="space-y-2 border-t border-slate-100 pt-3">

      <div>

        <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>

        <textarea

          value={value}

          onChange={(e) => {

            onChange(e.target.value);

            onInputActivity?.();

          }}

          onKeyDown={(e) => {

            if (e.key === "Enter" && !e.shiftKey) {

              e.preventDefault();

              if (canSubmit) {

                onSubmit();

              }

            }

          }}

          required

          minLength={3}

          maxLength={SUPPORT_MESSAGE_MAX_LENGTH}

          rows={3}

          disabled={disabled || pending}

          className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-secondary-blue focus:outline-none focus:ring-1 focus:ring-secondary-blue/30 disabled:bg-slate-50"

          placeholder={placeholder}

        />

        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">

          <span>Enter envia · Shift+Enter nova linha</span>

          <span>

            {value.length}/{SUPPORT_MESSAGE_MAX_LENGTH}

          </span>

        </div>

      </div>



      {sendState === "sent" ? (

        <p className="text-xs text-emerald-600">Mensagem enviada.</p>

      ) : null}



      {feedback ? (

        <div className="flex flex-wrap items-center gap-2">

          <p className="text-sm text-red-600">{feedback}</p>

          {sendState === "error" && onRetry ? (

            <button

              type="button"

              onClick={onRetry}

              className="text-sm font-medium text-secondary-blue hover:underline"

            >

              Tentar novamente

            </button>

          ) : null}

        </div>

      ) : null}



      <button

        type="submit"

        disabled={!canSubmit}

        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-green px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"

      >

        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}

        {pending ? "Enviando…" : submitLabel}

      </button>

    </form>

  );

}


