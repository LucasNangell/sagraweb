import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Fragment, useEffect, useState, type KeyboardEvent } from "react";

import type {
  CotasGrafConsumoHistoricoItem,
  CotasGrafSolicitanteCotasItem,
} from "@/api/cotasGraf";
import { useSolicitanteConsumoHistorico } from "@/api/hooks/useCotasGraf";

function formatCota(value: number): string {
  return value.toLocaleString("pt-BR");
}

function formatLimiteSaldo(value: number | null | undefined): string {
  if (value == null) return "—";
  return formatCota(value);
}

function saldoClassName(saldo: number | null | undefined): string {
  if (saldo == null) return "text-neutral-600";
  if (saldo <= 0) return "font-medium text-red-600";
  if (saldo <= 10_000) return "font-medium text-amber-700";
  return "text-neutral-700";
}

function formatOsLabel(nrOs: number, ano: number): string {
  return `${String(nrOs).padStart(5, "0")}/${String(ano).slice(-2)}`;
}

function formatHistoricoReferencia(entry: {
  nr_os: number;
  ano: number;
  origem?: string | null;
  referencia_externa?: string | null;
}): string {
  if (isGraficaRapidaOrigem(entry.origem) || entry.referencia_externa?.trim()) {
    return entry.referencia_externa?.trim() || "Gráfica Rápida";
  }
  return formatOsLabel(entry.nr_os, entry.ano);
}

function isGraficaRapidaOrigem(origem?: string | null): boolean {
  return (origem || "").trim().toLowerCase() === "grafica_rapida";
}

export function rowKey(item: CotasGrafSolicitanteCotasItem): string {
  return `${item.cod_usuario ?? ""}|${item.categoria ?? ""}|${item.nome_usuario ?? ""}`;
}

function tipoBadgeClass(tipo: string): string {
  return tipo === "sp"
    ? "bg-violet-100 text-violet-800"
    : "bg-sky-100 text-sky-800";
}

