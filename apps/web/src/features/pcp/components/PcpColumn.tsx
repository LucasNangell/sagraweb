import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@sagra/ui";
import { RefreshCw } from "lucide-react";
import { useMemo } from "react";

import type { PcpQueueItem } from "@/api/pcp";
import { usePcpReorderMutation } from "@/api/hooks/usePcpQueue";
import { filterPcpQueue, pcpItemKey } from "../pcpUtils";
import { PcpOsCard } from "./PcpOsCard";

interface PcpColumnProps {
  setor: string;
  items: PcpQueueItem[];
  filters: Record<string, string[]>;
  nowMs: number;
  onRefresh: () => void;
  isLoading?: boolean;
}

export function PcpColumn({
  setor,
  items,
  filters,
  nowMs,
  onRefresh,
  isLoading,
}: PcpColumnProps) {
  const reorderMutation = usePcpReorderMutation();
  const isSaving = reorderMutation.isPending;

  const visible = useMemo(
    () => filterPcpQueue(items, setor, filters),
    [items, setor, filters],
  );

  const visibleIds = useMemo(() => visible.map(pcpItemKey), [visible]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = visibleIds.indexOf(String(active.id));
    const newIndex = visibleIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const reorderedVisible = arrayMove(visible, oldIndex, newIndex);
    const visibleKeys = new Set(reorderedVisible.map(pcpItemKey));
    const queueFromVisible = [...reorderedVisible];
    const rebuilt = items.map((item) => {
      const key = pcpItemKey(item);
      if (visibleKeys.has(key)) {
        return queueFromVisible.shift()!;
      }
      return item;
    });

    reorderMutation.mutate({
      setor,
      items: rebuilt.map((it) => ({ nr_os: it.nr_os, ano: it.ano })),
    });
  };

  const hasFilter = (filters[setor]?.length ?? 0) > 0;

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl border border-sagra-border bg-slate-50/80 shadow-sm md:w-80">
      <div className="flex items-center justify-between gap-2 border-b border-sagra-border px-3 py-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-primary-green">
            Setor
          </span>
          <h2 className="text-base font-semibold text-secondary-blue">{setor}</h2>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span>{visible.length} na fila</span>
            {hasFilter && (
              <span className="rounded bg-amber-100 px-1.5 text-amber-800">
                Filtro ativo
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="rounded border border-sagra-border p-2 hover:bg-white disabled:opacity-50"
          title="Atualizar setor"
        >
          <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
        </button>
      </div>

      {isSaving && (
        <p className="border-b border-sagra-border bg-amber-50 px-3 py-1 text-xs text-amber-800">
          Salvando ordem…
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
          <div className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-3">
            {visible.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-400">
                Nenhuma OS no setor
              </p>
            ) : (
              visible.map((item) => (
                <PcpOsCard key={pcpItemKey(item)} item={item} nowMs={nowMs} />
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
