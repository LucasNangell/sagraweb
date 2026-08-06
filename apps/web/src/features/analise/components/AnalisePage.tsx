import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@sagra/ui";
import {
  BookOpen,
  Eye,
  Info,
  ListChecks,
  Loader2,
  Copy,
  PenSquare,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addAnaliseItem,
  addProblemaPadrao,
  deleteAnaliseItem,
  ensureAnalise,
  fetchAnaliseFull,
  fetchOsVersions,
  fetchProblemasPadrao,
  fetchUltimoAndamento,
  generateAnaliseLink,
  listAnaliseFiles,
  mapAnaliseItems,
  registerExecutionMovement,
  registerLinkMovement,
  registerPtvDispatch,
  startAnalise,
  toggleResolucaoObrigatoria,
  toggleCorrigidoSefoc,
  updateAnaliseItem,
  updateAnaliseMeta,
  uploadAnaliseIndicationImage,
} from "@/api/analise";
import { fetchOsDetails } from "@/api/os";
import {
  fetchPreAnaliseSnapshot,
  fetchPreAnaliseSnapshotIndex,
  initialPreAnaliseLiveState,
  runPreAnaliseAll,
} from "@/api/preAnalise";
import { queryKeys } from "@/api/query-keys";
import { useAuthStore } from "@/features/auth/authStore";
import {
  silentRefreshOsPanels,
  silentRefreshOsSearch,
} from "@/features/os/osRealtimeSync";
import type {
  AnaliseComponente,
  AnaliseSearchParams,
  AnaliseSelectedItem,
  ProblemaPadrao,
} from "../types";
import type { PreAnaliseCheckResult, PreAnaliseLiveState } from "../preAnaliseTypes";
import { countProblemItems } from "../preAnaliseUtils";
import { ANALISE_COMPONENTES } from "../types";
import {
  appendIndicationToAnaliseHtml,
  buildExecutionObsWithCorrecoes,
  buildPtMovementObsWithCorrecoes,
  hasIndicationInAnaliseHtml,
  parsePgsField,
  removeIndicationFromAnaliseHtml,
} from "../utils";
import { countPdfPagesInFolder } from "../pdfPageCount";
import { AnaliseAnnotationModal } from "./AnaliseAnnotationModal";
import { AnaliseFormattingToolbar } from "./AnaliseFormattingToolbar";
import { AnaliseHtmlEditor } from "./AnaliseHtmlEditor";
import { AnaliseHtmlViewer } from "./AnaliseHtmlViewer";
import {
  isItemFromOlderVersion,
  normalizeComponenteOrigem,
} from "../analiseItemsTree";
import { versionNeedsCapaMioloPrompt } from "../versionPdfClassify";
import { AnaliseItemsTree } from "./AnaliseItemsTree";
import {
  PageDivergenceModal,
  type VersionPageDivergence,
} from "./PageDivergenceModal";
import { PreAnalisePanel } from "./PreAnalisePanel";
import {
  cleanPonto,
  canPromptStartAnalise,
  isSefocSetor,
} from "../analiseAccess";

function resolveVersaoKeyFromStored(
  stored: string | undefined,
  versions: { version: number; label: string }[],
): string {
  if (!stored?.trim()) return "";
  const s = stored.trim();
  const byKey = versions.find((v) => `v${v.version}` === s);
  if (byKey) return `v${byKey.version}`;
  const byLabel = versions.find((v) => v.label === s);
  if (byLabel) return `v${byLabel.version}`;
  const m = s.match(/^v\s*(\d+)/i);
  if (m) return `v${m[1]}`;
  return s;
}

function versaoLabelFromKey(
  versaoKey: string,
  versions: { version: number; label: string }[],
): string {
  const found = versions.find((v) => `v${v.version}` === versaoKey);
  return found?.label ?? versaoKey;
}

interface AnalisePageProps {
  search: AnaliseSearchParams;
}