function HistoricoContent({
  isLoading,
  isError,
  items,
  layout,
}: {
  isLoading: boolean;
  isError: boolean;
  items: CotasGrafConsumoHistoricoItem[];
  layout: "table" | "card";
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-neutral-500">
        <Loader2 className="size-3.5 animate-spin" />
        Carregando histórico…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-4 text-center text-red-600">
        Não foi possível carregar o histórico.
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-4 text-center text-neutral-500">
        Nenhum consumo registrado no semestre.
      </div>
    );
  }

  if (layout === "card") {
    return (
      <div className="space-y-2">
        {items.map((entry) => {
          const grafica = isGraficaRapidaOrigem(entry.origem);
          const entryKey = entry.referencia_externa
            ? `gr-${entry.referencia_externa}`
            : `${entry.ano}-${entry.nr_os}`;
          const tipoLabel = grafica ? "GR" : entry.tipo === "sp" ? "SP" : "OS";
          return (
            <div
              key={entryKey}
              className="rounded border border-slate-200 bg-white px-2.5 py-2 text-[11px]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold uppercase ${
                      grafica
                        ? "bg-amber-100 text-amber-800"
                        : tipoBadgeClass(entry.tipo)
                    }`}
                  >
                    {tipoLabel}
                  </span>
                  <span className="break-words font-medium text-secondary-blue">
                    {formatHistoricoReferencia(entry)}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums font-medium">
                  {formatCota(entry.cota_consumida)}
                </span>
              </div>
              <div className="mt-1 break-words text-neutral-600">
                {entry.produto || "—"}
              </div>
              <div className="mt-0.5 break-words text-neutral-700">
                {entry.titulo || "—"}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="w-full border-collapse text-[11px]">
        <thead className="bg-slate-100">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold text-slate-600">
              OS/SP / PA
            </th>
            <th className="px-2 py-1.5 text-left font-semibold text-slate-600">
              Produto
            </th>
            <th className="px-2 py-1.5 text-left font-semibold text-slate-600">
              Título
            </th>
            <th className="px-2 py-1.5 text-right font-semibold text-slate-600">
              Cota
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => {
            const grafica = isGraficaRapidaOrigem(entry.origem);
            const entryKey = entry.referencia_externa
              ? `gr-${entry.referencia_externa}`
              : `${entry.ano}-${entry.nr_os}`;
            const tipoLabel = grafica ? "GR" : entry.tipo === "sp" ? "SP" : "OS";
            return (
              <tr key={entryKey} className="hover:bg-slate-50/80">
                <td className="border-t border-slate-100 px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`rounded px-1 py-0.5 text-[10px] font-semibold uppercase ${
                        grafica
                          ? "bg-amber-100 text-amber-800"
                          : tipoBadgeClass(entry.tipo)
                      }`}
                    >
                      {tipoLabel}
                    </span>
                    <span className="break-words font-medium text-secondary-blue">
                      {formatHistoricoReferencia(entry)}
                    </span>
                  </div>
                </td>
                <td className="border-t border-slate-100 px-2 py-1.5 break-words">
                  {entry.produto || "—"}
                </td>
                <td className="border-t border-slate-100 px-2 py-1.5 break-words whitespace-normal">
                  {entry.titulo || "—"}
                </td>
                <td className="border-t border-slate-100 px-2 py-1.5 text-right tabular-nums font-medium">
                  {formatCota(entry.cota_consumida)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CotasGrafSolicitanteRow({
  item,
  defaultExpanded = false,
  layout = "table",
}: {
  item: CotasGrafSolicitanteCotasItem;
  defaultExpanded?: boolean;
  layout?: "table" | "card";
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const clienteKey =
    item.cod_usuario && item.nome_usuario
      ? {
          cod_usuario: item.cod_usuario,
          categoria: item.categoria ?? "",
          nome_usuario: item.nome_usuario,
        }
      : null;

  const historyQuery = useSolicitanteConsumoHistorico(clienteKey, expanded);

  useEffect(() => {
    if (defaultExpanded) {
      setExpanded(true);
    }
  }, [defaultExpanded]);

  const toggleExpanded = () => {
    if (!clienteKey) return;
    setExpanded((prev) => !prev);
  };

  const rowInteractionProps = {
    onClick: toggleExpanded,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleExpanded();
      }
    },
    tabIndex: clienteKey ? 0 : -1,
    role: "button" as const,
    "aria-expanded": expanded,
  };

  const solicitanteHeader = (
    <div className="flex items-start gap-1.5">
      {clienteKey ? (
        expanded ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-neutral-400" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-neutral-400" />
        )
      ) : null}
      <div className="min-w-0">
        <div className="break-words font-medium text-secondary-blue">
          {item.solicitante || "—"}
        </div>
        {item.categoria ? (
          <div className="break-words text-[11px] text-neutral-500">
            {item.categoria}
          </div>
        ) : null}
      </div>
    </div>
  );

  const historico = expanded && clienteKey ? (
    <HistoricoContent
      isLoading={historyQuery.isLoading}
      isError={historyQuery.isError}
      items={historyQuery.data?.items ?? []}
      layout={layout}
    />
  ) : null;

  if (layout === "card") {
    return (
      <div
        className={`px-3 py-3 ${clienteKey ? "cursor-pointer hover:bg-slate-50/80" : ""} ${
          expanded ? "bg-slate-50/60" : ""
        }`}
        {...rowInteractionProps}
      >
        {solicitanteHeader}
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
          <div>
            <dt className="text-neutral-500">Cons. OS</dt>
            <dd className="tabular-nums">
              {formatCota(item.consumo_os)}
              {item.limite_os != null ? (
                <span className="text-neutral-400">
                  {" "}
                  / {formatCota(item.limite_os)}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Saldo OS</dt>
            <dd className={`tabular-nums ${saldoClassName(item.saldo_os)}`}>
              {formatLimiteSaldo(item.saldo_os)}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Cons. SP</dt>
            <dd className="tabular-nums">
              {formatCota(item.consumo_sp)}
              {item.limite_sp != null ? (
                <span className="text-neutral-400">
                  {" "}
                  / {formatCota(item.limite_sp)}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Saldo SP</dt>
            <dd className={`tabular-nums ${saldoClassName(item.saldo_sp)}`}>
              {formatLimiteSaldo(item.saldo_sp)}
            </dd>
          </div>
        </dl>
        {historico ? <div className="mt-3">{historico}</div> : null}
      </div>
    );
  }

  return (
    <Fragment>
      <tr
        className={`cursor-pointer hover:bg-slate-50/80 ${expanded ? "bg-slate-50/60" : ""}`}
        {...rowInteractionProps}
      >
        <td className="border-b border-slate-100 px-2 py-2">
          {solicitanteHeader}
        </td>
        <td className="border-b border-slate-100 px-2 py-2 text-right tabular-nums">
          {formatCota(item.consumo_os)}
          {item.limite_os != null ? (
            <span className="text-neutral-400">
              {" "}
              / {formatCota(item.limite_os)}
            </span>
          ) : null}
        </td>
        <td
          className={`border-b border-slate-100 px-2 py-2 text-right tabular-nums ${saldoClassName(item.saldo_os)}`}
        >
          {formatLimiteSaldo(item.saldo_os)}
        </td>
        <td className="border-b border-slate-100 px-2 py-2 text-right tabular-nums">
          {formatCota(item.consumo_sp)}
          {item.limite_sp != null ? (
            <span className="text-neutral-400">
              {" "}
              / {formatCota(item.limite_sp)}
            </span>
          ) : null}
        </td>
        <td
          className={`border-b border-slate-100 px-2 py-2 text-right tabular-nums ${saldoClassName(item.saldo_sp)}`}
        >
          {formatLimiteSaldo(item.saldo_sp)}
        </td>
      </tr>

      {expanded && clienteKey ? (
        <tr className="bg-slate-50/40">
          <td colSpan={5} className="border-b border-slate-200 px-2 py-2">
            {historico}
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
