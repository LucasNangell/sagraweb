import { cn } from "@sagra/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { useOsHistory } from "@/api/hooks/useOsHistory";
import { OsAndamentoEditor, formatUsuarioPontoLabel } from "@/features/os/components/OsAndamentoEditor";
import type { OsHistoryRow, OsSearchRow } from "@/features/os/types";
import { formatDateBr } from "@/lib/format";

type Props = {
  row: OsSearchRow;
};

export function PapelariaSpTramitacao({ row }: Props) {
  const historyQuery = useOsHistory(row.ano, row.nr_os);
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
  }, [row.ano, row.nr_os]);

  useEffect(() => {
    if (editing || rows.length === 0) {
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
  }, [editing, rows, row.ano, row.nr_os, selectedHistory]);

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

  const loading = historyQuery.isPending && rows.length === 0;

  return (
    <div
      className="min-w-0 max-w-full border-t border-neutral-200 bg-slate-50/70 px-2 py-2"
      data-testid={`papelaria-sp-tramitacao-${row.nr_os}`}
      onClick={(event) => event.stopPropagation()}
    >
      {loading ? (
        <p className="py-2 text-center text-[11px] text-neutral-500">
          Carregando andamentos…
        </p>
      ) : rows.length === 0 ? (
        <p className="py-2 text-center text-[11px] text-neutral-500">
          Nenhum andamento.
        </p>
      ) : (
        <ul className="mb-2 min-w-0 overflow-hidden rounded border border-sagra-border bg-white">
          {rows.map((item) => {
            const active = selectedHistory?.CodStatus === item.CodStatus;
            const ponto = formatUsuarioPontoLabel(item.Ponto, item.usuario_nome);
            return (
              <li key={item.CodStatus}>
                <button
                  type="button"
                  className={cn(
                    "grid w-full min-w-0 grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_5.25rem_minmax(0,1.2fr)] items-start gap-x-2 border-b border-neutral-100 px-2 py-1.5 text-left text-[11px] leading-snug last:border-b-0",
                    active ? "bg-[var(--highlight-yellow)]" : "hover:bg-slate-50",
                  )}
                  data-testid={`papelaria-sp-andamento-${row.nr_os}-${item.CodStatus}`}
                  onClick={() => setSelectedHistory(item)}
                >
                  <span className="min-w-0 break-words font-semibold text-neutral-800">
                    {item.SituacaoLink ?? "—"}
                  </span>
                  <span className="min-w-0 break-words text-neutral-700">
                    {item.SetorLink ?? "—"}
                  </span>
                  <span className="tabular-nums text-neutral-700">
                    {formatDateBr(item.Data) || "—"}
                  </span>
                  <span className="min-w-0 break-words text-neutral-700">
                    {ponto || "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedHistory ? (
        <p
          className="mb-2 whitespace-pre-wrap rounded border border-sagra-border bg-white px-2 py-1.5 text-[11px] text-neutral-700"
          data-testid={`papelaria-sp-obs-${row.nr_os}`}
        >
          {selectedHistory.Observaçao?.trim() || "Sem observação."}
        </p>
      ) : null}

      <OsAndamentoEditor
        selected={row}
        historyRow={selectedHistory}
        onHistoryRowChange={setSelectedHistory}
        onEditingChange={setEditing}
        compact
        presentation="inline"
      />
    </div>
  );
}
