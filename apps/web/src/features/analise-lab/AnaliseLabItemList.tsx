import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  Copy,
  GripVertical,
  Lock,
  LockOpen,
  Trash2,
  Wrench,
} from "lucide-react";
import { useMemo } from "react";

import type { AnaliseLabItem } from "@/api/analiseLab";
import { markScopeLabel } from "./analiseLabPageSpec";
import {
  buildLabItemsTree,
  canDropLabItem,
  labComponentDropId,
  labItemDragId,
  parseLabComponentDropId,
  parseLabItemDragId,
  reorderIdsAfterDrop,
} from "./analiseLabItemsTree";

interface AnaliseLabItemListProps {
  items: AnaliseLabItem[];
  currentVersaoLabel?: string;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete?: (id: number) => void;
  onMoveComponent?: (itemId: number, componente: string) => void;
  onReorder?: (orderedIds: number[]) => void;
  onToggleResolucao?: (itemId: number, next: boolean) => void;
  onToggleCorrigido?: (itemId: number, next: boolean) => void;
  onReplicateItem?: (itemId: number) => void;
  onReplicateVersion?: (versaoLabel: string) => void;
  busy?: boolean;
}

export function AnaliseLabItemList({
  items,
  currentVersaoLabel = "",
  selectedId,
  onSelect,
  onDelete,
  onMoveComponent,
  onReorder,
  onToggleResolucao,
  onToggleCorrigido,
  onReplicateItem,
  onReplicateVersion,
  busy,
}: AnaliseLabItemListProps) {
  const tree = useMemo(
    () => buildLabItemsTree(items, currentVersaoLabel),
    [currentVersaoLabel, items],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (busy || (!onMoveComponent && !onReorder)) return;
    const { active, over } = event;
    if (!over) return;

    const source = active.data.current as
      | {
          itemId: number;
          componente: string;
          versaoLabel: string;
          readonly?: boolean;
        }
      | undefined;
    if (!source?.itemId || source.readonly) return;

    const overData = over.data.current as
      | {
          kind: "component" | "item";
          componente: string;
          versaoLabel: string;
          itemId?: number;
          readonly?: boolean;
        }
      | undefined;

    let targetVersao = overData?.versaoLabel;
    let targetComponente = overData?.componente;
    let overItemId: number | null = overData?.itemId ?? null;
    let targetIsComponent = overData?.kind === "component";

    if (!targetVersao || !targetComponente) {
      const parsedComp = parseLabComponentDropId(String(over.id));
      const parsedItem = parseLabItemDragId(String(over.id));
      if (parsedComp) {
        targetVersao = parsedComp.versaoLabel;
        targetComponente = parsedComp.componente;
        targetIsComponent = true;
      } else if (parsedItem != null) {
        const overItem = items.find((i) => i.id === parsedItem);
        if (!overItem) return;
        targetVersao = overItem.versaoLabel || "(sem versão)";
        targetComponente = overItem.componente || "Outros";
        overItemId = overItem.id;
        targetIsComponent = false;
      } else {
        return;
      }
    }

    if (
      !canDropLabItem({
        sourceVersao: source.versaoLabel,
        sourceComponente: source.componente,
        targetVersao,
        targetComponente,
        readonlySource: source.readonly,
        readonlyTarget: overData?.readonly,
      })
    ) {
      return;
    }

    if (source.componente !== targetComponente) {
      onMoveComponent?.(source.itemId, targetComponente);
      return;
    }

    if (!onReorder) return;
    const componentIds = items
      .filter(
        (i) =>
          (i.versaoLabel || "(sem versão)") === targetVersao &&
          (i.componente || "Outros") === targetComponente,
      )
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.id - b.id)
      .map((i) => i.id);

    const nextLocal = reorderIdsAfterDrop({
      componentItemIds: componentIds,
      draggedId: source.itemId,
      overItemId,
      targetIsComponent,
    });

    // Build global order: keep other items, replace this component block.
    const otherIds = items
      .filter((i) => !componentIds.includes(i.id))
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.id - b.id)
      .map((i) => i.id);
    onReorder([...otherIds, ...nextLocal]);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto text-xs">
        {tree.map((versao) => (
          <div key={versao.key}>
            <div className="mb-0.5 flex items-center gap-1 font-semibold uppercase tracking-wide text-neutral-500">
              <span className="min-w-0 flex-1 truncate">
                {versao.label}
                {versao.readonly ? " · leitura" : ""}
              </span>
              {versao.readonly && onReplicateVersion ? (
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded bg-secondary-blue/10 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-secondary-blue hover:bg-secondary-blue/20 disabled:opacity-50"
                  onClick={() => onReplicateVersion(versao.label)}
                  title="Replicar todos desta versão"
                >
                  <Copy className="size-3" aria-hidden />
                  Replicar todos
                </button>
              ) : null}
            </div>
            {versao.components.map((comp) => (
              <ComponentDropZone
                key={comp.key}
                versaoLabel={versao.label}
                componente={comp.label}
                readonly={versao.readonly}
              >
                <div className="text-[11px] font-medium text-neutral-600">
                  {comp.label}
                </div>
                <ul className="space-y-0.5">
                  {comp.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      versaoLabel={versao.label}
                      readonly={versao.readonly}
                      selected={selectedId === item.id}
                      busy={busy}
                      onSelect={() => onSelect(item.id)}
                      onDelete={
                        onDelete && !versao.readonly
                          ? () => onDelete(item.id)
                          : undefined
                      }
                      onToggleResolucao={
                        onToggleResolucao && !versao.readonly
                          ? (next) => onToggleResolucao(item.id, next)
                          : undefined
                      }
                      onToggleCorrigido={
                        onToggleCorrigido && !versao.readonly
                          ? (next) => onToggleCorrigido(item.id, next)
                          : undefined
                      }
                      onReplicate={
                        versao.readonly && onReplicateItem
                          ? () => onReplicateItem(item.id)
                          : undefined
                      }
                    />
                  ))}
                </ul>
              </ComponentDropZone>
            ))}
          </div>
        ))}
        {!items.length ? (
          <p className="text-neutral-400">Nenhum problema registrado.</p>
        ) : null}
      </div>
    </DndContext>
  );
}

