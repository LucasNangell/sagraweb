import {
  Check,
  ExternalLink,
  FilePlus2,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { cn } from "@sagra/ui";

import { apiUrl } from "@/api/client";
import { usePdfOrientacao } from "@/lib/pdfOrientacao";
import {
  fetchPapelariaCorelModelo,
  fetchPapelariaJobPreviewPages,
  papelariaJobFileUrl,
  pollPapelariaImposicaoResultado,
  reenviarPapelariaImposicaoJdf,
} from "@/api/papelaria";
import { queryKeys } from "@/api/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMatchMedia } from "@/hooks/useMatchMedia";
import {
  getPapelariaMockupConfig,
  PAPELARIA_MOCKUP_SCENE_BASE_PX,
  PAPELARIA_MOCKUP_SCENE_BASE_PX_NARROW,
} from "../mockup";
import { extractProvaVersionFromFilename } from "@/features/email/utils/proofFilePicker";
import {
  isPastaAvulsoProduct,
  papelariaProofPdfFit,
  papelariaProofPdfViewerSrc,
} from "../papelariaSession";
import {
  papelariaGenerationStatusLabel,
  resolvePapelariaGenerationPhase,
} from "../papelariaGenerationStatus";
import {
  isReadyImposicaoPdf,
  isWaitingImposicaoApogee,
} from "../papelariaImposicaoStatus";
import { resolvePapelariaProvaDisplay } from "../papelariaProvaDisplay";
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
import type { PapelariaJob, PapelariaProvaStatus } from "../types";
import { PapelariaLivePreview } from "./PapelariaLivePreview";
import { previaRepeticao, type ProvaPdfRegiao } from "@/api/papelariaProvaPdf";

import {
  deveUsarPreviaPdfAoVivo,
  PapelariaPdfLivePreview,
  type AdicionarCampoExtraPayload,
  type MoverCampoExtraPayload,
  type RedeCatalogoItem,
} from "./PapelariaPdfLivePreview";
import type { ExtraEditorMeta } from "./PapelariaTextoEditor";
import { mockupJsonEfetivo, type ModeloComMockup } from "../mockup/mockupProduto";
import type { PapelariaComposicao } from "@/features/papelaria/types";
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
  /** Modelo selecionado (mockup do produto + reserva do modelo). */
  modeloMockup?: ModeloComMockup | null;
  previewConfigJson?: string | null;
  /** Modelo com PDF configurado: a prévia ao vivo é o próprio PDF renderizado no servidor. */
  temProvaPdf?: boolean;
  /** Frente de um modelo + verso de outro: a prévia junta as duas páginas. */
  composicao?: PapelariaComposicao | null;
  livePreviewValues?: Record<string, string>;
  previa: Record<string, string> | null;
  selectedModelId: number | null;
  modelLoading: boolean;
  viewMode: PapelariaViewMode;
  onViewModeChange: (mode: PapelariaViewMode) => void;
  /** PDF da última prova na pasta Sefoc (quando não há job ativo com PDF). */
  folderProofPdfUrl?: string | null;
  folderProofLabel?: string | null;
  /** PDF Digital de imposição na pasta Sefoc (quando não há job ativo). */
  folderImposicaoPdfUrl?: string | null;
  folderImposicaoLabel?: string | null;
  onCancelJob?: (jobId: number) => void;
  cancelPending?: boolean;
  onApproveProva?: (jobId: number) => void;
  onDiscardProva?: (jobId: number) => void;
  approveProvaPending?: boolean;
  discardProvaPending?: boolean;
  provaReviewMessage?: string | null;
  provaModo?: "prova_web" | "prova_email" | "prova_pdf";
  activeDynamicFields?: ActiveDynamicFieldPlacement[];
  onActiveDynamicFieldsChange?: (next: ActiveDynamicFieldPlacement[]) => void;
  onLivePreviewValueChange?: (key: string, value: string) => void;
  /** Texto editado direto na prévia do PDF. */
  onEditarTextoPrevia?: (
    regiao: ProvaPdfRegiao,
    texto: string,
    meta?: ExtraEditorMeta,
  ) => void;
  onRestaurarTextoPrevia?: (regiao: ProvaPdfRegiao) => void;
  /** Campos extras (só operador): menu de contexto na prévia PDF. */
  permitirCamposExtras?: boolean;
  redesCatalogoExtras?: RedeCatalogoItem[];
  onAdicionarCampoExtra?: (payload: AdicionarCampoExtraPayload) => void;
  onRemoverCampoExtra?: (extraId: string) => void;
  onMoverCampoExtra?: (payload: MoverCampoExtraPayload) => void;
  extrasMeta?: Record<string, ExtraEditorMeta>;
  /** Coluna à esquerda dentro do box (lista de modelos da página Papelaria). */
  ladoEsquerdo?: ReactNode;
  /** Conteúdo fixo no topo da prévia (ex.: resumo do pedido de alteração do cliente). */
  topoPrevia?: ReactNode;
  /** Repetição de SP: a prévia mostra a base recortada da prova antiga. */
  previaRepeticao?: { ano: number; nro: number } | null;
  /** Fase da prova (aprovação do cliente) para os badges Aprovada / Pendente. */
  provaStatus?: PapelariaProvaStatus | null;
  /** «Criar prova» flutuante no canto inferior direito da prévia. */
  criarProva?: {
    onClick: () => void;
    disabled: boolean;
    pending: boolean;
    title?: string;
  } | null;
  /** Conteúdo da aba Imposição quando ainda não há PDF (setup Offset/Digital + grade). */
  imposicaoSetup?: ReactNode;
  /** «Refazer imposição» flutuante quando o PDF está pronto. */
  refazerImposicao?: {
    onClick: () => void;
    disabled: boolean;
    pending: boolean;
    title?: string;
  } | null;
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
  modeloMockup = null,
  previewConfigJson,
  temProvaPdf = false,
  composicao = null,
  livePreviewValues,
  previa,
  selectedModelId,
  modelLoading,
  viewMode,
  onViewModeChange,
  folderProofPdfUrl = null,
  folderProofLabel = null,
  folderImposicaoPdfUrl = null,
  folderImposicaoLabel = null,
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
  onEditarTextoPrevia,
  onRestaurarTextoPrevia,
  permitirCamposExtras = true,
  redesCatalogoExtras = [],
  onAdicionarCampoExtra,
  onRemoverCampoExtra,
  onMoverCampoExtra,
  extrasMeta,
  ladoEsquerdo,
  provaStatus = null,
  criarProva = null,
  topoPrevia = null,
  previaRepeticao: repeticaoPrevia = null,
  imposicaoSetup = null,
  refazerImposicao = null,
}: Props) {
  const [previewFaceId, setPreviewFaceId] = useState("frente");
  const queryClient = useQueryClient();
  const isNarrowViewport = useMatchMedia("(max-width: 767px)");
  const isTimbradoDigitalJob =
    activeJob?.tipo_job === "timbrado_a4_digital";
  const isImposicaoJob = activeJob?.tipo_job === "imposicao";
  const waitingImposicaoApogee = isWaitingImposicaoApogee(activeJob);
  const readyImposicaoPdf = isReadyImposicaoPdf(activeJob);
  // Se o PDF já está em Digital, exibe mesmo antes do poll atualizar o job.
  const showApogeeWaitingUi =
    waitingImposicaoApogee && !folderImposicaoPdfUrl;
  const [resendJdfMessage, setResendJdfMessage] = useState<string | null>(null);
  const [resendJdfError, setResendJdfError] = useState<string | null>(null);

  const resendJdfMutation = useMutation({
    mutationFn: reenviarPapelariaImposicaoJdf,
    onSuccess: (job) => {
      setResendJdfError(null);
      setResendJdfMessage("JDF reenviado ao Apogee.");
      queryClient.setQueryData(queryKeys.papelaria.job(job.id), job);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.jobsOs(
          job.ano_protocolo,
          job.nro_protocolo,
        ),
      });
      void queryClient.invalidateQueries({
        queryKey: ["papelaria", "imposicao-resultado", job.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ["papelaria", "spStatusResumo"],
      });
    },
    onError: (err: Error) => {
      setResendJdfMessage(null);
      setResendJdfError(err.message || "Não foi possível reenviar o JDF.");
    },
  });
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
  // Prova: nunca mistura PDF Digital de imposição.
  const showPdf =
    !!activeJob &&
    !isTimbradoDigitalJob &&
    !isImposicaoJob &&
    activeJob.status === "completed" &&
    activeJob.prova_revisao !== "discarded" &&
    (activeJob.tem_arquivo_pdf || !!activeJob.arquivo_pdf);

  useQuery({
    queryKey: ["papelaria", "imposicao-resultado", activeJob?.id ?? 0],
    queryFn: async () => {
      const result = await pollPapelariaImposicaoResultado(activeJob!.id);
      if (result.status === "ready" && result.job) {
        queryClient.setQueryData(
          queryKeys.papelaria.job(result.job.id),
          result.job,
        );
        void queryClient.invalidateQueries({
          queryKey: queryKeys.papelaria.jobsOs(
            result.job.ano_protocolo,
            result.job.nro_protocolo,
          ),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.email.proofFiles(
            result.job.ano_protocolo,
            result.job.nro_protocolo,
          ),
        });
        void queryClient.invalidateQueries({
          queryKey: ["papelaria", "spStatusResumo"],
        });
      }
      return result;
    },
    // Continua o poll mesmo fora da aba Imposição (ex.: usuário voltou à SP).
    enabled: waitingImposicaoApogee && !!activeJob,
    refetchInterval: (query) =>
      query.state.data?.status === "ready" ? false : 3000,
    retry: false,
  });

  const needsProvaReview =
    showPdf &&
    activeJob?.prova_revisao === "pending";

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

  const provaDisplay = showPdf
    ? resolvePapelariaProvaDisplay(activeJob, folderProofLabel)
    : null;
  const jobPdfUrl = provaDisplay?.pdfUrl ?? "";
  const provaPdfUrl = showPdf ? jobPdfUrl : folderProofPdfUrl ?? "";
  const showingFolderProof = !showPdf && Boolean(folderProofPdfUrl);
  const folderProvaVersao =
    !showPdf && folderProofLabel
      ? extractProvaVersionFromFilename(folderProofLabel)
      : null;
  const displayedProvaLabel =
    provaDisplay?.provaLabel ??
    (folderProvaVersao != null ? `Prova ${folderProvaVersao}` : null);
  const displayedProvaFile =
    provaDisplay?.fileLabel ?? folderProofLabel ?? null;
  // Aprovação do cliente vale para a versão aprovada; prova mais nova volta a pendente.
  const versaoExibida =
    (displayedProvaFile ? extractProvaVersionFromFilename(displayedProvaFile) : null) ??
    folderProvaVersao;
  const provaAprovada =
    provaStatus?.phase === "approved" &&
    (provaStatus.versao == null || versaoExibida == null || provaStatus.versao === versaoExibida);
  const jobImposicaoPdfUrl =
    readyImposicaoPdf && activeJob
      ? papelariaJobFileUrl(activeJob.id, "pdf")
      : "";
  const imposicaoPdfUrl = jobImposicaoPdfUrl || folderImposicaoPdfUrl || "";
  const showingFolderImposicao =
    !jobImposicaoPdfUrl && Boolean(folderImposicaoPdfUrl);
  const produtoParaPdf = produto || activeJob?.produto || "";
  const pastaAvulsoPdf = isPastaAvulsoProduct(produtoParaPdf);
  // Orientação real da página 1: retrato abre pela altura, paisagem pela largura.
  const provaOrientacao = usePdfOrientacao(viewMode === "prova" ? provaPdfUrl : null);
  const imposicaoOrientacao = usePdfOrientacao(
    viewMode === "imposicao" ? imposicaoPdfUrl : null,
  );
  const provaAjuste = papelariaProofPdfFit(produtoParaPdf, provaOrientacao.orientacao);
  const imposicaoAjuste = papelariaProofPdfFit(produtoParaPdf, imposicaoOrientacao.orientacao);
  const provaPdfViewerSrc = provaOrientacao.pronta
    ? papelariaProofPdfViewerSrc(provaPdfUrl, produtoParaPdf, provaOrientacao.orientacao)
    : "";
  const imposicaoPdfViewerSrc = imposicaoOrientacao.pronta
    ? papelariaProofPdfViewerSrc(imposicaoPdfUrl, produtoParaPdf, imposicaoOrientacao.orientacao)
    : "";

  const jobModeloQuery = useQuery({
    queryKey: queryKeys.papelaria.corelModelo(activeJob?.modelo_id ?? 0),
    queryFn: () => fetchPapelariaCorelModelo(activeJob!.modelo_id!),
    enabled: viewMode === "prova" && showPdf && !!activeJob?.modelo_id,
    staleTime: 60_000,
  });

  // Mockup vale por produto: 1 página = só frente, 2+ = frente e verso.
  const mockupDoProduto = mockupJsonEfetivo(jobModeloQuery.data ?? modeloMockup, pageUrls.length);
  // `null` = sem configuração para esta variação → preset automático.
  const effectiveMockupJson = mockupDoProduto === undefined ? mockupConfigJson : mockupDoProduto;

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

  // Prévia PDF (pipeline Ct Visita) sempre que o modelo tem prova PDF.
  // Campos dinâmicos / prévia por imagem só como fallback sem PDF.
  const hasPdfLivePreview = deveUsarPreviaPdfAoVivo(
    temProvaPdf,
    selectedModelId,
    Boolean(livePreviewValues),
  );

  const hasLivePreview =
    !hasPdfLivePreview &&
    runtimePreviewConfig !== null &&
    selectedModelId !== null &&
    Boolean(livePreviewValues);

  const subtitle =
    viewMode === "previa"
      ? "Prévia em tempo real dos campos do formulário."
      : viewMode === "imposicao"
        ? showApogeeWaitingUi
          ? "Aguardando processamento pelo Apogee."
          : imposicaoPdfUrl
            ? "PDF de imposição (Digital) gerado pelo Apogee."
            : "Nenhuma imposição encontrada na pasta desta OS."
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
                        ? provaModo === "prova_email"
                          ? "PDF A4 carimbado (ProvaSefoc) para envio por e-mail."
                          : "PDF BaseSefoc e mockup 3D da prova gerada pelo sistema."
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

      <div className="flex min-h-0 flex-1 max-md:flex-col md:overflow-hidden">
      {ladoEsquerdo ? (
        <aside
          className="flex min-h-0 shrink-0 flex-col border-sagra-border bg-white max-md:max-h-64 max-md:border-b md:w-48 md:border-r xl:w-52"
          aria-label="Modelos disponíveis"
          data-testid="papelaria-proof-lado-esquerdo"
        >
          {ladoEsquerdo}
        </aside>
      ) : null}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col max-md:overflow-visible md:overflow-hidden">
      {viewMode === "previa" && topoPrevia ? topoPrevia : null}
      {viewMode === "previa" && criarProva ? (
        <button
          type="button"
          className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-secondary-blue px-4 py-2.5 text-xs font-semibold text-white shadow-lg ring-1 ring-black/5 transition hover:bg-secondary-blue/90 disabled:cursor-not-allowed disabled:opacity-55"
          onClick={criarProva.onClick}
          disabled={criarProva.disabled}
          title={criarProva.title ?? "Criar a prova a partir da prévia"}
          data-testid="papelaria-criar-prova-flutuante"
        >
          {criarProva.pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <FilePlus2 className="size-3.5" aria-hidden />
          )}
          Criar prova
        </button>
      ) : null}

      {viewMode === "imposicao" && showApogeeWaitingUi && activeJob ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
          data-testid="papelaria-imposicao-apogee-loading"
        >
          <Loader2 className="size-10 animate-spin text-secondary-blue" aria-hidden />
          <div>
            <p className="text-sm font-medium text-neutral-700">
              Aguardando processamento pelo Apogee
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <p className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold text-violet-900">
                Imposição
              </p>
              <button
                type="button"
                data-testid="papelaria-reenviar-jdf"
                disabled={resendJdfMutation.isPending}
                className="sagra-btn sagra-btn--outline sagra-btn--sm shadow-sm hover:bg-neutral-50 disabled:opacity-60"
                onClick={() => {
                  setResendJdfError(null);
                  setResendJdfMessage(null);
                  resendJdfMutation.mutate(activeJob.id);
                }}
              >
                {resendJdfMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden />
                )}
                {resendJdfMutation.isPending ? "Reenviando…" : "Reenviar JDF"}
              </button>
            </div>
            <p className="mt-2 max-w-sm text-xs text-neutral-500">
              O JDF foi enviado. Verificando Sefoc/Digital até surgir o PDF de
              imposição…
            </p>
            <p className="mt-2 font-mono text-[10px] text-neutral-400">
              Job #{activeJob.id}
            </p>
            {resendJdfMessage ? (
              <p className="mt-2 text-[11px] font-medium text-emerald-700">
                {resendJdfMessage}
              </p>
            ) : null}
            {resendJdfError ? (
              <p className="mt-2 max-w-sm text-[11px] font-medium text-red-700">
                {resendJdfError}
              </p>
            ) : null}
          </div>
        </div>
      ) : viewMode === "imposicao" && imposicaoPdfUrl ? (
        <div className="relative flex min-h-0 flex-1 flex-col max-md:overflow-visible md:overflow-hidden">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3">
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
                  PDF Imposição
                  <span className="ml-2 font-normal normal-case tracking-normal text-neutral-400">
                    {showingFolderImposicao && folderImposicaoLabel
                      ? folderImposicaoLabel
                      : "Digital"}
                  </span>
                </h3>
                <a
                  href={imposicaoPdfViewerSrc || imposicaoPdfUrl}
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
                  jobImposicaoPdfUrl && activeJob
                    ? `imp-${activeJob.id}-${activeJob.concluido_em ?? "pdf"}-${imposicaoAjuste}`
                    : `imp-folder-${folderImposicaoLabel ?? imposicaoPdfUrl}-${imposicaoAjuste}`
                }
                title={
                  jobImposicaoPdfUrl && activeJob
                    ? `Imposição PDF — job ${activeJob.id}`
                    : `Imposição PDF — ${folderImposicaoLabel ?? "Digital"}`
                }
                src={imposicaoPdfViewerSrc}
                className={cn(
                  "w-full border-0 bg-neutral-100",
                  pastaAvulsoPdf
                    ? "h-[min(48vh,560px)] min-h-[240px] flex-1"
                    : "min-h-0 h-full flex-1",
                )}
              />
            </article>
          </div>
          {refazerImposicao ? (
            <button
              type="button"
              className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-secondary-blue px-4 py-2.5 text-xs font-semibold text-white shadow-lg ring-1 ring-black/5 transition hover:bg-secondary-blue/90 disabled:cursor-not-allowed disabled:opacity-55"
              onClick={refazerImposicao.onClick}
              disabled={refazerImposicao.disabled}
              title={
                refazerImposicao.title ??
                "Refazer imposição e devolver as OSs juntadas a Aguard. Juntada"
              }
              data-testid="papelaria-refazer-imposicao-flutuante"
            >
              {refazerImposicao.pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="size-3.5" aria-hidden />
              )}
              Refazer imposição
            </button>
          ) : null}
        </div>
      ) : viewMode === "imposicao" && imposicaoSetup ? (
        imposicaoSetup
      ) : viewMode === "imposicao" ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-neutral-400">
          <div>
            <FileText className="mx-auto mb-2 size-10 text-neutral-300" aria-hidden />
            Nenhuma imposição nesta OS. Use a ação Imposição ou aguarde o
            Apogee.
          </div>
        </div>
      ) : viewMode === "prova" && showGenerating ? (
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
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-sagra-border px-3 py-2">
              <div className="min-w-0">
                <h3 className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-neutral-600">
                  PDF
                  {displayedProvaLabel ? (
                    <span
                      className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-sky-900"
                      data-testid="papelaria-prova-version-badge"
                    >
                      {displayedProvaLabel}
                    </span>
                  ) : (
                    <span className="font-normal normal-case tracking-normal text-neutral-400">
                      {provaAjuste === "FitH" ? "ajuste à largura" : "ajuste à altura"}
                    </span>
                  )}
                  {displayedProvaLabel ? (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal",
                        provaAprovada
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-900",
                      )}
                      data-testid="papelaria-prova-aprovacao-badge"
                      data-aprovada={provaAprovada ? "true" : "false"}
                    >
                      {provaAprovada ? "Aprovada" : "Pendente de aprovação"}
                    </span>
                  ) : null}
                </h3>
                {displayedProvaFile ? (
                  <p
                    className="mt-0.5 truncate text-[10px] font-normal normal-case tracking-normal text-neutral-500"
                    title={displayedProvaFile}
                    data-testid="papelaria-prova-file-label"
                  >
                    {displayedProvaFile}
                  </p>
                ) : null}
              </div>
              <a
                href={provaPdfViewerSrc || provaPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-secondary-blue hover:underline"
              >
                <ExternalLink className="size-3" aria-hidden />
                Abrir PDF
              </a>
            </header>
            <iframe
              key={
                showPdf && activeJob
                  ? `${activeJob.id}-${provaDisplay?.fileLabel ?? "pdf"}-${activeJob.concluido_em ?? "pdf"}-${provaAjuste}`
                  : `${folderProofLabel ?? provaPdfUrl}-${provaAjuste}`
              }
              title={
                showPdf && activeJob
                  ? `Prova PDF — ${displayedProvaLabel ?? `job ${activeJob.id}`}`
                  : `Prova PDF — ${displayedProvaLabel ?? folderProofLabel ?? "pasta Sefoc"}`
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 sm:p-3">
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
          ) : hasPdfLivePreview && selectedModelId !== null ? (
            <PapelariaPdfLivePreview
              modeloId={repeticaoPrevia ? 0 : (composicao?.frente.modelo_id ?? selectedModelId)}
              values={livePreviewValues ?? {}}
              composicao={composicao}
              {...(repeticaoPrevia
                ? {
                    fetchPrevia: (
                      _id: number,
                      dados: Record<string, string>,
                      signal?: AbortSignal,
                      comp?: PapelariaComposicao | null,
                    ) => previaRepeticao(repeticaoPrevia.ano, repeticaoPrevia.nro, dados, signal, comp),
                    queryKeyPrefix: "papelaria-repeticao",
                  }
                : {})}
              onEditarTexto={onEditarTextoPrevia}
              onRestaurarTexto={onRestaurarTextoPrevia}
              permitirCamposExtras={permitirCamposExtras}
              redesCatalogo={redesCatalogoExtras}
              onAdicionarCampoExtra={onAdicionarCampoExtra}
              onRemoverCampoExtra={onRemoverCampoExtra}
              onMoverCampoExtra={onMoverCampoExtra}
              extrasMeta={extrasMeta}
              className="min-h-0 flex-1"
            />
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
              Configuração de prévia inválida. Revise a aba Textos e prévia do modelo no admin.
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
                  Preencha os campos e clique em Criar prova.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      </div>
      </div>
    </section>
  );
}
