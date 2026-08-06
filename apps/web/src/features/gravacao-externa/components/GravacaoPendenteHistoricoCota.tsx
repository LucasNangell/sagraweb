import { useState } from "react";

import { cn } from "@sagra/ui";

import type { GravacaoPendenteMaquinaCotaItem } from "@/api/gravacaoPendente";

import { GravacaoPendenteDetalhesModal } from "./GravacaoPendenteDetalhesModal";

/** Komori e SM74 compartilham a mesma cota no banner de restantes. */
const KPI_GROUPS = [
  { label: "Komori / SM74", maquinas: ["Komori", "SM74"] as const },
  { label: "PM52", maquinas: ["PM52"] as const },
] as const;

interface GravacaoPendenteHistoricoCotaProps {
  maquinas?: GravacaoPendenteMaquinaCotaItem[];
  totalGravadas: number;
  restantes: number;
  loading?: boolean;
}

function valueForMachine(
  maquinas: GravacaoPendenteMaquinaCotaItem[] | undefined,
  nome: string,
): number {
  const found = maquinas?.find(
    (m) => m.maquina.toLowerCase() === nome.toLowerCase(),
  );
  return found?.chapas_restantes ?? 0;
}

function restantesForGroup(
  maquinas: GravacaoPendenteMaquinaCotaItem[] | undefined,
  nomes: readonly string[],
): number {
  // Pool compartilhado: (Σ cotas) − (Σ gravadas) ≡ Σ restantes por máquina.
  return nomes.reduce((acc, nome) => acc + valueForMachine(maquinas, nome), 0);
}

export function GravacaoPendenteHistoricoCota({
  maquinas,
  totalGravadas,
  restantes,
  loading = false,
}: GravacaoPendenteHistoricoCotaProps) {
  const [detalhesOpen, setDetalhesOpen] = useState(false);

  return (
    <>
      <div className="space-y-2 border-b border-neutral-100 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Restantes por máquina
          </span>
          <button
            type="button"
            disabled={loading}
            onClick={() => setDetalhesOpen(true)}
            className={cn(
              "rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50",
              loading && "cursor-not-allowed opacity-50",
            )}
          >
            Detalhes
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {KPI_GROUPS.map((g) => {
            const value = restantesForGroup(maquinas, g.maquinas);
            return (
              <div
                key={g.label}
                className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-center"
              >
                <p className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
                  {g.label}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-sm font-semibold tabular-nums",
                    value < 0 ? "text-red-600" : "text-neutral-900",
                  )}
                  aria-label={`Restantes ${g.label}`}
                >
                  {value}
                </p>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          <span className="text-neutral-600">
            Total gravadas:{" "}
            <span
              className="font-semibold tabular-nums text-neutral-900"
              aria-label="Total gravadas"
            >
              {totalGravadas}
            </span>
          </span>
          <span className="text-neutral-600">
            Restantes:{" "}
            <span
              className={cn(
                "font-semibold tabular-nums",
                restantes < 0 ? "text-red-600" : "text-emerald-700",
              )}
              aria-label="Chapas restantes"
            >
              {restantes}
            </span>
          </span>
        </div>
      </div>

      <GravacaoPendenteDetalhesModal
        open={detalhesOpen}
        onClose={() => setDetalhesOpen(false)}
      />
    </>
  );
}
