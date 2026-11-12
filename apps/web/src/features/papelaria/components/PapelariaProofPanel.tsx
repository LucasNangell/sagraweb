import { Check, ExternalLink, FileText, Loader2, XCircle } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { cn } from "@sagra/ui";

import { apiUrl } from "@/api/client";
import {
  fetchPapelariaCorelModelo,
  fetchPapelariaJobPreviewPages,
  papelariaJobFileUrl,
} from "@/api/papelaria";
import { queryKeys } from "@/api/query-keys";
import { useQuery } from "@tanstack/react-query";

import { useMatchMedia } from "@/hooks/useMatchMedia";
import {
  getPapelariaMockupConfig,
  PAPELARIA_MOCKUP_SCENE_BASE_PX,
  PAPELARIA_MOCKUP_SCENE_BASE_PX_NARROW,
} from "../mockup";
import {
  isPastaAvulsoProduct,
  papelariaProofPdfViewerSrc,
} from "../papelariaSession";
import {
  papelariaGenerationStatusLabel,
  resolvePapelariaGenerationPhase,
} from "../papelariaGenerationStatus";
import type { PapelariaViewMode } from "../papelariaViewMode";
import {
  buildRuntimePreviewConfig,
  getGroupedTemplateIds,
  getTemplateAllowedSlots,
  moveActiveFieldsToSlot,
  parsePreviewConfigJson,
  templateId,
  type ActiveDynamicFieldPlacement,
} from "../preview";
import type { PapelariaJob } from "../types";
import { PapelariaLivePreview } from "./PapelariaLivePreview";
import { PapelariaProofDynamicFields } from "./PapelariaProofDynamicFields";
import { PapelariaProofMockup3D } from "./PapelariaProofMockup3D";
import { PapelariaViewModeToggle } from "./PapelariaViewModeToggle";

type Props = {
  activeJob: PapelariaJob | null;
  isJobGenerating: boolean;
  produto?: string;
  frenteVerso?: string;
  cores?: string;
  arquivoModelo?: string;
  mockupConfigJson?: string | null;
  previewConfigJson?: string | null;
  livePreviewValues?: Record<string, string>;
  previa: Record<string, string> | null;
  selectedModelId: number | null;
  modelLoading: boolean;
  viewMode: PapelariaViewMode;
  onViewModeChange: (mode: PapelariaViewMode) => void;
  /** PDF da última prova na pasta Sefoc (quando não há job ativo com PDF). */
  folderProofPdfUrl?: string | null;
  folderProofLabel?: string | null;
  onCancelJob?: (jobId: number) => void;
  cancelPending?: boolean;
  onApproveProva?: (jobId: number) => void;
  onDiscardProva?: (jobId: number) => void;
  approveProvaPending?: boolean;
  discardProvaPending?: boolean;
  provaReviewMessage?: string | null;
  provaModo?: "prova_web" | "prova_email";
  activeDynamicFields?: ActiveDynamicFieldPlacement[];
  onActiveDynamicFieldsChange?: (next: ActiveDynamicFieldPlacement[]) => void;
  onLivePreviewValueChange?: (key: string, value: string) => void;
};

function resolvePreviewImageUrl(raw: string): string {
  if (raw.startsWith("http")) return raw;
  const path = raw.replace(/^\/api/, "");
  return apiUrl(path);
}

