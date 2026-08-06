import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CotasGrafSolicitanteCotasItem } from "@/api/cotasGraf";
import { useMatchMedia } from "@/hooks/useMatchMedia";

import { COTAS_GRAF_MOBILE_PAGE_SIZE } from "../types";
import { CotasGrafListPagination } from "./CotasGrafListPagination";
import { CotasGrafSolicitanteRow } from "./CotasGrafSolicitanteRow";

export function CotasGrafSolicitantesPanel({
  items,
  total,
  semestreAno,
  semestreNumero,
  isLoading,
  isError,
  textBelowMinLength,
  textMinLengthHint,
  filteredBySolicitante,
  onClearSolicitanteFilter,
}: {
  items: CotasGrafSolicitanteCotasItem[];
  total: number;
  semestreAno?: number | null;
  semestreNumero?: number | null;
  isLoading: boolean;
  isError: boolean;
  textBelowMinLength: boolean;
  textMinLengthHint?: string | null;
  filteredBySolicitante?: string | null;
  onClearSolicitanteFilter?: () => void;
}) {
  const isMobile = useMatchMedia("(max-width: 767px)");
  const [mobilePage, setMobilePage] = useState(1);
  const panelRef = useRef<HTMLDivElement>(null);

  const semestreLabel =
    semestreAno != null && semestreNumero != null
      ? `${semestreAno}/${semestreNumero}º sem.`
      : null;

  useEffect(() => {
    setMobilePage(1);
  }, [items, filteredBySolicitante, isMobile]);

  const displayedItems = useMemo(() => {
    if (!isMobile) {
      return items;
    }
    const start = (mobilePage - 1) * COTAS_GRAF_MOBILE_PAGE_SIZE;
    return items.slice(start, start + COTAS_GRAF_MOBILE_PAGE_SIZE);
  }, [isMobile, items, mobilePage]);

  const mobileTotalPages = Math.max(
    1,
    Math.ceil(total / COTAS_GRAF_MOBILE_PAGE_SIZE),
  );

  const handleMobilePageChange = useCallback((page: number) => {
    setMobilePage(page);
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div
      ref={panelRef}
      className="flex min-w-0 flex-col rounded-lg border border-sagra-border bg-white shadow-sm md:min-h-0 md:flex-1"
    >
      <div className="border-b border-slate-200 px-3 py-2.5">
        <h2 className="text-sm font-semibold text-secondary-blue">
          Cotas dos solicitantes
        </h2>
        <p className="text-xs text-neutral-500">
          Consumo e saldo do semestre atual
          {semestreLabel ? ` (${semestreLabel})` : ""}
          {" · "}
          deputados: somente em exercício (API Câmara)
          {" · "}
          clique para ver o histórico
        </p>
        {filteredBySolicitante ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium break-words text-secondary-blue">
              Filtrado: {filteredBySolicitante}
            </span>
            {onClearSolicitanteFilter ? (
              <button
                type="button"
                onClick={onClearSolicitanteFilter}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-neutral-600 hover:bg-slate-50"
              >
                Limpar
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="md:min-h-0 md:flex-1 md:overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-neutral-500">
            <Loader2 className="size-4 animate-spin" />
            Carregando cotas…
          </div>
        ) : textBelowMinLength ? (
          <div className="p-8 text-center text-xs text-amber-700">
            {textMinLengthHint}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-xs text-red-600">
            Não foi possível carregar as cotas dos solicitantes.
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-500">
            Nenhum solicitante encontrado com os filtros atuais.
          </div>
        ) : (
          <>
            <table className="hidden w-full border-collapse text-xs md:table">
              <thead className="sticky top-0 z-[1] bg-slate-50">
                <tr>
                  <th className="border-b border-slate-200 px-2 py-2 text-left font-semibold text-slate-600">
                    Solicitante
                  </th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-semibold text-slate-600">
                    Cons. OS
                  </th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-semibold text-slate-600">
                    Saldo OS
                  </th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-semibold text-slate-600">
                    Cons. SP
                  </th>
                  <th className="border-b border-slate-200 px-2 py-2 text-right font-semibold text-slate-600">
                    Saldo SP
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <CotasGrafSolicitanteRow
                    key={rowKey(item)}
                    item={item}
                    layout="table"
                    defaultExpanded={
                      filteredBySolicitante != null &&
                      item.solicitante === filteredBySolicitante
                    }
                  />
                ))}
              </tbody>
            </table>

            <div className="divide-y divide-slate-100 md:hidden">
              {displayedItems.map((item) => (
                <CotasGrafSolicitanteRow
                  key={rowKey(item)}
                  item={item}
                  layout="card"
                  defaultExpanded={
                    filteredBySolicitante != null &&
                    item.solicitante === filteredBySolicitante
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>

      {!isLoading && !isError && !textBelowMinLength ? (
        isMobile ? (
          <CotasGrafListPagination
            page={mobilePage}
            totalPages={mobileTotalPages}
            total={total}
            pageSize={COTAS_GRAF_MOBILE_PAGE_SIZE}
            onPageChange={handleMobilePageChange}
            itemLabel="solicitante"
          />
        ) : (
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-neutral-500">
            {items.length} de {total} solicitante{total !== 1 ? "s" : ""}
          </p>
        )
      ) : null}
    </div>
  );
}

function rowKey(item: CotasGrafSolicitanteCotasItem): string {
  return `${item.cod_usuario ?? ""}|${item.categoria ?? ""}|${item.nome_usuario ?? ""}`;
}
