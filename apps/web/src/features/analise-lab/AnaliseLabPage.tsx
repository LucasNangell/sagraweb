import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  FlaskConical,
  Loader2,
  RefreshCw,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  analiseLabPageUrl,
  createAnaliseLabItem,
  createAnaliseLabMark,
  deleteAnaliseLabItem,
  deleteAnaliseLabMark,
  fetchAnaliseLabInfo,
  fetchAnaliseLabManifest,
  reorderAnaliseLabItems,
  reprocessAnaliseLab,
  replicateAnaliseLabItems,
  saveAnaliseLab,
  updateAnaliseLabItem,
  updateAnaliseLabMark,
  type AnaliseLabItem,
  type AnaliseLabItemEscopo,
  type AnaliseLabMark,
  type AnaliseLabMarkCor,
  type AnaliseLabEdge,
  type SaveAnaliseLabPayload,
  type UpdateAnaliseLabItemPayload,
  type UpdateAnaliseLabMarkPayload,
} from "@/api/analiseLab";
import type { ProvaWebCropJson } from "@/api/provaWeb";
import type { ProblemaPadrao } from "@/features/analise/types";
import { ProvaWebViewerShell } from "@/features/prova-web/ProvaWebViewerShell";
import logoUrl from "@/logo.png";

import { AnaliseLabBalloonLayer } from "./AnaliseLabBalloonLayer";
import { AnaliseLabConcluir } from "./AnaliseLabConcluir";
import { AnaliseLabInspector } from "./AnaliseLabInspector";
import { AnaliseLabItemList } from "./AnaliseLabItemList";
import {
  AnaliseLabItemPanel,
  toPanelModel,
  type AnaliseLabItemPanelModel,
} from "./AnaliseLabItemPanel";
import { AnaliseLabLibrary } from "./AnaliseLabLibrary";
import { AnaliseLabMarkEditor } from "./AnaliseLabMarkEditor";
import { AnaliseLabMarksLayer } from "./AnaliseLabMarksLayer";
import type { AnaliseLabTool } from "./AnaliseLabMarkTools";
import {
  loadViewPrefs,
  normalizeViewPrefs,
  saveViewPrefs,
  type InspectorViewPrefs,
} from "./analiseLabViewPrefs";
import { AnaliseLabReplicateDialog } from "./AnaliseLabReplicateDialog";
import { AnaliseLabSourcePicker } from "./AnaliseLabSourcePicker";
import { buildLibraryDraft } from "./analiseLabLibraryDraft";
import { itemOccurrences, roleToComponente } from "./analiseLabComponente";
import { pageSizeMm } from "./analiseLabGeometry";
import {
  formatPageSpec,
  parsePageSpec,
  togglePagePickSpec,
} from "./analiseLabPageSpec";
import { pageNumberToIndex } from "./analiseLabPageSync";
import { labelTipo } from "./analiseLabLabels";
import { markScopeLabel } from "./analiseLabPageSpec";

interface AnaliseLabPageProps {
  ano: number;
  osId: number;
}

type LabTab = "inspecao" | "folhear";
type LeftPane = "itens" | "marcas";

function isInFlight(status?: string): boolean {
  return status === "pending" || status === "running";
}

