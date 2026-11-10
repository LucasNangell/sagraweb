import { cn } from "@sagra/ui";
import { AlertTriangle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ConfirmOptions {
  title: string;
  /** Texto do corpo; quebras de linha são preservadas. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Ação destrutiva (botão vermelho). */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

function optionsToPlainText(options: ConfirmOptions): string {
  const body = typeof options.message === "string" ? `\n\n${options.message}` : "";
  return `${options.title}${body}`;
}

/**
 * Confirmação própria (substitui `window.confirm`).
 * Sem `ConfirmProvider` acima na árvore, cai no `window.confirm` nativo — nunca deixa de perguntar.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return useCallback<ConfirmFn>(
    (options) => {
      if (ctx) return ctx(options);
      return Promise.resolve(window.confirm(optionsToPlainText(options)));
    },
    [ctx],
  );
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      // Uma confirmação por vez: a anterior (se houver) é tratada como cancelada.
      pendingRef.current?.resolve(false);
      const next = { options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const close = useCallback((value: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(value);
  }, []);

  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? <ConfirmDialog options={pending.options} onClose={close} /> : null}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  options,
  onClose,
}: {
  options: ConfirmOptions;
  onClose: (value: boolean) => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Foco no "Cancelar": Enter acidental não confirma ação destrutiva.
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={options.message ? bodyId : undefined}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
              options.danger ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700",
            )}
            aria-hidden
          >
            <AlertTriangle className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              {options.title}
            </h2>
            {options.message ? (
              <div id={bodyId} className="mt-1 whitespace-pre-line text-sm text-slate-600">
                {options.message}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onClose(false)}
            className="sagra-btn sagra-btn--outline sagra-btn--md"
          >
            {options.cancelLabel ?? "Cancelar"}
          </button>
          <button
            type="button"
            onClick={() => onClose(true)}
            className={cn(
              "sagra-btn sagra-btn--md",
              options.danger ? "sagra-btn--danger" : "sagra-btn--primary",
            )}
          >
            {options.confirmLabel ?? "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
