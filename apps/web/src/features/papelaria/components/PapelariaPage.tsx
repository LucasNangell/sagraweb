import { useState } from "react";
import { cn } from "@sagra/ui";

import { OsHistoryPanel } from "@/features/os/components/OsHistoryPanel";
import type { OsSearchRow } from "@/features/os/types";

import {
  osRowFromPapelariaSession,
  sameOsRow,
} from "../papelariaSelection";
import { setPapelariaNavigationContext } from "../papelariaSession";
import { PapelariaCorelPanel } from "./PapelariaCorelPanel";
import { PapelariaSpList } from "./PapelariaSpList";

type MobilePane = "lista" | "trabalho";

export function PapelariaPage() {
  const [selected, setSelected] = useState<OsSearchRow | null>(() =>
    osRowFromPapelariaSession(),
  );
  const [mobilePane, setMobilePane] = useState<MobilePane>(() =>
    osRowFromPapelariaSession() ? "trabalho" : "lista",
  );

  const osId = selected ? String(selected.nr_os) : null;
  const osAno = selected ? String(selected.ano) : null;
  const osPanelKey = `${osAno ?? ""}-${osId ?? ""}`;

  const handleSelect = (row: OsSearchRow) => {
    setPapelariaNavigationContext({
      nr_os: row.nr_os,
      ano: row.ano,
      produto: row.produto,
    });
    setSelected(row);
    setMobilePane("trabalho");
  };

  /** Quando a lista traz a linha completa, sincroniza metadados da seleção stub. */
  const handleSelectFromList = (row: OsSearchRow) => {
    if (sameOsRow(selected, row) && selected) {
      setSelected({ ...selected, ...row });
      return;
    }
    handleSelect(row);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto md:h-full md:overflow-hidden">
      <div
        className="flex shrink-0 gap-1 rounded-lg border border-sagra-border bg-white p-1 shadow-sm md:hidden"
        role="tablist"
        aria-label="Painéis da papelaria"
      >
        {(
          [
            ["lista", "Lista de SPs"],
            ["trabalho", "Formulário / Prova"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mobilePane === id}
            onClick={() => setMobilePane(id)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-[0.7rem] font-semibold transition-colors",
              mobilePane === id
                ? "bg-secondary-blue text-white"
                : "text-neutral-600 hover:bg-slate-50",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row md:overflow-hidden">
        <div
          className={cn(
            "flex min-h-[min(55vh,560px)] w-full min-w-0 flex-col gap-2 md:min-h-0 md:w-[340px] md:shrink-0 lg:w-[400px]",
            mobilePane !== "lista" && "max-md:hidden",
          )}
        >
          <PapelariaSpList
            selected={selected}
            onSelect={handleSelectFromList}
            className="min-h-[200px] flex-1 md:min-h-0"
          />
          <section className="flex min-h-[260px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-sagra-border border-t-4 border-t-secondary-blue bg-white shadow-sm md:min-h-[280px]">
            <OsHistoryPanel
              key={
                selected
                  ? `history-${selected.ano}-${selected.nr_os}`
                  : "history-none"
              }
              selected={selected}
              embedded
              listLayout="compact"
            />
          </section>
        </div>
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            mobilePane !== "trabalho" && "max-md:hidden",
          )}
        >
          <PapelariaCorelPanel
            key={osPanelKey}
            osId={osId}
            osAno={osAno}
          />
        </div>
      </div>
    </div>
  );
}
