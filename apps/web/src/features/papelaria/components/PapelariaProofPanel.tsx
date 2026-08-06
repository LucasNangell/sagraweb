import { Check, ExternalLink, FileText, Loader2, XCircle } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { apiUrl } from "@/api/client";
import {
  fetchPapelariaCorelModelo,
  fetchPapelariaJobPreviewPages,
  papelariaJobFileUrl,
} from "@/api/papelaria";
import { queryKeys } from "@/api/query-keys";
import { useQuery } from "@tanstack/react-query";

import { useMatchMedia } from "@/hooks/useMatchMedia";
import { getPapelariaMockupConfig } from "../mockup";
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
  onCancelJob?: (jobId: number) => void;
  cancelPending?: boolean;
  onApproveProva?: (jobId: number) => void;
  onDiscardProva?: (jobId: number) => void;
  approveProvaPending?: boolean;
  discardProvaPending?: boolean;
  provaReviewMessage?: string | null;
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
  onCancelJob,
  cancelPending = false,
  onApproveProva,
  onDiscardProva,
  approveProvaPending = false,
  discardProvaPending = false,
  provaReviewMessage = null,
  activeDynamicFields = [],
  onActiveDynamicFieldsChange,
  onLivePreviewValueChange,
}: Props) {
  const [previewFaceId, setPreviewFaceId] = useState("frente");
  const isNarrowViewport = useMatchMedia("(max-width: 767px)");
  const showPdf =
    !!activeJob &&
    activeJob.status === "completed" &&
    activeJob.prova_revisao !== "discarded" &&
    (activeJob.tem_arquivo_pdf || !!activeJob.arquivo_pdf);

  const needsProvaReview =
    showPdf &&
    activeJob?.prova_revisao !== "approved" &&
    activeJob?.prova_revisao !== "discarded";

  const previewPagesQuery = useQuery({
    queryKey: queryKeys.papelaria.previewPages(activeJob?.id ?? 0),
    queryFn: () => fetchPapelariaJobPreviewPages(activeJob!.id),
    enabled: showPdf && !!activeJob,
    staleTime: 120_000,
    retry: 1,
  });

  const pageUrls =
    previewPagesQuery.data?.pages.map((p) => resolvePreviewImageUrl(p.url)) ??
    [];

  const pdfUrl = activeJob ? papelariaJobFileUrl(activeJob.id, "pdf") : "";

  const jobModeloQuery = useQuery({
    queryKey: queryKeys.papelaria.corelModelo(activeJob?.modelo_id ?? 0),
    queryFn: () => fetchPapelariaCorelModelo(activeJob!.modelo_id!),
    enabled: showPdf && !!activeJob?.modelo_id,
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

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-sagra-border bg-neutral-50 shadow-sm max-md:overflow-visible md:overflow-hidden">
      <div className="border-b border-sagra-border bg-white px-3 py-2">
        <h2 className="text-xs font-bold text-secondary-blue">
          Visualização da prova
        </h2>
        <p className="text-[10px] text-neutral-500">
          {isJobGenerating
            ? "Aguardando conclusão do worker CorelDRAW..."
            : needsProvaReview
              ? "Revise o arquivo gerado e confirme (OK) ou descarte (Cancelar)."
              : showPdf
                ? activeJob?.prova_revisao === "approved"
                  ? "Prova aprovada. Pendência de e-mail criada em SEFOC."
                  : "PDF e mockup 3D da prova gerada pelo sistema."
                : "Gere o arquivo para visualizar a prova."}
        </p>
      </div>

      {isJobGenerating ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <Loader2 className="size-10 animate-spin text-secondary-blue" aria-hidden />
          <div>
            <p className="text-sm font-medium text-neutral-700">
              Gerando arquivo Corel/PDF
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {activeJob?.status === "processing"
                ? "CorelDRAW em execução no worker..."
                : "Job na fila — aguardando o worker..."}
            </p>
            {activeJob && (
              <p className="mt-2 font-mono text-[10px] text-neutral-400">
                Job #{activeJob.id}
              </p>
            )}
          </div>
          {activeJob && onCancelJob && (
            <button
              type="button"
              disabled={cancelPending}
              className="inline-flex items-center gap-1.5 rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-60"
              onClick={() => onCancelJob(activeJob.id)}
            >
              <XCircle className="size-3.5" aria-hidden />
              {cancelPending
                ? "Cancelando..."
                : activeJob.status === "processing"
                  ? "Cancelar processamento"
                  : "Cancelar solicitação"}
            </button>
          )}
        </div>
      ) : showPdf && activeJob ? (
        <div className="flex min-h-0 flex-1 flex-col max-md:overflow-visible md:overflow-hidden">
          {needsProvaReview ? (
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
                  className="inline-flex items-center gap-1.5 rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-60"
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
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 lg:grid-cols-2">
          <article className="flex min-h-[min(45vh,320px)] flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm sm:min-h-[280px]">
            <header className="flex items-center justify-between border-b border-sagra-border px-3 py-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600">
                PDF
              </h3>
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-medium text-secondary-blue hover:underline"
              >
                <ExternalLink className="size-3" aria-hidden />
                Abrir PDF
              </a>
            </header>
            <iframe
              key={`${activeJob.id}-${activeJob.concluido_em ?? "pdf"}`}
              title={`Prova PDF — job ${activeJob.id}`}
              src={pdfUrl}
              className="h-[min(50vh,520px)] min-h-[220px] w-full flex-1 border-0 bg-white sm:h-[min(45vh,520px)]"
            />
          </article>

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
                    sceneBasePx={isNarrowViewport ? 220 : 280}
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
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
          {!selectedModelId ? (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-neutral-400">
              <div>
                <FileText className="mx-auto mb-2 size-10 text-neutral-300" aria-hidden />
                Selecione um modelo e gere o arquivo para visualizar a prova.
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
