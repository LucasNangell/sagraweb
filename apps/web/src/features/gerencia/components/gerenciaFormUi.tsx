import { cn } from "@sagra/ui";
import type { ReactNode } from "react";

import { homeTestIds } from "@/lib/testId";

export const gerenciaInputClass =
  "mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm outline-none focus:border-secondary-blue focus:ring-2 focus:ring-secondary-blue/15 disabled:cursor-not-allowed disabled:bg-slate-100";

export const gerenciaLabelClass =
  "block text-xs font-semibold text-slate-600";

/** Campos compactos — uso restrito ao painel Informações do Solicitante. */
export const gerenciaInputCompactClass =
  "mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 shadow-sm outline-none focus:border-secondary-blue focus:ring-2 focus:ring-secondary-blue/15 disabled:cursor-not-allowed disabled:bg-slate-100";

export const gerenciaLabelCompactClass =
  "block text-[0.65rem] font-semibold text-slate-600";

export function GerenciaPanel({
  title,
  icon,
  children,
  className,
  bodyClassName,
  scrollableBody = false,
  headerRight,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Corpo com scroll interno (cabeçalho do painel permanece fixo). */
  scrollableBody?: boolean;
  bodyClassName?: string;
  headerRight?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-lg border border-slate-200/90 bg-white shadow-sm",
        scrollableBody && "min-h-0 overflow-hidden",
        className,
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2.5">
        {icon}
        <h3 className="text-sm font-bold text-secondary-blue">{title}</h3>
        {headerRight ? <div className="ml-auto shrink-0">{headerRight}</div> : null}
      </header>
      <div
        className={cn(
          "p-3",
          scrollableBody &&
            "min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function Field({
  label,
  children,
  className,
  compact = false,
  required = false,
  testId,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  required?: boolean;
  testId?: string;
}) {
  return (
    <label
      className={cn("block min-w-0", className)}
      data-testid={testId ?? homeTestIds.gerenciaField(label)}
    >
      <span className={compact ? gerenciaLabelCompactClass : gerenciaLabelClass}>
        {label}
        {required ? (
          <span className="text-red-600" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

export function Row({
  children,
  className,
  compact = false,
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("grid gap-2.5", compact && "gap-1.5", className)}>{children}</div>
  );
}
