import { ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";

import type { ClienteOsItem } from "@/api/cliente-portal";
import { cn } from "@sagra/ui";

import { ClienteOsTimeline } from "./ClienteOsTimeline";

interface ClienteOsListProps {
  items: ClienteOsItem[];
  showPendenciaButton?: boolean;
  emptyMessage: string;
}

function osKey(item: ClienteOsItem) {
  return `${item.ano}-${item.nr_os}`;
}

export function ClienteOsList({
  items,
  showPendenciaButton = false,
  emptyMessage,
}: ClienteOsListProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (!items.length) {
    return (
      <p className="rounded-lg border border-dashed border-sagra-border bg-white px-4 py-8 text-center text-sm text-neutral-500">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-sagra-border rounded-lg border border-sagra-border bg-white shadow-sm">
      {items.map((item) => {
        const key = osKey(item);
        const expanded = expandedKeys.has(key);

        return (
          <li key={key}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => toggleExpanded(key)}
                className="flex min-w-0 flex-1 items-start gap-2 text-left hover:opacity-90"
                aria-expanded={expanded}
                aria-controls={`cliente-os-timeline-${key}`}
              >
                <ChevronDown
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-neutral-400 transition-transform",
                    expanded && "rotate-180",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-secondary-blue">
                    OS {item.nr_os}/{item.ano}
                  </p>
                  <p className="truncate text-sm text-neutral-700">{item.titulo || "—"}</p>
                  <p className="text-xs text-neutral-500">
                    {item.produto || "—"} · {item.situacao || "—"}
                    {item.setor ? ` · ${item.setor}` : ""}
                  </p>
                </div>
              </button>
              {showPendenciaButton && item.pendencia_url ? (
                <a
                  href={item.pendencia_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary-green px-3 py-2 text-sm font-medium text-white hover:bg-primary-green/90"
                >
                  {item.pendencia_label || "Ver pendência"}
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              ) : null}
            </div>
            <div id={`cliente-os-timeline-${key}`}>
              <ClienteOsTimeline ano={item.ano} nrOs={item.nr_os} expanded={expanded} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
