import { cn } from "@sagra/ui";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import "./papelariaWorkspace.css";

/**
 * Primitivos visuais do workspace de Papelaria (admin/configuracoes).
 * Mantêm a identidade SAGRA (slate + secondary-blue) com um vocabulário único
 * para cards, campos, seletores segmentados e mensagens.
 */

export type SegmentedOption<T extends string> = {
  id: T;
  label: ReactNode;
  title?: string;
  icon?: ReactNode;
};

/**
 * Seletor segmentado com "trilho" deslizante (estilo slider). Teclado: ← → Home End.
 * Opções têm larguras iguais para que o indicador deslize com precisão.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className,
  disabled,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (i - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const opcao = options[next];
    if (!opcao) return;
    onChange(opcao.id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn("pw-segmented", size === "sm" && "pw-segmented--sm", className)}
      style={
        {
          "--pw-seg-count": options.length,
          "--pw-seg-index": index,
        } as CSSProperties
      }
    >
      <span className="pw-segmented__thumb" aria-hidden />
      {options.map((opt, i) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={opt.title}
            disabled={disabled}
            className={cn("pw-segmented__option", active && "is-active")}
            onClick={() => onChange(opt.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {opt.icon}
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PanelCard({
  title,
  description,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  tone = "default",
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  tone?: "default" | "danger" | "muted";
}) {
  const hasHeader = title != null || actions != null;
  return (
    <section className={cn("pw-card", tone !== "default" && `pw-card--${tone}`, className)}>
      {hasHeader ? (
        <header className="pw-card__header">
          <div className="min-w-0 flex-1">
            {title ? (
              <h4 className="pw-card__title">
                {icon ? <span className="pw-card__icon">{icon}</span> : null}
                {title}
              </h4>
            ) : null}
            {description ? <p className="pw-card__description">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children != null ? <div className={cn("pw-card__body", bodyClassName)}>{children}</div> : null}
    </section>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("pw-field", className)}>
      <label className="pw-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="pw-field__hint">{hint}</p> : null}
    </div>
  );
}

export type StatusTone = "ok" | "info" | "warn" | "muted" | "violet";

export function StatusPill({
  tone,
  children,
  title,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span className={cn("pw-pill", `pw-pill--${tone}`, className)} title={title}>
      {children}
    </span>
  );
}

export function InlineMessage({
  tone,
  children,
  className,
}: {
  tone: "ok" | "error" | "warn" | "info";
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("pw-message", `pw-message--${tone}`, className)}
    >
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("pw-empty", className)}>
      {icon ? <span className="pw-empty__icon">{icon}</span> : null}
      <p className="pw-empty__title">{title}</p>
      {children ? <div className="pw-empty__text">{children}</div> : null}
      {action ? <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Normaliza para busca sem acentos/caixa. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
