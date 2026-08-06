import type { DashboardOsItem } from "./types";
import { formatQueueDisplayLabel } from "./utils";

interface OsCardProps {
  item: DashboardOsItem;
  onSelect: (item: DashboardOsItem) => void;
}

export function OsCard({ item, onSelect }: OsCardProps) {
  const classes = [
    "os-card",
    item.isNew ? "os-card--new" : "",
    item.priorityType === "priority-high" ? "os-card--high" : "",
    item.priorityType === "priority-medium" ? "os-card--medium" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} onClick={() => onSelect(item)}>
      <div className="os-card-top">
        <span className="os-card-number">{formatQueueDisplayLabel(item)}</span>
        {item.priorityType ? (
          <span className={`os-card-prio os-card-prio--${item.priorityType}`}>
            {item.priorityType === "priority-high" ? "Prometido" : "Solicitado"}
          </span>
        ) : null}
      </div>
      <div className="os-card-title">{item.titulo || "—"}</div>
      <div className="os-card-situacao">{item.displaySituacao}</div>
    </button>
  );
}
