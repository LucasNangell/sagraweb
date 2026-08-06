import type { DashboardDisplayColumn, DashboardOsItem } from "./types";
import { OsCard } from "./OsCard";

interface KanbanBoardProps {
  columns: DashboardDisplayColumn[];
  onSelect: (item: DashboardOsItem) => void;
}

export function KanbanBoard({ columns, onSelect }: KanbanBoardProps) {
  return (
    <div className="kanban-board" data-columns={String(columns.length)}>
      {columns.map((col) => (
        <section key={col.id} className="kanban-column">
          <header className="kanban-column-header">
            <h2>{col.title}</h2>
            <span>{col.items.length}</span>
          </header>
          <div className="kanban-column-body">
            {col.items.map((item) => (
              <OsCard key={item.uniqueKey} item={item} onSelect={onSelect} />
            ))}
            {col.items.length === 0 ? (
              <div className="kanban-empty">Nenhuma OP</div>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
