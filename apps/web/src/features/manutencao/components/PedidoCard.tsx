import { cn } from "@sagra/ui";
import { AlertTriangle, Repeat } from "lucide-react";

import type { ManutencaoPedido } from "@/api/manutencao";

import { pessoa, PRIORIDADE_META, tempoRelativo } from "../manutencaoUi";
import {
  Badge,
  CodigoMaquina,
  ParadaBadge,
  PrioridadeBadge,
  StatusBadge,
} from "./ManutencaoShared";

export function PedidoCard({
  pedido,
  onAbrir,
  compact,
  hideStatus,
}: {
  pedido: ManutencaoPedido;
  onAbrir: (id: number) => void;
  compact?: boolean;
  hideStatus?: boolean;
}) {
  const meta = PRIORIDADE_META[pedido.prioridade];
  const quando =
    pedido.status === "fila"
      ? `aguardando ${tempoRelativo(pedido.solicitado_em).replace("há ", "")}`
      : pedido.status === "concluido"
        ? `concluído ${tempoRelativo(pedido.concluido_em)}`
        : pedido.status === "cancelado"
          ? `cancelado ${tempoRelativo(pedido.cancelado_em)}`
          : `iniciado ${tempoRelativo(pedido.iniciado_em)}`;
  const responsavel =
    pedido.status === "concluido"
      ? pessoa(pedido.concluido_por_nome, pedido.concluido_por)
      : pedido.status === "em_execucao" || pedido.status === "pausado"
        ? pessoa(pedido.iniciado_por_nome, pedido.iniciado_por)
        : null;
  return (
    <button
      type="button"
      onClick={() => onAbrir(pedido.id)}
      className={cn(
        "relative block w-full overflow-hidden rounded-lg border border-slate-200 bg-white py-2.5 pl-4 pr-3 text-left shadow-sm transition hover:border-slate-400 hover:shadow",
        pedido.status === "cancelado" && "opacity-60",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", meta.bar)} aria-hidden />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="truncate text-sm font-semibold text-slate-900">{pedido.maquina_nome}</span>
        <CodigoMaquina codigo={pedido.maquina_codigo} />
      </div>
      <p className={cn("mt-0.5 text-sm text-slate-700", compact ? "line-clamp-1" : "line-clamp-2")}>
        {pedido.titulo}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {!hideStatus ? <StatusBadge status={pedido.status} /> : null}
        {!compact ? <PrioridadeBadge prioridade={pedido.prioridade} /> : null}
        {pedido.maquina_parada && pedido.status !== "concluido" ? <ParadaBadge /> : null}
        {pedido.recorrente_id ? (
          <Badge className="bg-slate-50 text-slate-600 ring-slate-200">
            <Repeat className="h-3 w-3" aria-hidden />
            Recorrente
          </Badge>
        ) : null}
      </div>
      {pedido.status === "pausado" && pedido.pausa_motivo ? (
        <p className="mt-1 flex items-start gap-1 text-xs text-violet-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {pedido.pausa_motivo}
        </p>
      ) : null}
      <p className="mt-1 text-[11px] text-slate-400">
        #{pedido.id} · {quando}
        {responsavel ? ` · ${responsavel}` : ""}
      </p>
    </button>
  );
}
