import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@sagra/ui";
import { CalendarClock, Clock3, GripVertical, TrendingUp } from "lucide-react";

import type { PcpQueueItem } from "@/api/pcp";
import {
  elapsedTone,
  formatElapsed,
  formatPrevisaoDate,
  osLabel,
  pcpItemKey,
  previsaoConfiancaLabel,
  priorityTone,
} from "../pcpUtils";

interface PcpOsCardProps {
  item: PcpQueueItem;
  nowMs: number;
}

export function PcpOsCard({ item, nowMs }: PcpOsCardProps) {
  const id = pcpItemKey(item);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const elapsed = elapsedTone(item, nowMs);
  const prio = priorityTone(item.prioridade);
  const previsao = item.previsao;
  const proximoAndamento = formatPrevisaoDate(previsao?.previsao_proximo_andamento);
  const previsaoConclusao = formatPrevisaoDate(previsao?.previsao_conclusao);
  const confiancaLabel = previsaoConfiancaLabel(previsao?.confianca);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "rounded-lg border border-sagra-border bg-white p-3 shadow-sm",
        isDragging && "z-10 opacity-90 shadow-md ring-2 ring-primary-green/40",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab text-neutral-400 hover:text-neutral-600 active:cursor-grabbing"
          aria-label="Arrastar card"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-secondary-blue">
              {osLabel(item.nr_os, item.ano)}
            </span>
            {item.pcp_ordem != null && (
              <span className="text-xs text-neutral-500">#{item.pcp_ordem}</span>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-neutral-700">
            {item.produto || "Produto não informado"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-xs",
                prio === "ok" && "bg-red-100 text-red-900",
                prio === "warn" && "bg-amber-100 text-amber-900",
                prio === "muted" && "bg-slate-100 text-slate-600",
              )}
            >
              {item.prioridade || "Sem prioridade"}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
              {item.situacao}
            </span>
          </div>
          <div
            className={cn(
              "mt-2 flex items-center gap-1 text-xs",
              elapsed === "ok" && "text-primary-green",
              elapsed === "soon" && "text-amber-700",
              elapsed === "late" && "text-sagra-danger",
              elapsed === "muted" && "text-neutral-400",
            )}
          >
            <Clock3 className="size-3.5 shrink-0" />
            <span>{formatElapsed(item, nowMs)}</span>
          </div>
          {(proximoAndamento || previsaoConclusao || previsao?.trabalho_finalizado) && (
            <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs text-neutral-600">
              {proximoAndamento && (
                <div className="flex items-start gap-1">
                  <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-secondary-blue" />
                  <span>
                    Próx. andamento:{" "}
                    <span className="font-medium text-neutral-800">{proximoAndamento}</span>
                  </span>
                </div>
              )}
              {(previsaoConclusao || previsao?.trabalho_finalizado) && (
                <div className="flex items-start gap-1">
                  <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-primary-green" />
                  <span>
                    {previsao?.trabalho_finalizado ? "Trabalho finalizado" : "Conclusão est.:"}{" "}
                    <span className="font-medium text-neutral-800">
                      {previsao?.trabalho_finalizado ? "agora" : previsaoConclusao}
                    </span>
                  </span>
                </div>
              )}
              {confiancaLabel && (
                <p className="pl-4 text-[10px] text-neutral-400">{confiancaLabel}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
