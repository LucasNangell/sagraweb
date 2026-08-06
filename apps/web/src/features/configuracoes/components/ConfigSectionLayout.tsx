import { cn } from "@sagra/ui";
import type { ReactNode } from "react";

type ConfigSectionProps = {
  children: ReactNode;
  className?: string;
  /** Mantém classes específicas do editor Papelaria/E-mail (altura/colunas). */
  variant?: "default" | "papelaria" | "email";
};

export function ConfigSection({ children, className, variant = "default" }: ConfigSectionProps) {
  return (
    <section
      className={cn(
        "config-section rounded-lg border border-slate-200 bg-white shadow-sm",
        variant !== "email" && "overflow-hidden",
        variant === "papelaria" && "papelaria-admin-section",
        variant === "email" && "email-admin-section",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function ConfigSectionHeader({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "config-section-header flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          {icon ? <span className="shrink-0 text-secondary-blue">{icon}</span> : null}
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="config-section-actions flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function ConfigSectionBody({
  children,
  className,
  noPadding,
}: {
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}) {
  return (
    <div className={cn(!noPadding && "config-section-body p-4", className)}>{children}</div>
  );
}

export function ConfigSubsection({
  title,
  description,
  children,
  className,
  tone = "default",
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "default" | "highlight" | "muted";
}) {
  const toneClass = {
    default: "border-slate-200 bg-white",
    highlight: "border-secondary-blue/25 bg-secondary-blue/[0.04]",
    muted: "border-slate-200 bg-slate-50/80",
  }[tone];

  const hasHeader = title != null || description != null;

  return (
    <div className={cn("config-subsection rounded-lg border p-4", toneClass, className)}>
      {title ? (
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      ) : null}
      {description ? (
        <p className={cn("text-xs leading-relaxed text-slate-600", title ? "mt-1" : undefined)}>
          {description}
        </p>
      ) : null}
      <div className={hasHeader ? "mt-3" : undefined}>{children}</div>
    </div>
  );
}

export function ConfigSidebarLayout({
  sidebar,
  children,
  className,
  bareDetail = false,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  className?: string;
  /** Painel direito sem borda extra (conteúdo já estruturado). */
  bareDetail?: boolean;
}) {
  return (
    <div className={cn("config-sidebar-layout grid gap-4 lg:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)]", className)}>
      <nav className="config-sidebar-nav max-h-[32rem] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2">
        {sidebar}
      </nav>
      <div
        className={cn(
          "config-sidebar-detail min-w-0 space-y-3",
          !bareDetail && "rounded-lg border border-slate-200 bg-white p-4",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function ConfigSidebarGroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
      {children}
    </p>
  );
}

export function ConfigLoadingState({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("config-loading-state flex items-center gap-2 py-6 text-sm text-slate-500", className)}>
      {children}
    </div>
  );
}

export function ConfigErrorState({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("config-error-state rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700", className)}>
      {children}
    </p>
  );
}
