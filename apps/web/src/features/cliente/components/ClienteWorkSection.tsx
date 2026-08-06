import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

import type { ClienteOsItem } from "@/api/cliente-portal";
import { cn } from "@sagra/ui";

import type { SectionKind } from "../types/clienteProgress";
import { ClienteWorkCard } from "./ClienteWorkCard";

interface ClienteWorkSectionProps {
  kind: SectionKind;
  title: string;
  description: string;
  icon: LucideIcon;
  items: ClienteOsItem[];
  showPendenciaButton?: boolean;
  emptyMessage: string;
  expandedKeys: Set<string>;
  onToggleExpand: (key: string) => void;
  sectionId?: string;
}

function osKey(item: ClienteOsItem) {
  return `${item.ano}-${item.nr_os}`;
}

export function ClienteWorkSection({
  kind,
  title,
  description,
  icon: Icon,
  items,
  showPendenciaButton = false,
  emptyMessage,
  expandedKeys,
  onToggleExpand,
  sectionId,
}: ClienteWorkSectionProps) {
  return (
    <section
      id={sectionId}
      aria-labelledby={sectionId ? `${sectionId}-title` : undefined}
      className="scroll-mt-24"
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-sagra-border/70 pb-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
              kind === "em_andamento"
                ? "bg-primary-green/10 text-primary-green"
                : "bg-amber-50 text-amber-700",
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          <div>
            <h2
              id={sectionId ? `${sectionId}-title` : undefined}
              className="text-sm font-bold uppercase tracking-wide text-secondary-blue"
            >
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold tabular-nums",
            items.length > 0
              ? kind === "em_andamento"
                ? "bg-emerald-50 text-emerald-800"
                : "bg-amber-50 text-amber-800"
              : "bg-neutral-100 text-neutral-500",
          )}
        >
          {items.length} {items.length === 1 ? "OS" : "OSs"}
        </span>
      </header>

      {!items.length ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-sagra-border bg-gradient-to-b from-white to-slate-50 px-6 py-10 text-center shadow-sm">
          <Inbox className="size-8 text-neutral-300" aria-hidden />
          <p className="mt-3 text-sm font-medium text-neutral-600">{emptyMessage}</p>
          <p className="mt-1 text-xs text-neutral-500">
            Novas atualizações aparecerão aqui automaticamente.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((item, index) => {
            const key = osKey(item);
            return (
              <li
                key={key}
                style={{ animationDelay: `${Math.min(index * 70, 420)}ms` }}
                className="motion-safe:animate-[fadeIn_300ms_ease-out_both]"
              >
                <ClienteWorkCard
                  item={item}
                  sectionKind={kind}
                  showPendenciaButton={showPendenciaButton}
                  expanded={expandedKeys.has(key)}
                  onToggleExpand={() => onToggleExpand(key)}
                  animationIndex={index}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
