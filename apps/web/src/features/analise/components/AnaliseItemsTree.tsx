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
  ExternalLink,
  FolderOpen,
  GripVertical,
  Layers,
  Lock,
  LockOpen,
  ScanSearch,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  allAnaliseTreeNodeKeys,
  analiseComponentDropId,
  analiseItemDragId,
  buildAnaliseItemsTree,
  normalizeComponenteOrigem,
} from "../analiseItemsTree";
import { openPathLocally } from "@/lib/sagraLocalOpener";
import type { AnaliseComponente, AnaliseSelectedItem, OsVersionItem } from "../types";
import type { VersionPdfFile } from "../versionPdfClassify";

interface AnaliseItemsTreeProps {
  versions: OsVersionItem[];
  items: AnaliseSelectedItem[];
  /** PDFs por versão (chave vN), com caminho completo para abrir localmente. */
  versionPdfPerFile?: Record<string, { name: string; path: string; pages: number }[]>;
  produto?: string | null;
  capaMioloChoiceByVersion?: Record<string, boolean>;
  activeVersaoKey: string;
  selectedItemId: number | null;
  preAnaliseSelected: boolean;
  preAnaliseRunning?: boolean;
  preAnaliseAlertCount?: number;
  onSelectItem: (itemId: number) => void;
  onSelectPreAnalise: () => void;
  onToggleResolucao: (itemId: number, nextValue: boolean) => void;
  onToggleCorrigir?: (itemId: number, nextValue: boolean) => void;
  onCorrecaoObsChange?: (itemId: number, obs: string) => void;
  onDeleteItem: (item: AnaliseSelectedItem) => void;
  onObsChange: (itemId: number, obs: string) => void;
  /** Sincroniza o combo «Componente / Arquivo» ao abrir PDF da versão. */
  onOpenVersionFile?: (componente: AnaliseComponente) => void;
  /** Move item para outro componente (mesma versão). */
  onMoveItemToComponent?: (
    itemId: number,
    targetComponent: string,
    versionKey: string,
  ) => void;
  togglingItemId?: number;
  togglingCorrigirItemId?: number;
  deletingItemId?: number;
  readOnly?: boolean;
}

