import { cn } from "@sagra/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileImage, FileText, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchMaquinas } from "@/api/auxLookups";
import { fetchGravacaoPendenteChapasEstimate } from "@/api/gravacaoPendente";
import { fetchOsDetails } from "@/api/os";
import {
  correctNetworkGraphics,
  loadNetworkFilePreviewBlobUrl,
  type NetworkFileInspection,
  type NetworkFilePick,
} from "@/api/networkFiles";
import { queryKeys } from "@/api/query-keys";
import { formatOsLabel } from "@/lib/format";
import { homeTestIds } from "@/lib/testId";
import type { OsSearchRow } from "@/features/os/types";
import { OS_ANO_MAX, OS_ANO_MIN, normalizeAno } from "@/features/os/osAnoUtils";
import { formatOsListLabel } from "../utils/formatOsJuntadaLabel";
import { hydrateGravacaoPendenteLaunch } from "../utils/hydrateGravacaoPendenteLaunch";
import { parsePlateFilename } from "../utils/plateFilenameUtils";
import { NetworkFolderBrowserModal } from "./NetworkFolderBrowserModal";
import { useNetworkFileInspections, networkInspectionKey as inspectionKey } from "../hooks/useNetworkFileInspections";

export interface GravacaoPendenteChapaInput {
  maquina: string;
  quantidade: number;
}

export interface GravacaoPendenteArquivoLaunch {
  absolute_path: string;
  nome: string;
  maquina?: string | null;
}

export interface GravacaoPendenteJuntadaOs {
  nr_os: number;
  ano: number;
}

export type GravacaoComponente = "todos" | "capa" | "miolo";

export interface GravacaoPendenteLaunchResult {
  arquivos: GravacaoPendenteArquivoLaunch[];
  chapas: GravacaoPendenteChapaInput[];
  obs: string;
  juntadas: GravacaoPendenteJuntadaOs[];
  componente: GravacaoComponente;
}

interface GravacaoPendenteLaunchModalProps {
  row: OsSearchRow | null;
  open: boolean;
  /** launch = novo andamento; edit = alterar sessão existente */
  mode?: "launch" | "edit";
  /** Define se o modal cria um andamento ou apenas inclui a OS na fila. */
  workflow?: "andamento" | "fila";
  initialObs?: string;
  initialArquivos?: GravacaoPendenteArquivoLaunch[];
  initialChapas?: GravacaoPendenteChapaInput[];
  initialComponente?: GravacaoComponente;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (result: GravacaoPendenteLaunchResult) => void;
}

interface ChapaRow {
  key: string;
  maquina: string;
  quantidade: string;
  arquivos: NetworkFilePick[];
  espelhosPdf: NetworkFilePick[];
}

type BrowserTarget =
  | { kind: "espelho"; rowKey: string }
  | { kind: "tif"; rowKey: string }
  | null;

type PreviewTarget = {
  kind: "pdf" | "tif";
  rowKey: string;
  file: NetworkFilePick;
} | null;

function emptyChapaRow(): ChapaRow {
  return {
    key: crypto.randomUUID(),
    maquina: "",
    quantidade: "",
    arquivos: [],
    espelhosPdf: [],
  };
}

const TIF_EXTS = new Set(["tif", "tiff"]);

/** Ação secundária genérica (ex.: + Máquina) */
const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-secondary-blue/90 disabled:cursor-not-allowed disabled:opacity-50";

const BTN_PDF =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-red-600/40 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";

const BTN_TIF =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-blue-600/40 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

/** Ícone destrutivo padronizado */
const BTN_ICON_DANGER =
  "flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500";

function getExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function isTifFile(name: string): boolean {
  return TIF_EXTS.has(getExt(name));
}

function isPdfFile(name: string): boolean {
  return getExt(name) === "pdf";
}

function mergeNetworkFiles(
  existing: NetworkFilePick[],
  incoming: NetworkFilePick[],
): NetworkFilePick[] {
  const map = new Map(existing.map((f) => [f.absolute_path, f]));
  for (const file of incoming) {
    map.set(file.absolute_path, file);
  }
  return [...map.values()];
}

function countTifFiles(arquivos: NetworkFilePick[]): number {
  return arquivos.filter((a) => isTifFile(a.nome)).length;
}

function fileNameLooksLikeOs(nome: string, nrOs: number): boolean {
  return nome.includes(String(nrOs));
}

function selectionHasFilesOutsideOs(files: NetworkFilePick[], nrOs: number): boolean {
  return files.some((file) => !fileNameLooksLikeOs(file.nome, nrOs));
}

/** Agrupa TIFs por groupKey (CMYK + PANTONE); órfãos = sem sufixo de canal. */
function summarizeTifGroups(arquivos: NetworkFilePick[]): {
  groupCount: number;
  orphanCount: number;
  fileCount: number;
  hasPantone: boolean;
} {
  const groups = new Set<string>();
  let orphanCount = 0;
  let hasPantone = false;
  let fileCount = 0;

  for (const arq of arquivos) {
    if (!isTifFile(arq.nome)) continue;
    fileCount += 1;
    const parsed = parsePlateFilename(arq.nome);
    if (!parsed.groupKey || !parsed.kind) {
      orphanCount += 1;
      continue;
    }
    groups.add(parsed.groupKey);
    if (parsed.kind === "pantone") {
      hasPantone = true;
    }
  }

  return {
    groupCount: groups.size,
    orphanCount,
    fileCount,
    hasPantone,
  };
}

