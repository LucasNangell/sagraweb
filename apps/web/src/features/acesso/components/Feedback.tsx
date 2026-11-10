import { cn } from "@sagra/ui";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type FeedbackType = "success" | "error";

interface FeedbackMessage {
  id: number;
  type: FeedbackType;
  text: string;
}

export interface FeedbackApi {
  success: (text: string) => void;
  error: (text: string) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

const NOOP: FeedbackApi = { success: () => undefined, error: () => undefined };

export function useFeedback(): FeedbackApi {
  return useContext(FeedbackContext) ?? NOOP;
}

/** Mensagens de sucesso/erro do Controle de Acesso (sucesso some em 4s; erro em 8s). */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<FeedbackMessage | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(
      () => setMessage(null),
      message.type === "error" ? 8000 : 4000,
    );
    return () => window.clearTimeout(timer);
  }, [message]);

  const success = useCallback((text: string) => {
    setMessage({ id: Date.now(), type: "success", text });
  }, []);
  const error = useCallback((text: string) => {
    setMessage({ id: Date.now(), type: "error", text });
  }, []);

  const api = useMemo(() => ({ success, error }), [success, error]);

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {message ? (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex justify-center px-4">
          <div
            role={message.type === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex max-w-xl items-start gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg",
              message.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            {message.type === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1">{message.text}</span>
            <button
              type="button"
              onClick={() => setMessage(null)}
              className="shrink-0 rounded p-0.5 hover:bg-black/5"
              aria-label="Fechar mensagem"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </FeedbackContext.Provider>
  );
}
