import { Clock, Loader2, Play, CheckCircle2, Settings } from "lucide-react";

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

/** Só tipografia/ícone — badges informativos não usam cápsula colorida. */
function statusTextClass(status: string): string {
  switch (status) {
    case "iniciada":
      return "text-emerald-800";
    case "pendente":
      return "text-amber-800";
    case "concluida":
      return "text-blue-800";
    case "sem_sessao":
      return "text-neutral-600";
    default:
      return "text-neutral-700";
  }
}

export function GravacaoExternaStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const isIniciada = status === "iniciada";
  const isPendente = status === "pendente";
  const isConcluida = status === "concluida";
  return (
    <span
      className={cn(
        "inline-flex min-w-[5.75rem] items-center justify-center gap-1 text-xs font-semibold",
        statusTextClass(status),
        className,
      )}
    >
      {isIniciada ? (
        <Settings className="size-3 shrink-0 gravacao-gear-spin" aria-hidden />
      ) : null}
      {isPendente ? <Clock className="size-3 shrink-0" aria-hidden /> : null}
      {isConcluida ? <CheckCircle2 className="size-3 shrink-0" aria-hidden /> : null}
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
        className="sagra-btn sagra-btn--primary sagra-btn--md"
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
        className="sagra-btn sagra-btn--primary-outline sagra-btn--md "
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
