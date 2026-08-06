import { cn } from "@sagra/ui";
import { useEffect, useRef } from "react";

import type { GravacaoLogEntry } from "../types";

interface GravacaoLogPanelProps {
  entries: GravacaoLogEntry[];
  className?: string;
}

export function GravacaoLogPanel({ entries, className }: GravacaoLogPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-sagra-border bg-slate-900 text-slate-100",
        className,
      )}
    >
      <div className="border-b border-slate-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Log de eventos
      </div>
      <div className="max-h-64 flex-1 overflow-y-auto p-2 font-mono text-xs leading-relaxed">
        {entries.length === 0 ? (
          <p className="text-slate-500">Aguardando mensagens do WebSocket…</p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                "border-b border-slate-800/80 py-1",
                entry.level === "error" && "text-red-300",
                entry.level === "warn" && "text-amber-300",
                entry.level === "info" && "text-slate-200",
              )}
            >
              <span className="text-slate-500">[{entry.at}]</span> {entry.message}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
