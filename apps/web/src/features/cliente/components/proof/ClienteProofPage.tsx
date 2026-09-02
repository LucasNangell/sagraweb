import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { cn } from "@sagra/ui";

import {
  fetchProofPortalData,
  fetchProofPreviewPages,
  proofPdfUrl,
  proofPreviewBaseUrl,
  respondProof,
  uploadProofExampleFile,
} from "@/api/proof-portal";
import type { PapelariaField } from "@/features/papelaria/types";
import { parsePreviewConfigJson } from "@/features/papelaria/preview";
import { getPapelariaMockupConfig } from "@/features/papelaria/mockup";
import {
  hasSeenPortalAprovacaoAlteracoesTour,
  hasSeenPortalAprovacaoTour,
  PORTAL_APROVACAO_ALTERACOES_TOUR_ID,
  PORTAL_APROVACAO_TOUR_ID,
} from "@/features/guided-tour/tourSeen";
import { useGuidedTourStore } from "@/features/guided-tour/tourStore";

import { ClienteProofActions } from "./ClienteProofActions";
import { ClienteProofDecisionModal } from "./ClienteProofDecisionModal";
import { ClienteProofFlipbookPanel } from "./ClienteProofFlipbookPanel";
import { ClienteProofMockupPanel } from "./ClienteProofMockupPanel";
import { ClienteProofPapelariaEditPanel } from "./ClienteProofPapelariaEditPanel";
import {
  ClienteProofAlteracoesDescriptionForm,
  ClienteProofExampleFileModal,
  ClienteProofPortalInstructionBanner,
  ClienteProofRelevoSecoBanner,
  isRelevoSecoCores,
} from "./ClienteProofPortalExtras";
import {
  ClienteProofPontoInput,
  formatProofPontoDisplay,
  formatProofPontoForApi,
} from "./ClienteProofPontoInput";
import { ClienteProofStatusBadge, type ProofUiStatus } from "./ClienteProofStatusBadge";
import { ClienteProofViewer } from "./ClienteProofViewer";
import { resolvePdfViewerFit } from "./resolvePdfViewerFit";
import { useProofGalNomeLookup } from "./useProofGalNomeLookup";

interface ClienteProofPageProps {
  token: string;
  osId: number;
  ano: number;
  embedded?: boolean;
  /** Portal público /portal/aprovacao — UI e fluxo específicos. */
  publicPortal?: boolean;
  onBack?: () => void;
  hideStatusHeader?: boolean;
  fillHeight?: boolean;
  leftPanel?: ReactNode;
}

interface ProofSubmissionSummary {
  tipo: "approved" | "rejected";
  nome: string;
  pontoDisplay: string;
  alteracoesAdicionais?: string;
  camposAlterados?: Array<{ label: string; antes: string; depois: string }>;
  arquivosExemplo?: string[];
}

function collectChangedFields(
  original: Record<string, string>,
  current: Record<string, string>,
): Record<string, string> {
  const changes: Record<string, string> = {};
  for (const [key, val] of Object.entries(current)) {
    if (String(val ?? "").trim() !== String(original[key] ?? "").trim()) {
      changes[key] = val;
    }
  }
  return changes;
}

function describeChangedFields(
  original: Record<string, string>,
  current: Record<string, string>,
  campos: PapelariaField[],
): Array<{ label: string; antes: string; depois: string }> {
  const labelByKey = new Map(campos.map((f) => [f.key, f.label]));
  return Object.entries(collectChangedFields(original, current)).map(([key, depois]) => ({
      label: labelByKey.get(key) ?? key,
      antes: String(original[key] ?? "").trim() || "—",
      depois: String(depois ?? "").trim() || "—",
  }));
}

