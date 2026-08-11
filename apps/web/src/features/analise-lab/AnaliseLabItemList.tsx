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
import { cn } from "@sagra/ui";
import {
  ChevronDown,
  Copy,
  ExternalLink,
  FolderOpen,
  GripVertical,
  Layers,
  Lock,
  LockOpen,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AnaliseLabItem } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";
import {
  itemMatchesVersion,
  resolveItemVersion,
} from "@/features/analise/analiseItemsTree";
import type { OsVersionItem } from "@/features/analise/types";
import type { VersionPdfFile } from "@/features/analise/versionPdfClassify";
import { openPathLocally } from "@/lib/sagraLocalOpener";

import { markScopeLabel } from "./analiseLabPageSpec";
import {
  allLabTreeNodeKeys,
  buildLabItemsTree,
  canDropLabItem,
  labComponentCollapseKey,
  labComponentDropId,
  labItemDragId,
  type LabVersionPdfPerFile,
  parseLabComponentDropId,
  parseLabItemDragId,
  reorderIdsAfterDrop,
} from "./analiseLabItemsTree";

interface AnaliseLabItemListProps {
  items: AnaliseLabItem[];
  currentVersaoLabel?: string;
  versions?: OsVersionItem[];
  versionPdfPerFile?: LabVersionPdfPerFile;
  produto?: string | null;
  capaMioloChoiceByVersion?: Record<string, boolean>;
  pages?: ProvaWebPageMeta[];
  modo?: string;
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
  versions = [],
  versionPdfPerFile,
  produto,
  capaMioloChoiceByVersion,
  pages = [],
  modo = "capa_miolo",
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
    () =>
      buildLabItemsTree(
        items,
        currentVersaoLabel,
        versions,
        versionPdfPerFile,
        produto,
        capaMioloChoiceByVersion,
        pages,
        modo,
      ),
    [
      capaMioloChoiceByVersion,
      currentVersaoLabel,
      items,
      modo,
      pages,
      produto,
      versionPdfPerFile,
      versions,
    ],
  );

  const versionSig = versions.map((v) => `${v.version}:${v.label}`).join("|");
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (tree.length === 0) return;
    setCollapsedNodes(allLabTreeNodeKeys(tree));
    // Seed somente quando a lista de pastas Original muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- versionSig
  }, [versionSig]);

  useEffect(() => {
    if (!currentVersaoLabel || tree.length === 0) return;
    const matched =
      resolveItemVersion(currentVersaoLabel, versions) ??
      versions.find((v) => itemMatchesVersion(currentVersaoLabel, v)) ??
      null;
    const activeKey = matched
      ? `v${matched.version}`
      : (tree.find((v) => !v.readonly)?.key ?? null);
    if (!activeKey) return;
    setCollapsedNodes((prev) => {
      if (!prev.has(activeKey)) return prev;
      const next = new Set(prev);
      next.delete(activeKey);
      return next;
    });
  }, [currentVersaoLabel, versionSig, versions, tree]);

  const toggleNode = (nodeKey: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
  };

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
        const host = tree
          .flatMap((v) =>
            v.components.map((c) => ({
              versaoLabel: v.label,
              componente: c.label,
              items: c.items,
            })),
          )
          .find((c) => c.items.some((i) => i.id === parsedItem));
        if (!host) return;
        targetVersao = host.versaoLabel;
        targetComponente = host.componente;
        overItemId = parsedItem;
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
    const componentIds =
      tree
        .find((v) => v.label === targetVersao)
        ?.components.find((c) => c.label === targetComponente)
        ?.items.map((i) => i.id) ?? [];

    const nextLocal = reorderIdsAfterDrop({
      componentItemIds: componentIds,
      draggedId: source.itemId,
      overItemId,
      targetIsComponent,
    });

    const otherIds = items
      .filter((i) => !componentIds.includes(i.id))
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.id - b.id)
      .map((i) => i.id);
    onReorder([...otherIds, ...nextLocal]);
  };

  const empty = tree.length === 0 && items.length === 0;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto text-xs">
        {tree.map((versao) => {
          const versionCollapsed = collapsedNodes.has(versao.key);
          return (
            <div key={versao.key}>
              <button
                type="button"
                onClick={() => toggleNode(versao.key)}
                className="flex w-full items-center justify-between border-l-4 border-secondary-blue bg-slate-100 px-2 py-1.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-200/80"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Layers
                    className="size-3.5 shrink-0 text-secondary-blue"
                    aria-hidden
                  />
                  <span className="truncate">
                    {versao.label}
                    {versao.readonly ? " · leitura" : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {versao.readonly && onReplicateVersion ? (
                    <span
                      role="button"
                      tabIndex={0}
                      className="inline-flex items-center gap-0.5 rounded bg-secondary-blue/10 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-secondary-blue hover:bg-secondary-blue/20"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!busy) onReplicateVersion(versao.label);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          e.preventDefault();
                          if (!busy) onReplicateVersion(versao.label);
                        }
                      }}
                      title="Replicar todos desta versão"
                    >
                      <Copy className="size-3" aria-hidden />
                      Replicar
                    </span>
                  ) : null}
                  <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                    {versao.itemCount} item
                    {versao.itemCount === 1 ? "" : "s"}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform",
                      versionCollapsed && "-rotate-90",
                    )}
                    aria-hidden
                  />
                </span>
              </button>

              {!versionCollapsed
                ? versao.components.map((comp) => {
                    const hasPdf =
                      Boolean(comp.versionFile) ||
                      Boolean(comp.versionFiles?.length);
                    if (comp.items.length === 0 && !hasPdf) return null;

                    const componentKey = labComponentCollapseKey(
                      versao.key,
                      comp.key,
                    );
                    const componentCollapsed = collapsedNodes.has(componentKey);

                    return (
                      <div
                        key={comp.key}
                        className="border-l-2 border-slate-200"
                      >
                        <button
                          type="button"
                          onClick={() => toggleNode(componentKey)}
                          className="flex w-full items-center justify-between bg-slate-50 px-2 py-1 pl-4 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-100"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <FolderOpen
                              className="size-3 shrink-0 text-primary-green"
                              aria-hidden
                            />
                            {comp.label}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="text-[10px] font-normal normal-case text-slate-500">
                              {comp.items.length}
                            </span>
                            <ChevronDown
                              className={cn(
                                "size-3.5 transition-transform",
                                componentCollapsed && "-rotate-90",
                              )}
                              aria-hidden
                            />
                          </span>
                        </button>

                        {!componentCollapsed ? (
                          <ComponentDropZone
                            versaoLabel={versao.label}
                            componente={comp.label}
                            readonly={versao.readonly}
                          >
                            {(comp.versionFiles?.length
                              ? comp.versionFiles
                              : comp.versionFile
                                ? [comp.versionFile]
                                : []
                            ).map((file) =>
                              file.ausente ? (
                                <VersionPdfAbsentRow
                                  key={`${comp.key}-absent-${file.componente}`}
                                  componente={file.componente}
                                />
                              ) : (
                                <VersionPdfOpenRow
                                  key={`${comp.key}-open-${file.path || file.name}`}
                                  file={file}
                                />
                              ),
                            )}
                            <ul className="space-y-0.5 px-1 pb-1">
                              {comp.items.map((item) => (
                                <ItemRow
                                  key={`${item.id}::${comp.label}`}
                                  item={item}
                                  versaoLabel={versao.label}
                                  listComponente={comp.label}
                                  readonly={versao.readonly}
                                  selected={selectedId === item.id}
                                  busy={busy}
                                  onSelect={() => onSelect(item.id)}
                                  onDelete={
                                    onDelete && !versao.readonly
                                      ? () => {
                                          if (
                                            window.confirm(
                                              "Excluir este problema técnico e todas as marcas vinculadas?",
                                            )
                                          ) {
                                            onDelete(item.id);
                                          }
                                        }
                                      : undefined
                                  }
                                  onToggleResolucao={
                                    onToggleResolucao && !versao.readonly
                                      ? (next) =>
                                          onToggleResolucao(item.id, next)
                                      : undefined
                                  }
                                  onToggleCorrigido={
                                    onToggleCorrigido && !versao.readonly
                                      ? (next) =>
                                          onToggleCorrigido(item.id, next)
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
                        ) : null}
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
        {empty ? (
          <p className="p-3 text-center text-neutral-400">
            Nenhum problema registrado.
          </p>
        ) : null}
      </div>
    </DndContext>
  );
}

function VersionPdfAbsentRow({ componente }: { componente: string }) {
  return (
    <div className="mb-0.5 border-b border-slate-100 bg-amber-50/40 py-1 pl-4 pr-1">
      <span
        className="text-[11px] italic text-amber-900/90"
        title={`Arquivo de ${componente} não encontrado`}
      >
        (ausente)
      </span>
    </div>
  );
}

function VersionPdfOpenRow({ file }: { file: VersionPdfFile }) {
  const handleOpen = async () => {
    const ok = await openPathLocally(file.path, "file");
    if (!ok) {
      window.alert(
        `Não foi possível abrir o arquivo localmente.\n\nVerifique se o serviço SAGRA Folder Opener está em execução.\n\n${file.name}`,
      );
    }
  };

  return (
    <div className="mb-0.5 border-b border-slate-100 bg-white py-1 pl-4 pr-1">
      <button
        type="button"
        onClick={() => void handleOpen()}
        title={file.name}
        className="inline-flex max-w-full items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-secondary-blue hover:bg-blue-50"
      >
        <ExternalLink className="size-3 shrink-0" aria-hidden />
        <span className="truncate">Abrir arquivo</span>
        <span className="tabular-nums text-slate-500">({file.pages} pág.)</span>
      </button>
    </div>
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
          ? "rounded border border-dashed border-primary-green bg-primary-green/5"
          : undefined
      }
    >
      {children}
    </div>
  );
}

function ItemRow({
  item,
  versaoLabel,
  listComponente,
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
  listComponente: string;
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
      id: labItemDragId(item.id, listComponente),
      data: {
        itemId: item.id,
        componente: listComponente,
        versaoLabel,
        readonly,
      },
      disabled: readonly || busy,
    });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `lab-over-item:${item.id}::${listComponente}`,
    data: {
      kind: "item",
      itemId: item.id,
      componente: listComponente,
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