function ComponentDropZone({
  versaoLabel,
  componente,
  readonly,
  children,
}: {
  versaoLabel: string;
  componente: string;
  readonly: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: labComponentDropId(versaoLabel, componente),
    data: {
      kind: "component",
      versaoLabel,
      componente,
      readonly,
    },
    disabled: readonly,
  });
  return (
    <div
      ref={setNodeRef}
      className={
        isOver
          ? "mb-1 rounded border border-dashed border-primary-green bg-primary-green/5 pl-1"
          : "mb-1 pl-1"
      }
    >
      {children}
    </div>
  );
}

function ItemRow({
  item,
  versaoLabel,
  readonly,
  selected,
  busy,
  onSelect,
  onDelete,
  onToggleResolucao,
  onToggleCorrigido,
  onReplicate,
}: {
  item: AnaliseLabItem;
  versaoLabel: string;
  readonly: boolean;
  selected: boolean;
  busy?: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onToggleResolucao?: (next: boolean) => void;
  onToggleCorrigido?: (next: boolean) => void;
  onReplicate?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: labItemDragId(item.id),
      data: {
        itemId: item.id,
        componente: item.componente || "Outros",
        versaoLabel,
        readonly,
      },
      disabled: readonly || busy,
    });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `lab-over-item:${item.id}`,
    data: {
      kind: "item",
      itemId: item.id,
      componente: item.componente || "Outros",
      versaoLabel,
      readonly,
    },
    disabled: readonly || busy,
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        setDropRef(node);
      }}
      style={style}
      className={
        selected
          ? "flex items-center gap-1 rounded border border-primary-green bg-primary-green/5 px-1 py-0.5"
          : isOver
            ? "flex items-center gap-1 rounded border border-dashed border-secondary-blue px-1 py-0.5"
            : isDragging
              ? "flex items-center gap-1 rounded border border-transparent bg-white px-1 py-0.5 opacity-60 shadow"
              : "flex items-center gap-1 rounded border border-transparent px-1 py-0.5 hover:bg-neutral-50"
      }
    >
      {!readonly ? (
        <button
          type="button"
          className="shrink-0 cursor-grab text-neutral-400 active:cursor-grabbing"
          title="Arrastar"
          {...listeners}
          {...attributes}
        >
          <GripVertical className="size-3" aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left"
        onClick={onSelect}
      >
        {item.titulo}
        {item.corrigidoSefoc ? (
          <span className="ml-1 rounded bg-emerald-600 px-1 py-px text-[9px] font-bold uppercase text-white">
            Corrigido
          </span>
        ) : null}
        {item.resolucaoObrigatoria ? (
          <span className="ml-1 rounded bg-amber-400 px-1 py-px text-[9px] font-bold uppercase text-black">
            Obrigatória
          </span>
        ) : null}
        <span className="ml-1 text-neutral-400">
          · {markScopeLabel(item)}
        </span>
      </button>
      {onToggleResolucao ? (
        <button
          type="button"
          disabled={busy}
          className="shrink-0 text-amber-700"
          title={
            item.resolucaoObrigatoria
              ? "Desmarcar resolução obrigatória"
              : "Marcar resolução obrigatória"
          }
          onClick={() => onToggleResolucao(!item.resolucaoObrigatoria)}
        >
          {item.resolucaoObrigatoria ? (
            <Lock className="size-3" aria-hidden />
          ) : (
            <LockOpen className="size-3" aria-hidden />
          )}
        </button>
      ) : null}
      {onToggleCorrigido ? (
        <button
          type="button"
          disabled={busy}
          className={
            item.corrigidoSefoc
              ? "shrink-0 text-emerald-700"
              : "shrink-0 text-neutral-500"
          }
          title={item.corrigidoSefoc ? "Desmarcar corrigido" : "Marcar corrigido"}
          onClick={() => onToggleCorrigido(!item.corrigidoSefoc)}
        >
          <Wrench className="size-3" aria-hidden />
        </button>
      ) : null}
      {onReplicate ? (
        <button
          type="button"
          disabled={busy}
          className="shrink-0 text-secondary-blue"
          title="Replicar para versão atual"
          onClick={onReplicate}
        >
          <Copy className="size-3" aria-hidden />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          disabled={busy}
          className="shrink-0 text-sagra-danger"
          onClick={onDelete}
          title="Excluir"
        >
          <Trash2 className="size-3" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}