export function AnaliseItemsTree({
  versions,
  items,
  versionPdfPerFile,
  produto,
  capaMioloChoiceByVersion,
  activeVersaoKey,
  selectedItemId,
  preAnaliseSelected,
  preAnaliseRunning = false,
  preAnaliseAlertCount = 0,
  onSelectItem,
  onSelectPreAnalise,
  onToggleResolucao,
  onToggleCorrigir,
  onCorrecaoObsChange,
  onDeleteItem,
  onObsChange,
  onOpenVersionFile,
  onMoveItemToComponent,
  togglingItemId,
  togglingCorrigirItemId,
  deletingItemId,
  readOnly = false,
}: AnaliseItemsTreeProps) {
  const tree = useMemo(
    () =>
      buildAnaliseItemsTree(
        versions,
        items,
        versionPdfPerFile,
        produto,
        capaMioloChoiceByVersion,
      ),
    [versions, items, versionPdfPerFile, produto, capaMioloChoiceByVersion],
  );

  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (versions.length === 0) return;
    setCollapsedNodes((prev) => (prev.size > 0 ? prev : allAnaliseTreeNodeKeys(versions)));
  }, [versions]);

  useEffect(() => {
    if (!activeVersaoKey || !preAnaliseSelected) return;
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      next.delete(activeVersaoKey);
      return next;
    });
  }, [activeVersaoKey, preAnaliseSelected]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const toggleNode = (nodeKey: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (readOnly || !onMoveItemToComponent) return;
    const { active, over } = event;
    if (!over) return;

    const source = active.data.current as
      | { itemId: number; component: string; versionKey: string }
      | undefined;
    const target = over.data.current as
      | { component: string; versionKey: string }
      | undefined;
    if (!source?.itemId || !target) return;
    if (source.versionKey !== target.versionKey) return;
    if (source.component === target.component) return;

    onMoveItemToComponent(source.itemId, target.component, target.versionKey);
  };

  if (versions.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-slate-500">
        Nenhuma versão Original encontrada para esta OS.
      </p>
    );
  }

  const hasLibraryItems = items.length > 0;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="divide-y divide-slate-100">
      {!hasLibraryItems ? (
        <p className="border-b border-slate-100 bg-amber-50/50 px-3 py-2 text-center text-[11px] text-amber-900">
          Nenhum item da biblioteca — a pré-análise da versão atual permanece disponível
          abaixo.
        </p>
      ) : null}

      {tree.map((versionNode) => {
        const versionCollapsed = collapsedNodes.has(versionNode.key);
        const showPreAnalise =
          Boolean(activeVersaoKey) && versionNode.key === activeVersaoKey;

        return (
          <div key={versionNode.key}>
            <button
              type="button"
              onClick={() => toggleNode(versionNode.key)}
              className="flex w-full items-center justify-between border-l-4 border-secondary-blue bg-slate-100 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-200/80"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Layers className="size-3.5 shrink-0 text-secondary-blue" aria-hidden />
                <span className="truncate">{versionNode.label}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                  {versionNode.itemCount} item{versionNode.itemCount === 1 ? "" : "s"}
                </span>
                <ChevronDown
                  className={cn("size-4 transition-transform", versionCollapsed && "-rotate-90")}
                  aria-hidden
                />
              </span>
            </button>

            {!versionCollapsed ? (
              <>
                {showPreAnalise ? (
                  <PreAnaliseTreeRow
                    selected={preAnaliseSelected}
                    running={preAnaliseRunning}
                    alertCount={preAnaliseAlertCount}
                    onSelect={onSelectPreAnalise}
                  />
                ) : null}

                {versionNode.components.map((componentNode) => {
                  const componentKey = `${versionNode.key}::${componentNode.key}`;
                  const componentCollapsed = collapsedNodes.has(componentKey);
                  if (
                    componentNode.items.length === 0 &&
                    !componentNode.versionFile &&
                    !(componentNode.versionFiles?.length ?? 0)
                  ) {
                    return null;
                  }

                  return (
                    <div key={componentKey} className="border-l-2 border-slate-200">
                      <button
                        type="button"
                        onClick={() => toggleNode(componentKey)}
                        className="flex w-full items-center justify-between bg-slate-50 px-3 py-1.5 pl-5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-100"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <FolderOpen className="size-3 shrink-0 text-primary-green" aria-hidden />
                          {componentNode.label}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-[10px] font-normal normal-case text-slate-500">
                            {componentNode.items.length}
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
                        <ComponentItemsDropZone
                          versionKey={versionNode.key}
                          componentLabel={componentNode.label}
                          readOnly={readOnly || !onMoveItemToComponent}
                        >
                          {(componentNode.versionFiles ??
                          (componentNode.versionFile ? [componentNode.versionFile] : [])
                          ).map((pdfFile) =>
                            pdfFile.ausente ? (
                              <VersionPdfAbsentRow
                                key={`${componentNode.key}-ausente-${pdfFile.componente}`}
                                componente={pdfFile.componente}
                              />
                            ) : (
                              <VersionPdfOpenRow
                                key={pdfFile.path || pdfFile.name}
                                file={pdfFile}
                                onOpen={onOpenVersionFile}
                              />
                            ),
                          )}
                          {componentNode.items.map((item) => (
                            <AnaliseTreeItemRow
                              key={item.uniqueId}
                              item={item}
                              versionKey={versionNode.key}
                              selected={selectedItemId === item.uniqueId}
                              onSelect={() => onSelectItem(item.uniqueId)}
                              onToggleResolucao={onToggleResolucao}
                              onToggleCorrigir={onToggleCorrigir}
                              onCorrecaoObsChange={onCorrecaoObsChange}
                              onDelete={() => onDeleteItem(item)}
                              onObsChange={(obs) => onObsChange(item.uniqueId, obs)}
                              toggling={togglingItemId === item.uniqueId}
                              togglingCorrigir={togglingCorrigirItemId === item.uniqueId}
                              deleting={deletingItemId === item.uniqueId}
                              readOnly={readOnly}
                            />
                          ))}
                        </ComponentItemsDropZone>
                      ) : null}
                    </div>
                  );
                })}
              </>
            ) : null}
          </div>
        );
      })}
      </div>
    </DndContext>
  );
}

