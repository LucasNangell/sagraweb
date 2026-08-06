import { ChevronDown } from "lucide-react";

import type { ClienteOsItem } from "@/api/cliente-portal";
import { cn } from "@sagra/ui";

import type { ClienteSectionConfig } from "../utils/clienteSectionConfig";
import { ClienteCompactOsCard } from "./ClienteCompactOsCard";
import { ClienteSectionEmptyState } from "./ClienteSectionEmptyState";

interface ClienteCollapsibleSectionProps {
  config: ClienteSectionConfig;
  items: ClienteOsItem[];
  vinculoLabel: string;
  isOpen: boolean;
  onToggle: () => void;
  expandedOsKeys: Set<string>;
  onToggleOsExpand: (key: string) => void;
}

function osKey(item: ClienteOsItem) {
  return `${item.ano}-${item.nr_os}`;
}

export function ClienteCollapsibleSection({
  config,
  items,
  vinculoLabel,
  isOpen,
  onToggle,
  expandedOsKeys,
  onToggleOsExpand,
}: ClienteCollapsibleSectionProps) {
  const { kind, sectionId, title, description, closedSummary, emptyMessage, icon: Icon, priority } =
    config;
  const count = items.length;
  const hasItems = count > 0;
  const contentId = `${sectionId}-content`;
  const isAction = priority === "action";

  return (
    <section
      id={sectionId}
      className="scroll-mt-28 overflow-hidden rounded-2xl border border-sagra-border bg-white shadow-sm"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={contentId}
        id={`${sectionId}-trigger`}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-4 text-left transition-colors sm:px-5",
          "hover:bg-slate-50/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-secondary-blue",
          isAction && hasItems && "bg-amber-50/30",
          !isAction && hasItems && "bg-emerald-50/20",
        )}
      >
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            isAction
              ? hasItems
                ? "bg-amber-100 text-amber-700"
                : "bg-neutral-100 text-neutral-500"
              : hasItems
                ? "bg-emerald-100 text-emerald-700"
                : "bg-neutral-100 text-neutral-500",
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-secondary-blue sm:text-base">{title}</h2>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                hasItems
                  ? isAction
                    ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-800"
                  : "bg-neutral-100 text-neutral-500",
              )}
            >
              {count}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">
            {isOpen ? description : hasItems ? closedSummary(count) : description}
          </p>
        </div>

        <ChevronDown
          className={cn(
            "mt-1 size-5 shrink-0 text-neutral-400 transition-transform duration-200 motion-reduce:transition-none",
            isOpen && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <div
        id={contentId}
        role="region"
        aria-labelledby={`${sectionId}-trigger`}
        className={cn(
          "grid border-t border-sagra-border/60 transition-[grid-template-rows] duration-300 motion-reduce:transition-none",
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 px-4 py-4 sm:px-5">
            {!hasItems ? (
              <ClienteSectionEmptyState message={emptyMessage} />
            ) : (
              <ul className="space-y-3">
                {items.map((item, index) => {
                  const key = osKey(item);
                  return (
                    <li key={key}>
                      <ClienteCompactOsCard
                        item={item}
                        sectionKind={kind}
                        vinculoLabel={vinculoLabel}
                        showPendenciaButton={config.showPendenciaButton}
                        expanded={expandedOsKeys.has(key)}
                        onToggleExpand={() => onToggleOsExpand(key)}
                        animationIndex={index}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
