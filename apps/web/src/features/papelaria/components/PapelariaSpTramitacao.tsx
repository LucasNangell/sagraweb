import { cn } from "@sagra/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { useOsHistory } from "@/api/hooks/useOsHistory";
import { OsAndamentoEditor } from "@/features/os/components/OsAndamentoEditor";
import type { OsHistoryRow, OsSearchRow } from "@/features/os/types";

type Props = {
  row: OsSearchRow | null;
  className?: string;
};

export function PapelariaSpTramitacao({ row, className }: Props) {
  const historyQuery = useOsHistory(row?.ano ?? null, row?.nr_os ?? null);
  const rows = useMemo(
    () => historyQuery.data ?? [],
    [historyQuery.data],
  );
  const [selectedHistory, setSelectedHistory] = useState<OsHistoryRow | null>(null);
  const [editing, setEditing] = useState(false);
  const lastAutoKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setSelectedHistory(null);
    setEditing(false);
    lastAutoKeyRef.current = null;
  }, [row?.ano, row?.nr_os]);

  useEffect(() => {
    if (!row || editing || rows.length === 0) {
      return;
    }
    const last = rows[rows.length - 1];
    if (!last) {
      return;
    }
    const key = `${row.ano}-${row.nr_os}-${last.CodStatus}`;
    if (selectedHistory && lastAutoKeyRef.current === key) {
      return;
    }
    lastAutoKeyRef.current = key;
    setSelectedHistory(last);
  }, [editing, rows, row, selectedHistory]);

  useEffect(() => {
    if (!selectedHistory) {
      return;
    }
    const fresh = rows.find((item) => item.CodStatus === selectedHistory.CodStatus);
    if (!fresh || fresh === selectedHistory) {
      return;
    }
    const same =
      fresh.Observaçao === selectedHistory.Observaçao &&
      fresh.SituacaoLink === selectedHistory.SituacaoLink &&
      fresh.SetorLink === selectedHistory.SetorLink &&
      fresh.Data === selectedHistory.Data &&
      fresh.Ponto === selectedHistory.Ponto &&
      fresh.usuario_nome === selectedHistory.usuario_nome;
    if (same) {
      return;
    }
    setSelectedHistory(fresh);
  }, [rows, selectedHistory]);

  const loading = Boolean(row) && historyQuery.isPending && rows.length === 0;
  const testId = row
    ? `papelaria-sp-tramitacao-${row.nr_os}`
    : "papelaria-sp-tramitacao-empty";

  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm",
        className,
      )}
      aria-label="Andamentos da SP"
      data-testid={testId}
    >
      <div className="shrink-0 border-b border-sagra-border bg-slate-50/80 px-3 py-1.5">
        <h3 className="text-xs font-bold tracking-wide text-secondary-blue">
          Andamentos
        </h3>
      </div>

      {!row ? (
        <p className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-500">
          Selecione uma SP na lista para ver o histórico.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
          <div
            className={cn(
              "relative max-h-[min(40vh,280px)] min-h-[140px] min-w-0 shrink-0 overflow-x-hidden overflow-y-auto overscroll-contain border-b border-sagra-border sm:max-h-none sm:h-auto sm:w-[44%] sm:border-r sm:border-b-0",
              editing && "cursor-not-allowed",
            )}
          >
            {editing ? (
              <div
                className="absolute inset-0 z-10 cursor-not-allowed bg-white/40"
                aria-hidden
              />
            ) : null}
            <table
              className={cn(
                "w-full min-w-0 table-fixed border-collapse text-xs",
                editing && "pointer-events-none opacity-60",
              )}
            >
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  <th className="min-w-0 overflow-hidden px-2 py-1.5 text-left font-semibold">
                    Situação
                  </th>
                  <th
                    className="overflow-hidden px-1.5 py-1.5 text-left font-semibold"
                    style={{ width: "5.5rem" }}
                  >
                    Setor
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={2}
                      className="px-2 py-4 text-center text-neutral-500"
                    >
                      Carregando andamentos…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={2}
                      className="px-2 py-4 text-center text-neutral-500"
                    >
                      Nenhum andamento.
                    </td>
                  </tr>
                ) : (
                  rows.map((item) => {
                    const active =
                      selectedHistory?.CodStatus === item.CodStatus;
                    return (
                      <tr
                        key={item.CodStatus}
                        data-testid={`papelaria-sp-andamento-${row.nr_os}-${item.CodStatus}`}
                        onClick={() => {
                          if (!editing) {
                            setSelectedHistory(item);
                          }
                        }}
                        className={cn(
                          "cursor-pointer border-b border-sagra-border/50 hover:bg-slate-50",
                          active && "bg-[var(--highlight-yellow)]",
                        )}
                      >
                        <td className="min-w-0 overflow-hidden px-2 py-1">
                          <span
                            className="block truncate"
                            title={item.SituacaoLink ?? undefined}
                          >
                            {item.SituacaoLink ?? "—"}
                          </span>
                        </td>
                        <td
                          className="overflow-hidden px-1.5 py-1"
                          style={{ width: "5.5rem" }}
                        >
                          <span
                            className="block truncate"
                            title={item.SetorLink ?? undefined}
                          >
                            {item.SetorLink ?? "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <OsAndamentoEditor
            selected={row}
            historyRow={selectedHistory}
            onHistoryRowChange={setSelectedHistory}
            onEditingChange={setEditing}
            compact
            presentation="panel"
          />
        </div>
      )}
    </section>
  );
}