export function AnaliseLabPage({ ano, osId }: AnaliseLabPageProps) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [optimisticGenerating, setOptimisticGenerating] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<LabTab>("inspecao");
  const [leftPane, setLeftPane] = useState<LeftPane>("itens");
  const [concluirOpen, setConcluirOpen] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageNonce, setPageNonce] = useState(0);
  const goToPage = (page: number) => {
    setCurrentPage(page);
    setPageNonce((n) => n + 1);
  };

  const [tool, setTool] = useState<AnaliseLabTool>("select");
  const [edge, setEdge] = useState<AnaliseLabEdge>("top");
  const [offsetMm, setOffsetMm] = useState(7);
  const [fromMm, setFromMm] = useState(0);
  const [applyAllPages, setApplyAllPages] = useState(false);
  const [pageSpec, setPageSpec] = useState("");
  const [espelhar, setEspelhar] = useState(true);
  const [cor, setCor] = useState<AnaliseLabMarkCor>("red");
  const [rotulo, setRotulo] = useState("");
  const [sangriaMm, setSangriaMm] = useState(5);
  const [espessura, setEspessura] = useState(2);
  const [pagePickTarget, setPagePickTarget] = useState<"item" | "mark" | null>(
    null,
  );
  const [itemPageSpec, setItemPageSpec] = useState("");
  const [viewPrefs, setViewPrefs] = useState<InspectorViewPrefs>(() =>
    loadViewPrefs(ano, osId),
  );
  const [localMarks, setLocalMarks] = useState<AnaliseLabMark[] | null>(null);
  const [localItens, setLocalItens] = useState<AnaliseLabItem[] | null>(null);
  const [selectedMarkId, setSelectedMarkId] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [dismissedBalloonIds, setDismissedBalloonIds] = useState<number[]>([]);
  const [occurrenceIndex, setOccurrenceIndex] = useState(0);
  const [replicateVersao, setReplicateVersao] = useState<string | null>(null);
  const [draftLibraryItem, setDraftLibraryItem] =
    useState<AnaliseLabItemPanelModel | null>(null);
  const draftPayloadRef = useRef<UpdateAnaliseLabItemPayload | null>(null);
  const markScopeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const infoQuery = useQuery({
    queryKey: ["analise-lab-info", ano, osId],
    queryFn: () => fetchAnaliseLabInfo(ano, osId),
    retry: 1,
    refetchInterval: (q) => {
      const status = q.state.data?.session?.renderStatus;
      if (optimisticGenerating || isInFlight(status)) return 1500;
      return false;
    },
  });

  const info = infoQuery.data;
  const session = info?.session ?? null;
  const hasSession = Boolean(session);
  const renderStatus = session?.renderStatus;
  const renderInFlight = optimisticGenerating || isInFlight(renderStatus);
  const renderReady = !optimisticGenerating && renderStatus === "ready";
  const renderError =
    !optimisticGenerating && renderStatus === "error"
      ? session?.renderError || "Falha ao gerar as páginas."
      : null;

  const showPicker =
    !optimisticGenerating && (pickerOpen || (Boolean(info) && !hasSession));

  useEffect(() => {
    document.title = `Análise Lab — OS ${osId}/${ano}`;
  }, [ano, osId]);

  useEffect(() => {
    setViewPrefs(loadViewPrefs(ano, osId));
  }, [ano, osId]);

  useEffect(() => {
    saveViewPrefs(ano, osId, viewPrefs);
  }, [ano, osId, viewPrefs]);

  useEffect(() => {
    if (!optimisticGenerating) return;
    if (
      renderStatus === "ready" ||
      renderStatus === "error" ||
      renderStatus === "cancelled"
    ) {
      setOptimisticGenerating(false);
    }
  }, [optimisticGenerating, renderStatus]);

  useEffect(() => {
    if (info?.marks) setLocalMarks(info.marks);
  }, [info?.marks]);

  useEffect(() => {
    if (info?.itens) setLocalItens(info.itens);
  }, [info?.itens]);

  const marks = localMarks ?? info?.marks ?? [];
  const itens = localItens ?? info?.itens ?? [];
  const sessionCropVersao = session?.cropVersao ?? 1;
  const staleMarksCount = marks.filter(
    (m) => (m.cropVersao ?? 1) !== sessionCropVersao,
  ).length;

  const selectedMark =
    selectedMarkId == null
      ? null
      : (marks.find((m) => m.id === selectedMarkId) ?? null);

  const selectedItem =
    selectedItemId == null
      ? null
      : (itens.find((i) => i.id === selectedItemId) ?? null);

  const manifestQuery = useQuery({
    queryKey: ["analise-lab-manifest", ano, osId],
    queryFn: () => fetchAnaliseLabManifest(ano, osId),
    enabled: hasSession && !showPicker && renderReady && !renderError,
    retry: 1,
    staleTime: 60_000,
  });

  const pages = manifestQuery.data?.pages ?? [];
  const pageIndex = pageNumberToIndex(pages, currentPage);

  const progress = session?.renderProgress;
  const progressLabel =
    progress &&
    typeof progress.done === "number" &&
    typeof progress.total === "number" &&
    progress.total > 0
      ? `${progress.done} / ${progress.total} páginas`
      : null;

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["analise-lab-info", ano, osId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["analise-lab-manifest", ano, osId],
    });
  };

  const handleGenerateStarted = () => {
    setPickerOpen(false);
    setOptimisticGenerating(true);
    setActionError(null);
    queryClient.removeQueries({ queryKey: ["analise-lab-manifest", ano, osId] });
  };

  const handleGenerate = async (payload: SaveAnaliseLabPayload) => {
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await saveAnaliseLab(ano, osId, payload);
      queryClient.setQueryData(["analise-lab-info", ano, osId], (prev: typeof info) => {
        if (!prev) return prev;
        return {
          ...prev,
          session: res.session,
          marks: prev.marks ?? [],
          itens: prev.itens ?? [],
        };
      });
      setOptimisticGenerating(true);
      invalidate();
    } catch (err) {
      setOptimisticGenerating(false);
      setPickerOpen(true);
      setActionError(
        err instanceof Error ? err.message : "Erro ao iniciar o laboratório.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const pageNumero = pages[pageIndex]?.page ?? currentPage;

  useEffect(() => {
    if (pagePickTarget) return;
    if (!applyAllPages) {
      setPageSpec((prev) => {
        if (!prev.trim() || /^\d+$/.test(prev.trim())) {
          return String(pageNumero);
        }
        return prev;
      });
    }
  }, [applyAllPages, pageNumero, pagePickTarget]);

  const canEspelharTipo = (tipo: string) =>
    tipo === "faixa" ||
    tipo === "sangria" ||
    tipo === "retangulo" ||
    tipo === "seta" ||
    tipo === "circulo" ||
    tipo === "texto" ||
    tipo === "ponto" ||
    tipo === "livre";

  const resolveScope = () => {
    if (applyAllPages) {
      return { pagina: 0, paginas: null as string | null };
    }
    return { pagina: pageNumero, paginas: pageSpec || String(pageNumero) };
  };

  const openLibraryDraft = (problema: ProblemaPadrao) => {
    const pageMeta = pages.find((p) => p.page === pageNumero) ?? pages[0];
    const componente = roleToComponente(
      pageMeta?.role || "page",
      session?.modo || "unico",
    );
    setDraftLibraryItem(
      buildLibraryDraft({
        problema,
        escopo: "pagina",
        pagina: pageNumero,
        pageSpec: String(pageNumero),
        componente,
      }),
    );
    setItemPageSpec(String(pageNumero));
    setSelectedItemId(null);
    setSelectedMarkId(null);
    setTool("select");
    setPagePickTarget(null);
  };

  const registerDraftItem = async (
    payload: UpdateAnaliseLabItemPayload,
    confirmSplit = false,
  ): Promise<AnaliseLabItem | null> => {
    if (!draftLibraryItem?.idProblemaPadrao) return null;
    setActionBusy(true);
    setActionError(null);
    try {
      const escopo = (payload.escopo ||
        draftLibraryItem.escopo) as AnaliseLabItemEscopo;
      // Escopo arquivo: usa o fluxo da biblioteca (split Capa/Miolo) e depois aplica o HTML limpo.
      if (escopo === "arquivo") {
        const res = await createAnaliseLabItem(ano, osId, {
          id_problema: draftLibraryItem.idProblemaPadrao,
          escopo,
          pagina: 0,
          paginas: null,
          versao_label: session?.versaoLabel,
          confirm_split: confirmSplit,
        });
        if (res.needsConfirm && res.splitPreview) {
          const lines = Object.entries(res.splitPreview)
            .map(([c, p]) => `${c}: ${p}`)
            .join("\n");
          const ok = window.confirm(
            `Este escopo atinge Capa e Miolo. Registrar dois problemas?\n\n${lines}`,
          );
          if (ok) {
            return await registerDraftItem(payload, true);
          }
          return null;
        }
        const updated: AnaliseLabItem[] = [];
        for (const created of res.items || []) {
          const patch = await updateAnaliseLabItem(ano, osId, created.id, {
            titulo: payload.titulo,
            html_snapshot: payload.html_snapshot,
            obs: payload.obs,
            resolucao_obrigatoria: payload.resolucao_obrigatoria,
          });
          updated.push(patch.item);
        }
        setLocalItens((prev) => [...(prev ?? []), ...updated]);
        if (updated[0]) {
          setSelectedItemId(updated[0].id);
          setLeftPane("itens");
        }
        setDraftLibraryItem(null);
        draftPayloadRef.current = null;
        invalidate();
        return updated[0] ?? null;
      }

      const res = await createAnaliseLabItem(ano, osId, {
        id_problema: draftLibraryItem.idProblemaPadrao,
        titulo: payload.titulo,
        html_snapshot: payload.html_snapshot,
        escopo,
        pagina: payload.pagina,
        paginas: payload.paginas || null,
        componente: payload.componente,
        obs: payload.obs,
        versao_label: session?.versaoLabel,
      });
      let items = res.items || [];
      if (items[0] && payload.resolucao_obrigatoria) {
        const patch = await updateAnaliseLabItem(ano, osId, items[0].id, {
          resolucao_obrigatoria: true,
        });
        items = [patch.item];
      }
      setLocalItens((prev) => [...(prev ?? []), ...items]);
      if (items[0]) {
        setSelectedItemId(items[0].id);
        setLeftPane("itens");
      }
      setDraftLibraryItem(null);
      draftPayloadRef.current = null;
      invalidate();
      return items[0] ?? null;
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao registrar problema.",
      );
      return null;
    } finally {
      setActionBusy(false);
    }
  };

  const ensureItemId = async (): Promise<number | null> => {
    if (selectedItemId) return selectedItemId;
    if (draftLibraryItem && draftPayloadRef.current) {
      const item = await registerDraftItem(draftPayloadRef.current);
      return item?.id ?? null;
    }
    return null;
  };

  const addMark = async (payload: {
    tipo: AnaliseLabMark["tipo"];
    geometria: Record<string, number | string | number[][]>;
    pagina?: number;
  }) => {
    setActionBusy(true);
    setActionError(null);
    try {
      const itemId = await ensureItemId();
      if (itemId == null) {
        setActionError(
          "Selecione ou registre um problema técnico antes de inserir a marca.",
        );
        return;
      }
      const scope = resolveScope();
      let multi = applyAllPages;
      if (!multi && scope.paginas) {
        try {
          multi = parsePageSpec(scope.paginas).length > 1;
        } catch {
          multi = false;
        }
      }
      const drawnPage = Math.max(1, payload.pagina ?? pageNumero);
      let markPaginas = applyAllPages ? null : scope.paginas;
      let markPagina = applyAllPages ? 0 : (payload.pagina ?? scope.pagina);
      if (pagePickTarget === "mark") {
        const seed = togglePagePickSpec(pageSpec, drawnPage);
        setPageSpec(seed);
        markPaginas = seed || String(drawnPage);
        markPagina = 1;
        multi = (seed ? parsePageSpec(seed) : [drawnPage]).length > 1;
      }
      const res = await createAnaliseLabMark(ano, osId, {
        pagina: markPagina,
        paginas: markPaginas,
        tipo: payload.tipo as "offset_corte",
        geometria: payload.geometria,
        rotulo: rotulo || null,
        cor,
        espelhar: canEspelharTipo(payload.tipo) && espelhar && multi,
        pagina_origem: drawnPage,
        item_id: itemId,
      });
      setLocalMarks((prev) => [...(prev ?? []), res.mark]);
      setSelectedMarkId(res.mark.id);
      invalidate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao gravar marca.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleUpdateMark = async (payload: UpdateAnaliseLabMarkPayload) => {
    if (selectedMarkId == null) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await updateAnaliseLabMark(ano, osId, selectedMarkId, payload);
      setLocalMarks((prev) =>
        (prev ?? []).map((m) => (m.id === selectedMarkId ? res.mark : m)),
      );
      invalidate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao atualizar marca.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteMark = async (id: number) => {
    setActionBusy(true);
    try {
      await deleteAnaliseLabMark(ano, osId, id);
      setLocalMarks((prev) => (prev ?? []).filter((m) => m.id !== id));
      if (selectedMarkId === id) setSelectedMarkId(null);
      invalidate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao excluir marca.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteItem = async (id: number) => {
    setActionBusy(true);
    try {
      await deleteAnaliseLabItem(ano, osId, id);
      setLocalItens((prev) => (prev ?? []).filter((i) => i.id !== id));
      setLocalMarks((prev) =>
        (prev ?? []).filter((m) => m.itemId !== id),
      );
      if (selectedItemId === id) setSelectedItemId(null);
      if (
        selectedMarkId != null &&
        marks.find((m) => m.id === selectedMarkId)?.itemId === id
      ) {
        setSelectedMarkId(null);
      }
      invalidate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao excluir item.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleMoveItemComponent = async (
    itemId: number,
    componente: string,
  ) => {
    const before = itens;
    setLocalItens((prev) =>
      (prev ?? itens).map((i) =>
        i.id === itemId ? { ...i, componente } : i,
      ),
    );
    setActionBusy(true);
    try {
      const res = await updateAnaliseLabItem(ano, osId, itemId, { componente });
      setLocalItens((prev) =>
        (prev ?? []).map((i) => (i.id === itemId ? res.item : i)),
      );
      invalidate();
    } catch (err) {
      setLocalItens(before);
      setActionError(
        err instanceof Error ? err.message : "Erro ao mover item.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleReorderItems = async (orderedIds: number[]) => {
    const before = itens;
    const orderMap = new Map(orderedIds.map((id, idx) => [id, idx + 1]));
    setLocalItens((prev) =>
      (prev ?? itens)
        .map((i) =>
          orderMap.has(i.id) ? { ...i, ordem: orderMap.get(i.id)! } : i,
        )
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.id - b.id),
    );
    setActionBusy(true);
    try {
      const res = await reorderAnaliseLabItems(ano, osId, orderedIds);
      setLocalItens(res.itens);
      invalidate();
    } catch (err) {
      setLocalItens(before);
      setActionError(
        err instanceof Error ? err.message : "Erro ao reordenar itens.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleResolucao = async (itemId: number, next: boolean) => {
    const before = itens;
    setLocalItens((prev) =>
      (prev ?? itens).map((i) =>
        i.id === itemId ? { ...i, resolucaoObrigatoria: next } : i,
      ),
    );
    setActionBusy(true);
    try {
      const res = await updateAnaliseLabItem(ano, osId, itemId, {
        resolucao_obrigatoria: next,
      });
      setLocalItens((prev) =>
        (prev ?? []).map((i) => (i.id === itemId ? res.item : i)),
      );
      invalidate();
    } catch (err) {
      setLocalItens(before);
      setActionError(
        err instanceof Error
          ? err.message
          : "Erro ao atualizar resolução obrigatória.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleCorrigido = async (itemId: number, next: boolean) => {
    const before = itens;
    setLocalItens((prev) =>
      (prev ?? itens).map((i) =>
        i.id === itemId
          ? {
              ...i,
              corrigidoSefoc: next,
              obsCorrecaoSefoc: next ? i.obsCorrecaoSefoc : null,
            }
          : i,
      ),
    );
    setActionBusy(true);
    try {
      const res = await updateAnaliseLabItem(ano, osId, itemId, {
        corrigido_sefoc: next,
        ...(next ? {} : { obs_correcao_sefoc: null }),
      });
      setLocalItens((prev) =>
        (prev ?? []).map((i) => (i.id === itemId ? res.item : i)),
      );
      invalidate();
    } catch (err) {
      setLocalItens(before);
      setActionError(
        err instanceof Error ? err.message : "Erro ao marcar corrigido.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleReplicateItems = async (args: {
    itemIds: number[];
    copiarMarcas: boolean;
  }) => {
    setActionBusy(true);
    try {
      const res = await replicateAnaliseLabItems(ano, osId, {
        item_ids: args.itemIds,
        copiar_marcas: args.copiarMarcas,
      });
      setLocalItens((prev) => [...(prev ?? itens), ...res.items]);
      setReplicateVersao(null);
      if (args.copiarMarcas) {
        setLocalMarks(null);
      }
      invalidate();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Erro ao replicar itens.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const balloonGutter = useMemo(() => {
    if (typeof window === "undefined") return 320;
    return Math.min(360, Math.max(260, Math.round(window.innerWidth * 0.28)));
  }, []);

  const occurrences = useMemo(() => {
    if (!selectedItem) return [];
    return itemOccurrences(selectedItem, pages, parsePageSpec);
  }, [selectedItem, pages]);

  useEffect(() => {
    setOccurrenceIndex(0);
  }, [selectedItemId]);

  useEffect(() => {
    setDismissedBalloonIds([]);
  }, [currentPage, tab]);

  useEffect(() => {
    if (!selectedItem || !occurrences.length || tab !== "inspecao") return;
    const page = occurrences[occurrenceIndex];
    if (page) goToPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrenceIndex, selectedItemId]);

  const selectItem = (id: number) => {
    setDraftLibraryItem(null);
    draftPayloadRef.current = null;
    setSelectedItemId(id);
    setSelectedMarkId(null);
    setTool("select");
    setPagePickTarget(null);
    const item = itens.find((i) => i.id === id);
    if (item) {
      setItemPageSpec(
        item.paginas || (item.pagina > 0 ? String(item.pagina) : ""),
      );
      const occ = itemOccurrences(item, pages, parsePageSpec);
      if (occ[0]) goToPage(occ[0]);
      setOccurrenceIndex(0);
    }
  };

  const itemListProps = {
    items: itens,
    currentVersaoLabel: session?.versaoLabel,
    selectedId: selectedItemId,
    onSelect: selectItem,
    onDelete: (id: number) => void handleDeleteItem(id),
    onMoveComponent: (itemId: number, componente: string) =>
      void handleMoveItemComponent(itemId, componente),
    onReorder: (ids: number[]) => void handleReorderItems(ids),
    onToggleResolucao: (itemId: number, next: boolean) =>
      void handleToggleResolucao(itemId, next),
    onToggleCorrigido: (itemId: number, next: boolean) =>
      void handleToggleCorrigido(itemId, next),
    onReplicateItem: (itemId: number) =>
      void handleReplicateItems({ itemIds: [itemId], copiarMarcas: false }),
    onReplicateVersion: (versaoLabel: string) => setReplicateVersao(versaoLabel),
    busy: actionBusy,
  };

  const allPagesSpec = useMemo(() => {
    const nums = pages.map((p) => p.page).filter((n) => n >= 1);
    return formatPageSpec(nums);
  }, [pages]);

  /** Escopo de páginas do problema aberto — usado por "Todas as páginas" da marca. */
  const markAllPagesSpec = useMemo(() => {
    const panelItem =
      selectedItem ??
      (draftLibraryItem
        ? {
            escopo: draftLibraryItem.escopo,
            pagina: draftLibraryItem.pagina,
            paginas: draftLibraryItem.paginas,
            componente: draftLibraryItem.componente,
          }
        : null);
    if (!panelItem) return "";
    return formatPageSpec(itemOccurrences(panelItem, pages, parsePageSpec));
  }, [selectedItem, draftLibraryItem, pages]);

  const selectMarkFromCanvas = (id: number) => {
    setSelectedMarkId(id);
    setPagePickTarget(null);
    setTool("select");
    setLeftPane("marcas");
    const mark = marks.find((m) => m.id === id);
    if (mark?.itemId != null && mark.itemId !== selectedItemId) {
      setSelectedItemId(mark.itemId);
      setDraftLibraryItem(null);
    }
  };

  /** Maior profundidade de sangria gravada — define a folga do Folhear. */
  const maxSangriaMm = marks.reduce((max, m) => {
    if (m.tipo !== "sangria") return max;
    const from = Number(
      (m.geometria as { fromMm?: number } | null)?.fromMm ?? 0,
    );
    return Math.max(max, Math.abs(Number.isFinite(from) ? from : 0));
  }, 0);

  const firstPageMeta = pages[0];
  const bleedFraction =
    maxSangriaMm > 0 && firstPageMeta
      ? Math.min(
          0.2,
          maxSangriaMm /
            Math.max(1, pageSizeMm(firstPageMeta.widthPt, 0).widthMm),
        )
      : 0;

  const renderPageOverlay = (
    page: {
      page: number;
      width: number;
      height: number;
      widthPt: number;
      heightPt: number;
    },
    size: { width: number; height: number },
  ) => {
    const { widthMm, heightMm } = pageSizeMm(page.widthPt, page.heightPt);
    return (
      <AnaliseLabMarksLayer
        marks={marks}
        pageNumber={page.page}
        pageWidthMm={widthMm}
        pageHeightMm={heightMm}
        displayWidth={size.width}
        displayHeight={size.height}
        includeMedidas={false}
        selectedMarkId={selectedMarkId}
        bleedMm={maxSangriaMm}
      />
    );
  };

  const pickedPages = (() => {
    if (!pagePickTarget) return [];
    const spec = pagePickTarget === "item" ? itemPageSpec : pageSpec;
    try {
      return spec.trim() ? parsePageSpec(spec) : [];
    } catch {
      return [];
    }
  })();

  const flushMarkScope = (markId: number, spec: string, markTipo: string) => {
    if (markScopeTimerRef.current) clearTimeout(markScopeTimerRef.current);
    markScopeTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          let pageCount = 0;
          try {
            pageCount = spec.trim() ? parsePageSpec(spec).length : 0;
          } catch {
            pageCount = 0;
          }
          const res = await updateAnaliseLabMark(ano, osId, markId, {
            pagina: 1,
            paginas: spec || null,
            espelhar:
              canEspelharTipo(markTipo) && espelhar && pageCount > 1,
          });
          setLocalMarks((prev) =>
            (prev ?? []).map((m) => (m.id === markId ? res.mark : m)),
          );
          invalidate();
        } catch (err) {
          setActionError(
            err instanceof Error
              ? err.message
              : "Erro ao atualizar páginas da marca.",
          );
          invalidate();
        }
      })();
    }, 300);
  };

  const togglePickPage = (page: number) => {
    if (!pagePickTarget) return;
    if (pagePickTarget === "item") {
      setItemPageSpec((prev) => togglePagePickSpec(prev, page));
      return;
    }
    const next = togglePagePickSpec(pageSpec, page);
    setPageSpec(next);
    if (selectedMarkId != null) {
      const mark = marks.find((m) => m.id === selectedMarkId);
      if (mark) {
        setLocalMarks((prev) =>
          (prev ?? []).map((m) =>
            m.id === selectedMarkId
              ? { ...m, pagina: 1, paginas: next || null }
              : m,
          ),
        );
        flushMarkScope(selectedMarkId, next, mark.tipo);
      }
    }
  };

  const itemPagePickProps = {
    pageSpecOverride: pagePickTarget === "item" ? itemPageSpec : null,
    onPageSpecChange: (spec: string) => {
      setItemPageSpec(spec);
    },
    pagePickActive: pagePickTarget === "item",
    onTogglePagePick: () => {
      setPagePickTarget((prev) => (prev === "item" ? null : "item"));
    },
    allPagesSpec,
  };

  const toggleMarkPagePick = () => {
    setPagePickTarget((prev) => {
      if (prev === "mark") return null;
      setApplyAllPages(false);
      return "mark";
    });
  };

  const markToolsProps = {
    tool,
    onToolChange: setTool,
    edge,
    onEdgeChange: setEdge,
    offsetMm,
    onOffsetMmChange: setOffsetMm,
    fromMm,
    onFromMmChange: setFromMm,
    sangriaMm,
    onSangriaMmChange: setSangriaMm,
    applyAllPages,
    onApplyAllPagesChange: (v: boolean) => {
      setApplyAllPages(v);
      if (v && pagePickTarget === "mark") setPagePickTarget(null);
    },
    pageSpec,
    onPageSpecChange: setPageSpec,
    pagePickActive: pagePickTarget === "mark",
    onTogglePagePick: toggleMarkPagePick,
    espelhar,
    onEspelharChange: setEspelhar,
    cor,
    onCorChange: setCor,
    rotulo,
    onRotuloChange: setRotulo,
    espessura,
    onEspessuraChange: setEspessura,
    busy: actionBusy,
    onAddFaixa: () =>
      void addMark({
        tipo: "faixa",
        geometria: { edge, fromMm, toMm: offsetMm },
        pagina: pageNumero,
      }),
    onAddSangriaAll: () =>
      void addMark({
        tipo: "sangria",
        geometria: {
          edge: "all",
          fromMm: -Math.abs(sangriaMm || 5),
          toMm: 0,
          alongFromMm: 0,
          alongToMm: 0,
        },
        pagina: pageNumero,
      }),
  };

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-sagra-bg text-sagra-text">
      <header className="flex h-14 shrink-0 items-center gap-3 bg-secondary-blue px-3 text-white shadow-md sm:h-16 sm:px-4">
        <img
          src={logoUrl}
          alt="DEAPA"
          className="h-8 w-auto shrink-0 object-contain sm:h-10"
        />
        <FlaskConical className="hidden size-5 shrink-0 text-primary-green sm:block" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-wide sm:text-base">
            Análise Lab — OS {osId}/{ano}
            {session?.versaoLabel ? ` · ${session.versaoLabel}` : ""}
            {renderInFlight ? (
              <span className="ml-2 inline-block rounded bg-sky-300/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary-blue">
                Gerando
              </span>
            ) : null}
          </h1>
          {info && (info.titulo || info.produto) ? (
            <p className="truncate text-xs text-white/70">
              {[info.titulo, info.produto].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        {hasSession && !showPicker ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setPageNonce((n) => n + 1);
                setTab("inspecao");
              }}
              className={
                tab === "inspecao"
                  ? "rounded-md bg-primary-green/30 px-2 py-1.5 text-sm"
                  : "rounded-md border border-white/30 px-2 py-1.5 text-sm hover:bg-white/10"
              }
            >
              <ScanSearch className="mr-1 inline size-4" aria-hidden />
              Inspeção
            </button>
            <button
              type="button"
              onClick={() => {
                setPageNonce((n) => n + 1);
                setTab("folhear");
              }}
              className={
                tab === "folhear"
                  ? "rounded-md bg-primary-green/30 px-2 py-1.5 text-sm"
                  : "rounded-md border border-white/30 px-2 py-1.5 text-sm hover:bg-white/10"
              }
            >
              <BookOpen className="mr-1 inline size-4" aria-hidden />
              Folhear
            </button>
            <button
              type="button"
              disabled={actionBusy || renderInFlight || !itens.length}
              onClick={() => setConcluirOpen(true)}
              className="rounded-md border border-white/30 px-2 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              <CheckCircle2 className="mr-1 inline size-4" aria-hidden />
              Concluir
            </button>
            <button
              type="button"
              disabled={actionBusy || renderInFlight}
              onClick={() => setPickerOpen(true)}
              className="rounded-md border border-white/30 px-2 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              Trocar arquivo
            </button>
          </div>
        ) : null}
      </header>

      {actionError ? (
        <p className="shrink-0 bg-red-50 px-4 py-2 text-center text-sm text-sagra-danger">
          {actionError}
        </p>
      ) : null}

      {staleMarksCount > 0 && !showPicker && renderReady ? (
        <p className="shrink-0 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          {staleMarksCount} marca{staleMarksCount === 1 ? "" : "s"} com outra
          configuração de corte.
        </p>
      ) : null}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {infoQuery.isLoading ? (
          <Centered>
            <Loader2 className="size-8 animate-spin text-primary-green" aria-hidden />
            <p className="text-sm text-neutral-600">Carregando…</p>
          </Centered>
        ) : null}

        {infoQuery.isError ? (
          <Centered>
            <p className="text-sm text-sagra-danger">
              {infoQuery.error instanceof Error
                ? infoQuery.error.message
                : "Erro ao carregar."}
            </p>
            <button
              type="button"
              onClick={() => void infoQuery.refetch()}
              className="inline-flex items-center gap-1 rounded border border-sagra-border bg-white px-3 py-1.5 text-xs"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Tentar novamente
            </button>
          </Centered>
        ) : null}

        {info && showPicker ? (
          <AnaliseLabSourcePicker
            ano={ano}
            osId={osId}
            saving={actionBusy}
            formato={info.formato}
            formatoAlturaMm={info.formatoAlturaMm}
            formatoLarguraMm={info.formatoLarguraMm}
            initialVersaoLabel={session?.versaoLabel}
            initialModo={
              session?.modo === "capa_miolo" ? "capa_miolo" : "unico"
            }
            initialArquivoUnico={session?.arquivoUnico}
            initialArquivoCapa={session?.arquivoCapa}
            initialArquivoMiolo={session?.arquivoMiolo}
            initialCropJson={
              (session?.cropJson as ProvaWebCropJson | null | undefined) ?? null
            }
            onGenerateStarted={handleGenerateStarted}
            onGenerate={(p) => void handleGenerate(p)}
          />
        ) : null}

        {info && !showPicker && (hasSession || optimisticGenerating) ? (
          <>
            {renderInFlight ? (
              <Centered>
                <Loader2 className="size-8 animate-spin text-primary-green" aria-hidden />
                <p className="text-sm text-neutral-600">
                  {optimisticGenerating && !isInFlight(renderStatus)
                    ? "Iniciando a geração do laboratório…"
                    : "Gerando páginas em segundo plano…"}
                </p>
                {progressLabel ? (
                  <p className="text-xs font-medium text-neutral-700">
                    {progressLabel}
                  </p>
                ) : null}
              </Centered>
            ) : null}

            {renderError ? (
              <Centered>
                <p className="text-sm text-sagra-danger">{renderError}</p>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => {
                    void (async () => {
                      setActionBusy(true);
                      try {
                        await reprocessAnaliseLab(ano, osId);
                        setOptimisticGenerating(true);
                        invalidate();
                      } catch (err) {
                        setActionError(
                          err instanceof Error
                            ? err.message
                            : "Erro ao reprocessar.",
                        );
                      } finally {
                        setActionBusy(false);
                      }
                    })();
                  }}
                  className="rounded border border-sagra-border bg-white px-3 py-1.5 text-xs"
                >
                  Tentar novamente
                </button>
              </Centered>
            ) : null}

            {renderReady && manifestQuery.isLoading ? (
              <Centered>
                <Loader2 className="size-8 animate-spin text-primary-green" aria-hidden />
                <p className="text-sm text-neutral-600">Carregando visualização…</p>
              </Centered>
            ) : null}

            {renderReady && manifestQuery.data ? (
              <div className="flex min-h-0 flex-1 overflow-hidden">
                {tab === "inspecao" ? (
                  <>
                    <aside className="flex w-[332px] shrink-0 flex-col border-r border-sagra-border bg-white">
                      <div className="flex min-h-0 flex-1 flex-col border-b border-sagra-border p-2">
                        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                          <AnaliseLabLibrary
                            busy={actionBusy}
                            onRegister={openLibraryDraft}
                          />
                        </div>
                      </div>
                      <div className="flex min-h-0 flex-1 flex-col">
                        <div className="flex shrink-0 gap-0.5 border-b border-sagra-border p-1">
                          {(
                            [
                              ["itens", "Itens"],
                              ["marcas", "Marcas"],
                            ] as const
                          ).map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setLeftPane(id)}
                              className={
                                leftPane === id
                                  ? "flex-1 rounded bg-primary-green/15 px-1 py-1 text-[11px] font-semibold text-primary-green"
                                  : "flex-1 rounded px-1 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
                              }
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
                          {leftPane === "itens" ? (
                            <AnaliseLabItemList {...itemListProps} />
                          ) : null}
                          {leftPane === "marcas" ? (
                            <div className="flex min-h-0 flex-1 flex-col gap-2">
                              {selectedMark ? (
                                <AnaliseLabMarkEditor
                                  mark={selectedMark}
                                  busy={actionBusy}
                                  onSave={(p) => void handleUpdateMark(p)}
                                  onCancel={() => setSelectedMarkId(null)}
                                  onDelete={() =>
                                    void handleDeleteMark(selectedMark.id)
                                  }
                                />
                              ) : null}
                              <ul className="space-y-0.5 text-xs">
                                {marks.map((m) => (
                                  <li
                                    key={m.id}
                                    className={
                                      selectedMarkId === m.id
                                        ? "flex items-center gap-1 rounded border border-primary-green bg-primary-green/5 px-1 py-0.5"
                                        : "flex items-center gap-1 rounded px-1 py-0.5 hover:bg-neutral-50"
                                    }
                                  >
                                    <button
                                      type="button"
                                      className="min-w-0 flex-1 truncate text-left"
                                      onClick={() => selectMarkFromCanvas(m.id)}
                                    >
                                      {labelTipo(m.tipo)}
                                      {m.rotulo ? ` · ${m.rotulo}` : ""}
                                      {` · ${markScopeLabel(m)}`}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionBusy}
                                      className="text-sagra-danger"
                                      onClick={() => void handleDeleteMark(m.id)}
                                    >
                                      <Trash2 className="size-3" aria-hidden />
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </aside>

                    {draftLibraryItem ? (
                      <AnaliseLabItemPanel
                        item={draftLibraryItem}
                        mode="register"
                        marks={marks}
                        busy={actionBusy}
                        onClose={() => {
                          setDraftLibraryItem(null);
                          draftPayloadRef.current = null;
                          if (pagePickTarget === "item") setPagePickTarget(null);
                        }}
                        onSave={(p) => void registerDraftItem(p)}
                        onPayloadChange={(p) => {
                          draftPayloadRef.current = p;
                        }}
                        tool={tool}
                        onToolChange={setTool}
                        selectedMark={selectedMark}
                        markAllPagesSpec={markAllPagesSpec}
                        onUpdateMark={(p) => void handleUpdateMark(p)}
                        onDeleteSelectedMark={() => {
                          if (selectedMark)
                            void handleDeleteMark(selectedMark.id);
                        }}
                        {...itemPagePickProps}
                      />
                    ) : selectedItem ? (
                      <AnaliseLabItemPanel
                        item={toPanelModel(selectedItem)}
                        mode="edit"
                        marks={marks}
                        busy={actionBusy}
                        {...itemPagePickProps}
                        tool={tool}
                        onToolChange={setTool}
                        selectedMark={selectedMark}
                        markAllPagesSpec={markAllPagesSpec}
                        onUpdateMark={(p) => void handleUpdateMark(p)}
                        onDeleteSelectedMark={() => {
                          if (selectedMark)
                            void handleDeleteMark(selectedMark.id);
                        }}
                        onClose={() => {
                          setSelectedItemId(null);
                          setTool("select");
                          setSelectedMarkId(null);
                          if (pagePickTarget === "item") setPagePickTarget(null);
                        }}
                        onDelete={() => void handleDeleteItem(selectedItem.id)}
                        onUnlinkMark={(markId) => {
                          void (async () => {
                            setActionBusy(true);
                            try {
                              const res = await updateAnaliseLabMark(
                                ano,
                                osId,
                                markId,
                                { item_id: null },
                              );
                              setLocalMarks((prev) =>
                                (prev ?? []).map((m) =>
                                  m.id === markId ? res.mark : m,
                                ),
                              );
                              invalidate();
                            } catch (err) {
                              setActionError(
                                err instanceof Error
                                  ? err.message
                                  : "Erro ao desvincular marca.",
                              );
                            } finally {
                              setActionBusy(false);
                            }
                          })();
                        }}
                        onDeleteMark={(id) => void handleDeleteMark(id)}
                        onSave={(p) => {
                          void (async () => {
                            setActionBusy(true);
                            try {
                              const res = await updateAnaliseLabItem(
                                ano,
                                osId,
                                selectedItem.id,
                                p,
                              );
                              setLocalItens((prev) =>
                                (prev ?? []).map((i) =>
                                  i.id === selectedItem.id ? res.item : i,
                                ),
                              );
                              invalidate();
                            } catch (err) {
                              setActionError(
                                err instanceof Error
                                  ? err.message
                                  : "Erro ao salvar item.",
                              );
                            } finally {
                              setActionBusy(false);
                            }
                          })();
                        }}
                      />
                    ) : null}

                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                      <AnaliseLabInspector
                        pages={pages}
                        pageTarget={{ page: currentPage, nonce: pageNonce }}
                        onPageChange={(page) => setCurrentPage(page)}
                        resolveUrl={(page) =>
                          analiseLabPageUrl(
                            ano,
                            osId,
                            page,
                            manifestQuery.data.cacheKey,
                          )
                        }
                        marks={marks}
                        tool={tool}
                        edge={edge}
                        applyAllPages={applyAllPages}
                        cor={cor}
                        rotulo={rotulo}
                        espessura={espessura}
                        sangriaMm={sangriaMm}
                        selectedMarkId={selectedMarkId}
                        markTools={markToolsProps}
                        prefs={viewPrefs}
                        onPrefsChange={(next) =>
                          setViewPrefs(normalizeViewPrefs(next))
                        }
                        pagePick={
                          pagePickTarget
                            ? {
                                label:
                                  pagePickTarget === "item"
                                    ? "Selecionando páginas do problema"
                                    : "Selecionando páginas da marca",
                                pages: pickedPages,
                                onTogglePage: togglePickPage,
                                onFinish: () => setPagePickTarget(null),
                              }
                            : null
                        }
                        onSelectMark={selectMarkFromCanvas}
                        onCreateGeometryMark={(args) =>
                          void addMark({
                            tipo: args.tipo,
                            geometria: args.geometria,
                            pagina: args.pagina,
                          })
                        }
                        onCreateFaixaDrag={(args) =>
                          void addMark({
                            tipo: "faixa",
                            pagina: args.pagina,
                            geometria: {
                              edge,
                              fromMm: args.fromMm,
                              toMm: args.toMm,
                            },
                          })
                        }
                        onCreateSangriaDrag={(args) =>
                          void addMark({
                            tipo: "sangria",
                            pagina: args.pagina,
                            geometria: {
                              edge: edge === "all" ? "left" : edge,
                              fromMm: args.fromMm,
                              toMm: args.toMm,
                              alongFromMm: args.alongFromMm,
                              alongToMm: args.alongToMm,
                            },
                          })
                        }
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <aside className="flex w-[332px] shrink-0 flex-col border-r border-sagra-border bg-white p-2">
                      <h2 className="mb-1 text-xs font-semibold uppercase text-neutral-600">
                        Problemas
                      </h2>
                      <AnaliseLabItemList {...itemListProps} />
                    </aside>
                    <ProvaWebViewerShell
                      ano={ano}
                      osId={osId}
                      manifest={manifestQuery.data}
                      buildPageUrl={(page) =>
                        analiseLabPageUrl(
                          ano,
                          osId,
                          page,
                          manifestQuery.data.cacheKey,
                        )
                      }
                      stageGutterRight={balloonGutter}
                      pageBleedFraction={bleedFraction}
                      renderPageOverlay={renderPageOverlay}
                      renderStageOverlay={(ctx) => (
                        <AnaliseLabBalloonLayer
                          items={itens}
                          marks={marks}
                          pages={pages}
                          visiblePages={ctx.visiblePages}
                          pageSize={ctx.pageSize}
                          slotWidth={ctx.slotWidth}
                          gutterRight={ctx.gutterRight || balloonGutter}
                          isSpread={ctx.isSpread}
                          flipping={ctx.flipping}
                          selectedItemId={selectedItemId}
                          dismissedIds={dismissedBalloonIds}
                          onDismiss={(id) =>
                            setDismissedBalloonIds((prev) =>
                              prev.includes(id) ? prev : [...prev, id],
                            )
                          }
                          onGoToOccurrence={(itemId, page) => {
                            setSelectedItemId(itemId);
                            goToPage(page);
                          }}
                        />
                      )}
                      pageTarget={{ page: currentPage, nonce: pageNonce }}
                      onPageChange={(page) => setCurrentPage(page)}
                    />
                  </>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </main>

      <AnaliseLabReplicateDialog
        open={Boolean(replicateVersao)}
        versaoLabel={replicateVersao || ""}
        items={itens}
        busy={actionBusy}
        onClose={() => setReplicateVersao(null)}
        onConfirm={(payload) => void handleReplicateItems(payload)}
      />

      <AnaliseLabConcluir
        ano={ano}
        osId={osId}
        versaoLabel={session?.versaoLabel}
        open={concluirOpen}
        onClose={() => setConcluirOpen(false)}
        hasClassicAnalise={false}
      />
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
      {children}
    </div>
  );
}
