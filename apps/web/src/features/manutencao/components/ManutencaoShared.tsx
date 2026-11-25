import { cn } from "@sagra/ui";
import { AlertOctagon, Loader2, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import type {
  ManutencaoEvento,
  ManutencaoPrioridade,
  ManutencaoStatus,
} from "@/api/manutencao";

import {
  eventoLabel,
  formatDataHora,
  pessoa,
  PRIORIDADE_META,
  PRIORIDADES,
  STATUS_META,
  tempoRelativo,
} from "../manutencaoUi";

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PrioridadeBadge({ prioridade }: { prioridade: ManutencaoPrioridade }) {
  const meta = PRIORIDADE_META[prioridade] ?? PRIORIDADE_META.normal;
  return (
    <Badge className={meta.badge}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: ManutencaoStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge className={meta.badge}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          meta.dot,
          status === "em_execucao" && "animate-pulse",
        )}
        aria-hidden
      />
      {meta.label}
    </Badge>
  );
}

export function ParadaBadge() {
  return (
    <Badge className="bg-red-600 text-white ring-red-700">
      <AlertOctagon className="h-3 w-3" aria-hidden />
      Máquina parada
    </Badge>
  );
}

export function CodigoMaquina({ codigo, className }: { codigo?: string | null; className?: string }) {
  if (!codigo) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-slate-700",
        className,
      )}
      title="Código da máquina (base para o QR Code)"
    >
      {codigo}
    </span>
  );
}

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)}
    >
      {children}
    </section>
  );
}

export function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "slate",
  onClick,
  active,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "slate" | "amber" | "blue" | "violet" | "emerald" | "red";
  onClick?: () => void;
  active?: boolean;
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    amber: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
    violet: "bg-violet-100 text-violet-700",
    emerald: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
  };
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition",
        active ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200",
        onClick && "hover:border-slate-400 hover:shadow",
      )}
    >
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", tones[tone])}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-none tabular-nums text-slate-900">
          {value}
        </span>
        <span className="mt-1 block truncate text-xs font-medium text-slate-600">{label}</span>
        {hint ? <span className="block truncate text-[11px] text-slate-400">{hint}</span> : null}
      </span>
    </Comp>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description ? <p className="max-w-sm text-xs text-slate-500">{description}</p> : null}
      {action}
    </div>
  );
}

export function LoadingBlock({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-800">
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-50 sm:text-sm";

export function PrioridadeSelector({
  value,
  onChange,
  disabled,
}: {
  value: ManutencaoPrioridade;
  onChange: (p: ManutencaoPrioridade) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Prioridade">
      {PRIORIDADES.map((p) => {
        const meta = PRIORIDADE_META[p];
        const selected = value === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(p)}
            title={meta.hint}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition",
              selected
                ? cn("border-transparent ring-2", meta.ring)
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <span className={cn("h-2 w-2 rounded-full", meta.dot)} aria-hidden />
              {meta.label}
            </span>
            <span className="line-clamp-2 text-[11px] leading-tight opacity-75">{meta.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Pilha de modais abertos: ESC fecha apenas o do topo. */
const modalStack: string[] = [];

/**
 * Modal responsivo: bottom-sheet em telas pequenas, diálogo centralizado no desktop.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalStack.push(titleId);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && modalStack[modalStack.length - 1] === titleId) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      const idx = modalStack.lastIndexOf(titleId);
      if (idx >= 0) modalStack.splice(idx, 1);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, titleId]);

  if (!open) return null;
  const widths = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl" };
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:rounded-2xl",
          widths[size],
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden" aria-hidden />
        <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description ? <div className="mt-0.5 text-sm text-slate-500">{description}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

const EVENTO_DOT: Record<string, string> = {
  criado: "bg-amber-500",
  iniciado: "bg-blue-500",
  retomado: "bg-blue-500",
  pausado: "bg-violet-500",
  concluido: "bg-emerald-500",
  cancelado: "bg-slate-400",
  devolvido: "bg-amber-500",
  comentario: "bg-slate-300",
};

export function Timeline({ eventos }: { eventos: ManutencaoEvento[] }) {
  if (!eventos.length) {
    return <p className="text-sm text-slate-500">Sem eventos registrados.</p>;
  }
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {eventos.map((ev) => (
        <li key={ev.id} className="relative">
          <span
            className={cn(
              "absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full ring-4 ring-white",
              EVENTO_DOT[ev.tipo] ?? "bg-slate-400",
            )}
            aria-hidden
          />
          <p className="text-sm font-semibold text-slate-800">{eventoLabel(ev.tipo)}</p>
          {ev.texto ? (
            <p className="whitespace-pre-line text-sm text-slate-600">{ev.texto}</p>
          ) : null}
          <p className="text-xs text-slate-400" title={formatDataHora(ev.criado_em)}>
            {pessoa(ev.ponto_nome, ev.ponto)} · {tempoRelativo(ev.criado_em)}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function SectionTitle({
  icon: Icon,
  title,
  count,
  action,
  description,
}: {
  icon?: LucideIcon;
  title: string;
  count?: number;
  action?: ReactNode;
  description?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
      {Icon ? <Icon className="h-4 w-4 text-slate-500" aria-hidden /> : null}
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          {title}
          {count != null ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {count}
            </span>
          ) : null}
        </h3>
        {description ? <p className="text-xs text-slate-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
