import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@sagra/ui";
import { GripVertical } from "lucide-react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

type OsSortableHistoryRowProps = {
  id: string;
  disabled: boolean;
  selected: boolean;
  showDragHandle: boolean;
  compactList: boolean;
  onRowClick: (event: MouseEvent<HTMLTableRowElement>) => void;
  situacao: string;
  setor: string;
  dataCell: ReactNode;
  testId: string;
};

export function OsSortableHistoryRow({
  id,
  disabled,
  selected,
  showDragHandle,
  compactList,
  onRowClick,
  situacao,
  setor,
  dataCell,
  testId,
}: OsSortableHistoryRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      data-testid={testId}
      onClick={onRowClick}
      className={cn(
        "border-b border-sagra-border/50",
        disabled ? "cursor-default" : "cursor-pointer hover:bg-slate-50",
        showDragHandle && !disabled && "cursor-grab active:cursor-grabbing",
        selected && "bg-[var(--highlight-yellow)]",
        isDragging && "relative z-20 bg-white opacity-95 shadow-md",
      )}
    >
      <td className="min-w-0 overflow-hidden px-2 py-1">
        <div className="flex min-w-0 items-center gap-1">
          {showDragHandle ? (
            <button
              type="button"
              className="shrink-0 cursor-grab touch-none text-neutral-400 hover:text-neutral-600 active:cursor-grabbing"
              aria-label="Arrastar andamento"
              onClick={(event) => event.stopPropagation()}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-3.5" aria-hidden />
            </button>
          ) : null}
          <span className="block min-w-0 flex-1 truncate" title={situacao || undefined}>
            {situacao || "-"}
          </span>
        </div>
      </td>
      <td
        className="overflow-hidden px-1.5 py-1"
        style={{ width: compactList ? "5.5rem" : "6.5rem" }}
      >
        <span className="block truncate" title={setor || undefined}>
          {setor || "-"}
        </span>
      </td>
      {!compactList ? dataCell : null}
    </tr>
  );
}