function inspectionByPath(
  inspections: NetworkFileInspection[] | undefined,
): Map<string, NetworkFileInspection> {
  return new Map((inspections ?? []).map((item) => [inspectionKey(item.absolute_path, item.maquina), item]));
}

function NetworkPreviewPane({ target, inspection, maquina, correcting, correctionError, onCorrect }: {
  target: PreviewTarget;
  inspection?: NetworkFileInspection;
  maquina: string;
  correcting: boolean;
  correctionError: string | null;
  onCorrect: (blank: boolean) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setPreviewUrl(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    setError(null);
    setLoading(true);

    loadNetworkFilePreviewBlobUrl(target.file, controller.signal)
      .then((url) => {
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Não foi possível carregar o preview.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [target]);

  if (!target) {
    return (
      <aside className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
        Selecione um PDF ou TIF para visualizar.
      </aside>
    );
  }

  const isPdf = target.kind === "pdf";

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        {isPdf ? (
          <FileText className="size-4 shrink-0 text-red-600" />
        ) : (
          <FileImage className="size-4 shrink-0 text-blue-600" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800" title={target.file.nome}>
          {target.file.nome}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 bg-slate-100">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-6 animate-spin text-primary-green" />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-red-600">
            {error}
          </div>
        ) : isPdf && previewUrl ? (
          <iframe title={`Preview ${target.file.nome}`} src={previewUrl} className="h-full w-full border-0" />
        ) : previewUrl ? (
          <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-4">
            <img
              src={previewUrl}
              alt={target.file.nome}
              className="block max-h-full max-w-full object-contain shadow-sm"
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-slate-500">
            Preview indisponível.
          </div>
        )}
      </div>
      {!isPdf ? (
        <div className="flex h-28 shrink-0 flex-col justify-center gap-1.5 border-t border-slate-200 px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
            <span className="min-w-0 truncate" title={maquina}>
              {maquina || "Selecione uma máquina"} · {inspection?.cor || "Cor não identificada"}
            </span>
            <span className="shrink-0">
              {inspection?.blank_graphics === true ? "Sem grafismo" : inspection?.blank_graphics === false ? "Com grafismo" : "Detecção inconclusiva"}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            {inspection?.blank_graphics == null ? (
              <button type="button" className={BTN_SECONDARY}
                disabled={!maquina.trim() || !inspection?.inspection_token || correcting || loading || !!error}
                onClick={() => onCorrect(false)}>Possui grafismo</button>
            ) : null}
            <button type="button" className={BTN_SECONDARY}
              disabled={!maquina.trim() || !inspection?.inspection_token || inspection.status !== "done" || correcting || loading || !!error}
              title="Corrigir a detecção e usar este exemplo no aprendizado"
              onClick={() => onCorrect(inspection?.blank_graphics !== true)}>
              {correcting ? <Loader2 className="size-3 animate-spin" /> : null}
              {inspection?.blank_graphics === true ? "Possui grafismo" : "Não possui grafismo"}
            </button>
          </div>
          <p aria-live="polite" className={cn("truncate text-right text-xs", correctionError ? "text-red-600" : "text-slate-500")}
            title={correctionError || undefined}>
            {correctionError || (!inspection?.inspection_token
              ? inspection?.reason || "Aguardando inspeção do TIFF…"
              : inspection?.detection_source === "feedback"
                ? "Correção salva para o aprendizado."
                : "A detecção está errada? Corrija pelo botão acima.")}
          </p>
        </div>
      ) : null}
    </aside>
  );
}

export function GravacaoPendenteLaunchModal({
  row,
  open,
  mode = "launch",
  workflow = "andamento",
  initialObs = "",
  initialArquivos,
  initialChapas,
  initialComponente = "todos",
  saving = false,
  onClose,
  onConfirm,
}: GravacaoPendenteLaunchModalProps) {
  const isEdit = mode === "edit";
  const isFila = workflow === "fila";
  const queryClient = useQueryClient();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserTarget, setBrowserTarget] = useState<BrowserTarget>(null);
  const [chapas, setChapas] = useState<ChapaRow[]>([emptyChapaRow()]);
  const [juntadaEnabled, setJuntadaEnabled] = useState(false);
  const [componente, setComponente] = useState<GravacaoComponente>(initialComponente);
  const [juntadas, setJuntadas] = useState<GravacaoPendenteJuntadaOs[]>([]);
  const [juntadaNumero, setJuntadaNumero] = useState("");
  const [juntadaAno, setJuntadaAno] = useState("");
  const [juntadaBusy, setJuntadaBusy] = useState(false);
  const [obs, setObs] = useState(initialObs);
  const [autoChapasLoading, setAutoChapasLoading] = useState<Record<string, boolean>>({});
  const [autoChapasError, setAutoChapasError] = useState<Record<string, string>>({});
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget>(null);

  const maquinasQuery = useQuery({
    queryKey: queryKeys.gerencia.maquinas,
    queryFn: fetchMaquinas,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const allEspelhosPdf = useMemo(
    () => chapas.flatMap((c) => c.espelhosPdf),
    [chapas],
  );

  const allTifFiles = useMemo(
    () => chapas.flatMap((c) => c.arquivos.map((file) => ({ ...file, maquina: c.maquina }))),
    [chapas],
  );

  const allPreviewFiles = useMemo(
    () => [
      ...chapas.flatMap((c) =>
        c.espelhosPdf.map((file) => ({ kind: "pdf" as const, rowKey: c.key, file })),
      ),
      ...chapas.flatMap((c) =>
        c.arquivos.map((file) => ({ kind: "tif" as const, rowKey: c.key, file })),
      ),
    ],
    [chapas],
  );

  const espelhosPathsKey = useMemo(
    () =>
      allEspelhosPdf
        .map((p) => p.absolute_path)
        .sort()
        .join("|"),
    [allEspelhosPdf],
  );

  const espelhosEstimateQuery = useQuery({
    queryKey: ["gravacaoPendente", "espelhosEstimate", espelhosPathsKey],
    queryFn: () =>
      fetchGravacaoPendenteChapasEstimate(
        allEspelhosPdf.map((p) => ({ absolute_path: p.absolute_path, nome: p.nome })),
      ),
    enabled: open && allEspelhosPdf.length > 0,
    staleTime: 60_000,
  });

  const tifInspectionQuery = useNetworkFileInspections(allTifFiles, open);

  const tifInspectionMap = useMemo(
    () => inspectionByPath(tifInspectionQuery.data?.files),
    [tifInspectionQuery.data],
  );

  const feedbackMutation = useMutation({
    mutationFn: correctNetworkGraphics,
    onSuccess: (updated) => tifInspectionQuery.acceptCorrection(updated),
    onError: (_error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["networkFiles", "inspect", inspectionKey(variables.absolute_path, variables.maquina)], exact: true,
      });
    },
  });
  const previewMaquina = chapas.find((c) => c.key === previewTarget?.rowKey)?.maquina ?? "";
  const previewInspection = previewTarget?.kind === "tif"
    ? tifInspectionMap.get(inspectionKey(previewTarget.file.absolute_path, previewMaquina))
    : undefined;
  const feedbackMatchesPreview = feedbackMutation.variables && previewTarget &&
    inspectionKey(feedbackMutation.variables.absolute_path, feedbackMutation.variables.maquina) ===
    inspectionKey(previewTarget.file.absolute_path, previewMaquina);

  function handleCorrectGraphics(blank: boolean) {
    if (!previewTarget || !previewInspection?.inspection_token || !previewMaquina.trim() || feedbackMutation.isPending) return;
    feedbackMutation.mutate({
      absolute_path: previewTarget.file.absolute_path,
      maquina: previewMaquina,
      blank_graphics: blank,
      inspection_token: previewInspection.inspection_token,
      feedback_revision: previewInspection.feedback_revision ?? 0,
    });
  }

  const blankTifCount = useMemo(
    () =>
      allTifFiles.filter(
        (file) => tifInspectionMap.get(inspectionKey(file.absolute_path, file.maquina))?.blank_graphics === true,
      ).length,
    [allTifFiles, tifInspectionMap],
  );
  const failedTifCount = [...tifInspectionMap.values()].filter(item => item.status === "error").length;

  const pdfPageCount = useMemo(() => {
    if (allEspelhosPdf.length === 0 || !espelhosEstimateQuery.isSuccess) {
      return null;
    }
    const data = espelhosEstimateQuery.data;
    if (data.fonte !== "pdf") {
      return null;
    }
    const pages = data.pdf_page_count ?? data.total_chapas;
    return pages > 0 ? pages : null;
  }, [allEspelhosPdf.length, espelhosEstimateQuery.isSuccess, espelhosEstimateQuery.data]);

  const tifSummary = useMemo(() => {
    const allTifs = chapas.flatMap((rowItem) => rowItem.arquivos);
    return summarizeTifGroups(allTifs);
  }, [chapas]);

  const espelhosMismatch =
    pdfPageCount != null &&
    tifSummary.fileCount > 0 &&
    (tifSummary.orphanCount > 0 || tifSummary.groupCount !== pdfPageCount);

  useEffect(() => {
    if (!open) {
      setChapas([emptyChapaRow()]);
      setJuntadaEnabled(false);
      setComponente("todos");
      setJuntadas([]);
      setJuntadaNumero("");
      setJuntadaAno("");
      setObs("");
      setBrowserOpen(false);
      setBrowserTarget(null);
      setAutoChapasLoading({});
      setAutoChapasError({});
      setPreviewTarget(null);
      return;
    }

    const hydrated = hydrateGravacaoPendenteLaunch(
      initialArquivos ?? [],
      initialChapas ?? [],
    );
    setChapas(hydrated.chapas);
    setJuntadaEnabled(false);
    setComponente(initialComponente);
    setJuntadas([]);
    setJuntadaNumero("");
    setJuntadaAno(row?.ano != null ? String(row.ano) : "");
    setObs(initialObs);
    setBrowserOpen(false);
    setBrowserTarget(null);
    setAutoChapasLoading({});
    setAutoChapasError({});
    setPreviewTarget(null);
    // Hidrata apenas ao abrir o modal (snapshot do momento do clique).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [open]);

  useEffect(() => {
    if (!previewTarget) return;
    const stillExists = allPreviewFiles.some(
      (item) =>
        item.rowKey === previewTarget.rowKey &&
        item.kind === previewTarget.kind &&
        item.file.absolute_path === previewTarget.file.absolute_path,
    );
    if (!stillExists) {
      setPreviewTarget(null);
    }
  }, [allPreviewFiles, previewTarget]);

  useEffect(() => {
    if (!open) return;

    let needsQtyUpdate = false;
    const nextQtyByKey = new Map<string, string>();

    for (const chapaRow of chapas) {
      const tifCount =
        chapaRow.arquivos.length === 0 ? 0 : countTifFiles(chapaRow.arquivos);
      // Só sincroniza automaticamente quando há TIFs; PDF-only preserva qty manual.
      if (tifCount <= 0) continue;
      const expected = String(tifCount);
      nextQtyByKey.set(chapaRow.key, expected);
      if (chapaRow.quantidade !== expected) {
        needsQtyUpdate = true;
      }
    }

    setAutoChapasLoading((prev) => {
      const next = { ...prev };
      for (const chapaRow of chapas) {
        next[chapaRow.key] = false;
      }
      return next;
    });
    setAutoChapasError((prev) => {
      const next = { ...prev };
      for (const chapaRow of chapas) {
        delete next[chapaRow.key];
      }
      return next;
    });

    if (needsQtyUpdate) {
      setChapas((prev) =>
        prev.map((rowItem) => {
          const expected = nextQtyByKey.get(rowItem.key);
          if (expected === undefined || rowItem.quantidade === expected) {
            return rowItem;
          }
          return { ...rowItem, quantidade: expected };
        }),
      );
    }
  }, [chapas, open]);

  const openBrowserFor = (target: BrowserTarget) => {
    setBrowserTarget(target);
    setBrowserOpen(true);
  };

  const handleBrowserConfirm = (files: NetworkFilePick[]) => {
    if (!browserTarget || !row) {
      setBrowserOpen(false);
      return;
    }

    if (selectionHasFilesOutsideOs(files, row.nr_os)) {
      const ok = window.confirm(
        "Algum/Alguns dos arquivos selecionados parecem não ser da OS atual, você confirma a seleção?",
      );
      if (!ok) {
        return;
      }
    }

    if (browserTarget.kind === "espelho") {
      const pdfs = files.filter((f) => isPdfFile(f.nome));
      if (pdfs.length !== files.length) {
        window.alert("Por máquina, selecione apenas arquivos PDF de espelho.");
      }
      if (pdfs.length > 0) {
        setChapas((prev) =>
          prev.map((rowItem) =>
            rowItem.key === browserTarget.rowKey
              ? { ...rowItem, espelhosPdf: mergeNetworkFiles(rowItem.espelhosPdf, pdfs) }
              : rowItem,
          ),
        );
      }
    } else {
      const tifs = files.filter((f) => isTifFile(f.nome));
      if (tifs.length !== files.length) {
        window.alert("Por máquina, selecione apenas arquivos TIF de separação.");
      }
      if (tifs.length > 0) {
        setChapas((prev) =>
          prev.map((rowItem) =>
            rowItem.key === browserTarget.rowKey
              ? { ...rowItem, arquivos: mergeNetworkFiles(rowItem.arquivos, tifs) }
              : rowItem,
          ),
        );
      }
    }

    setBrowserOpen(false);
    setBrowserTarget(null);
  };

  const isDirty = useMemo(() => {
    if (obs.trim()) return true;
    if (juntadas.length > 0 || componente !== initialComponente) return true;
    return chapas.some(
      (c) =>
        c.maquina.trim().length > 0 ||
        c.arquivos.length > 0 ||
        c.espelhosPdf.length > 0,
    );
  }, [obs, chapas, juntadas, componente, initialComponente]);

  const addJuntada = async () => {
    if (!row || isEdit) return;
    const nr = Number(juntadaNumero.trim());
    const anoRaw = Number(juntadaAno.trim() || row.ano);
    const ano = normalizeAno(anoRaw);
    if (!Number.isFinite(nr) || nr <= 0 || ano == null) {
      window.alert(
        `Informe número e ano válidos da OS a juntar (ano entre ${OS_ANO_MIN} e ${OS_ANO_MAX}).`,
      );
      return;
    }
    if (nr === row.nr_os && ano === row.ano) {
      window.alert("A OS atual já faz parte do lançamento.");
      return;
    }
    if (juntadas.some((j) => j.nr_os === nr && j.ano === ano)) {
      window.alert("Esta OS já está na lista de juntadas.");
      return;
    }
    setJuntadaBusy(true);
    try {
      await fetchOsDetails(ano, nr);
      setJuntadas((prev) =>
        [...prev, { nr_os: nr, ano }].sort((a, b) => a.nr_os - b.nr_os || a.ano - b.ano),
      );
      setJuntadaNumero("");
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : `OS ${nr}/${ano} não encontrada.`,
      );
    } finally {
      setJuntadaBusy(false);
    }
  };

  const handleRequestClose = () => {
    if (saving) return;
    if (
      isDirty &&
      !window.confirm(
        "Você perderá todas as informações preenchidas neste lançamento. Deseja cancelar?",
      )
    ) {
      return;
    }
    onClose();
  };

  const browserTitle = useMemo(() => {
    if (!row) {
      return "Selecionar arquivos na rede";
    }
    const base = `Arquivos — OS ${formatOsLabel(row)}`;
    if (browserTarget?.rowKey) {
      const maquina = chapas
        .find((c) => c.key === browserTarget.rowKey)
        ?.maquina.trim();
      if (maquina) {
        return `${base} — ${maquina}`;
      }
    }
    return base;
  }, [row, browserTarget, chapas]);

  const removeChapaRow = (index: number) => {
    setChapas((prev) => {
      if (prev.length <= 1) {
        return [emptyChapaRow()];
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleConfirm = () => {
    if (!isEdit && juntadaEnabled) {
      if (juntadaBusy) {
        window.alert("Aguarde a validação da OS que está sendo adicionada à juntada.");
        return;
      }
      if (juntadaNumero.trim()) {
        window.alert('Clique em "+ OS" para incluir a OS informada na juntada antes de confirmar.');
        return;
      }
      if (juntadas.length === 0) {
        window.alert(
          'Adicione ao menos uma OS à juntada pelo botão "+ OS" ou desmarque "Juntada de OSs".',
        );
        return;
      }
    }

    const allTifArquivos: GravacaoPendenteArquivoLaunch[] = [];
    const pdfArquivos: GravacaoPendenteArquivoLaunch[] = [];
    const parsedChapas: GravacaoPendenteChapaInput[] = [];

    for (const rowItem of chapas) {
      const maquina = rowItem.maquina.trim();
      const hasTifs = rowItem.arquivos.length > 0;
      const hasPdfs = rowItem.espelhosPdf.length > 0;

      if (!maquina) {
        if (hasTifs || hasPdfs) {
          window.alert(
            "Informe o nome da máquina para cada linha com arquivos PDF ou TIF.",
          );
          return;
        }
        continue;
      }

      if (!hasTifs && !hasPdfs) {
        continue;
      }

      for (const arq of rowItem.espelhosPdf) {
        pdfArquivos.push({
          absolute_path: arq.absolute_path,
          nome: arq.nome,
          maquina,
        });
      }

      const quantidade = Number(rowItem.quantidade);
      if (!Number.isFinite(quantidade) || quantidade < 1) {
        window.alert(
          hasTifs
            ? `Quantidade de chapas inválida para máquina ${maquina}.`
            : `Informe a quantidade de chapas para a máquina ${maquina} (lançamento só com PDF).`,
        );
        return;
      }

      parsedChapas.push({ maquina, quantidade });
      if (hasTifs) {
        for (const arq of rowItem.arquivos) {
          allTifArquivos.push({
            absolute_path: arq.absolute_path,
            nome: arq.nome,
            maquina,
          });
        }
      }
    }

    const allArquivos = [...allTifArquivos, ...pdfArquivos];

    if (allArquivos.length === 0) {
      window.alert("Selecione ao menos um arquivo TIF ou PDF de espelho.");
      return;
    }
    if (parsedChapas.length === 0) {
      window.alert("Informe ao menos uma máquina com quantidade de chapas.");
      return;
    }

    if (allTifArquivos.length > 0 && pdfArquivos.length > 0 && pdfPageCount != null) {
      const summary = summarizeTifGroups(
        allTifArquivos.map((a) => ({ absolute_path: a.absolute_path, nome: a.nome })),
      );
      if (summary.orphanCount > 0) {
        window.alert(
          `Há ${summary.orphanCount} TIF(s) sem sufixo de canal (ex.: (C), (M), (Pantone…)). ` +
            "Renomeie ou selecione arquivos com nomenclatura de separação para validar as lâminas contra o espelho.",
        );
        return;
      }
      if (summary.groupCount !== pdfPageCount) {
        window.alert(
          `Os espelhos têm ${pdfPageCount} página(s) → ${pdfPageCount} lâmina(s) de separação esperada(s). ` +
            `Você selecionou ${summary.groupCount} lâmina(s) (${summary.fileCount} arquivo(s) TIF). ` +
            "Ajuste os TIFs para que o número de lâminas (mesmo nome-base com canais CMYK/PANTONE) coincida com as páginas do espelho.",
        );
        return;
      }
    }

    onConfirm({
      arquivos: allArquivos,
      chapas: parsedChapas,
      obs: obs.trim(),
      juntadas,
      componente,
    });
  };

  const browserSubtitle =
    browserTarget?.kind === "espelho"
      ? "Marque os PDFs de espelho de chapa para esta máquina."
      : "Marque os arquivos TIF de separação para esta máquina.";

  if (!open || !row) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/60 p-3 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label={`Gravação Pendente — OS ${formatOsLabel(row)}`}
        data-testid={homeTestIds.osGravacaoRoot}
      >
        <div className="flex h-[min(94vh,860px)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-base font-semibold text-secondary-blue">
              {isEdit ? "Alterar arquivos" : isFila ? "Adicionar OS" : "Gravação Pendente"} — OS {formatOsLabel(row)}
            </h3>
            <button
              type="button"
              onClick={handleRequestClose}
              disabled={saving}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
              aria-label="Fechar"
              data-testid={homeTestIds.osGravacaoClose}
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4 overflow-hidden px-4 py-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:grid-rows-[minmax(0,1fr)]">
            <div className="min-h-0 space-y-4 overflow-y-auto pr-1 [overflow-anchor:none] [scrollbar-gutter:stable]">
            {!isEdit ? (
              <section>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={juntadaEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setJuntadaEnabled(enabled);
                      if (!enabled) {
                        setJuntadas([]);
                        setJuntadaNumero("");
                        setJuntadaAno(row?.ano != null ? String(row.ano) : "");
                      }
                    }}
                    className="size-4 rounded border-slate-300 text-primary-green focus:ring-primary-green"
                  />
                  Juntada de OSs
                </label>

                {juntadaEnabled ? (
                  <div className="mt-3">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      OSs juntadas (mesma chapa)
                    </h4>
                    <p className="mb-2 text-xs text-slate-500">
                      A OS atual ({formatOsListLabel(row.nr_os, row.ano)}) já está incluída.
                      Adicione outras OSs que compartilham esta chapa — elas serão
                      {isFila ? " incluídas na mesma fila, sem lançar andamento." : " lançadas no mesmo andamento."}
                    </p>
                    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={juntadaNumero}
                    onChange={(e) => setJuntadaNumero(e.target.value)}
                    placeholder="Nº OS"
                    className="min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    min={OS_ANO_MIN}
                    max={OS_ANO_MAX}
                    value={juntadaAno}
                    onChange={(e) => setJuntadaAno(e.target.value)}
                    onBlur={() => {
                      const expanded = normalizeAno(juntadaAno);
                      if (
                        expanded != null &&
                        String(expanded) !== juntadaAno.trim()
                      ) {
                        setJuntadaAno(String(expanded));
                      }
                    }}
                    placeholder="Ano"
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    disabled={juntadaBusy || !juntadaNumero.trim()}
                    onClick={() => void addJuntada()}
                    className={BTN_SECONDARY}
                  >
                    {juntadaBusy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      "+ OS"
                    )}
                  </button>
                    </div>
                    {juntadas.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {juntadas.map((j) => (
                          <li
                            key={`${j.ano}-${j.nr_os}`}
                            className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm"
                          >
                            <span className="min-w-0 flex-1 font-medium tabular-nums">
                              {formatOsListLabel(j.nr_os, j.ano)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setJuntadas((prev) =>
                                  prev.filter(
                                    (x) => !(x.nr_os === j.nr_os && x.ano === j.ano),
                                  ),
                                )
                              }
                              className={cn(BTN_ICON_DANGER, "size-7")}
                              title="Remover"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        Nenhuma OS adicional. Opcional para papelaria / chapa compartilhada.
                      </p>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section>
              <div className="mb-2 flex h-10 items-center gap-3">
              <h4 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Chapas por máquina
              </h4>
              <div className="flex h-10 min-w-0 flex-1 flex-col justify-start gap-0.5 overflow-y-auto text-xs [scrollbar-gutter:stable]" aria-live="polite" data-testid="tif-inspection-status">
              {blankTifCount > 0 ? (
                <div className="flex items-center gap-1 text-red-800">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  <span>
                    {blankTifCount} TIF{blankTifCount === 1 ? "" : "s"} sem grafismo detectado.
                  </span>
                </div>
              ) : null}
              {tifInspectionQuery.isFetching ? (
                <div className="flex items-center gap-1 text-slate-600">
                  <Loader2 className="size-3.5 shrink-0 animate-spin" />
                  Processados {tifInspectionQuery.completed} de {tifInspectionQuery.total} TIFFs…
                </div>
              ) : null}
              {tifInspectionQuery.isError ? (
                <div role="alert" className="text-amber-900">
                  <p>Verificação interrompida: {tifInspectionQuery.error.message}</p>
                  <button type="button" className="mt-1 font-semibold underline" onClick={() => void tifInspectionQuery.refetch()}>
                    Tentar novamente
                  </button>
                </div>
              ) : null}
              {failedTifCount > 0 ? (
                <p role="alert" className="text-amber-800">
                  {failedTifCount} TIFF(s) não puderam ser verificados. Confira os itens sinalizados.
                </p>
              ) : null}
              </div>
              </div>
              <div className="space-y-3">
                {chapas.map((chapaRow, index) => {
                  const hasTifs = chapaRow.arquivos.length > 0;
                  return (
                  <div
                    key={chapaRow.key}
                    className="rounded-lg border border-slate-200 bg-slate-50/50 p-3"
                  >
                    <div className="grid grid-cols-[minmax(80px,1fr)_4rem_auto_auto_2rem] items-center gap-2">
                      <input
                        type="text"
                        list="gravacao-pendente-maquinas"
                        value={chapaRow.maquina}
                        onChange={(e) =>
                          setChapas((prev) =>
                            prev.map((item, i) =>
                              i === index ? { ...item, maquina: e.target.value } : item,
                            ),
                          )
                        }
                        placeholder="Máquina"
                        className="min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      />
                      <input
                        type="number"
                        min={1}
                        readOnly={hasTifs}
                        value={chapaRow.quantidade}
                        onChange={
                          hasTifs
                            ? undefined
                            : (e) =>
                                setChapas((prev) =>
                                  prev.map((item, i) =>
                                    i === index
                                      ? { ...item, quantidade: e.target.value }
                                      : item,
                                  ),
                                )
                        }
                        placeholder="Qtd"
                        title={
                          hasTifs
                            ? "Quantidade definida automaticamente pelos TIFs selecionados"
                            : "Informe a quantidade de chapas (editável quando só há PDFs)"
                        }
                        aria-label={
                          hasTifs
                            ? "Quantidade de chapas (automática)"
                            : "Quantidade de chapas"
                        }
                        className={
                          hasTifs
                            ? "w-full cursor-default rounded-md border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm text-slate-700 tabular-nums"
                            : "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 tabular-nums"
                        }
                      />
                      <button
                        type="button"
                        disabled={!chapaRow.maquina.trim()}
                        onClick={() =>
                          openBrowserFor({ kind: "espelho", rowKey: chapaRow.key })
                        }
                        className={BTN_PDF}
                        title={
                          chapaRow.maquina.trim()
                            ? "Selecionar arquivos PDF"
                            : "Informe a máquina antes de adicionar PDFs"
                        }
                      >
                        + PDF
                        <FileText className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!chapaRow.maquina.trim()}
                        onClick={() =>
                          openBrowserFor({ kind: "tif", rowKey: chapaRow.key })
                        }
                        className={BTN_TIF}
                        title={
                          chapaRow.maquina.trim()
                            ? "Selecionar arquivos TIF"
                            : "Informe a máquina antes de adicionar TIFs"
                        }
                      >
                        + TIF
                        <FileImage className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeChapaRow(index)}
                        className={BTN_ICON_DANGER}
                        title={
                          chapas.length <= 1
                            ? "Limpar máquina e arquivos"
                            : "Remover máquina"
                        }
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>

                    <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      PDFs ({chapaRow.espelhosPdf.length})
                    </p>

                    <div className="mt-1 h-10 overflow-y-auto [overflow-anchor:none] [scrollbar-gutter:stable]" data-testid="machine-pdf-list">
                    {chapaRow.espelhosPdf.length > 0 ? (
                      <ul className="space-y-1">
                        {chapaRow.espelhosPdf.map((arq) => (
                          <li
                            key={arq.absolute_path}
                            className={cn(
                              "flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-xs",
                              previewTarget?.rowKey === chapaRow.key && previewTarget?.file.absolute_path === arq.absolute_path
                                ? "border-primary-green ring-1 ring-primary-green/40"
                                : "border-slate-200",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => setPreviewTarget({ kind: "pdf", rowKey: chapaRow.key, file: arq })}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              title={arq.nome}
                            >
                              <FileText className="size-3.5 shrink-0 text-red-600" />
                              <span className="min-w-0 flex-1 truncate">{arq.nome}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setChapas((prev) =>
                                  prev.map((item) =>
                                    item.key === chapaRow.key
                                      ? {
                                          ...item,
                                          espelhosPdf: item.espelhosPdf.filter(
                                            (p) => p.absolute_path !== arq.absolute_path,
                                          ),
                                        }
                                      : item,
                                  ),
                                )
                              }
                              className={cn(BTN_ICON_DANGER, "size-6")}
                              title="Remover"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">Nenhum PDF selecionado.</p>
                    )}
                    </div>

                    <div className="mt-2 flex h-4 items-center gap-2">
                    <p className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      TIFs ({chapaRow.arquivos.length})
                    </p>
                    {autoChapasLoading[chapaRow.key] ? (
                      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-slate-500">
                        <Loader2 className="size-3 shrink-0 animate-spin" />
                        Calculando chapas…
                      </span>
                    ) : null}
                    {autoChapasError[chapaRow.key] ? (
                      <span className="min-w-0 truncate text-xs text-red-600" title={autoChapasError[chapaRow.key]}>
                        {autoChapasError[chapaRow.key]}
                      </span>
                    ) : null}
                    </div>

                    <div className="mt-1 h-44 overflow-y-auto [overflow-anchor:none] [scrollbar-gutter:stable]" data-testid="machine-tif-list">
                    {chapaRow.arquivos.length > 0 ? (
                      <ul className="space-y-1">
                        {chapaRow.arquivos.map((arq) => {
                          const inspection = tifInspectionMap.get(inspectionKey(arq.absolute_path, chapaRow.maquina));
                          const blankGraphics = inspection?.blank_graphics === true;
                          const selected = previewTarget?.rowKey === chapaRow.key && previewTarget?.file.absolute_path === arq.absolute_path;
                          return (
                            <li
                              key={arq.absolute_path}
                              className={cn(
                                "flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-xs",
                                blankGraphics
                                  ? "border-red-500 ring-1 ring-red-200"
                                  : selected
                                    ? "border-primary-green ring-1 ring-primary-green/40"
                                    : "border-slate-200",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => setPreviewTarget({ kind: "tif", rowKey: chapaRow.key, file: arq })}
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                title={inspection?.reason ? `${arq.nome} — ${inspection.reason}` : arq.nome}
                              >
                                <FileImage
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    blankGraphics ? "text-red-600" : "text-blue-600",
                                  )}
                                />
                                <span className="min-w-0 flex-1 truncate">{arq.nome}</span>
                                {blankGraphics ? (
                                  <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                    Sem grafismo
                                  </span>
                                ) : inspection?.status === "error" ? (
                                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Não verificado</span>
                                ) : null}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setChapas((prev) =>
                                    prev.map((item) =>
                                      item.key === chapaRow.key
                                        ? {
                                            ...item,
                                            arquivos: item.arquivos.filter(
                                              (p) => p.absolute_path !== arq.absolute_path,
                                            ),
                                          }
                                        : item,
                                    ),
                                  )
                                }
                                className={cn(BTN_ICON_DANGER, "size-6")}
                                title="Remover"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">Nenhum TIF selecionado.</p>
                    )}
                    </div>

                  </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
              {allEspelhosPdf.length > 0 ? (
                <>
                  {espelhosEstimateQuery.isLoading ? (
                    <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500">
                      <Loader2 className="size-3 animate-spin" />
                      Contando páginas dos espelhos…
                    </p>
                  ) : null}
                  {espelhosEstimateQuery.isError ? (
                    <p className="mt-2 text-xs text-amber-700">
                      Não foi possível ler as páginas dos espelhos. A validação
                      lâminas×páginas será ignorada neste lançamento.
                    </p>
                  ) : null}
                  {pdfPageCount != null ? (
                    <div
                      className={cn(
                        "mt-2 space-y-0.5 rounded-md border px-2.5 py-2 text-xs",
                        espelhosMismatch
                          ? "border-amber-300 bg-amber-50 text-amber-900"
                          : "border-slate-200 bg-slate-50 text-slate-600",
                      )}
                    >
                      <p>
                        Espelhos de chapas: {pdfPageCount} página
                        {pdfPageCount === 1 ? "" : "s"}
                      </p>
                      <p>
                        Separações: {tifSummary.fileCount} TIF
                        {tifSummary.fileCount === 1 ? "" : "s"} (
                        {tifSummary.groupCount} Lâmina
                        {tifSummary.groupCount === 1 ? "" : "s"}
                        {tifSummary.hasPantone ? "; inclui PANTONE" : ""})
                      </p>
                      {tifSummary.orphanCount > 0 ? (
                        <p className="font-medium text-amber-800">
                          {tifSummary.orphanCount} TIF(s) sem sufixo de canal — não
                          entram em nenhuma lâmina.
                        </p>
                      ) : null}
                      {espelhosMismatch && tifSummary.orphanCount === 0 ? (
                        <p className="font-medium text-amber-800">
                          Divergência: o número de lâminas não bate com as páginas do
                          espelho.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}

              {maquinasQuery.isLoading ? (
                <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500">
                  <Loader2 className="size-3 animate-spin" />
                  Carregando máquinas…
                </p>
              ) : null}
              </div>
                <button
                  type="button"
                  onClick={() => setChapas((prev) => [...prev, emptyChapaRow()])}
                  className={cn(BTN_SECONDARY, "shrink-0")}
                >
                  + Máquina
                </button>
              </div>
              <datalist id="gravacao-pendente-maquinas">
                {(maquinasQuery.data ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </section>

            {!isEdit ? (
              <label className="block text-xs">
                <span className="font-semibold text-neutral-600">
                  Observação para o Birô
                </span>
                <textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  rows={3}
                  className="mt-1 w-full resize-none rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="Observações para o Birô (opcional)"
                />
              </label>
            ) : null}

            </div>

            <div className="min-h-0 overflow-hidden">
              <NetworkPreviewPane target={previewTarget} inspection={previewInspection}
                maquina={previewMaquina} correcting={feedbackMutation.isPending}
                correctionError={feedbackMatchesPreview && feedbackMutation.error ? feedbackMutation.error.message : null}
                onCorrect={handleCorrectGraphics} />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
            <button
              type="button"
              onClick={handleRequestClose}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-md bg-neutral-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
              data-testid={homeTestIds.osGravacaoCancel}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving || juntadaBusy}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-green px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              data-testid={homeTestIds.osGravacaoConfirm}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {isEdit ? "Salvar alterações" : isFila ? "Adicionar OS" : "Confirmar lançamento"}
            </button>
          </div>
        </div>
      </div>

      <NetworkFolderBrowserModal
        open={browserOpen}
        title={browserTitle}
        subtitle={browserSubtitle}
        onClose={() => {
          setBrowserOpen(false);
          setBrowserTarget(null);
        }}
        onConfirm={handleBrowserConfirm}
      />
    </>
  );
}