export function AnalisePage({ search }: AnalisePageProps) {
  const DISABLE_ENTRY_SIDE_EFFECTS = false;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const ponto = user?.ponto != null ? String(user.ponto) : "";
  const userSetor = user?.setor;

  const osId = search.id ? parseInt(search.id, 10) : NaN;
  const ano = search.ano ? parseInt(search.ano, 10) : NaN;
  const validOs = !Number.isNaN(osId) && !Number.isNaN(ano);
  const isSpOs = validOs && osId >= 5000;

  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [analysisId, setAnalysisId] = useState<number | null>(null);
  const [lastAnalysisStatus, setLastAnalysisStatus] = useState<string | null>(null);
  const [readOnlyMode, setReadOnlyMode] = useState(false);
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);

  const [items, setItems] = useState<AnaliseSelectedItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [versaoKey, setVersaoKey] = useState("");
  const [componente, setComponente] = useState<AnaliseComponente>("Capa");
  const [librarySearch, setLibrarySearch] = useState("");

  const [previewLibrary, setPreviewLibrary] = useState<ProblemaPadrao | null>(null);
  const [creatingNewItem, setCreatingNewItem] = useState(false);
  const [newItemHtml, setNewItemHtml] = useState("");

  const [showObsModal, setShowObsModal] = useState(false);
  const [obsModalMode, setObsModalMode] = useState<"empty" | "all_corrected">("empty");
  const [obsText, setObsText] = useState("");
  const [showFileModal, setShowFileModal] = useState(false);
  const [fileList, setFileList] = useState<{ name: string; path: string }[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [filePage, setFilePage] = useState(1);
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [previewHtmlRevision, setPreviewHtmlRevision] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [pageDivergenceModalOpen, setPageDivergenceModalOpen] = useState(false);
  const [capaMioloChoiceByVersion, setCapaMioloChoiceByVersion] = useState<
    Record<string, boolean>
  >({});
  const [preAnalisePanelActive, setPreAnalisePanelActive] = useState(false);
  const [preAnaliseRunning, setPreAnaliseRunning] = useState(false);
  const [preAnaliseLive, setPreAnaliseLive] = useState<PreAnaliseLiveState>(
    initialPreAnaliseLiveState,
  );
  const [preAnaliseResults, setPreAnaliseResults] = useState<PreAnaliseCheckResult[]>(
    [],
  );
  const [preAnaliseSavedAt, setPreAnaliseSavedAt] = useState<string | null>(null);
  const [preAnaliseLoadingSnapshot, setPreAnaliseLoadingSnapshot] = useState(false);
  const [preAnaliseSnapshotByLabel, setPreAnaliseSnapshotByLabel] = useState<
    Record<string, { alertCount: number; executedAt?: string }>
  >({});
  const [togglingItemId, setTogglingItemId] = useState<number | null>(null);
  const [togglingCorrigirItemId, setTogglingCorrigirItemId] = useState<number | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"library" | "items" | "preview">(
    "items",
  );

  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correcaoObsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageDivergenceCheckedRef = useRef(false);
  const capaMioloPromptCheckedRef = useRef(false);
  const analysisStartPromptedRef = useRef<string | null>(null);

  useEffect(() => {
    pageDivergenceCheckedRef.current = false;
    capaMioloPromptCheckedRef.current = false;
    analysisStartPromptedRef.current = null;
    setPageDivergenceModalOpen(false);
    setCapaMioloChoiceByVersion({});
    setVersaoKey("");
  }, [ano, osId]);

  const libraryQuery = useQuery({
    queryKey: queryKeys.analise.library,
    queryFn: fetchProblemasPadrao,
    staleTime: 60_000,
  });

  const versionsQuery = useQuery({
    queryKey: queryKeys.analise.versions(ano, osId),
    queryFn: () => fetchOsVersions(ano, osId),
    enabled: validOs,
    staleTime: 60_000,
    retry: 1,
  });

  const versionsLoading =
    validOs && !versionsQuery.data && versionsQuery.fetchStatus === "fetching";
  const versionsLoadError =
    validOs && versionsQuery.status === "error"
      ? versionsQuery.error instanceof Error
        ? versionsQuery.error.message
        : "Não foi possível carregar as versões."
      : null;

  const detailsQuery = useQuery({
    queryKey: queryKeys.os.details(ano, osId),
    queryFn: () => fetchOsDetails(ano, osId),
    enabled: validOs,
  });

  const versionPaths = useMemo(() => {
    const map: Record<string, string> = {};
    for (const v of versionsQuery.data?.versions ?? []) {
      map[`v${v.version}`] = v.path;
    }
    return map;
  }, [versionsQuery.data]);

  const osVersions = versionsQuery.data?.versions ?? [];

  const versionPdfPageQueries = useQueries({
    queries: osVersions.map((version) => ({
      queryKey: queryKeys.analise.pdfPages(version.path),
      queryFn: () => countPdfPagesInFolder(version.path),
      enabled: Boolean(version.path) && validOs && versionsQuery.isSuccess,
      staleTime: 60_000,
    })),
  });

  const declaredPags = parsePgsField(detailsQuery.data?.Pags);

  const versionPdfPerFile = useMemo(() => {
    const map: Record<string, { name: string; path: string; pages: number }[]> = {};
    for (let i = 0; i < osVersions.length; i++) {
      const version = osVersions[i];
      const query = versionPdfPageQueries[i];
      if (query?.isSuccess && query.data) {
        map[`v${version.version}`] = query.data.perFile;
      }
    }
    return map;
  }, [osVersions, versionPdfPageQueries]);

  const versionPageDivergences = useMemo((): VersionPageDivergence[] => {
    if (declaredPags == null || osVersions.length === 0) return [];
    const i = osVersions.length - 1;
    const version = osVersions[i];
    const query = versionPdfPageQueries[i];
    if (!version?.path) return [];
    if (query?.isError) {
      return [
        {
          versionLabel: version.label,
          declaredPags,
          folderPdfPages: 0,
          pdfCount: 0,
          perFile: [],
          queryError:
            query.error instanceof Error
              ? query.error.message
              : "Não foi possível contar as páginas dos PDFs desta versão.",
        },
      ];
    }
    if (!query?.isSuccess) return [];
    const folderPdfPages = query.data.totalPages;
    if (declaredPags !== folderPdfPages) {
      return [
        {
          versionLabel: version.label,
          declaredPags,
          folderPdfPages,
          pdfCount: query.data.pdfCount,
          perFile: query.data.perFile,
        },
      ];
    }
    return [];
  }, [declaredPags, osVersions, versionPdfPageQueries]);

  useEffect(() => {
    if (bootstrapping || !validOs) return;
    if (pageDivergenceCheckedRef.current) return;
    if (!versionsQuery.isSuccess || !detailsQuery.isSuccess) return;
    if (versionPdfPageQueries.some((q) => q.isLoading || q.isFetching)) return;

    pageDivergenceCheckedRef.current = true;
    if (versionPageDivergences.length > 0) {
      setPageDivergenceModalOpen(true);
    }
  }, [
    bootstrapping,
    validOs,
    versionsQuery.isSuccess,
    detailsQuery.isSuccess,
    versionPdfPageQueries,
    versionPageDivergences.length,
  ]);

  const produto =
    (detailsQuery.data as { TipoPublicacaoLink?: string | null })?.TipoPublicacaoLink ?? "";

  useEffect(() => {
    if (bootstrapping || !validOs) return;
    if (capaMioloPromptCheckedRef.current) return;
    if (!versionsQuery.isSuccess || !detailsQuery.isSuccess) return;
    if (osVersions.length === 0) return;
    const pdfQueriesReady = osVersions.every((v, i) => {
      if (!v.path) return true;
      const q = versionPdfPageQueries[i];
      return q && !q.isLoading && !q.isFetching;
    });
    if (!pdfQueriesReady) return;

    const pending = osVersions.filter((v) => {
      const key = `v${v.version}`;
      const files = versionPdfPerFile[key];
      if (!files?.length) return false;
      return versionNeedsCapaMioloPrompt(files, {
        produto,
        versionLabel: v.label,
        tratarComoCapaMiolo: capaMioloChoiceByVersion[key],
      });
    });

    capaMioloPromptCheckedRef.current = true;
    if (pending.length === 0) return;

    const choices: Record<string, boolean> = {};
    for (const v of pending) {
      const key = `v${v.version}`;
      const files = versionPdfPerFile[key] ?? [];
      const wants = window.confirm(
        `Na pasta «${v.label}» foram encontrados ${files.length} arquivos PDF.\n\n` +
          `O produto «${produto || "desta OS"}» é tratado como arquivo único (sem capa e miolo separados).\n\n` +
          `Deseja considerar capa e miolo para os arquivos desta pasta?`,
      );
      choices[key] = wants;
    }
    setCapaMioloChoiceByVersion((prev) => ({ ...prev, ...choices }));
  }, [
    bootstrapping,
    validOs,
    versionsQuery.isSuccess,
    detailsQuery.isSuccess,
    osVersions,
    versionPdfPageQueries,
    versionPdfPerFile,
    produto,
    capaMioloChoiceByVersion,
  ]);

  useEffect(() => {
    if (!versionsQuery.data?.versions?.length) return;
    const versions = versionsQuery.data.versions;
    setVersaoKey((prev) => {
      if (prev) return prev;
      const last = versions[versions.length - 1];
      return `v${last.version}`;
    });
  }, [versionsQuery.data]);

  const versaoLabel = useMemo(
    () => versaoLabelFromKey(versaoKey, versionsQuery.data?.versions ?? []),
    [versaoKey, versionsQuery.data?.versions],
  );

  const preAnaliseAbortRef = useRef<AbortController | null>(null);
  const preAnaliseSnapshotLoadRef = useRef<AbortController | null>(null);
  const preAnaliseRunningRef = useRef(false);
  preAnaliseRunningRef.current = preAnaliseRunning;

  const refreshPreAnaliseSnapshotIndex = useCallback(async () => {
    if (!validOs) return;
    try {
      const rows = await fetchPreAnaliseSnapshotIndex(ano, osId);
      const versions = versionsQuery.data?.versions ?? [];
      const map: Record<string, { alertCount: number; executedAt?: string }> = {};
      for (const row of rows) {
        if (!row.versao_label) continue;
        const canonicalLabel = versaoLabelFromKey(
          resolveVersaoKeyFromStored(row.versao_label, versions),
          versions,
        );
        const targetLabel = canonicalLabel || row.versao_label;
        const existing = map[targetLabel];
        if (
          existing?.executedAt &&
          row.executed_at &&
          row.executed_at <= existing.executedAt
        ) {
          continue;
        }
        map[targetLabel] = {
          alertCount: row.alert_count ?? 0,
          executedAt: row.executed_at,
        };
      }
      setPreAnaliseSnapshotByLabel(map);
    } catch {
      /* índice opcional — não bloqueia a tela */
    }
  }, [validOs, ano, osId, versionsQuery.data?.versions]);

  useEffect(() => {
    void refreshPreAnaliseSnapshotIndex();
  }, [refreshPreAnaliseSnapshotIndex]);

  const applyLoadedSnapshot = useCallback((snap: Awaited<ReturnType<typeof fetchPreAnaliseSnapshot>>) => {
    if (snap.found && !snap.stale && Array.isArray(snap.results)) {
      setPreAnaliseResults(snap.results);
      setPreAnaliseLive({
        phase: "complete",
        currentCheckName: null,
        currentDetail: null,
        completedChecks: snap.results.length,
        totalChecks: snap.results.length,
      });
      setPreAnaliseSavedAt(snap.executed_at ?? null);
      return;
    }
    setPreAnaliseResults([]);
    setPreAnaliseLive(initialPreAnaliseLiveState());
    setPreAnaliseSavedAt(null);
  }, []);

  const loadPreAnaliseSnapshot = useCallback(async () => {
    if (!validOs || !versaoLabel || !versionsQuery.isSuccess) return;
    preAnaliseSnapshotLoadRef.current?.abort();
    const abortController = new AbortController();
    preAnaliseSnapshotLoadRef.current = abortController;
    setPreAnaliseLoadingSnapshot(true);
    try {
      const snap = await fetchPreAnaliseSnapshot(ano, osId, versaoLabel, abortController.signal);
      if (preAnaliseSnapshotLoadRef.current !== abortController) return;
      if (preAnaliseRunningRef.current) return;
      applyLoadedSnapshot(snap);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      if (preAnaliseSnapshotLoadRef.current === abortController) {
        preAnaliseSnapshotLoadRef.current = null;
        setPreAnaliseLoadingSnapshot(false);
      }
    }
  }, [validOs, ano, osId, versaoLabel, versionsQuery.isSuccess, applyLoadedSnapshot]);

  const handleCancelPreAnalise = useCallback(() => {
    preAnaliseAbortRef.current?.abort();
  }, []);

  const handleRunPreAnalise = useCallback(async () => {
    if (!validOs || !versaoLabel || !versionsQuery.isSuccess) return;
    preAnaliseSnapshotLoadRef.current?.abort();
    preAnaliseAbortRef.current?.abort();
    const abortController = new AbortController();
    preAnaliseAbortRef.current = abortController;

    setPreAnaliseRunning(true);
    setPreAnaliseLive(initialPreAnaliseLiveState());
    setPreAnaliseResults([]);
    try {
      const outcome = await runPreAnaliseAll(
        ano,
        osId,
        versaoLabel,
        setPreAnaliseLive,
        { signal: abortController.signal },
      );
      setPreAnaliseResults(outcome.results);
      if (!outcome.cancelled && outcome.results.length > 0 && outcome.live.phase === "complete") {
        const executedAt = new Date().toISOString();
        setPreAnaliseSavedAt(executedAt);
        setPreAnaliseSnapshotByLabel((prev) => ({
          ...prev,
          [versaoLabel]: {
            alertCount: countProblemItems(outcome.results),
            executedAt,
          },
        }));
        void refreshPreAnaliseSnapshotIndex();
      }
    } finally {
      if (preAnaliseAbortRef.current === abortController) {
        preAnaliseAbortRef.current = null;
      }
      setPreAnaliseRunning(false);
    }
  }, [validOs, ano, osId, versaoLabel, versionsQuery.isSuccess, refreshPreAnaliseSnapshotIndex]);

  useEffect(() => {
    setPreAnalisePanelActive(false);
    preAnaliseSnapshotLoadRef.current?.abort();
    if (preAnaliseRunningRef.current) return;
    setPreAnaliseResults([]);
    setPreAnaliseLive(initialPreAnaliseLiveState());
    setPreAnaliseSavedAt(null);
  }, [versaoKey]);

  const preAnaliseAlertCount = useMemo(() => {
    if (preAnaliseRunning) return 0;
    if (preAnaliseResults.length > 0) return countProblemItems(preAnaliseResults);
    return preAnaliseSnapshotByLabel[versaoLabel]?.alertCount ?? 0;
  }, [preAnaliseRunning, preAnaliseResults, preAnaliseSnapshotByLabel, versaoLabel]);

  const handleSelectPreAnalise = useCallback(() => {
    setPreAnalisePanelActive(true);
    setSelectedItemId(null);
    setPreviewLibrary(null);
    setCreatingNewItem(false);
    setMobilePanel("preview");
  }, []);

  useEffect(() => {
    if (!preAnalisePanelActive || preAnaliseRunningRef.current || !versionsQuery.isSuccess) return;
    void loadPreAnaliseSnapshot();
  }, [preAnalisePanelActive, versaoLabel, versionsQuery.isSuccess, loadPreAnaliseSnapshot]);

  const metaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!validOs || !analysisId || !versaoLabel) return;
    if (metaTimeoutRef.current) clearTimeout(metaTimeoutRef.current);
    metaTimeoutRef.current = setTimeout(() => {
      void updateAnaliseMeta(ano, osId, {
        versao: versaoLabel,
        componente,
      }).catch((e) => console.error("Erro ao gravar versão/componente:", e));
    }, 400);
    return () => {
      if (metaTimeoutRef.current) clearTimeout(metaTimeoutRef.current);
    };
  }, [validOs, analysisId, ano, osId, versaoLabel, componente]);

  const selectedItem = useMemo(
    () => items.find((i) => i.uniqueId === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const selectedItemIsOlderVersion = useMemo(
    () =>
      Boolean(
        selectedItem &&
          isItemFromOlderVersion(selectedItem.versaoOrigem, versaoKey, osVersions),
      ),
    [selectedItem, versaoKey, osVersions],
  );

  const filteredLibrary = useMemo(() => {
    const list = libraryQuery.data ?? [];
    const term = librarySearch.trim().toLowerCase();
    const sorted = [...list].sort((a, b) =>
      (a.TituloPT || "").localeCompare(b.TituloPT || "", "pt-BR"),
    );
    if (!term) return sorted;
    return sorted.filter((item) => (item.TituloPT || "").toLowerCase().includes(term));
  }, [libraryQuery.data, librarySearch]);

  const scheduleItemUpdate = useCallback(
    (itemId: number, fields: { obs?: string; html_snapshot?: string }) => {
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = setTimeout(() => {
        void updateAnaliseItem({ id_item: itemId, ...fields }).catch((e) => {
          console.error(e);
        });
      }, 1000);
    },
    [],
  );

  const handleMoveItemToComponent = useCallback(
    async (itemId: number, targetComponent: string, _versionKey: string) => {
      if (readOnlyMode) return;
      const item = items.find((i) => i.uniqueId === itemId);
      if (!item) return;

      const nextComponente = normalizeComponenteOrigem(targetComponent);
      if (normalizeComponenteOrigem(item.componenteOrigem) === nextComponente) return;

      const previousComponente = item.componenteOrigem;
      setItems((prev) =>
        prev.map((i) =>
          i.uniqueId === itemId ? { ...i, componenteOrigem: nextComponente } : i,
        ),
      );

      try {
        await updateAnaliseItem({ id_item: itemId, componente: nextComponente });
      } catch (e) {
        setItems((prev) =>
          prev.map((i) =>
            i.uniqueId === itemId ? { ...i, componenteOrigem: previousComponente } : i,
          ),
        );
        window.alert(
          e instanceof Error ? e.message : "Erro ao mover item para outro componente.",
        );
      }
    },
    [items, readOnlyMode],
  );

  const bootstrap = useCallback(async () => {
    if (!validOs || !ponto) {
      setBootstrapping(false);
      return;
    }
    setBootstrapping(true);
    setBootstrapError(null);
    try {
      const last = await fetchUltimoAndamento(ano, osId);
      setLastAnalysisStatus(last.situacao ?? null);

      const currentClean = cleanPonto(ponto);
      const lastClean = cleanPonto(last.ponto);
      const isSefocUser = isSefocSetor(userSetor);

      let canEdit = false;
      let blockedReason: string | null = null;
      if (!isSefocUser) {
        blockedReason =
          "Apenas usuários do setor SEFOC podem registrar problemas técnicos.";
      } else if (canPromptStartAnalise(last.situacao)) {
        const promptKey = `${ano}-${osId}-${cleanPonto(ponto)}`;
        let wantsToStart = false;
        if (analysisStartPromptedRef.current === promptKey) {
          wantsToStart = true;
        } else {
          wantsToStart = window.confirm(
            "Deseja lançar o recebido no sistema e iniciar a análise deste arquivo agora?",
          );
          if (wantsToStart) {
            analysisStartPromptedRef.current = promptKey;
          }
        }

        if (wantsToStart) {
          await startAnalise({
            os_id: osId,
            ano,
            ponto,
            usuario: ponto,
          });
          setLastAnalysisStatus("Recebido");
          await Promise.all([
            silentRefreshOsSearch(qc, undefined, { skipCrossTabLock: true }),
            silentRefreshOsPanels(qc, ano, osId),
          ]);
          canEdit = true;
        } else {
          canEdit = false;
          blockedReason =
            "Análise aberta em modo visualização porque o início da análise não foi confirmado.";
        }
      } else if (last.situacao === "Recebido") {
        canEdit = Boolean(lastClean) && lastClean === currentClean;
        if (!canEdit) {
          blockedReason = `Arquivo sob análise pelo usuário ${last.ponto ?? "responsável atual"}.`;
        }
      } else if (last.situacao === "Problemas Técnicos") {
        canEdit = true;
      } else {
        blockedReason =
          "A análise está em modo visualização porque a situação atual da OS não permite iniciar análise.";
      }
      setReadOnlyMode(!canEdit);
      setReadOnlyReason(blockedReason);

      if (!DISABLE_ENTRY_SIDE_EFFECTS) {
        if (
          isSefocUser &&
          last.situacao !== "Problemas Técnicos" &&
          last.situacao !== "Recebido" &&
          !canPromptStartAnalise(last.situacao)
        ) {
          await startAnalise({
            os_id: osId,
            ano,
            ponto,
            usuario: ponto,
          });
        }

        const ensured = await ensureAnalise({
          nro_os: osId,
          ano_os: ano,
          usuario: ponto,
        });
        setAnalysisId(ensured.id);
      }

      const full = await fetchAnaliseFull(ano, osId);
      if (full.exists) {
        setAnalysisId(full.id ?? null);
        const fallbackVersao = full.versao?.trim() || "";
        setItems(
          mapAnaliseItems(full.items).map((item) => ({
            ...item,
            versaoOrigem: item.versaoOrigem || fallbackVersao || undefined,
          })),
        );
        if (full.componente && ANALISE_COMPONENTES.includes(full.componente as AnaliseComponente)) {
          setComponente(full.componente as AnaliseComponente);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao iniciar análise.";
      setBootstrapError(msg);
      if (msg.includes("já está sendo realizada")) {
        window.alert(msg);
        void navigate({ to: "/" });
      }
    } finally {
      setBootstrapping(false);
    }
  }, [ano, navigate, osId, ponto, qc, userSetor, validOs]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const addItemMutation = useMutation({
    mutationFn: addAnaliseItem,
    onError: (e) => {
      window.alert(e instanceof Error ? e.message : "Erro ao adicionar item.");
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: deleteAnaliseItem,
    onMutate: (itemId) => {
      setDeletingItemId(itemId);
    },
    onSuccess: (_, itemId) => {
      setItems((prev) => prev.filter((i) => i.uniqueId !== itemId));
      if (selectedItemId === itemId) {
        setSelectedItemId(null);
      }
    },
    onError: (e) => {
      window.alert(e instanceof Error ? e.message : "Erro ao remover item.");
    },
    onSettled: () => {
      setDeletingItemId(null);
    },
  });

  const toggleResolucaoMutation = useMutation({
    mutationFn: toggleResolucaoObrigatoria,
    onMutate: (variables) => {
      setTogglingItemId(variables.id_item);
    },
    onSuccess: (data, variables) => {
      setItems((prev) =>
        prev.map((i) =>
          i.uniqueId === variables.id_item
            ? { ...i, resolucaoObrigatoria: data.resolucao_obrigatoria }
            : i,
        ),
      );
    },
    onError: (e) => {
      window.alert(e instanceof Error ? e.message : "Erro ao atualizar resolução obrigatória.");
    },
    onSettled: () => {
      setTogglingItemId(null);
    },
  });

  const toggleCorrigidoMutation = useMutation({
    mutationFn: toggleCorrigidoSefoc,
    onMutate: (variables) => {
      setTogglingCorrigirItemId(variables.id_item);
    },
    onSuccess: (data, variables) => {
      setItems((prev) =>
        prev.map((i) =>
          i.uniqueId === variables.id_item
            ? {
                ...i,
                corrigidoSefoc: data.corrigido_sefoc,
                obsCorrecaoSefoc: data.obs_correcao_sefoc,
              }
            : i,
        ),
      );
    },
    onError: (e) => {
      window.alert(e instanceof Error ? e.message : "Erro ao registrar correção interna.");
    },
    onSettled: () => {
      setTogglingCorrigirItemId(null);
    },
  });

  const scheduleCorrecaoObsUpdate = useCallback((itemId: number, obs: string) => {
    setItems((prev) =>
      prev.map((i) => (i.uniqueId === itemId ? { ...i, obsCorrecaoSefoc: obs } : i)),
    );
    if (correcaoObsTimeoutRef.current) clearTimeout(correcaoObsTimeoutRef.current);
    correcaoObsTimeoutRef.current = setTimeout(() => {
      void toggleCorrigidoSefoc({
        id_item: itemId,
        corrigido_sefoc: true,
        obs_correcao_sefoc: obs,
      }).catch((e) => {
        console.error(e);
      });
    }, 800);
  }, []);

  const handlePreviewLibrary = (item: ProblemaPadrao) => {
    setPreAnalisePanelActive(false);
    setPreviewLibrary(item);
    setCreatingNewItem(false);
    setNewItemHtml(item.ProbTecHTML || "");
    setSelectedItemId(null);
    setMobilePanel("preview");
  };

  const handleRegisterPt = async () => {
    if (readOnlyMode) {
      window.alert(readOnlyReason ?? "Análise em modo visualização.");
      return;
    }
    if (!previewLibrary?.ID) {
      window.alert("Selecione um item na biblioteca.");
      return;
    }
    if (!validOs || !ponto) {
      window.alert("OS ou usuário inválido para registro.");
      return;
    }

    let idAnalise = analysisId;
    if (idAnalise == null) {
      try {
        const ensured = await ensureAnalise({
          nro_os: osId,
          ano_os: ano,
          usuario: ponto,
        });
        idAnalise = ensured.id;
        setAnalysisId(ensured.id);
      } catch (e) {
        window.alert(
          e instanceof Error ? e.message : "Erro ao preparar a análise para registro.",
        );
        return;
      }
    }

    try {
      const itemVersao = versaoLabel || versaoKey;
      const res = await addItemMutation.mutateAsync({
        id_analise: idAnalise,
        id_padrao: previewLibrary.ID,
        componente,
        versao: itemVersao,
        obs: "",
        html_snapshot: previewLibrary.ProbTecHTML,
      });
      const instance: AnaliseSelectedItem = {
        uniqueId: res.id,
        originalId: previewLibrary.ID,
        titulo: previewLibrary.TituloPT,
        html: previewLibrary.ProbTecHTML ?? "",
        obs: "",
        componenteOrigem: componente,
        versaoOrigem: itemVersao,
        resolucaoObrigatoria: false,
      };
      setItems((prev) => [...prev, instance]);
      setSelectedItemId(instance.uniqueId);
      setPreviewLibrary(null);
    } catch {
      /* onError */
    }
  };

  const handleStartNewLibraryItem = () => {
    const title = window.prompt("Digite o título para o novo Item de Problema Técnico:");
    if (!title?.trim()) return;
    setCreatingNewItem(true);
    setPreviewLibrary({
      ID: 0,
      TituloPT: title.trim(),
      ProbTecHTML: previewLibrary?.ProbTecHTML ?? "",
      Categoria: "Geral",
    });
    setNewItemHtml(previewLibrary?.ProbTecHTML ?? "");
  };

  const saveNewLibraryMutation = useMutation({
    mutationFn: addProblemaPadrao,
    onSuccess: async (data) => {
      window.alert(`Item "${data.titulo}" criado com sucesso!`);
      await qc.invalidateQueries({ queryKey: queryKeys.analise.library });
      const created: ProblemaPadrao = {
        ID: data.id,
        TituloPT: data.titulo,
        ProbTecHTML: newItemHtml,
        Categoria: "Geral",
      };
      setCreatingNewItem(false);
      handlePreviewLibrary(created);
    },
    onError: (e) => {
      window.alert(e instanceof Error ? e.message : "Erro ao criar item.");
    },
  });

  const handleReplicatePt = async () => {
    if (readOnlyMode) {
      window.alert(readOnlyReason ?? "Análise em modo visualização.");
      return;
    }
    if (!selectedItem) {
      window.alert("Nenhum item selecionado.");
      return;
    }
    const idPadrao = selectedItem.originalId;
    if (!idPadrao) {
      window.alert(
        "Este problema não possui vínculo com a biblioteca e não pode ser replicado automaticamente.",
      );
      return;
    }
    if (!validOs || !ponto) {
      window.alert("OS ou usuário inválido para registro.");
      return;
    }

    let idAnalise = analysisId;
    if (idAnalise == null) {
      try {
        const ensured = await ensureAnalise({
          nro_os: osId,
          ano_os: ano,
          usuario: ponto,
        });
        idAnalise = ensured.id;
        setAnalysisId(ensured.id);
      } catch (e) {
        window.alert(
          e instanceof Error ? e.message : "Erro ao preparar a análise para replicação.",
        );
        return;
      }
    }

    const normalized = normalizeComponenteOrigem(selectedItem.componenteOrigem);
    const targetComponente = (ANALISE_COMPONENTES as readonly string[]).includes(normalized)
      ? (normalized as AnaliseComponente)
      : componente;
    const itemVersao = versaoLabel || versaoKey;

    try {
      const res = await addItemMutation.mutateAsync({
        id_analise: idAnalise,
        id_padrao: idPadrao,
        componente: targetComponente,
        versao: itemVersao,
        obs: selectedItem.obs ?? "",
        html_snapshot: selectedItem.html ?? "",
      });
      const instance: AnaliseSelectedItem = {
        uniqueId: res.id,
        originalId: idPadrao,
        titulo: selectedItem.titulo,
        html: selectedItem.html ?? "",
        obs: selectedItem.obs ?? "",
        componenteOrigem: targetComponente,
        versaoOrigem: itemVersao,
        resolucaoObrigatoria: selectedItem.resolucaoObrigatoria ?? false,
      };
      setItems((prev) => [...prev, instance]);
      setSelectedItemId(instance.uniqueId);
      setComponente(targetComponente);
      window.alert(
        `Problema replicado para ${itemVersao} (${targetComponente}).`,
      );
    } catch {
      /* onError */
    }
  };

  const handleOpenAnnotation = async () => {
    if (readOnlyMode) {
      window.alert(readOnlyReason ?? "Análise em modo visualização.");
      return;
    }
    if (!selectedItem) {
      window.alert("Nenhum item selecionado.");
      return;
    }
    const path = versionPaths[versaoKey];
    if (!path) {
      window.alert("Selecione uma versão analisada válida.");
      return;
    }
    try {
      const data = await listAnaliseFiles(path);
      setFileList(data.files ?? []);
      setSelectedFile(data.files?.[0]?.path ?? "");
      setFilePage(1);
      setShowFileModal(true);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erro ao listar arquivos.");
    }
  };

  const handleConfirmFile = () => {
    if (!selectedFile) return;
    setShowFileModal(false);
    setAnnotationOpen(true);
  };

  const handleAnnotationSave = (dataUrl: string) => {
    if (!selectedItem) return;
    void (async () => {
      try {
        const { url } = await uploadAnaliseIndicationImage(
          selectedItem.uniqueId,
          dataUrl,
        );
        const newHtml = appendIndicationToAnaliseHtml(selectedItem.html || "", url);
        if (newHtml === (selectedItem.html || "")) {
          window.alert("Não foi possível gerar a imagem de indicação.");
          return;
        }
        const itemId = selectedItem.uniqueId;
        setItems((prev) =>
          prev.map((i) => (i.uniqueId === itemId ? { ...i, html: newHtml } : i)),
        );
        setPreviewHtmlRevision((r) => r + 1);
        if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
        void updateAnaliseItem({ id_item: itemId, html_snapshot: newHtml }).catch((e) => {
          console.error(e);
          window.alert("Erro ao gravar a indicação no item.");
        });
      } catch (e) {
        window.alert(
          e instanceof Error ? e.message : "Erro ao salvar imagem de indicação.",
        );
      }
    })();
  };

  const handleRemoveIndication = () => {
    if (readOnlyMode) {
      window.alert(readOnlyReason ?? "Análise em modo visualização.");
      return;
    }
    if (!selectedItem) return;
    const currentHtml = selectedItem.html || "";
    if (!hasIndicationInAnaliseHtml(currentHtml)) return;
    if (
      !window.confirm("Remover a imagem de indicação no arquivo deste problema técnico?")
    ) {
      return;
    }
    const newHtml = removeIndicationFromAnaliseHtml(currentHtml);
    if (newHtml === currentHtml) {
      window.alert("Não foi possível remover a indicação.");
      return;
    }
    const itemId = selectedItem.uniqueId;
    setItems((prev) =>
      prev.map((i) => (i.uniqueId === itemId ? { ...i, html: newHtml } : i)),
    );
    setPreviewHtmlRevision((r) => r + 1);
    if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
    void updateAnaliseItem({ id_item: itemId, html_snapshot: newHtml }).catch((e) => {
      console.error(e);
      window.alert("Erro ao remover a indicação do item.");
    });
  };

  const handleFinish = async () => {
    if (readOnlyMode) {
      window.alert(readOnlyReason ?? "Análise em modo visualização.");
      return;
    }
    if (!validOs) return;

    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }
    if (correcaoObsTimeoutRef.current) {
      clearTimeout(correcaoObsTimeoutRef.current);
      correcaoObsTimeoutRef.current = null;
    }

    const correctedItems = items.filter((i) => i.corrigidoSefoc);
    const activeClientItems = items.filter((i) => !i.corrigidoSefoc);
    const allCorrected = items.length > 0 && correctedItems.length === items.length;
    const hasCorrections = correctedItems.length > 0;
    const hasUncorrectedClientItems = activeClientItems.length > 0;
    const isPtSituation = lastAnalysisStatus === "Problemas Técnicos";

    if (items.length === 0) {
      setObsModalMode("empty");
      setObsText("");
      setShowObsModal(true);
      return;
    }

    if (allCorrected) {
      setObsModalMode("all_corrected");
      setObsText(buildExecutionObsWithCorrecoes(items));
      setShowObsModal(true);
      return;
    }

    setFinishing(true);
    try {
      const versionLabel = versaoLabel || versaoKey.replace(/^v/, "v");
      await updateAnaliseMeta(ano, osId, { versao: versionLabel, componente });

      if (hasCorrections && hasUncorrectedClientItems) {
        const linkRes = await generateAnaliseLink(ano, osId, versionLabel, ponto);
        await registerLinkMovement({
          os_id: osId,
          ano,
          usuario: ponto,
          link: linkRes.url,
          versao: versionLabel,
          observacao: buildPtMovementObsWithCorrecoes(items, versionLabel),
        });
      } else if (isPtSituation) {
        await registerPtvDispatch({
          os_id: osId,
          ano,
          usuario: ponto,
          versao: versionLabel,
        });
        await generateAnaliseLink(ano, osId, versionLabel, ponto);
      } else {
        const linkRes = await generateAnaliseLink(ano, osId, versionLabel, ponto);
        await registerLinkMovement({
          os_id: osId,
          ano,
          usuario: ponto,
          link: linkRes.url,
          versao: versionLabel,
        });
      }

      window.alert(isPtSituation ? "Problemas confirmados." : "Análise concluída.");
      void navigate({ to: "/" });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erro ao finalizar análise.");
    } finally {
      setFinishing(false);
    }
  };

  const handleConfirmObservacao = async () => {
    if (!obsText.trim()) {
      window.alert("Informe a observação.");
      return;
    }
    setFinishing(true);
    try {
      const versionLabel = versaoLabel || versaoKey.replace(/^v/, "v");
      if (obsModalMode === "all_corrected") {
        await updateAnaliseMeta(ano, osId, { versao: versionLabel, componente });
      }
      await registerExecutionMovement({
        os_id: osId,
        ano,
        observacao: obsText.trim(),
        ponto,
      });
      window.alert(obsModalMode === "all_corrected" ? "Análise concluída." : "Análise concluída.");
      setShowObsModal(false);
      setObsModalMode("empty");
      void navigate({ to: "/" });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erro ao registrar andamento.");
    } finally {
      setFinishing(false);
    }
  };

  if (!validOs || isSpOs) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <Search className="size-10 text-slate-400" />
        <p className="text-sm font-semibold text-secondary-blue">
          {isSpOs
            ? "Análise disponível apenas para OS reprográficas"
            : "Selecione uma OS na tela Início"}
        </p>
        <p className="max-w-md text-sm text-slate-500">
          {isSpOs ? (
            <>
              A análise técnica é restrita a OS com número inferior a 5000. Selecione uma OS
              reprográfica na lista do Início e acesse Análise pelo menu lateral.
            </>
          ) : (
            <>
              A análise técnica exige os parâmetros <strong>ano</strong> e <strong>id</strong> da
              ordem de serviço. Selecione uma linha na lista e acesse Análise pelo menu lateral.
            </>
          )}
        </p>
      </div>
    );
  }

  if (bootstrapping) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="size-8 animate-spin" />
        <p className="text-sm">Carregando análise técnica…</p>
      </div>
    );
  }

  if (bootstrapError && !analysisId) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        {bootstrapError}
      </div>
    );
  }

  const titulo = (detailsQuery.data as { Titulo?: string })?.Titulo ?? "Sem título";
  const details = detailsQuery.data;

  const previewMode: "library" | "item" | "pre-analise" | "empty" = preAnalisePanelActive
    ? "pre-analise"
    : selectedItem
      ? "item"
      : previewLibrary
        ? "library"
        : "empty";

  const isPtSituation = lastAnalysisStatus === "Problemas Técnicos";

  const mobilePanelClass = (panel: "library" | "items" | "preview") =>
    cn(
      mobilePanel !== panel && "max-md:hidden",
      panel === "preview"
        ? "flex min-h-[min(50vh,420px)] flex-col md:min-h-0"
        : "flex min-h-[min(50vh,360px)] flex-col md:min-h-[clamp(200px,38vh,320px)] md:min-h-0",
      "min-w-0 max-md:overflow-visible md:overflow-hidden",
    );

  return (
    <div className="flex min-h-min flex-1 flex-col gap-2 p-2 md:h-full md:min-h-0 md:overflow-hidden md:p-3">
      {/* Toolbar */}
      <section className="shrink-0 rounded-lg border border-t-[3px] border-sagra-border border-t-primary-green bg-white px-3 py-3 shadow-sm sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 flex-1 sm:min-w-[140px] sm:flex-[2]">
            <label className="text-xs font-semibold text-slate-600">OS selecionada</label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={`${osId}/${ano}`}
                className="h-9 w-full rounded border border-slate-200 bg-slate-100 px-2 text-sm font-bold sm:w-24"
              />
              <input
                readOnly
                value={titulo}
                className="h-9 min-w-0 flex-1 rounded border border-slate-200 bg-slate-100 px-2 text-sm"
              />
            </div>
          </div>
          <div className="min-w-0 flex-1 sm:min-w-[120px]">
            <label className="text-xs font-semibold text-slate-600">Versão analisada</label>
            <select
              value={versaoKey}
              onChange={(e) => setVersaoKey(e.target.value)}
              className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-sm"
              disabled={versionsLoading}
            >
              {!validOs ? (
                <option value="">Selecione uma OS</option>
              ) : versionsLoading ? (
                <option value="">Carregando…</option>
              ) : versionsLoadError ? (
                <option value="">Erro ao carregar versões</option>
              ) : (versionsQuery.data?.versions.length ?? 0) === 0 ? (
                <option value="">Nenhuma pasta Original</option>
              ) : (
                versionsQuery.data?.versions.map((v) => (
                  <option key={v.version} value={`v${v.version}`}>
                    {v.label}
                  </option>
                ))
              )}
            </select>
            {versionsLoadError ? (
              <p className="mt-1 text-[11px] leading-snug text-red-600">
                {versionsLoadError}{" "}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => void versionsQuery.refetch()}
                >
                  Tentar novamente
                </button>
              </p>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 sm:min-w-[140px] sm:flex-[2]">
            <label className="text-xs font-semibold text-slate-600">Componente / Arquivo</label>
            <select
              value={componente}
              onChange={(e) => setComponente(e.target.value as AnaliseComponente)}
              className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-sm"
            >
              {ANALISE_COMPONENTES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex shrink-0 flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {readOnlyMode ? (
            <div className="mr-auto rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-center text-sm font-bold text-amber-900 shadow-sm sm:text-left">
              MODO VISUALIZACAO ATIVO
            </div>
          ) : null}
          <button
            type="button"
            disabled={finishing || readOnlyMode}
            onClick={() => void handleFinish()}
            className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-green px-5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60 sm:w-auto"
          >
            {finishing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4 shrink-0" />
            )}
            {isPtSituation ? "Confirmar problemas" : "Concluir e salvar"}
          </button>
        </div>
      </section>

      <div
        className="flex shrink-0 gap-1 rounded-lg border border-sagra-border bg-white p-1 shadow-sm md:hidden"
        role="tablist"
        aria-label="Painéis da análise"
      >
        {(
          [
            ["library", "Biblioteca"],
            ["items", "Itens"],
            ["preview", "Relatório"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mobilePanel === id}
            onClick={() => setMobilePanel(id)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-[0.7rem] font-semibold transition-colors",
              mobilePanel === id
                ? "bg-secondary-blue text-white"
                : "text-neutral-600 hover:bg-slate-50",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Workspace */}
      <div className="flex min-h-min flex-col gap-2 md:grid md:min-h-0 md:flex-1 md:auto-rows-fr md:grid-cols-2 lg:grid-cols-[minmax(220px,1.3fr)_minmax(220px,0.9fr)_minmax(280px,1.5fr)]">
        {/* Biblioteca */}
        <section
          className={cn(
            mobilePanelClass("library"),
            "rounded-lg border border-sagra-border bg-white shadow-sm",
          )}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-sagra-border bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
            <span className="flex items-center gap-2">
              <BookOpen className="size-4 text-secondary-blue" />
              Biblioteca
            </span>
            <button
              type="button"
              onClick={() => void qc.invalidateQueries({ queryKey: queryKeys.analise.library })}
              className="rounded p-1 text-slate-500 hover:bg-slate-200"
              title="Atualizar"
            >
              <RefreshCw className="size-4" />
            </button>
          </header>
          <div className="shrink-0 border-b border-sagra-border p-2">
            {!readOnlyMode ? (
              <input
                type="search"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Pesquisar…"
                className="h-8 w-full rounded border border-slate-200 px-2 text-sm"
              />
            ) : (
              <p className="text-center text-xs font-semibold text-amber-800">
                Biblioteca desabilitada em modo visualizacao.
              </p>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {readOnlyMode ? (
              <p className="p-4 text-center text-sm font-semibold text-amber-800">
                A analise foi aberta em modo visualizacao.
              </p>
            ) : libraryQuery.isPending ? (
              <p className="p-4 text-center text-sm text-slate-500">Carregando…</p>
            ) : libraryQuery.isError ? (
              <p className="p-4 text-center text-sm text-red-600">Erro ao carregar biblioteca.</p>
            ) : filteredLibrary.length === 0 ? (
              <p className="p-4 text-center text-sm text-slate-500">Biblioteca vazia.</p>
            ) : (
              filteredLibrary.map((item) => (
                <button
                  key={item.ID}
                  type="button"
                  onClick={() => handlePreviewLibrary(item)}
                  className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2.5 text-left text-sm hover:bg-blue-50"
                >
                  <span>{item.TituloPT}</span>
                  <Eye className="size-3.5 shrink-0 text-slate-400" />
                </button>
              ))
            )}
          </div>
        </section>

        {/* Itens + detalhes OS */}
        <section
          className={cn(
            mobilePanelClass("items"),
            "rounded-lg border border-sagra-border bg-white shadow-sm lg:col-span-1",
          )}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-sagra-border bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
            <span className="flex items-center gap-2">
              <ListChecks className="size-4 text-secondary-blue" />
              Itens da análise
            </span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
              {items.length} itens
            </span>
          </header>
          <div className="min-h-0 flex-[2] overflow-y-auto">
            <AnaliseItemsTree
              versions={osVersions}
              items={items}
              versionPdfPerFile={versionPdfPerFile}
              produto={produto}
              capaMioloChoiceByVersion={capaMioloChoiceByVersion}
              activeVersaoKey={versaoKey}
              selectedItemId={selectedItemId}
              preAnaliseSelected={preAnalisePanelActive}
              preAnaliseRunning={preAnaliseRunning}
              preAnaliseAlertCount={preAnaliseAlertCount}
              onSelectPreAnalise={handleSelectPreAnalise}
              onSelectItem={(itemId) => {
                setPreAnalisePanelActive(false);
                setSelectedItemId(itemId);
                setPreviewLibrary(null);
                setMobilePanel("preview");
              }}
              onToggleResolucao={(itemId, nextValue) => {
                if (readOnlyMode) return;
                void toggleResolucaoMutation.mutateAsync({
                  id_item: itemId,
                  resolucao_obrigatoria: nextValue,
                });
              }}
              onToggleCorrigir={(itemId, nextValue) => {
                if (readOnlyMode) return;
                const item = items.find((i) => i.uniqueId === itemId);
                void toggleCorrigidoMutation.mutateAsync({
                  id_item: itemId,
                  corrigido_sefoc: nextValue,
                  obs_correcao_sefoc: nextValue ? item?.obsCorrecaoSefoc ?? "" : "",
                });
              }}
              onCorrecaoObsChange={(itemId, obs) => {
                if (readOnlyMode) return;
                scheduleCorrecaoObsUpdate(itemId, obs);
              }}
              onDeleteItem={(item) => {
                if (readOnlyMode) return;
                if (!window.confirm(`Excluir o item "${item.titulo}"?`)) return;
                void deleteItemMutation.mutateAsync(item.uniqueId);
              }}
              onObsChange={(itemId, obs) => {
                if (readOnlyMode) return;
                setItems((prev) =>
                  prev.map((i) => (i.uniqueId === itemId ? { ...i, obs } : i)),
                );
                scheduleItemUpdate(itemId, { obs });
              }}
              onOpenVersionFile={(comp) => {
                if ((ANALISE_COMPONENTES as readonly string[]).includes(comp)) {
                  setComponente(comp);
                }
              }}
              onMoveItemToComponent={(itemId, targetComponent, versionKey) => {
                void handleMoveItemToComponent(itemId, targetComponent, versionKey);
              }}
              togglingItemId={togglingItemId ?? undefined}
              togglingCorrigirItemId={togglingCorrigirItemId ?? undefined}
              deletingItemId={deletingItemId ?? undefined}
              readOnly={readOnlyMode}
            />
          </div>
          <div className="flex shrink-0 flex-col border-t-2 border-slate-200 bg-[#f8f9fa] max-md:overflow-visible md:min-h-0 md:flex-1 md:overflow-hidden">
            <header className="flex shrink-0 items-center gap-2 border-b border-slate-300 bg-[#e9ecef] px-2.5 py-1.5 text-xs font-bold text-slate-600">
              <Info className="size-3.5" />
              Detalhes da OS
            </header>
            <div className="flex flex-col gap-1 p-1.5 text-xs max-md:overflow-visible md:min-h-0 md:flex-1 md:overflow-hidden">
              <div className="grid shrink-0 grid-cols-2 gap-1 sm:flex sm:flex-wrap">
                <OsDetailField label="Máquina" className="min-w-0 sm:flex-[1.5]">
                  <OsDetailInput value={details?.MaquinaLink} />
                </OsDetailField>
                <OsDetailField label="Formato" className="min-w-0 sm:flex-1">
                  <OsDetailInput value={details?.FormatoLink} />
                </OsDetailField>
                <OsDetailField label="Tiragem" className="min-w-0 sm:w-16">
                  <OsDetailInput value={details?.Tiragem} />
                </OsDetailField>
                <OsDetailField label="Pgs" className="min-w-0 sm:w-12">
                  <OsDetailInput value={details?.Pags} />
                </OsDetailField>
              </div>
              <div className="flex flex-col gap-1 lg:min-h-0 lg:flex-1 lg:flex-row">
                <div className="flex min-w-0 flex-col gap-1 lg:min-h-0 lg:flex-1">
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:min-h-0 lg:flex-1">
                    <OsDetailField label="Papel" className="flex min-w-0 flex-col">
                      <OsDetailTextarea
                        value={[details?.PapelLink, details?.PapelDescricao].filter(Boolean).join("\n")}
                      />
                    </OsDetailField>
                    <OsDetailField label="Cores" className="flex min-w-0 flex-col">
                      <OsDetailTextarea
                        value={[details?.Cores, details?.CoresDescricao].filter(Boolean).join("\n")}
                      />
                    </OsDetailField>
                  </div>
                  <OsDetailField label="Observação" className="flex flex-col">
                    <OsDetailTextarea value={details?.Observ} />
                  </OsDetailField>
                </div>
                <OsDetailField label="Acabamento" className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
                  <OsDetailTextarea value={details?.DescAcabamento} />
                </OsDetailField>
              </div>
            </div>
          </div>
        </section>

        {/* Preview */}
        <section
          className={cn(
            mobilePanelClass("preview"),
            "rounded-lg border border-sagra-border bg-slate-100 shadow-sm md:col-span-2 lg:col-span-1",
          )}
        >
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-sagra-border bg-slate-50 px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
              {previewMode === "pre-analise" ? (
                <>
                  <ListChecks className="size-4 text-secondary-blue" />
                  Pré-análise automática
                </>
              ) : (
                <>
                  <Eye className="size-4 text-secondary-blue" />
                  Relatório (item editável)
                </>
              )}
            </span>
            <div className="flex flex-wrap gap-1">
              {previewMode === "library" && !creatingNewItem && !readOnlyMode ? (
                <>
                  <ActionChip
                    onClick={() => void handleRegisterPt()}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Registrar PT
                  </ActionChip>
                  <ActionChip onClick={handleStartNewLibraryItem}>
                    <Plus className="size-3" /> Adicionar item
                  </ActionChip>
                </>
              ) : null}
              {previewMode === "library" && creatingNewItem && !readOnlyMode ? (
                <ActionChip
                  onClick={() =>
                    previewLibrary &&
                    void saveNewLibraryMutation.mutateAsync({
                      titulo: previewLibrary.TituloPT,
                      html_snapshot: newItemHtml,
                      categoria: "Geral",
                    })
                  }
                >
                  <Save className="size-3" /> Salvar novo item
                </ActionChip>
              ) : null}
              {previewMode === "item" && !readOnlyMode ? (
                selectedItemIsOlderVersion ? (
                  <ActionChip onClick={() => void handleReplicatePt()}>
                    <Copy className="size-3" /> Replicar PT
                  </ActionChip>
                ) : (
                  <>
                    <ActionChip onClick={() => void handleOpenAnnotation()}>
                      <PenSquare className="size-3" /> Indicar no arquivo
                    </ActionChip>
                    {hasIndicationInAnaliseHtml(selectedItem.html || "") ? (
                      <ActionChip onClick={handleRemoveIndication}>
                        <Trash2 className="size-3" /> Remover indicação
                      </ActionChip>
                    ) : null}
                  </>
                )
              ) : null}
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {previewMode === "empty" ? (
              <p className="py-12 text-center text-sm text-slate-500">
                Selecione um item da biblioteca, um item da análise ou{" "}
                <strong>Pré-análise</strong> na versão atual.
              </p>
            ) : previewMode === "pre-analise" ? (
              <PreAnalisePanel
                running={preAnaliseRunning}
                loadingSnapshot={preAnaliseLoadingSnapshot}
                live={preAnaliseLive}
                results={preAnaliseResults}
                versaoLabel={versaoLabel}
                savedAt={preAnaliseSavedAt}
                onRun={() => void handleRunPreAnalise()}
                onCancel={handleCancelPreAnalise}
                canRun={validOs && Boolean(versaoKey)}
              />
            ) : previewMode === "library" && previewLibrary ? (
              <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
                <h4 className="mb-2 border-b border-slate-100 pb-2 text-sm font-bold text-primary-green">
                  {creatingNewItem ? `Criando: ${previewLibrary.TituloPT}` : "Pré-visualização"}
                </h4>
                <AnaliseFormattingToolbar visible={creatingNewItem} />
                {creatingNewItem ? (
                  <AnaliseHtmlEditor
                    key={`new-${previewLibrary.TituloPT}`}
                    html={newItemHtml}
                    itemTitulo={previewLibrary.TituloPT}
                    onChange={setNewItemHtml}
                    className="min-h-[100px] border-2 border-dashed border-sky-400"
                    readOnly={readOnlyMode}
                  />
                ) : (
                  <AnaliseHtmlViewer
                    html={previewLibrary.ProbTecHTML ?? ""}
                    itemTitulo={previewLibrary.TituloPT}
                    className="rounded border border-dashed border-slate-300 bg-slate-50 p-2 text-sm"
                  />
                )}
              </div>
            ) : selectedItem ? (
              <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
                <p className="mb-2 text-xs font-bold text-slate-500">
                  SIMULAÇÃO ({selectedItem.componenteOrigem || "Geral"})
                </p>
                <AnaliseFormattingToolbar visible />
                <AnaliseHtmlEditor
                  key={`${selectedItem.uniqueId}-r${previewHtmlRevision}`}
                  html={selectedItem.html}
                  itemTitulo={selectedItem.titulo}
                  onChange={(html) => {
                    if (readOnlyMode) return;
                    setItems((prev) =>
                      prev.map((i) =>
                        i.uniqueId === selectedItem.uniqueId ? { ...i, html } : i,
                      ),
                    );
                    scheduleItemUpdate(selectedItem.uniqueId, { html_snapshot: html });
                  }}
                  className="min-h-[80px]"
                  readOnly={readOnlyMode}
                />
                <div className="mt-4 border-t border-dashed border-slate-200 pt-2">
                  <p className="text-[10px] font-bold text-slate-500">Observação adicional</p>
                  <p className="mt-1 rounded border-l-4 border-amber-400 bg-amber-50 px-2 py-1 text-sm text-amber-900">
                    {selectedItem.obs || "(Vazio)"}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {/* Modal observação sem PT */}
      {showObsModal ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-center text-lg font-bold text-slate-800">
              {obsModalMode === "all_corrected"
                ? "Todos os problemas foram corrigidos"
                : "Nenhum problema técnico registrado"}
            </h3>
            <p className="mt-2 text-center text-sm text-slate-600">
              {obsModalMode === "all_corrected"
                ? "Revise a observação e confirme o andamento Em Execução."
                : "Informe a observação para lançamento do andamento."}
            </p>
            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Observação <span className="text-red-600">*</span>
            </label>
            <textarea
              rows={obsModalMode === "all_corrected" ? 8 : 4}
              value={obsText}
              onChange={(e) => setObsText(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Digite a observação…"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowObsModal(false);
                  setObsModalMode("empty");
                }}
                className="flex-1 rounded border border-slate-300 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={finishing}
                onClick={() => void handleConfirmObservacao()}
                className="flex-1 rounded bg-primary-green py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal seleção arquivo */}
      {showFileModal ? (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h4 className="font-bold text-slate-800">Selecione o arquivo</h4>
            <label className="mt-3 block text-sm font-semibold">Arquivo</label>
            <select
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              className="mt-1 h-9 w-full rounded border border-slate-200 px-2 text-sm"
            >
              {fileList.length === 0 ? (
                <option value="">Nenhum arquivo</option>
              ) : (
                fileList.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.name}
                  </option>
                ))
              )}
            </select>
            <label className="mt-3 block text-sm font-semibold">Página</label>
            <input
              type="number"
              min={1}
              value={filePage}
              onChange={(e) => setFilePage(parseInt(e.target.value, 10) || 1)}
              className="mt-1 h-9 w-full rounded border border-slate-200 px-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowFileModal(false)}
                className="rounded border border-slate-300 px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmFile}
                disabled={!selectedFile}
                className="rounded bg-primary-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AnaliseAnnotationModal
        open={annotationOpen}
        filePath={selectedFile}
        pageNum={filePage}
        onClose={() => setAnnotationOpen(false)}
        onSave={handleAnnotationSave}
      />

      <PageDivergenceModal
        open={pageDivergenceModalOpen}
        divergences={versionPageDivergences}
        onClose={() => setPageDivergenceModalOpen(false)}
      />

    </div>
  );
}

const osDetailControlClass =
  "w-full rounded border border-slate-300 bg-[#e9ecef] px-1 text-xs text-slate-800 disabled:opacity-100";

function OsDetailField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label className="mb-0.5 block text-[11px] font-bold text-[#555]">{label}</label>
      {children}
    </div>
  );
}

function OsDetailInput({ value }: { value?: string | number | null }) {
  return (
    <input
      type="text"
      readOnly
      disabled
      value={value != null ? String(value) : ""}
      className={cn(osDetailControlClass, "h-6")}
    />
  );
}

function OsDetailTextarea({ value }: { value?: string | null }) {
  return (
    <textarea
      readOnly
      disabled
      value={value ?? ""}
      className={cn(
        osDetailControlClass,
        "min-h-[4.5rem] resize-none py-0.5 md:min-h-0 md:flex-1",
      )}
    />
  );
}

function ActionChip({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-white",
        className ?? "bg-slate-600 hover:bg-slate-700",
      )}
    >
      {children}
    </button>
  );
}