export function PapelariaProofPanel({
  activeJob,
  isJobGenerating,
  produto,
  frenteVerso,
  cores,
  arquivoModelo,
  mockupConfigJson,
  previewConfigJson,
  livePreviewValues,
  previa,
  selectedModelId,
  modelLoading,
  viewMode,
  onViewModeChange,
  folderProofPdfUrl = null,
  folderProofLabel = null,
  onCancelJob,
  cancelPending = false,
  onApproveProva,
  onDiscardProva,
  approveProvaPending = false,
  discardProvaPending = false,
  provaReviewMessage = null,
  provaModo = "prova_web",
  activeDynamicFields = [],
  onActiveDynamicFieldsChange,
  onLivePreviewValueChange,
}: Props) {
  const [previewFaceId, setPreviewFaceId] = useState("frente");
  const isNarrowViewport = useMatchMedia("(max-width: 767px)");
  const isTimbradoDigitalJob =
    activeJob?.tipo_job === "timbrado_a4_digital";
  const generationPhase = resolvePapelariaGenerationPhase(
    isJobGenerating,
    activeJob,
  );
  const generationCopy = papelariaGenerationStatusLabel(generationPhase, {
    ordemFila: activeJob?.ordem_fila,
    isTimbradoDigital: isTimbradoDigitalJob,
  });
  const showGenerating = generationPhase === "submitting" ||
    generationPhase === "pending" ||
    generationPhase === "processing";
  const showGenerationFailed = generationPhase === "failed";
  const showGenerationCancelled = generationPhase === "cancelled";
  const showDigitalDone =
    !!activeJob &&
    isTimbradoDigitalJob &&
    activeJob.status === "completed";
  const showPdf =
    !!activeJob &&
    !isTimbradoDigitalJob &&
    activeJob.status === "completed" &&
    activeJob.prova_revisao !== "discarded" &&
    (activeJob.tem_arquivo_pdf || !!activeJob.arquivo_pdf);

  const needsProvaReview =
    showPdf &&
    activeJob?.prova_revisao !== "approved" &&
    activeJob?.prova_revisao !== "discarded";

  const exibirMockup3d = provaModo !== "prova_email";

  const previewPagesQuery = useQuery({
    queryKey: queryKeys.papelaria.previewPages(activeJob?.id ?? 0),
    queryFn: () => fetchPapelariaJobPreviewPages(activeJob!.id),
    enabled:
      viewMode === "prova" && showPdf && !!activeJob && exibirMockup3d,
    staleTime: 120_000,
    retry: 1,
  });

  const pageUrls =
    previewPagesQuery.data?.pages.map((p) => resolvePreviewImageUrl(p.url)) ??
    [];

  const jobPdfUrl = activeJob && showPdf ? papelariaJobFileUrl(activeJob.id, "pdf") : "";
  const provaPdfUrl = showPdf ? jobPdfUrl : folderProofPdfUrl ?? "";
  const showingFolderProof = !showPdf && Boolean(folderProofPdfUrl);
  const produtoParaPdf = produto || activeJob?.produto || "";
  const pastaAvulsoPdf = isPastaAvulsoProduct(produtoParaPdf);
  const provaPdfViewerSrc = papelariaProofPdfViewerSrc(
    provaPdfUrl,
    produtoParaPdf,
  );

  const jobModeloQuery = useQuery({
    queryKey: queryKeys.papelaria.corelModelo(activeJob?.modelo_id ?? 0),
    queryFn: () => fetchPapelariaCorelModelo(activeJob!.modelo_id!),
    enabled: viewMode === "prova" && showPdf && !!activeJob?.modelo_id,
    staleTime: 60_000,
  });

  const effectiveMockupJson =
    jobModeloQuery.data?.mockup_config_json ?? mockupConfigJson;

  const mockupResolved = getPapelariaMockupConfig({
    produto: produto ?? activeJob?.produto,
    arquivoModelo: arquivoModelo ?? activeJob?.arquivo_modelo,
    frenteVerso,
    cores,
    pageCount: pageUrls.length,
    mockupConfigJson: effectiveMockupJson,
  });

  const livePreviewParsed = previewConfigJson?.trim()
    ? parsePreviewConfigJson(previewConfigJson)
    : null;
  const basePreviewConfig =
    livePreviewParsed?.ok === true ? livePreviewParsed.config : null;

  const runtimePreviewConfig = useMemo(() => {
    if (!basePreviewConfig) return null;
    return buildRuntimePreviewConfig(basePreviewConfig, activeDynamicFields);
  }, [activeDynamicFields, basePreviewConfig]);

  const allowedSlotsByElement = useMemo(() => {
    if (!basePreviewConfig?.camposDinamicos) return undefined;
    const map: Record<string, ReturnType<typeof getTemplateAllowedSlots>> = {};
    for (const tpl of basePreviewConfig.camposDinamicos) {
      map[templateId(tpl)] = getTemplateAllowedSlots(tpl);
    }
    return map;
  }, [basePreviewConfig]);

  const handleElementSlotChange = useCallback(
    (faceId: string, elementIds: string[], slotId: ActiveDynamicFieldPlacement["posicaoSlot"]) => {
      if (!onActiveDynamicFieldsChange || !basePreviewConfig) return;
      let next = [...activeDynamicFields];
      for (const elId of elementIds) {
        next = moveActiveFieldsToSlot(
          next,
          [elId],
          faceId,
          slotId,
          basePreviewConfig.camposDinamicos ?? [],
        );
      }
      onActiveDynamicFieldsChange(next);
    },
    [activeDynamicFields, basePreviewConfig, onActiveDynamicFieldsChange],
  );

  const activeFaceId =
    previewFaceId || runtimePreviewConfig?.faces[0]?.id || "frente";

  const hasLivePreview =
    runtimePreviewConfig !== null &&
    selectedModelId !== null &&
    Boolean(livePreviewValues);

  const subtitle =
    viewMode === "previa"
      ? "Prévia em tempo real dos campos do formulário."
      : showGenerating
        ? generationCopy.detail
        : showGenerationFailed
          ? "A geração falhou."
          : showGenerationCancelled
            ? "A solicitação foi cancelada."
            : showDigitalDone
              ? "DOCX Cor/PB e SVGs gerados na pasta Sefoc da OS."
              : needsProvaReview
                ? "Revise o arquivo gerado e confirme (OK) ou descarte (Cancelar)."
                : showPdf
                  ? activeJob?.prova_revisao === "approved"
                    ? "Prova aprovada. Pendência de e-mail criada em SEFOC."
                    : exibirMockup3d
                      ? "PDF e mockup 3D da prova gerada pelo sistema."
                      : "PDF da prova gerada pelo sistema."
                  : showingFolderProof
                    ? `Última prova na pasta Sefoc${folderProofLabel ? `: ${folderProofLabel}` : "."}`
                    : "Nenhuma prova encontrada na pasta desta OS.";

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-sagra-border bg-neutral-50 shadow-sm max-md:overflow-visible md:overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-sagra-border bg-white px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-xs font-bold text-secondary-blue">
            Visualização
          </h2>
          <p className="text-[10px] text-neutral-500">{subtitle}</p>
        </div>
        <PapelariaViewModeToggle value={viewMode} onChange={onViewModeChange} />
      </div>

      {viewMode === "prova" && showGenerating ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
          data-testid="papelaria-generation-loading"
        >
          <Loader2 className="size-10 animate-spin text-secondary-blue" aria-hidden />
          <div>
            <p className="text-sm font-medium text-neutral-700">
              {generationCopy.title}
            </p>
            <p
              className={cn(
                "mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                generationPhase === "processing"
                  ? "bg-amber-100 text-amber-900"
                  : "bg-sky-100 text-sky-900",
              )}
            >
              {generationPhase === "processing"
                ? "Processando"
                : generationPhase === "pending"
                  ? "Na fila"
                  : "Enviando"}
            </p>
            <p className="mt-2 text-xs text-neutral-500">{generationCopy.detail}</p>
            {activeJob &&
            (generationPhase === "pending" ||
              generationPhase === "processing") ? (
              <p className="mt-2 font-mono text-[10px] text-neutral-400">
                Job #{activeJob.id}
                {activeJob.ordem_fila != null && activeJob.ordem_fila > 0
                  ? ` · fila ${activeJob.ordem_fila}`
                  : ""}
              </p>
            ) : null}
          </div>
          {activeJob &&
          onCancelJob &&
          (generationPhase === "pending" ||
            generationPhase === "processing") ? (
            <button
              type="button"
              disabled={cancelPending}
              className="sagra-btn sagra-btn--outline sagra-btn--sm shadow-sm hover:bg-neutral-50 disabled:opacity-60"
              onClick={() => onCancelJob(activeJob.id)}
            >
              <XCircle className="size-3.5" aria-hidden />
              {cancelPending
                ? "Cancelando..."
                : generationPhase === "processing"
                  ? "Cancelar processamento"
                  : "Cancelar solicitação"}
            </button>
          ) : null}
        </div>
      ) : viewMode === "prova" && showGenerationFailed && activeJob ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
          data-testid="papelaria-generation-error"
        >
          <XCircle className="size-10 text-red-500" aria-hidden />
          <div>
            <p className="text-sm font-medium text-red-800">
              {generationCopy.title}
            </p>
            <p className="mt-2 inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-900">
              Erro
            </p>
            <p className="mt-3 max-w-md text-xs text-red-700/90">
              {activeJob.erro?.trim() ||
                "Falha ao gerar o arquivo. Tente novamente."}
            </p>
            <p className="mt-2 font-mono text-[10px] text-neutral-400">
              Job #{activeJob.id}
            </p>
          </div>
        </div>
      ) : viewMode === "prova" && showGenerationCancelled && activeJob ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <XCircle className="size-10 text-neutral-400" aria-hidden />
          <div>
            <p className="text-sm font-medium text-neutral-700">
              {generationCopy.title}
            </p>
            <p className="mt-2 text-xs text-neutral-500">{generationCopy.detail}</p>
            <p className="mt-2 font-mono text-[10px] text-neutral-400">
              Job #{activeJob.id}
            </p>
          </div>
        </div>
      ) : viewMode === "prova" && showDigitalDone && activeJob ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <FileText className="size-10 text-emerald-600" aria-hidden />
          <div>
            <p className="text-sm font-medium text-neutral-700">
              Timbrado A4 Digital concluído
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Arquivos na pasta Sefoc da OS (sem revisão de prova PDF).
            </p>
            {activeJob.artefatos && activeJob.artefatos.length > 0 ? (
              <ul className="mt-3 space-y-1 text-left font-mono text-[11px] text-neutral-600">
                {activeJob.artefatos.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : viewMode === "prova" && (showPdf || showingFolderProof) && provaPdfUrl ? (
        <div className="flex min-h-0 flex-1 flex-col max-md:overflow-visible md:overflow-hidden">
          {needsProvaReview && activeJob ? (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11px] font-medium text-amber-900">
                Arquivo gerado — aguardando sua aprovação
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={
                    discardProvaPending ||
                    approveProvaPending ||
                    !onDiscardProva
                  }
                  className="sagra-btn sagra-btn--outline sagra-btn--sm shadow-sm hover:bg-neutral-50 disabled:opacity-60"
                  onClick={() => onDiscardProva?.(activeJob.id)}
                >
                  <XCircle className="size-3.5" aria-hidden />
                  {discardProvaPending ? "Descartando..." : "Cancelar"}
                </button>
                <button
                  type="button"
                  disabled={
                    approveProvaPending ||
                    discardProvaPending ||
                    !onApproveProva
                  }
                  className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                  onClick={() => onApproveProva?.(activeJob.id)}
                >
                  {approveProvaPending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Check className="size-3.5" aria-hidden />
                  )}
                  {approveProvaPending ? "Registrando..." : "OK"}
                </button>
              </div>
            </div>
          ) : null}
          {provaReviewMessage ? (
            <p className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-[11px] text-emerald-800">
              {provaReviewMessage}
            </p>
          ) : null}
          <div
            className={
              showPdf && exibirMockup3d
                ? "grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 lg:grid-cols-2"
                : "grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3"
            }
          >
          <article
            className={cn(
              "flex flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm",
              pastaAvulsoPdf
                ? "min-h-[min(42vh,300px)] sm:min-h-[280px]"
                : "min-h-[min(50vh,360px)] flex-1 sm:min-h-[320px]",
            )}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-sagra-border px-3 py-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600">
                PDF
                <span className="ml-2 font-normal normal-case tracking-normal text-neutral-400">
                  {pastaAvulsoPdf ? "ajuste à largura" : "ajuste à altura"}
                </span>
              </h3>
              <a
                href={provaPdfViewerSrc || provaPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-medium text-secondary-blue hover:underline"
              >
                <ExternalLink className="size-3" aria-hidden />
                Abrir PDF
              </a>
            </header>
            <iframe
              key={
                showPdf && activeJob
                  ? `${activeJob.id}-${activeJob.concluido_em ?? "pdf"}-${pastaAvulsoPdf ? "w" : "h"}`
                  : `${folderProofLabel ?? provaPdfUrl}-${pastaAvulsoPdf ? "w" : "h"}`
              }
              title={
                showPdf && activeJob
                  ? `Prova PDF — job ${activeJob.id}`
                  : `Prova PDF — ${folderProofLabel ?? "pasta Sefoc"}`
              }
              src={provaPdfViewerSrc}
              className={cn(
                "w-full border-0 bg-neutral-100",
                pastaAvulsoPdf
                  ? "h-[min(48vh,560px)] min-h-[240px] flex-1"
                  : "min-h-0 h-full flex-1",
              )}
            />
          </article>

          {showPdf && exibirMockup3d ? (
          <article className="flex min-h-[min(45vh,320px)] flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm sm:min-h-[280px]">
            <header className="border-b border-sagra-border px-3 py-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600">
                Mockup 3D
              </h3>
            </header>
            <div className="relative min-h-[min(50vh,520px)] flex-1 sm:min-h-[min(45vh,520px)]">
              {previewPagesQuery.isLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-xs text-neutral-500">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Gerando prévia a partir do PDF...
                </div>
              ) : previewPagesQuery.isError ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-xs text-red-600">
                  Não foi possível gerar a prévia 3D a partir do PDF.
                </div>
              ) : (
                <>
                  <PapelariaProofMockup3D
                    pages={pageUrls}
                    config={mockupResolved.config}
                    isFallback={mockupResolved.isFallback}
                    sceneBasePx={
                      isNarrowViewport
                        ? PAPELARIA_MOCKUP_SCENE_BASE_PX_NARROW
                        : PAPELARIA_MOCKUP_SCENE_BASE_PX
                    }
                  />
                  {mockupResolved.isInvalid && (
                    <p className="absolute bottom-2 left-2 right-2 rounded bg-amber-50 px-2 py-1 text-center text-[10px] text-amber-800">
                      Configuração de mockup inválida. Usando visualização
                      genérica.
                    </p>
                  )}
                </>
              )}
            </div>
          </article>
          ) : null}
          </div>
        </div>
      ) : viewMode === "prova" ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-neutral-400">
          <div>
            <FileText className="mx-auto mb-2 size-10 text-neutral-300" aria-hidden />
            Nenhuma prova gerada nesta OS. Gere um arquivo ou alterne para Prévia.
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
          {!selectedModelId ? (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-neutral-400">
              <div>
                <FileText className="mx-auto mb-2 size-10 text-neutral-300" aria-hidden />
                Selecione um modelo para ver a prévia em tempo real.
              </div>
            </div>
          ) : modelLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Carregando modelo...
            </div>
          ) : hasLivePreview && runtimePreviewConfig ? (
            <article className="flex min-h-[min(45vh,400px)] flex-1 flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm sm:min-h-[280px]">
              <header className="border-b border-sagra-border px-3 py-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600">
                  Prévia em tempo real
                </h3>
                <p className="text-[10px] text-neutral-500">
                  Arraste os campos adicionados para as posições permitidas.
                </p>
              </header>
              <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
                {runtimePreviewConfig.faces.length > 1 ? (
                  <select
                    className="w-fit rounded border border-slate-300 px-2 py-1 text-xs"
                    value={activeFaceId}
                    onChange={(e) => setPreviewFaceId(e.target.value)}
                  >
                    {runtimePreviewConfig.faces.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome ?? f.id}
                      </option>
                    ))}
                  </select>
                ) : null}
                {onActiveDynamicFieldsChange ? (
                  <PapelariaProofDynamicFields
                    previewConfig={basePreviewConfig!}
                    activeFaceId={activeFaceId}
                    activeFields={activeDynamicFields}
                    fieldValues={livePreviewValues ?? {}}
                    onFieldValueChange={(key, value) =>
                      onLivePreviewValueChange?.(key, value)
                    }
                    onChange={onActiveDynamicFieldsChange}
                  />
                ) : null}
                <PapelariaLivePreview
                  previewConfig={runtimePreviewConfig}
                  values={livePreviewValues!}
                  modeloId={selectedModelId}
                  faceId={activeFaceId}
                  mode="form"
                  showGuides
                  editablePositions={activeDynamicFields.length > 0}
                  allowedSlotsByElement={allowedSlotsByElement}
                  onElementSlotChange={(faceId, elementIds, slotId) => {
                    const templates = basePreviewConfig?.camposDinamicos ?? [];
                    const expanded = elementIds.flatMap((id) =>
                      getGroupedTemplateIds(basePreviewConfig!, id),
                    );
                    handleElementSlotChange(faceId, expanded, slotId);
                  }}
                />
              </div>
            </article>
          ) : previewConfigJson?.trim() ? (
            <p className="flex flex-1 items-center justify-center p-6 text-center text-xs text-amber-700">
              Configuração de prévia inválida. Verifique o PreviewConfigJson no admin.
            </p>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-neutral-500">
                Este modelo ainda não possui prévia em tempo real configurada.
              </p>
              {previa && Object.keys(previa).length > 0 ? (
                <div className="max-h-full w-full max-w-lg overflow-y-auto space-y-2 text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    Prévia textual dos dados
                  </p>
                  {Object.entries(previa).map(([campo, texto]) => (
                    <div
                      key={campo}
                      className="rounded border border-sagra-border bg-white p-3 shadow-sm"
                    >
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-secondary-blue">
                        {campo}
                      </p>
                      <pre className="whitespace-pre-wrap font-sans text-xs text-neutral-800">
                        {texto}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-400">
                  Preencha os campos e clique em Gerar arquivo.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
