import { cn } from "@sagra/ui";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchOsAuditLog } from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import { formatPonto } from "@/lib/format";

import {
  auditLaunchDescriptionRows,
  formatAuditActionLabel,
  formatAuditEventDateParts,
  groupAuditLogLaunches,
  type AuditLogLaunch,
} from "../auditLogFormat";

interface OsGerenciaAuditHistoryPanelProps {
  ano: number;
  osId: number;
}

export function OsGerenciaAuditHistoryPanel({
  ano,
  osId,
}: OsGerenciaAuditHistoryPanelProps) {
  const auditQuery = useQuery({
    queryKey: queryKeys.os.auditLog(ano, osId),
    queryFn: () => fetchOsAuditLog(ano, osId),
  });

  const launches = useMemo(
    () => groupAuditLogLaunches(auditQuery.data ?? []),
    [auditQuery.data],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(null);
  }, [ano, osId]);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && launches.some((item) => item.id === current)) {
        return current;
      }
      return launches[0]?.id ?? null;
    });
  }, [launches]);

  const selected = launches.find((item) => item.id === selectedId) ?? null;
  const descriptionRows = selected ? auditLaunchDescriptionRows(selected) : [];

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-slate-200 bg-white">
      <section
        className="flex min-w-0 flex-1 flex-col border-r border-slate-200"
        aria-label="Lançamentos do histórico"
      >
        <div className="shrink-0 border-b border-slate-100 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Lançamentos
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {auditQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Carregando histórico…
            </div>
          ) : auditQuery.isError ? (
            <p className="px-2 py-8 text-center text-xs text-red-700">
              {auditQuery.error instanceof Error
                ? auditQuery.error.message
                : "Erro ao carregar o histórico."}
            </p>
          ) : launches.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-slate-400">
              Nenhum registro encontrado para esta OS.
            </p>
          ) : (
            <table className="w-full table-fixed border-collapse text-[11px]">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  <th className="w-[18%] px-2 py-1.5 text-left font-semibold text-slate-600">
                    Data
                  </th>
                  <th className="w-[14%] px-2 py-1.5 text-left font-semibold text-slate-600">
                    Hora
                  </th>
                  <th className="w-[28%] px-2 py-1.5 text-left font-semibold text-slate-600">
                    Tipo de registro
                  </th>
                  <th className="w-[16%] px-2 py-1.5 text-left font-semibold text-slate-600">
                    Ponto
                  </th>
                  <th className="px-2 py-1.5 text-left font-semibold text-slate-600">
                    Nome Usuário
                  </th>
                </tr>
              </thead>
              <tbody>
                {launches.map((launch) => (
                  <AuditLaunchRow
                    key={launch.id}
                    launch={launch}
                    selected={launch.id === selectedId}
                    onSelect={() => setSelectedId(launch.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <aside
        className="flex w-[42%] min-w-[12rem] max-w-[22rem] flex-col bg-slate-50/70"
        aria-label="Descrição da alteração"
      >
        <div className="shrink-0 border-b border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Descrição
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {!selected ? (
            <p className="py-6 text-center text-[11px] text-slate-400">
              Clique em um lançamento para ver os detalhes.
            </p>
          ) : (
            <table className="w-full table-fixed border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-1.5 py-1 text-left font-semibold">Campo</th>
                  <th className="px-1.5 py-1 text-left font-semibold">
                    Valor antigo
                  </th>
                  <th className="px-1.5 py-1 text-left font-semibold">
                    Valor atual
                  </th>
                </tr>
              </thead>
              <tbody>
                {descriptionRows.map((row, index) => (
                  <tr
                    key={`${selected.id}-${row.campo}-${index}`}
                    className="border-b border-slate-100 align-top"
                  >
                    <td className="break-words px-1.5 py-1 font-medium text-slate-700">
                      {row.campo}
                    </td>
                    <td className="break-words px-1.5 py-1 text-slate-600">
                      {row.valorAntigo}
                    </td>
                    <td className="break-words px-1.5 py-1 text-slate-800">
                      {row.valorAtual}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </div>
  );
}

function AuditLaunchRow({
  launch,
  selected,
  onSelect,
}: {
  launch: AuditLogLaunch;
  selected: boolean;
  onSelect: () => void;
}) {
  const { date, time } = formatAuditEventDateParts(launch.evento_em);
  return (
    <tr
      className={cn(
        "cursor-pointer border-b border-slate-100 align-top",
        selected ? "bg-[#cce8ff]" : "hover:bg-[#e5f3ff]",
      )}
      onClick={onSelect}
    >
      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">{date}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">{time}</td>
      <td className="break-words px-2 py-1.5 font-medium text-secondary-blue">
        {formatAuditActionLabel(launch.acao)}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">
        {launch.ponto ? formatPonto(launch.ponto) : "—"}
      </td>
      <td className="truncate px-2 py-1.5 text-slate-700" title={launch.usuario_nome ?? undefined}>
        {launch.usuario_nome?.trim() || "—"}
      </td>
    </tr>
  );
}