function buildObservacaoPayload(
  alteracoesAdicionais: string,
  uploadedExampleFiles: string[],
  fallbackObservacao: string,
): string | undefined {
  const parts: string[] = [];
  const extra = alteracoesAdicionais.trim();
  if (extra) parts.push(extra);
  if (uploadedExampleFiles.length > 0) {
    parts.push(`Arquivo(s) de exemplo enviado(s): ${uploadedExampleFiles.join(", ")}`);
  }
  const merged = parts.join("\n\n").trim();
  return merged || fallbackObservacao.trim() || undefined;
}

const PREVIEW_DISCLAIMER_EDIT =
  "Esta é apenas uma visualização prévia aproximada e não constitui prova oficial. " +
  "Ao enviar a solicitação de alterações, você receberá uma nova prova para aprovação.";

export function ClienteProofPage({
  token,
  osId,
  ano,
  embedded = false,
  publicPortal = false,
  onBack,
  hideStatusHeader = false,
  fillHeight = false,
  leftPanel,
}: ClienteProofPageProps) {
  const qc = useQueryClient();
  const [nomeCliente, setNomeCliente] = useState("");
  const [ponto, setPonto] = useState("");
  const [observacao, setObservacao] = useState("");
  const [alteracoesAdicionais, setAlteracoesAdicionais] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState(false);
  const [alteracoesRequestMode, setAlteracoesRequestMode] = useState(false);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [submissionSummary, setSubmissionSummary] = useState<ProofSubmissionSummary | null>(
    null,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [modal, setModal] = useState<"approve" | "reject" | null>(null);
  const [exampleFileModalOpen, setExampleFileModalOpen] = useState(false);
  const [uploadedExampleFiles, setUploadedExampleFiles] = useState<string[]>([]);
  const [exampleUploadError, setExampleUploadError] = useState<string | null>(null);
  const [exampleUploadPending, setExampleUploadPending] = useState(false);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  const proofQuery = useQuery({
    queryKey: ["portal", "aprovacao", token, osId, ano],
    queryFn: () => fetchProofPortalData(ano, osId, token),
    enabled: Boolean(token && osId && ano),
    retry: false,
  });

  const papelaria = proofQuery.data?.papelaria;
  const isPapelaria = Boolean(proofQuery.data?.isPapelaria && papelaria);
  const showMockup = isPapelaria && Boolean(proofQuery.data?.hasPdf);
  // Papelaria mantém o mockup 3D; os demais produtos folheiam as páginas.
  const showFlipbook = Boolean(proofQuery.data?.isProvaWeb) && !showMockup;
  const showRelevoSecoNotice =
    !showFlipbook &&
    isRelevoSecoCores(papelaria?.cores ?? proofQuery.data?.cores);
  const hasEditableFields =
    Boolean(isPapelaria && (papelaria?.campos_formulario?.length ?? 0) > 0);
  const portalTourStartedRef = useRef(false);
  const portalAlteracoesTourStartedRef = useRef(false);

  const { pending: nomeLookupPending, lockNome: nomeLocked } = useProofGalNomeLookup({
    enabled: Boolean(publicPortal && token && osId && ano && !done),
    ano,
    osId,
    token,
    pontoDigits: ponto,
    nomeCliente,
    onNomeChange: setNomeCliente,
  });

  useEffect(() => {
    if (!publicPortal || !proofQuery.data || done || alteracoesRequestMode) {
      return;
    }
    if (hasSeenPortalAprovacaoTour() || portalTourStartedRef.current) {
      return;
    }
    const tour = useGuidedTourStore.getState();
    if (tour.tourId) {
      return;
    }
    portalTourStartedRef.current = true;
    tour.start(PORTAL_APROVACAO_TOUR_ID);
  }, [publicPortal, proofQuery.data, done, alteracoesRequestMode]);

  useEffect(() => {
    if (!publicPortal || !proofQuery.data || done || !alteracoesRequestMode) {
      return;
    }
    if (
      hasSeenPortalAprovacaoAlteracoesTour() ||
      portalAlteracoesTourStartedRef.current
    ) {
      return;
    }
    const tour = useGuidedTourStore.getState();
    portalAlteracoesTourStartedRef.current = true;
    if (tour.tourId === PORTAL_APROVACAO_TOUR_ID) {
      tour.complete();
    }
    useGuidedTourStore.getState().start(PORTAL_APROVACAO_ALTERACOES_TOUR_ID);
  }, [publicPortal, proofQuery.data, done, alteracoesRequestMode]);

  useEffect(() => {
    if (alteracoesRequestMode) {
      return;
    }
    const tour = useGuidedTourStore.getState();
    if (tour.tourId !== PORTAL_APROVACAO_ALTERACOES_TOUR_ID) {
      return;
    }
    tour.stop();
    portalAlteracoesTourStartedRef.current = false;
  }, [alteracoesRequestMode]);

  useEffect(() => {
    if (!done) {
      return;
    }
    const tour = useGuidedTourStore.getState();
    if (
      tour.tourId === PORTAL_APROVACAO_TOUR_ID ||
      tour.tourId === PORTAL_APROVACAO_ALTERACOES_TOUR_ID
    ) {
      tour.complete();
    }
  }, [done]);

  const previewQuery = useQuery({
    queryKey: ["portal", "aprovacao", "preview-pages", token, osId, ano],
    queryFn: () => fetchProofPreviewPages(ano, osId, token),
    enabled: Boolean(token && osId && ano && showMockup && !editMode),
    staleTime: 120_000,
    retry: 1,
  });

  const livePreviewParsed = useMemo(() => {
    const raw = papelaria?.preview_config_json;
    if (!raw?.trim()) return null;
    return parsePreviewConfigJson(raw);
  }, [papelaria?.preview_config_json]);

  const hasLivePreview =
    livePreviewParsed?.ok === true &&
    Boolean(papelaria?.modelo_id) &&
    Object.keys(fieldValues).length > 0;

  const pdfFit = useMemo(() => {
    const preview = previewQuery.data;
    if (!preview?.isPapelaria) {
      return "page-fit" as const;
    }
    const pageCount = preview.pages?.length ?? 0;
    const mockup = getPapelariaMockupConfig({
      produto: preview.produto ?? proofQuery.data?.produto,
      arquivoModelo: preview.arquivoModelo,
      frenteVerso: preview.frenteVerso,
      pageCount,
      mockupConfigJson: preview.mockupConfigJson,
    });
    return resolvePdfViewerFit(
      mockup.config.orientacao,
      mockup.config.larguraAbertaMm,
      mockup.config.alturaAbertaMm,
    );
  }, [previewQuery.data, proofQuery.data?.produto]);

  const pontoApiValue = publicPortal
    ? formatProofPontoForApi(ponto, true)
    : ponto.trim();

  const respondMutation = useMutation({
    mutationFn: (aprovado: boolean) => {
      const obsPayload = publicPortal
        ? buildObservacaoPayload(alteracoesAdicionais, uploadedExampleFiles, observacao)
        : observacao.trim() || undefined;

      let alteracoesPayload: Record<string, string> | undefined;
      if (!aprovado && isPapelaria && editMode) {
        if (publicPortal) {
          const changes = collectChangedFields(
            papelaria?.job_dados ?? {},
            fieldValues,
          );
          if (Object.keys(changes).length > 0) {
            alteracoesPayload = changes;
          }
        } else {
          alteracoesPayload = fieldValues;
        }
      }

      return respondProof({
        token,
        os_id: osId,
        ano,
        aprovado,
        observacao: obsPayload,
        nome_cliente: nomeCliente.trim(),
        ponto: pontoApiValue,
        alteracoes_campos: alteracoesPayload,
      });
    },
    onSuccess: (_data, aprovado) => {
      const pontoDisplay = formatProofPontoDisplay(ponto, publicPortal);
      if (aprovado) {
        setSubmissionSummary({
          tipo: "approved",
          nome: nomeCliente.trim(),
          pontoDisplay,
        });
      } else {
        const camposAlterados =
          isPapelaria && papelaria
            ? describeChangedFields(
                papelaria.job_dados ?? {},
                fieldValues,
                papelaria.campos_formulario ?? [],
              )
            : [];
        setSubmissionSummary({
          tipo: "rejected",
          nome: nomeCliente.trim(),
          pontoDisplay,
          alteracoesAdicionais: alteracoesAdicionais.trim() || undefined,
          camposAlterados: camposAlterados.length > 0 ? camposAlterados : undefined,
          arquivosExemplo:
            uploadedExampleFiles.length > 0 ? [...uploadedExampleFiles] : undefined,
        });
      }
      setDone(aprovado ? "approved" : "rejected");
      setErrorMsg(null);
      setModal(null);
      setEditMode(false);
      setAlteracoesRequestMode(false);
      setExampleFileModalOpen(false);
      void qc.invalidateQueries({ queryKey: ["cliente", "dashboard"] });
    },
    onError: (err: Error) => {
      setErrorMsg(err.message);
      setModal(null);
    },
  });

  const exampleUploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadProofExampleFile({ token, os_id: osId, ano, file }),
    onSuccess: (data) => {
      setUploadedExampleFiles((prev) =>
        prev.includes(data.filename) ? prev : [...prev, data.filename],
      );
      setExampleUploadError(null);
    },
    onError: (err: Error) => {
      setExampleUploadError(err.message);
    },
    onSettled: () => {
      setExampleUploadPending(false);
    },
  });

  const handleRejectClick = () => {
    setErrorMsg(null);
    if (!nomeCliente.trim() || !ponto.replace(/\D/g, "")) {
      setErrorMsg("Preencha nome e ponto antes de solicitar alterações.");
      return;
    }
    if (isPapelaria && papelaria) {
      setFieldValues({ ...(papelaria.job_dados ?? {}) });
      setEditMode(true);
      if (publicPortal) setAlteracoesRequestMode(true);
      return;
    }
    if (publicPortal) {
      setAlteracoesRequestMode(true);
      return;
    }
    setModal("reject");
  };

  useEffect(() => {
    if (!editMode) return;
    previewScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [editMode]);

  const validateRejectSubmission = (): boolean => {
    if (isPapelaria && editMode) {
      const missing = (papelaria?.campos_formulario ?? []).filter(
        (f) => f.required && !String(fieldValues[f.key] ?? "").trim(),
      );
      if (missing.length > 0) {
        setErrorMsg(
          `Preencha os campos obrigatórios: ${missing.map((f) => f.label).join(", ")}.`,
        );
        return false;
      }
    }

    if (publicPortal) {
      const original = papelaria?.job_dados ?? {};
      const hasFieldChanges =
        isPapelaria &&
        Object.keys(
          collectChangedFields(original, fieldValues),
        ).length > 0;
      const hasAdditional = Boolean(alteracoesAdicionais.trim());
      const hasFiles = uploadedExampleFiles.length > 0;
      if (!hasFieldChanges && !hasAdditional && !hasFiles) {
        setErrorMsg(
          "Descreva as alterações desejadas, altere os campos ou envie um arquivo de exemplo.",
        );
        return false;
      }
    }

    return true;
  };

  const handleConfirmReject = () => {
    if (!validateRejectSubmission()) return;
    setModal("reject");
  };

  const handleCancelAlteracoes = () => {
    if (respondMutation.isPending) return;
    setEditMode(false);
    setAlteracoesRequestMode(false);
    setErrorMsg(null);
  };

  const handleOpenExampleFile = () => {
    setExampleUploadError(null);
    setExampleFileModalOpen(true);
  };

  const handleExampleFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setExampleUploadPending(true);
    setExampleUploadError(null);
    void exampleUploadMutation.mutate(list[0]!);
  };

  if (!osId || !ano || !token) {
    return (
      <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
        Link inválido. Parâmetros os, ano e token são obrigatórios.
      </p>
    );
  }

  if (proofQuery.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
        <Loader2 className="size-8 animate-spin" aria-hidden />
        <p className="mt-3 text-sm">Carregando prova…</p>
      </div>
    );
  }

  if (proofQuery.isError) {
    const msg =
      proofQuery.error instanceof Error
        ? proofQuery.error.message
        : "Erro ao carregar prova.";
    const isExpired = msg.toLowerCase().includes("expir") || msg.includes("409");
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center">
        <ClienteProofStatusBadge status={isExpired ? "unavailable" : "error"} />
        <p className="mt-3 text-sm text-red-800">{msg}</p>
        {embedded ? (
          <Link
            to="/cliente"
            className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-secondary-blue px-4 py-2 text-sm font-medium text-white"
          >
            Voltar ao painel
          </Link>
        ) : null}
      </div>
    );
  }

  const data = proofQuery.data;
  const pdfUrl = proofPdfUrl(ano, osId, token);
  const osLabel = `${osId}/${ano}`;

  let uiStatus: ProofUiStatus = "pending";
  if (done === "approved") uiStatus = "approved";
  if (done === "rejected") uiStatus = "adjustment_requested";

  if (done) {
    const summary = submissionSummary;
    return (
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-sagra-border bg-white px-6 py-10 shadow-sm">
        <div className="text-center">
          {done === "approved" ? (
            <CheckCircle2 className="mx-auto size-14 text-primary-green" aria-hidden />
          ) : (
            <CheckCircle2 className="mx-auto size-14 text-secondary-blue" aria-hidden />
          )}
          <h2 className="mt-4 text-xl font-bold text-slate-900">
            {done === "approved" ? "Prova aprovada" : "Solicitações enviadas"}
          </h2>
          <p className="mt-2 text-sm text-neutral-600">
            OS {osLabel} — sua resposta foi registrada e a equipe técnica será notificada.
          </p>
        </div>
        {publicPortal && summary ? (
          <dl className="mt-8 space-y-4 text-left text-sm">
            <div className="rounded-xl border border-sagra-border bg-slate-50 px-4 py-3">
              <dt className="font-semibold text-neutral-700">Registrado por</dt>
              <dd className="mt-1 text-neutral-900">
                {summary.nome} — ponto {summary.pontoDisplay}
              </dd>
            </div>
            {summary.tipo === "rejected" ? (
              <>
                {summary.camposAlterados && summary.camposAlterados.length > 0 ? (
                  <div className="rounded-xl border border-sagra-border px-4 py-3">
                    <dt className="font-semibold text-neutral-700">Campos alterados</dt>
                    <dd className="mt-2 space-y-2">
                      {summary.camposAlterados.map((campo) => (
                        <div key={campo.label} className="rounded-lg bg-slate-50 px-3 py-2">
                          <p className="font-medium text-secondary-blue">{campo.label}</p>
                          <p className="mt-1 text-neutral-600">
                            <span className="text-neutral-500">De:</span> {campo.antes}
                          </p>
                          <p className="text-neutral-800">
                            <span className="text-neutral-500">Para:</span> {campo.depois}
                          </p>
                        </div>
                      ))}
                    </dd>
                  </div>
                ) : null}
                {summary.alteracoesAdicionais ? (
                  <div className="rounded-xl border border-sagra-border px-4 py-3">
                    <dt className="font-semibold text-neutral-700">Solicitações adicionais</dt>
                    <dd className="mt-2 whitespace-pre-wrap text-neutral-800">
                      {summary.alteracoesAdicionais}
                    </dd>
                  </div>
                ) : null}
                {summary.arquivosExemplo && summary.arquivosExemplo.length > 0 ? (
                  <div className="rounded-xl border border-sagra-border px-4 py-3">
                    <dt className="font-semibold text-neutral-700">Arquivos de exemplo enviados</dt>
                    <dd className="mt-2 list-inside list-disc text-neutral-800">
                      {summary.arquivosExemplo.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>
        ) : null}
        {embedded ? (
          <div className="mt-6 flex justify-center gap-3">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex min-h-11 items-center rounded-xl bg-secondary-blue px-4 py-2 text-sm font-medium text-white"
              >
                Voltar ao painel
              </button>
            ) : (
              <Link
                to="/cliente"
                className="inline-flex min-h-11 items-center rounded-xl bg-secondary-blue px-4 py-2 text-sm font-medium text-white"
              >
                Voltar ao painel
              </Link>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  const proofInfoHeader = !hideStatusHeader ? (
    <div className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase text-neutral-500">Prova digital</p>
          <p className="text-sm font-bold text-secondary-blue">
            OS {osLabel} — Versão {data?.versao}
          </p>
          <p className="mt-1 text-sm font-medium text-neutral-800">{data?.titulo || "—"}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {[data?.produto, data?.gabinete || data?.solicitante].filter(Boolean).join(" · ")}
          </p>
        </div>
        <ClienteProofStatusBadge status={uiStatus} />
      </div>
    </div>
  ) : null;

  const resolvePreviewBase = (faceId: string) =>
    proofPreviewBaseUrl(ano, osId, token, faceId, data?.versao);

  return (
    <div
      data-tour={publicPortal ? "portal-proof-page" : undefined}
      data-tour-alteracoes={alteracoesRequestMode ? "true" : "false"}
      data-tour-editable-fields={hasEditableFields ? "true" : "false"}
      data-tour-approve-modal={modal === "approve" ? "true" : "false"}
      className={cn(
        fillHeight && "flex min-h-0 w-full flex-1 flex-col",
        fillHeight && !editMode && "h-full min-h-0 overflow-hidden",
        fillHeight && editMode && "min-h-0 overflow-y-auto",
      )}
    >
      <div
        className={cn(
          "flex flex-1 flex-col gap-4 lg:flex-row lg:gap-0",
          fillHeight && !editMode && "min-h-0 overflow-hidden lg:items-stretch",
          fillHeight && editMode && "min-h-0 lg:items-start",
          fillHeight && "border-t border-sagra-border/80",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 flex-col gap-4",
            fillHeight
              ? editMode && isPapelaria
                ? "w-full border-b border-sagra-border/80 p-4 lg:w-72 lg:max-w-xs lg:border-b-0 lg:border-r lg:p-5"
                : "w-full border-b border-sagra-border/80 p-4 lg:w-[min(100%,22rem)] lg:max-w-md lg:border-b-0 lg:border-r lg:p-5"
              : "w-full lg:w-[min(100%,22rem)] lg:max-w-md",
            editMode && isPapelaria && "lg:sticky lg:top-4 lg:self-start lg:overflow-visible",
            !editMode && "overflow-y-auto",
          )}
        >
          {leftPanel}
          {proofInfoHeader}
          {hideStatusHeader && !leftPanel ? (
            <div className="flex justify-start">
              <ClienteProofStatusBadge status={uiStatus} />
            </div>
          ) : null}

          {editMode && isPapelaria ? (
            <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm sm:p-5">
              {!publicPortal ? (
                <button
                  type="button"
                  className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-secondary-blue hover:underline"
                  onClick={() => {
                    setEditMode(false);
                    setAlteracoesRequestMode(false);
                  }}
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  Voltar à prova
                </button>
              ) : null}
              <h2 className="text-base font-bold text-secondary-blue">
                Solicitação de alterações
              </h2>
              <p className="mt-1 text-sm text-neutral-600">
                {publicPortal
                  ? "Ajuste os dados na prévia e envie quando terminar."
                  : "Identifique-se e envie quando terminar de ajustar os dados na prévia."}
              </p>
              <div className="mt-4 space-y-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-neutral-700">
                    Número de ponto <span className="text-red-600">*</span>
                  </span>
                  <ClienteProofPontoInput
                    value={ponto}
                    onChange={(value) => {
                      setPonto(value);
                      setNomeCliente("");
                    }}
                    withPrefix={publicPortal}
                    disabled={respondMutation.isPending}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-neutral-700">
                    Nome <span className="text-red-600">*</span>
                    {nomeLookupPending ? (
                      <span className="ml-2 font-normal text-neutral-500">Buscando…</span>
                    ) : null}
                  </span>
                  <input
                    className="min-h-11 rounded-xl border border-sagra-border px-3 py-2 text-sm disabled:bg-neutral-50 disabled:text-neutral-500"
                    value={nomeCliente}
                    onChange={(e) => setNomeCliente(e.target.value)}
                    disabled={respondMutation.isPending || nomeLocked}
                    aria-busy={nomeLookupPending || undefined}
                  />
                </label>
                {!publicPortal ? (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-neutral-700">
                      Observações adicionais
                    </span>
                    <textarea
                      className="min-h-20 rounded-xl border border-sagra-border px-3 py-2 text-sm"
                      value={observacao}
                      onChange={(e) => setObservacao(e.target.value)}
                      placeholder="Descreva outros ajustes desejados, se necessário."
                      disabled={respondMutation.isPending}
                    />
                  </label>
                ) : null}
              </div>
              {publicPortal ? (
                <ClienteProofAlteracoesDescriptionForm
                  value={alteracoesAdicionais}
                  loading={respondMutation.isPending}
                  errorMsg={errorMsg}
                  uploadedFiles={uploadedExampleFiles}
                  onChange={setAlteracoesAdicionais}
                  onSubmit={handleConfirmReject}
                  onCancel={handleCancelAlteracoes}
                  onExampleFile={handleOpenExampleFile}
                />
              ) : (
                <>
                  {errorMsg ? (
                    <p className="mt-3 text-sm text-red-700" role="alert">
                      {errorMsg}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={respondMutation.isPending}
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                    onClick={handleConfirmReject}
                  >
                    Enviar solicitação de alterações
                  </button>
                </>
              )}
            </section>
          ) : alteracoesRequestMode && publicPortal && !isPapelaria ? (
            <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm sm:p-5">
              <h2 className="text-base font-bold text-secondary-blue">
                Solicitação de alterações
              </h2>
              <ClienteProofAlteracoesDescriptionForm
                value={alteracoesAdicionais}
                loading={respondMutation.isPending}
                errorMsg={errorMsg}
                uploadedFiles={uploadedExampleFiles}
                onChange={setAlteracoesAdicionais}
                onSubmit={handleConfirmReject}
                onCancel={handleCancelAlteracoes}
                onExampleFile={handleOpenExampleFile}
              />
            </section>
          ) : !alteracoesRequestMode ? (
            <ClienteProofActions
              nomeCliente={nomeCliente}
              ponto={ponto}
              observacao={observacao}
              onNomeChange={setNomeCliente}
              onPontoChange={(value) => {
                setPonto(value);
                setNomeCliente("");
              }}
              onObservacaoChange={setObservacao}
              onApproveClick={() => setModal("approve")}
              onRejectClick={handleRejectClick}
              isPending={respondMutation.isPending}
              errorMsg={errorMsg}
              requireObsForReject={!isPapelaria}
              publicPortal={publicPortal}
              nomeLookupPending={nomeLookupPending}
              nomeLocked={nomeLocked}
            />
          ) : null}
        </div>

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col bg-white",
            editMode && isPapelaria
              ? "min-h-0 overflow-hidden"
              : fillHeight && !editMode
                ? "min-h-0 overflow-hidden"
                : "min-h-0",
          )}
        >
          {showRelevoSecoNotice ? <ClienteProofRelevoSecoBanner /> : null}
          {editMode && isPapelaria ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 lg:p-5">
              <article
                className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-sagra-border bg-white shadow-sm"
                data-tour="proof-editable-fields"
              >
                <header className="border-b border-sagra-border px-4 py-3">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-600">
                    Prévia em tempo real — informações do trabalho
                  </h3>
                  <p className="mt-1 text-sm text-neutral-600">
                    Ajuste os campos ao lado de cada face. A prévia atualiza automaticamente.
                  </p>
                </header>
                {publicPortal ? (
                  <ClienteProofPortalInstructionBanner />
                ) : (
                  <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {PREVIEW_DISCLAIMER_EDIT}
                  </div>
                )}
                <div ref={previewScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
                  {hasLivePreview ? (
                    <ClienteProofPapelariaEditPanel
                      previewConfig={livePreviewParsed!.config}
                      camposFormulario={papelaria!.campos_formulario ?? []}
                      fieldValues={fieldValues}
                      modeloId={papelaria!.modelo_id}
                      disabled={respondMutation.isPending}
                      resolvePreviewBaseUrl={resolvePreviewBase}
                      onFieldChange={(key, value) =>
                        setFieldValues((prev) => ({ ...prev, [key]: value }))
                      }
                    />
                  ) : (
                    <p className="py-8 text-center text-sm text-neutral-500">
                      Prévia indisponível para este modelo. Ajuste os campos e envie a
                      solicitação — a equipe gerará uma nova prova.
                    </p>
                  )}
                </div>
              </article>
            </div>
          ) : showFlipbook ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
              <ClienteProofFlipbookPanel
                ano={ano}
                osId={osId}
                token={token}
                fillHeight={fillHeight}
              />
            </div>
          ) : showMockup ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-3 overflow-hidden p-3 xl:grid-cols-2 xl:grid-rows-1">
              <ClienteProofViewer
                pdfUrl={pdfUrl}
                osLabel={osLabel}
                hasPdf={Boolean(data?.hasPdf)}
                arquivoNome={data?.arquivoNome}
                fillHeight={fillHeight}
                pdfFit={pdfFit}
              />
              <ClienteProofMockupPanel
                previewData={previewQuery.data}
                isLoading={previewQuery.isLoading}
                isError={previewQuery.isError}
                produtoFallback={data?.produto}
                fillHeight={fillHeight}
              />
            </div>
          ) : (
            <ClienteProofViewer
              pdfUrl={pdfUrl}
              osLabel={osLabel}
              hasPdf={Boolean(data?.hasPdf)}
              arquivoNome={data?.arquivoNome}
              fillHeight={fillHeight}
            />
          )}
        </div>
      </div>

      <ClienteProofDecisionModal
        open={modal === "approve"}
        title="Confirmar aprovação"
        description="Confirma a aprovação desta prova? Após aprovada, a produção poderá seguir para a próxima etapa."
        confirmLabel="Sim, aprovar prova"
        variant="approve"
        loading={respondMutation.isPending}
        onConfirm={() => respondMutation.mutate(true)}
        onCancel={() => setModal(null)}
      />

      <ClienteProofDecisionModal
        open={modal === "reject"}
        title="Confirmar solicitação de alterações"
        description={
          isPapelaria && editMode
            ? "Confirma o envio das alterações informadas? Você receberá uma nova prova para aprovação."
            : "Confirma a solicitação de alterações? A equipe responsável será notificada para revisar a prova."
        }
        confirmLabel="Sim, solicitar alterações"
        variant="reject"
        loading={respondMutation.isPending}
        onConfirm={() => respondMutation.mutate(false)}
        onCancel={() => setModal(null)}
      />

      {publicPortal ? (
        <ClienteProofExampleFileModal
          open={exampleFileModalOpen}
          loading={exampleUploadPending}
          errorMsg={exampleUploadError}
          uploadedFiles={uploadedExampleFiles}
          onUpload={handleExampleFiles}
          onClose={() => {
            if (!exampleUploadPending) setExampleFileModalOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
