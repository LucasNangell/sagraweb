import type { DashboardDisplayColumn } from "./types";

interface ColumnTabsProps {
  columns: DashboardDisplayColumn[];
  activeIndex: number;
  onChange: (index: number) => void;
}

export function ColumnTabs({ columns, activeIndex, onChange }: ColumnTabsProps) {
  return (
    <div className="column-tabs" role="tablist">
      {columns.map((col, index) => (
        <button
          key={col.id}
          type="button"
          role="tab"
          aria-selected={index === activeIndex}
          className={
            index === activeIndex ? "column-tab column-tab--active" : "column-tab"
          }
          onClick={() => onChange(index)}
        >
          <span className="column-tab-title">{col.title}</span>
          <span className="column-tab-count">{col.items.length}</span>
        </button>
      ))}
    </div>
  );
}
