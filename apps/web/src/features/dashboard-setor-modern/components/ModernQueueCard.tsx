import { Layers2, UserRound } from "lucide-react";
import type { CSSProperties } from "react";

import type { DashboardOsItem } from "@/features/dashboard-setor/types";
import { formatQueueDisplayLabel } from "@/features/dashboard-setor/utils";

import { AndamentoTimer } from "./AndamentoTimer";

export function ModernQueueCard({
  item,
  index,
  showTime = true,
}: {
  item: DashboardOsItem;
  index: number;
  showTime?: boolean;
}) {
  const registeredBy = item.andamento_usuario?.trim();
  const priority =
    item.priorityType === "priority-high"
      ? "Prometido"
      : item.priorityType === "priority-medium"
        ? "Solicitado"
        : null;
  return (
    <article
      className={`setor-modern-card ${item.isNew ? "is-new" : ""} ${item.priorityType ?? ""}`}
      data-card-key={item.uniqueKey}
      style={{ "--card-index": Math.min(index, 7) } as CSSProperties}
      aria-label={`${formatQueueDisplayLabel(item)} · ${item.displaySituacao}${priority ? ` · ${priority}` : ""}`}
    >
      <div className="setor-modern-card-top">
        <h3>{formatQueueDisplayLabel(item)}</h3>
      </div>
      <div className="setor-modern-situation" title={item.displaySituacao}>
        {item.row_kind === "sub_os" && (
          <Layers2 size={13} aria-label="Sub OS" />
        )}
        <span>{item.displaySituacao || "Sem situação informada"}</span>
      </div>
      {(registeredBy || showTime) && (
        <div className="setor-modern-card-meta">
          {registeredBy && (
            <p
              className="setor-modern-card-author"
              title={`Andamento registrado por ${registeredBy}`}
            >
              <UserRound aria-hidden="true" />
              <span>{registeredBy}</span>
            </p>
          )}
          {showTime && (
            <AndamentoTimer
              since={item.last_update}
              observation={item.observacao}
            />
          )}
        </div>
      )}
    </article>
  );
}
