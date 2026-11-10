import { cn } from "@sagra/ui";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

interface DrawerProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Rodapé fixo (ações). */
  footer?: ReactNode;
}

/** Painel lateral (~480px; tela cheia abaixo de 640px). Esc fecha. */
export function Drawer({ open, title, subtitle, onClose, children, footer }: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Diálogos de confirmação tratam o próprio Esc (capturing) antes deste.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" aria-hidden onMouseDown={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative flex h-full w-full flex-col bg-white shadow-2xl outline-none sm:max-w-[480px]",
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold text-slate-900">
              {title}
            </h2>
            {subtitle ? <div className="mt-0.5 text-xs text-slate-600">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-slate-600 hover:bg-slate-100"
            aria-label="Fechar painel"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer ? (
          <footer className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** Seção recolhível do drawer (acordeão). */
export function DrawerSection({
  title,
  description,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string;
  description?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group border-b border-slate-200">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          {title}
          {badge}
        </span>
        <span
          className="text-slate-400 transition-transform group-open:rotate-90"
          aria-hidden
        >
          ›
        </span>
      </summary>
      <div className="px-5 pb-4">
        {description ? <p className="mb-3 text-xs text-slate-600">{description}</p> : null}
        {children}
      </div>
    </details>
  );
}
