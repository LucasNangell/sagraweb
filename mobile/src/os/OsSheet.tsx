import { X } from "lucide-react";
import { useState } from "react";

import type { DashboardOsItem } from "@/board/types";
import { formatQueueDisplayLabel } from "@/board/utils";
import { useBreakpoint } from "@/lib/useBreakpoint";

import { AndamentoForm } from "./AndamentoForm";
import { OsSummary } from "./OsSummary";

interface OsSheetProps {
  item: DashboardOsItem;
  panelSector: string;
  onClose: () => void;
  onAndamentoSaved: () => void;
}

type Tab = "resumo" | "andamento";

export function OsSheet({
  item,
  panelSector,
  onClose,
  onAndamentoSaved,
}: OsSheetProps) {
  const bp = useBreakpoint();
  const [tab, setTab] = useState<Tab>("andamento");

  return (
    <div className="os-sheet-backdrop" role="dialog" aria-modal="true">
      <div className={bp === "phone" ? "os-sheet os-sheet--phone" : "os-sheet"}>
        <header className="os-sheet-header">
          <div>
            <h1>{formatQueueDisplayLabel(item)}</h1>
            <p>{item.displaySituacao}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={22} />
          </button>
        </header>

        {bp === "phone" ? (
          <>
            <div className="os-sheet-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                className={tab === "resumo" ? "tab tab--active" : "tab"}
                onClick={() => setTab("resumo")}
              >
                Resumo
              </button>
              <button
                type="button"
                role="tab"
                className={tab === "andamento" ? "tab tab--active" : "tab"}
                onClick={() => setTab("andamento")}
              >
                Lançar andamento
              </button>
            </div>
            <div className="os-sheet-body">
              {tab === "resumo" ? (
                <OsSummary item={item} />
              ) : (
                <AndamentoForm
                  item={item}
                  panelSector={panelSector}
                  onSaved={onAndamentoSaved}
                />
              )}
            </div>
          </>
        ) : (
          <div className="os-sheet-split">
            <OsSummary item={item} />
            <AndamentoForm
              item={item}
              panelSector={panelSector}
              onSaved={onAndamentoSaved}
            />
          </div>
        )}
      </div>
    </div>
  );
}