function ComponentItemsDropZone({
  versionKey,
  componentLabel,
  readOnly,
  children,
}: {
  versionKey: string;
  componentLabel: string;
  readOnly: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: analiseComponentDropId(versionKey, componentLabel),
    data: { versionKey, component: componentLabel },
    disabled: readOnly,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[2rem] transition-colors",
        isOver && !readOnly && "bg-emerald-50/80 ring-1 ring-inset ring-primary-green/40",
      )}
    >
      {children}
    </div>
  );
}

function VersionPdfAbsentRow({ componente }: { componente: string }) {
  return (
    <div className="border-b border-slate-100 bg-amber-50/40 py-1.5 pl-8 pr-3">
      <span className="text-[11px] italic text-amber-900/90" title={`Arquivo de ${componente} não encontrado`}>
        (ausente)
      </span>
    </div>
  );
}

function VersionPdfOpenRow({
  file,
  onOpen,
}: {
  file: VersionPdfFile;
  onOpen?: (componente: AnaliseComponente) => void;
}) {
  const handleOpen = async () => {
    onOpen?.(file.componente);
    const ok = await openPathLocally(file.path, "file");
    if (!ok) {
      window.alert(
        `Não foi possível abrir o arquivo localmente.\n\nVerifique se o serviço SAGRA Folder Opener está em execução.\n\n${file.name}`,
      );
    }
  };

  return (
    <div className="border-b border-slate-100 bg-white py-1.5 pl-8 pr-3">
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

function PreAnaliseTreeRow({
  selected,
  running,
  alertCount,
  onSelect,
}: {
  selected: boolean;
  running: boolean;
  alertCount: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-2 border-b border-slate-100 py-2.5 pl-6 pr-3 text-left transition-colors",
        selected
          ? "border-l-[3px] border-l-secondary-blue bg-blue-50"
          : "border-l-2 border-l-secondary-blue/40 bg-sky-50/40 hover:bg-sky-50",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <ScanSearch
          className={cn(
            "size-3.5 shrink-0",
            selected ? "text-secondary-blue" : "text-slate-500",
          )}
          aria-hidden
        />
        <span className="text-sm font-semibold text-slate-800">Pré-análise</span>
        {running ? (
          <span className="rounded bg-secondary-blue/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-secondary-blue">
            Em execução
          </span>
        ) : null}
      </span>
      {alertCount > 0 ? (
        <span className="shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-amber-950">
          {alertCount}
        </span>
      ) : null}
    </button>
  );
}

function AnaliseTreeItemRow({
  item,
  versionKey,
  selected,
  onSelect,
  onToggleResolucao,
  onToggleCorrigir,
  onCorrecaoObsChange,
  onDelete,
  onObsChange,
  toggling,
  togglingCorrigir = false,
  deleting,
  readOnly,
}: {
  item: AnaliseSelectedItem;
  versionKey: string;
  selected: boolean;
  onSelect: () => void;
  onToggleResolucao: (itemId: number, nextValue: boolean) => void;
  onToggleCorrigir?: (itemId: number, nextValue: boolean) => void;
  onCorrecaoObsChange?: (itemId: number, obs: string) => void;
  onDelete: () => void;
  onObsChange: (obs: string) => void;
  toggling: boolean;
  togglingCorrigir: boolean;
  deleting: boolean;
  readOnly: boolean;
}) {
  const componentLabel = normalizeComponenteOrigem(item.componenteOrigem);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: analiseItemDragId(item.uniqueId),
    data: { itemId: item.uniqueId, component: componentLabel, versionKey },
    disabled: readOnly,
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-b border-slate-100",
        selected && "border-l-[3px] border-l-blue-500 bg-blue-50",
        isDragging && "relative z-10 opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-2 py-2 pl-3 pr-3">
        {!readOnly ? (
          <button
            type="button"
            className="shrink-0 cursor-grab rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 active:cursor-grabbing"
            title="Arrastar para outro componente"
            aria-label={`Arrastar ${item.titulo} para outro componente`}
            {...listeners}
            {...attributes}
          >
            <GripVertical className="size-3.5" aria-hidden />
          </button>
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          className="min-w-0 flex-1 text-left text-sm font-semibold text-slate-800"
          onClick={onSelect}
        >
          {item.titulo}
          {item.corrigidoSefoc ? (
            <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
              Corrigido
            </span>
          ) : null}
          {item.resolucaoObrigatoria ? (
            <span className="ml-2 rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold uppercase text-black">
              Obrigatória
            </span>
          ) : null}
        </button>
        <div className="flex shrink-0 gap-1">
          {onToggleCorrigir ? (
            <button
              type="button"
              title={item.corrigidoSefoc ? "Desmarcar correção interna" : "Marcar como corrigido (controle interno)"}
              disabled={togglingCorrigir || readOnly}
              onClick={() => onToggleCorrigir(item.uniqueId, !item.corrigidoSefoc)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-50",
                item.corrigidoSefoc
                  ? "bg-emerald-100 text-emerald-800"
                  : "text-slate-600 hover:bg-slate-200",
              )}
            >
              <span className="inline-flex items-center gap-0.5">
                <Wrench className="size-3" />
                Corrigir
              </span>
            </button>
          ) : null}
          <button
            type="button"
            title={
              item.resolucaoObrigatoria
                ? "Desmarcar resolução obrigatória"
                : "Marcar resolução obrigatória"
            }
            disabled={toggling || readOnly}
            onClick={() =>
              onToggleResolucao(item.uniqueId, !item.resolucaoObrigatoria)
            }
            className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-50"
          >
            {item.resolucaoObrigatoria ? (
              <Lock className="size-3.5 text-amber-700" />
            ) : (
              <LockOpen className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            title="Excluir item"
            disabled={deleting || readOnly}
            onClick={onDelete}
            className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      {item.corrigidoSefoc ? (
        <div className="border-t border-emerald-100 bg-emerald-50/60 px-3 pb-2 pl-8 pr-3 pt-1">
          <label className="text-[10px] font-bold uppercase text-emerald-800">
            Observação da correção (interno)
          </label>
          <textarea
            rows={2}
            value={item.obsCorrecaoSefoc ?? ""}
            onChange={(e) => onCorrecaoObsChange?.(item.uniqueId, e.target.value)}
            readOnly={readOnly}
            className="mt-0.5 w-full rounded border border-emerald-200 px-2 py-1 text-xs"
            placeholder="Detalhe a correção realizada…"
          />
        </div>
      ) : null}
      {selected ? (
        <div className="border-t border-slate-100 bg-slate-50/80 px-3 pb-2 pl-8 pr-3 pt-1">
          <label className="text-[10px] font-bold uppercase text-slate-500">
            Observação
          </label>
          <textarea
            rows={2}
            value={item.obs}
            onChange={(e) => onObsChange(e.target.value)}
            readOnly={readOnly}
            className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-xs"
            placeholder="Observação adicional…"
          />
        </div>
      ) : null}
    </div>
  );
}
