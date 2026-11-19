import { useEffect, useState } from "react";
import { cn } from "@sagra/ui";

import { OsFolderBrowserModal } from "@/features/os/components/OsFolderBrowserModal";
import type { OsSearchRow } from "@/features/os/types";

import { sameOsRow } from "../papelariaSelection";
import { setPapelariaNavigationContext } from "../papelariaSession";
import { PapelariaCorelPanel } from "./PapelariaCorelPanel";
import { PapelariaSpList } from "./PapelariaSpList";

type MobilePane = "lista" | "trabalho";

export function PapelariaPage() {
  /** Só preenche o formulário/visualização após clique na lista de SPs. */
  const [selected, setSelected] = useState<OsSearchRow | null>(null);
  const [listExpanded, setListExpanded] = useState(false);
  const [formHost, setFormHost] = useState<HTMLDivElement | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("lista");
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);

  useEffect(() => {
    const onFolder = () => {
      if (!selected) return;
      setFolderBrowserOpen(true);
    };
    window.addEventListener("sagra:os-folder-browser", onFolder);
    return () =>
      window.removeEventListener("sagra:os-folder-browser", onFolder);
  }, [selected]);

  const osId = selected ? String(selected.nr_os) : null;
  const osAno = selected ? String(selected.ano) : null;
  const osPanelKey = `${osAno ?? ""}-${osId ?? ""}`;

  const handleSelect = (row: OsSearchRow) => {
    setPapelariaNavigationContext({
      nr_os: row.nr_os,
      ano: row.ano,
    });
    setSelected(row);
    setMobilePane("trabalho");
  };

  /** Quando a lista traz a linha completa, sincroniza metadados e alterna a expansão. */
  const handleSelectFromList = (row: OsSearchRow) => {
    if (sameOsRow(selected, row) && selected) {
      setSelected({ ...selected, ...row });
      setListExpanded((open) => !open);
      return;
    }
    setListExpanded(true);
    handleSelect(row);
  };

  // Colunas Prova/Imposição da lista vêm só do servidor (compartilhadas entre
  // usuários): jobs, andamento, pasta Sefoc e atividades em andamento.

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
            ["trabalho", "Prévia / Prova"],
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
            "flex min-h-[min(70vh,720px)] w-full min-w-0 flex-col gap-2 md:h-full md:min-h-0 md:w-[696px] md:shrink-0 lg:w-[768px]",
            mobilePane !== "lista" && "max-md:hidden",
          )}
        >
          <PapelariaSpList
            selected={selected}
            expanded={listExpanded}
            onSelect={handleSelectFromList}
            className="min-h-0 flex-1 basis-0"
          />
          <div
            ref={setFormHost}
            className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col"
            data-testid="papelaria-form-host"
          />
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
            formHost={formHost}
            dockForm
          />
        </div>
      </div>

      <OsFolderBrowserModal
        row={selected}
        open={folderBrowserOpen}
        onClose={() => setFolderBrowserOpen(false)}
      />
    </div>
  );
}
