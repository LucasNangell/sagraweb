import { cn } from "@sagra/ui";
import { PauseCircle, Repeat } from "lucide-react";

import type { ManutencaoPedido } from "@/api/manutencao";

import { pessoa, PRIORIDADE_META, tempoRelativo } from "../manutencaoUi";
import { VistoPorBadge } from "./Visualizacoes";
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
        pedido.status === "pausado" && "border-violet-300 ring-1 ring-violet-200",
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
        {pedido.status !== "concluido" && pedido.status !== "cancelado" ? (
          <VistoPorBadge visualizacoes={pedido.visualizacoes} destacarNinguem={pedido.status === "fila"} />
        ) : null}
      </div>
      {pedido.status === "pausado" ? <PausaResumo pedido={pedido} compact={compact} /> : null}
      <p className="mt-1 text-[11px] text-slate-400">
        #{pedido.id} · {quando}
        {responsavel ? ` · ${responsavel}` : ""}
      </p>
    </button>
  );
}

/** O que o operador informou ao pausar: quem, quando, motivo e o que já foi feito. */
export function PausaResumo({ pedido, compact }: { pedido: ManutencaoPedido; compact?: boolean }) {
  const passos = pedido.solucao_passos ?? [];
  const quem = pedido.pausado_por
    ? pessoa(pedido.pausado_por_nome, pedido.pausado_por)
    : pessoa(pedido.iniciado_por_nome, pedido.iniciado_por);
  return (
    <div className="mt-2 space-y-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-2 text-xs text-violet-900">
      <p className="flex items-start gap-1 font-semibold">
        <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Pausado por {quem}
          {pedido.pausado_em ? ` · ${tempoRelativo(pedido.pausado_em)}` : ""}
        </span>
      </p>
      {pedido.pausa_motivo ? (
        <p>
          <span className="font-medium">Motivo:</span> {pedido.pausa_motivo}
        </p>
      ) : null}
      {!compact && pedido.diagnostico ? (
        <p className="line-clamp-2 text-violet-800">
          <span className="font-medium">Diagnóstico:</span> {pedido.diagnostico}
        </p>
      ) : null}
      {!compact ? (
        <p className="text-violet-800">
          {passos.length ? (
            <>
              <span className="font-medium">
                {passos.length} {passos.length === 1 ? "passo feito" : "passos feitos"}
              </span>
              {" · último: "}
              {passos[passos.length - 1]}
            </>
          ) : (
            "Nenhum passo registrado"
          )}
        </p>
      ) : null}
    </div>
  );
}
