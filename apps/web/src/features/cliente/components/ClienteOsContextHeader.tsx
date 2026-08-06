import type { ClienteOsItem } from "@/api/cliente-portal";
import { formatDateTimeBr } from "@/lib/format";

import { ClienteStatusBadge } from "./ClienteStatusBadge";

interface ClienteOsContextHeaderProps {
  item: ClienteOsItem;
  vinculoLabel?: string;
  extra?: React.ReactNode;
}

export function ClienteOsContextHeader({
  item,
  vinculoLabel,
  extra,
}: ClienteOsContextHeaderProps) {
  return (
    <header className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Ordem de serviço
          </p>
          <h1 className="mt-0.5 text-xl font-bold tabular-nums text-secondary-blue sm:text-2xl">
            OS {item.nr_os}/{item.ano}
          </h1>
          <p className="mt-1 line-clamp-2 text-sm font-medium text-neutral-800">
            {item.titulo || "—"}
          </p>
          {vinculoLabel ? (
            <p className="mt-1 text-xs text-neutral-500">{vinculoLabel}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.produto ? (
              <ClienteStatusBadge variant="default">{item.produto}</ClienteStatusBadge>
            ) : null}
            {item.situacao ? (
              <ClienteStatusBadge variant="situacao">{item.situacao}</ClienteStatusBadge>
            ) : null}
            {item.setor ? (
              <ClienteStatusBadge variant="setor">{item.setor}</ClienteStatusBadge>
            ) : null}
            {item.versao ? (
              <ClienteStatusBadge variant="default">Prova v{item.versao}</ClienteStatusBadge>
            ) : null}
          </div>
          {item.data_andamento ? (
            <p className="mt-2 text-xs text-neutral-500">
              Atualizado{" "}
              <time dateTime={String(item.data_andamento)}>
                {formatDateTimeBr(item.data_andamento)}
              </time>
            </p>
          ) : null}
        </div>
        {extra ? <div className="shrink-0">{extra}</div> : null}
      </div>
    </header>
  );
}
