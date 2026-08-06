import { Loader2, Play, CheckCircle2 } from "lucide-react";

import type { GravacaoExternaDetail } from "@/api/gravacaoExterna";
import { cn } from "@sagra/ui";

interface GravacaoExternaActionsProps {
  detail: GravacaoExternaDetail;
  canOperate: boolean;
  onIniciar: () => void;
  onConcluir: () => void;
  iniciando: boolean;
  concluindo: boolean;
}

function statusLabel(status: string): string {
  switch (status) {
    case "iniciada":
      return "Iniciada";
    case "pendente":
      return "Pendente";
    case "concluida":
      return "Concluída";
    case "sem_sessao":
      return "Sem arquivos";
    default:
      return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "iniciada":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "pendente":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "concluida":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "sem_sessao":
      return "bg-neutral-100 text-neutral-600 border-neutral-300";
    default:
      return "bg-neutral-100 text-neutral-700 border-neutral-200";
  }
}

export function GravacaoExternaStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        statusClass(status),
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

export function GravacaoExternaActions({
  detail,
  canOperate,
  onIniciar,
  onConcluir,
  iniciando,
  concluindo,
}: GravacaoExternaActionsProps) {
  const iniciada = detail.status === "iniciada";
  const concluida = detail.status === "concluida";
  const pendente = detail.status === "pendente";

  if (!canOperate) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={!pendente || iniciando || iniciada || concluida}
        onClick={onIniciar}
        className="inline-flex items-center gap-2 rounded bg-primary-green px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {iniciando ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        Iniciar gravação
      </button>

      <button
        type="button"
        disabled={!iniciada || concluindo || concluida}
        onClick={onConcluir}
        className="inline-flex items-center gap-2 rounded border border-primary-green bg-white px-4 py-2 text-sm font-medium text-primary-green hover:bg-primary-green/5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {concluindo ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        Gravação concluída
      </button>
    </div>
  );
}
