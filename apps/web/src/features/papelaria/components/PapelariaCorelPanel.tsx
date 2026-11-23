import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  approvePapelariaJobProva,
  abrirCorelPapelariaOs,
  cancelPapelariaJob,
  createPapelariaJob,
  createPapelariaTimbradoA4DigitalJob,
  criarPapelariaImposicaoJob,
  discardPapelariaJobProva,
  fetchPapelariaCdrPath,
  fetchPapelariaCorelModelo,
  fetchPapelariaJob,
  fetchPapelariaJobsForOs,
  fetchPapelariaOsContext,
  finalizarCorelPapelariaOs,
  iniciarComparacaoCorelPapelariaOs,
} from "@/api/papelaria";
import { fetchImposicaoVariantesOs } from "@/api/imposicaoPerfil";
import { fetchDeputadoLookup } from "@/api/auxLookups";
import { emailProofFileUrl } from "@/api/email";
import { fetchOsFolderBrowse } from "@/api/os";
import { useOsPathMutation } from "@/api/hooks/useOsPath";
import { useEmailProofFiles } from "@/api/hooks/useEmailQueries";
import { queryKeys } from "@/api/query-keys";
import { useAuthStore } from "@/features/auth/authStore";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { OsFolderRequiredGateModal } from "@/features/os/components/OsFolderRequiredGateModal";
import { openNetworkFolder } from "@/features/os/osFolderActions";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";
import { tryOpenFileLocally } from "@/lib/sagraLocalOpener";
import { authenticatedWsPath } from "@/lib/websocket";
import { PapelariaActionBar } from "./PapelariaActionBar";
import {
  PapelariaCorelDadosModal,
  type PapelariaCorelDadosEstado,
} from "./PapelariaCorelDadosModal";
import { PapelariaImposicaoVarianteDialog } from "./PapelariaImposicaoVarianteDialog";
import type { PapelariaFaceFonte, PapelariaRedeEstilo } from "@/features/papelaria/types";
import {
  COMPOSICAO_DADOS_KEY,
  usePapelariaComposicao,
} from "./PapelariaFrenteVersoPicker";
import type { ProvaPdfRegiao } from "@/api/papelariaProvaPdf";
import {
  interpretarEdicao,
  TEXTOS_DADOS_KEY,
  textosParaDados,
} from "@/features/papelaria/papelariaTextosEditados";

import { PapelariaModelosLista, resumoListaModelos } from "./PapelariaModelosLista";
import { PapelariaProofPanel } from "./PapelariaProofPanel";
import {
  estiloInicial,
  lembrarRedes,
  PapelariaRedesPicker,
  REDES_DADOS_KEY,
  REDES_ESTILO_DADOS_KEY,
  redesParaBloco,
  redesParaDados,
  type RedeEscolha,
} from "./PapelariaRedesPicker";
import type {
  ImposicaoVariante,
  ImposicaoVariantesResponse,
} from "@/features/papelaria/imposicao/perfil/types";
import {
  mergeDadosWithDynamicLayout,
  applyPreviewTemplate,
  type ActiveDynamicFieldPlacement,
} from "../preview";
import {
  clienteAlteracaoIdentity,
  isClienteAlteracaoPendente,
  mergePapelariaFieldValues,
} from "../applyPapelariaPrefill";
import {
  applyCamaraCorelEnrichment,
  aplicarVariaveisFonte,
  deputadoLookupToCorelPrefill,
} from "../deputadoCorelPrefill";
import {
  isReadyImposicaoPdf,
  isWaitingImposicaoApogee,
} from "../papelariaImposicaoStatus";
import { isTimbradoA4DigitalProduct } from "../papelariaSession";
import { compararDadosCorel } from "../papelariaCorelDados";
import {
  CAMPOS_PRODUTO_DADOS_KEY,
  camposModeloComProduto,
  camposVisiveis,
  construirCamposProduto,
  previewConfigComProduto,
  semValoresDoProduto,
} from "../papelariaCamposProduto";
import {
  resolveDefaultPapelariaViewMode,
  type PapelariaViewMode,
} from "../papelariaViewMode";
import type {
  PapelariaCamposProduto,
  PapelariaCorelModelSummary,
  PapelariaField,
  PapelariaJob,
  PapelariaJobStatus,
  PapelariaOsCdrFile,
} from "../types";

type Props = {
  osId: string | null;
  osAno: string | null;
  /** Quando informado, modelos e campos são renderizados neste elemento. */
  formHost?: HTMLElement | null;
  /** Reserva o formulário para o host, mesmo antes do elemento existir. */
  dockForm?: boolean;
};

function buildPreviaTextual(
  campos: Record<string, string>,
  dados: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [nome, template] of Object.entries(campos)) {
    const fvMatch = template.match(
      /^\s*Frente:\s*([\s\S]*?)\n\s*Verso:\s*([\s\S]*?)\s*$/i,
    );
    if (fvMatch) {
      out[nome] = [
        "[Frente]",
        applyPreviewTemplate(fvMatch[1], dados),
        "",
        "[Verso]",
        applyPreviewTemplate(fvMatch[2], dados),
      ].join("\n");
    } else {
      out[nome] = applyPreviewTemplate(template, dados);
    }
  }
  return out;
}

const TERMINAL_JOB_STATUSES: PapelariaJobStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

function usableCdrFiles(
  data:
    | {
        filename: string;
        files?: PapelariaOsCdrFile[];
      }
    | null
    | undefined,
): PapelariaOsCdrFile[] {
  if (!data) return [];
  if (data.files?.length) return data.files;
  if (data.filename) {
    return [{ filename: data.filename, relative_path: data.filename, mtime: 0 }];
  }
  return [];
}

export function validateRequiredFields(
  fields: PapelariaField[] | undefined,
  values: Record<string, string>,
  excludedFields: string[] = [],
): string[] {
  if (!fields?.length) return [];
  return fields
    .filter((f) => f.required && !excludedFields.includes(f.key) && !String(values[f.key] ?? "").trim())
    .map((f) => f.label);
}

export function PapelariaCorelPanel({
  osId,
  osAno,
  formHost = null,
  dockForm = false,
}: Props) {
  const anoNum = osAno ? parseInt(osAno, 10) : NaN;
  const nroNum = osId ? parseInt(osId, 10) : NaN;
  const hasOs = Number.isFinite(anoNum) && Number.isFinite(nroNum);

  const queryClient = useQueryClient();
  const ponto = useAuthStore((s) => s.user?.ponto);
  const { can } = useAccessControl();
  const canOpenOsFolder = can("ctx_abrir_pasta");
  const pathMutation = useOsPathMutation();
  const [abrirPastaPending, setAbrirPastaPending] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [excludedFields, setExcludedFields] = useState<string[]>([]);
  /** Textos digitados direto na prévia (`modelo:pagina:marcador` → texto). */
  const [textosEditados, setTextosEditados] = useState<Record<string, string>>({});
  const [activeDynamicFields, setActiveDynamicFields] = useState<
    ActiveDynamicFieldPlacement[]
  >([]);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [provaReviewMessage, setProvaReviewMessage] = useState<string | null>(
    null,
  );
  const [corelEditMode, setCorelEditMode] = useState(false);
  const [andamentoModal, setAndamentoModal] = useState<
    "gerar" | "digital" | "corel" | null
  >(null);
  const [folderGateAction, setFolderGateAction] = useState<
    "gerar" | "digital" | "corel" | "imposicao" | null
  >(null);
  const [folderCheckPending, setFolderCheckPending] = useState(false);
  const [corelDados, setCorelDados] = useState<PapelariaCorelDadosEstado | null>(
    null,
  );
  /** Escolha do usuário: manter os textos do Corel da pasta. */
  const manterDadosCorelRef = useRef(false);
  /** Exceção «Gerar Corel»: o próximo «gerar» vai para o worker CorelDRAW. */
  const gerarCorelRef = useRef(false);
  /** Campos do produto real (Corel da pasta): um campo por ocorrência de objeto. */
  const [camposProduto, setCamposProduto] = useState<PapelariaCamposProduto | null>(
    null,
  );
  const camposProdutoAplicados = useRef(false);
  const corelDadosAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => corelDadosAbortRef.current?.abort(), []);
  const [imposicaoModalOpen, setImposicaoModalOpen] = useState(false);
  const [imposicaoOpcoes, setImposicaoOpcoes] =
    useState<ImposicaoVariantesResponse | null>(null);
  const [imposicaoOpcoesLoading, setImposicaoOpcoesLoading] = useState(false);
  const [imposicaoModalError, setImposicaoModalError] = useState<string | null>(
    null,
  );
  const autoSelectDone = useRef(false);
  const prefillApplied = useRef(false);
  const camaraEnrichApplied = useRef(false);
  const appliedAlteracaoRef = useRef<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"form" | "preview">("form");
  const [viewMode, setViewMode] = useState<PapelariaViewMode>("previa");
  const viewModeInitialized = useRef(false);

  const contextQuery = useQuery({
    queryKey: queryKeys.papelaria.contexto(anoNum, nroNum),
    queryFn: () => fetchPapelariaOsContext(anoNum, nroNum),
    enabled: hasOs,
    staleTime: 30_000,
    refetchOnMount: "always",
    retry: 2,
  });

  const contextReady = hasOs && contextQuery.isSuccess;
  /** Modo Prova PDF com PDF configurado: prova no servidor, sem ler o Corel da pasta. */
  const provaPdfServidor = Boolean(
    selectedModelId &&
      contextQuery.data?.prova_modo === "prova_pdf" &&
      contextQuery.data?.prova_pdf_modelos?.includes(selectedModelId),
  );
  const enrichNome = (
    contextQuery.data?.prefill?.nome_deputado ||
    contextQuery.data?.os?.titular ||
    contextQuery.data?.os?.solicitante ||
    ""
  ).trim();

  const deputadoEnrichQuery = useQuery({
    queryKey: queryKeys.papelaria.deputadoEnrich(anoNum, nroNum, enrichNome),
    queryFn: () => fetchDeputadoLookup(enrichNome),
    enabled: contextReady && enrichNome.length >= 3,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const cdrPathQuery = useQuery({
    queryKey: queryKeys.papelaria.cdrPath(anoNum, nroNum),
    queryFn: async () => {
      try {
        return await fetchPapelariaCdrPath(anoNum, nroNum);
      } catch {
        return null;
      }
    },
    enabled: contextReady,
    staleTime: 30_000,
    retry: false,
  });

  const modelDetailQuery = useQuery({
    queryKey: queryKeys.papelaria.corelModelo(selectedModelId ?? 0),
    queryFn: () => fetchPapelariaCorelModelo(selectedModelId!),
    enabled: selectedModelId !== null,
  });

  // Frente e verso independentes (modo Prova PDF): frente de um modelo + verso de outro.
  const {
    faces: facesComposicao,
    composicao,
    setComposicao,
    marcarEscolhaManual,
  } = usePapelariaComposicao(
    selectedModelId,
    modelDetailQuery.data?.frente_versao,
    contextQuery.data?.os.frente_verso,
    contextQuery.data?.ultima_prova?.composicao ?? null,
    hasOs ? `${anoNum}-${nroNum}` : null,
  );
  const modelosExtrasIds = useMemo(() => {
    if (!composicao) return [];
    return [...new Set([composicao.frente.modelo_id, composicao.verso.modelo_id])].filter(
      (id) => id !== selectedModelId,
    );
  }, [composicao, selectedModelId]);
  const modelosExtrasQueries = useQueries({
    queries: modelosExtrasIds.map((id) => ({
      queryKey: queryKeys.papelaria.corelModelo(id),
      queryFn: () => fetchPapelariaCorelModelo(id),
      staleTime: 60_000,
    })),
  });

  const refreshPapelariaJobs = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
    });
    if (activeJobId !== null) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.job(activeJobId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.previewPages(activeJobId),
      });
    }
  }, [activeJobId, anoNum, nroNum, queryClient]);

  const { status: papelariaWsStatus } = useSagraWebSocket<{
    type?: string;
    job_id?: number;
    ano?: number;
    nro?: number;
    id?: number;
    action?: string;
  }>({
    path: authenticatedWsPath(ponto != null ? String(ponto) : null),
    enabled: hasOs,
    onMessage: (data) => {
      if (data.type === "system_update" && data.action === "proof_responded") {
        const osNro = data.id ?? data.nro;
        if (data.ano !== anoNum || osNro !== nroNum) return;
        void queryClient.invalidateQueries({
          queryKey: queryKeys.papelaria.contexto(anoNum, nroNum),
        });
        return;
      }
      if (data.type !== "papelaria_job_update") return;
      if (data.ano !== anoNum || data.nro !== nroNum) return;
      refreshPapelariaJobs();
      if (data.job_id && data.job_id === activeJobId) {
        void queryClient.fetchQuery({
          queryKey: queryKeys.papelaria.job(data.job_id),
          queryFn: () => fetchPapelariaJob(data.job_id!),
        });
      }
      // Nova prova gerada: limpa destaque "(alterado pelo cliente)".
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.contexto(anoNum, nroNum),
      });
    },
  });
  const papelariaWsConnected = papelariaWsStatus === "connected";

  const proofFilesQuery = useEmailProofFiles(
    Number.isFinite(anoNum) ? anoNum : null,
    Number.isFinite(nroNum) ? nroNum : null,
    contextReady,
  );

  const jobsQuery = useQuery({
    queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
    queryFn: () => fetchPapelariaJobsForOs(anoNum, nroNum),
    enabled: hasOs,
    refetchInterval: papelariaWsConnected ? 60_000 : 12_000,
  });

  const activeJobQuery = useQuery({
    queryKey: queryKeys.papelaria.job(activeJobId ?? 0),
    queryFn: () => fetchPapelariaJob(activeJobId!),
    enabled: activeJobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const revisao = query.state.data?.prova_revisao;
      const tipoJob = query.state.data?.tipo_job;
      if (!status) return papelariaWsConnected ? 8_000 : 2_000;
      if (status === "pending" || status === "processing") {
        return papelariaWsConnected ? 8_000 : 2_000;
      }
      if (tipoJob === "timbrado_a4_digital" || revisao === "n_a") {
        return false;
      }
      if (
        status === "completed" &&
        revisao !== "approved" &&
        revisao !== "discarded"
      ) {
        return papelariaWsConnected ? 15_000 : 5_000;
      }
      return false;
    },
  });

  useEffect(() => {
    if (activeJobId === null || !jobsQuery.data?.length) return;
    const listed = jobsQuery.data.find((j) => j.id === activeJobId);
    const cached = activeJobQuery.data;
    if (!listed) return;
    if (!cached || listed.status !== cached.status) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.job(activeJobId),
      });
    }
  }, [activeJobId, activeJobQuery.data, jobsQuery.data, queryClient]);

  /** Ao abrir/voltar para a SP, retoma job em fila/processamento, Apogee ou última prova. */
  useEffect(() => {
    if (!hasOs || !jobsQuery.data?.length) return;
    const inFlight = [...jobsQuery.data]
      .filter(
        (j) => j.status === "pending" || j.status === "processing",
      )
      .sort((a, b) => b.id - a.id)[0];
    const waitingApogee = [...jobsQuery.data]
      .filter((j) => isWaitingImposicaoApogee(j))
      .sort((a, b) => b.id - a.id)[0];
    const latestCompletedProof = [...jobsQuery.data]
      .filter(
        (j) =>
          j.status === "completed" &&
          j.tipo_job !== "imposicao" &&
          j.tipo_job !== "timbrado_a4_digital" &&
          j.prova_revisao !== "discarded" &&
          Boolean(j.tem_arquivo_pdf || j.arquivo_pdf),
      )
      .sort((a, b) => b.id - a.id)[0];
    const target = inFlight ?? waitingApogee ?? latestCompletedProof;
    if (!target) return;

    setActiveJobId((prev) => {
      if (prev === target.id) return prev;
      if (prev != null) {
        const current = jobsQuery.data.find((j) => j.id === prev);
        if (
          current &&
          (current.status === "pending" ||
            current.status === "processing" ||
            isWaitingImposicaoApogee(current))
        ) {
          return prev;
        }
        // Job antigo de prova: sobe para o completed mais recente.
        if (
          latestCompletedProof &&
          current &&
          current.status === "completed" &&
          latestCompletedProof.id > current.id &&
          target.id === latestCompletedProof.id
        ) {
          return latestCompletedProof.id;
        }
        if (current && !inFlight && !waitingApogee) {
          // Mantém seleção explícita só se não houver prova mais nova.
          if (!latestCompletedProof || latestCompletedProof.id <= current.id) {
            return prev;
          }
        }
      }
      return target.id;
    });
    if (inFlight) {
      setViewMode("prova");
      setMobilePanel("preview");
    } else if (waitingApogee) {
      setViewMode("imposicao");
      setMobilePanel("preview");
    }
  }, [hasOs, jobsQuery.data, anoNum, nroNum]);

  /** Lista de SPs: o estado (compartilhado) mudou no servidor. */
  const invalidateSpStatusResumo = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["papelaria", "spStatusResumo"],
    });
  }, [queryClient]);

  const createJobMutation = useMutation({
    mutationFn: createPapelariaJob,
    onSuccess: (job) => {
      invalidateSpStatusResumo();
      if (!job?.id) {
        setFormError("Job criado, mas a resposta da API veio inválida. Atualize a página.");
        void queryClient.invalidateQueries({
          queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
        });
        return;
      }
      setActiveJobId(job.id);
      setFormError(null);
      setProvaReviewMessage(null);
      setViewMode("prova");
      setMobilePanel("preview");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.email.proofFiles(anoNum, nroNum),
      });
    },
    onError: (err: Error) => {
      setFormError(err.message || "Erro ao criar solicitação.");
    },
  });

  const createDigitalJobMutation = useMutation({
    mutationFn: createPapelariaTimbradoA4DigitalJob,
    onSuccess: (job) => {
      invalidateSpStatusResumo();
      if (!job?.id) {
        setFormError("Job criado, mas a resposta da API veio inválida. Atualize a página.");
        void queryClient.invalidateQueries({
          queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
        });
        return;
      }
      setActiveJobId(job.id);
      setFormError(null);
      setProvaReviewMessage(null);
      setViewMode("prova");
      setMobilePanel("preview");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.email.proofFiles(anoNum, nroNum),
      });
    },
    onError: (err: Error) => {
      setFormError(err.message || "Erro ao criar Timbrado A4 Digital.");
    },
  });

  const imposicaoMutation = useMutation({
    mutationFn: criarPapelariaImposicaoJob,
    onSuccess: (job) => {
      invalidateSpStatusResumo();
      if (!job?.id) {
        setFormError("Job criado, mas a resposta da API veio inválida. Atualize a página.");
        void queryClient.invalidateQueries({
          queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
        });
        return;
      }
      setActiveJobId(job.id);
      setCorelEditMode(false);
      setFormError(null);
      setProvaReviewMessage("JDF enviado ao Apogee.");
      setViewMode("imposicao");
      setMobilePanel("preview");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.email.proofFiles(anoNum, nroNum),
      });
    },
    onError: (err: Error) => {
      setFormError(err.message || "Erro ao solicitar imposição (JDF).");
    },
  });

  const cancelJobMutation = useMutation({
    mutationFn: cancelPapelariaJob,
    onSuccess: (job) => {
      invalidateSpStatusResumo();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
      });
      void queryClient.setQueryData(queryKeys.papelaria.job(job.id), job);
    },
    onError: (err: Error) => {
      setFormError(err.message || "Não foi possível cancelar o job.");
    },
  });

  const approveProvaMutation = useMutation({
    mutationFn: approvePapelariaJobProva,
    onSuccess: (result) => {
      if (!result?.job?.id) {
        setFormError("Prova aprovada, mas a resposta da API veio inválida. Atualize a página.");
        return;
      }
      setFormError(null);
      setProvaReviewMessage(
        `Prova v${result.prova_versao} aprovada. Andamento "Encam. de Docum." registrado em SEFOC.`,
      );
      void queryClient.setQueryData(
        queryKeys.papelaria.job(result.job.id),
        result.job,
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.os.history(anoNum, nroNum),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.email.proofFiles(anoNum, nroNum),
      });
      invalidateSpStatusResumo();
    },
    onError: (err: Error) => {
      setFormError(err.message || "Não foi possível aprovar a prova.");
    },
  });

  const discardProvaMutation = useMutation({
    mutationFn: discardPapelariaJobProva,
    onSuccess: (job) => {
      invalidateSpStatusResumo();
      setFormError(null);
      setProvaReviewMessage(null);
      void queryClient.setQueryData(queryKeys.papelaria.job(job.id), job);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.previewPages(job.id),
      });
    },
    onError: (err: Error) => {
      setFormError(err.message || "Não foi possível descartar a prova.");
    },
  });

  const finalizeCorelMutation = useMutation({
    mutationFn: finalizarCorelPapelariaOs,
    onSuccess: (job) => {
      invalidateSpStatusResumo();
      if (!job?.id) {
        setFormError("Finalização concluída, mas a resposta da API veio inválida.");
        return;
      }
      setActiveJobId(job.id);
      setCorelEditMode(false);
      setFormError(null);
      setProvaReviewMessage(null);
      setViewMode("prova");
      setMobilePanel("preview");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.job(job.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.previewPages(job.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.email.proofFiles(anoNum, nroNum),
      });
    },
    onError: (err: Error) => {
      setFormError(err.message || "Não foi possível finalizar a edição no Corel.");
    },
  });

  const abrirCorelMutation = useMutation({
    mutationFn: (lancarAndamento: boolean) =>
      abrirCorelPapelariaOs(anoNum, nroNum, lancarAndamento),
    onSuccess: async (data) => {
      const opened = await tryOpenFileLocally(data.path);
      if (!opened) {
        setFormError(
          "Não foi possível abrir o CorelDRAW localmente. Verifique se o serviço Sagra Local Opener está em execução.",
        );
        return;
      }
      setCorelEditMode(true);
      setFormError(null);
    },
    onError: (err: Error) => {
      setFormError(err.message || "Erro ao abrir arquivo Corel.");
    },
  });

  const handleCancelJob = useCallback(
    (jobId: number) => {
      cancelJobMutation.mutate(jobId);
    },
    [cancelJobMutation],
  );

  const handleApproveProva = useCallback(
    (jobId: number) => {
      setProvaReviewMessage(null);
      approveProvaMutation.mutate(jobId);
    },
    [approveProvaMutation],
  );

  const handleDiscardProva = useCallback(
    (jobId: number) => {
      if (
        !window.confirm(
          "Descartar o PDF gerado? A prova voltará para a versão anterior na pasta da OS.",
        )
      ) {
        return;
      }
      setProvaReviewMessage(null);
      discardProvaMutation.mutate(jobId);
    },
    [discardProvaMutation],
  );

  useEffect(() => {
    if (!contextQuery.data || autoSelectDone.current) return;
    const embedded = contextQuery.data.autoSelectedModel;
    const autoId =
      contextQuery.data.autoSelectedModelId ?? embedded?.id ?? null;
    if (embedded && autoId) {
      queryClient.setQueryData(
        queryKeys.papelaria.corelModelo(autoId),
        embedded,
      );
    }
    if (autoId) {
      setSelectedModelId(autoId);
    }
    autoSelectDone.current = true;
  }, [contextQuery.data, queryClient]);

  useEffect(() => {
    const ctx = contextQuery.data;
    if (!ctx || camposProdutoAplicados.current) return;
    camposProdutoAplicados.current = true;
    setCamposProduto(ctx.campos_produto ?? null);
  }, [contextQuery.data]);

  useEffect(() => {
    const ctx = contextQuery.data;
    if (!ctx) return;
    const camposCliente = ctx.cliente_alteracao?.campos ?? null;
    const alteracaoKey = clienteAlteracaoIdentity(ctx.cliente_alteracao);

    if (alteracaoKey && alteracaoKey !== appliedAlteracaoRef.current) {
      setFieldValues((prev) =>
        mergePapelariaFieldValues(prev, ctx.prefill, camposCliente),
      );
      appliedAlteracaoRef.current = alteracaoKey;
      prefillApplied.current = true;
      return;
    }

    if (
      !prefillApplied.current &&
      ctx.prefill &&
      Object.keys(ctx.prefill).length > 0
    ) {
      setFieldValues((prev) => mergePapelariaFieldValues(prev, ctx.prefill));
      prefillApplied.current = true;
    }
  }, [contextQuery.data]);

  useEffect(() => {
    if (!prefillApplied.current || camaraEnrichApplied.current) return;
    const dep = deputadoEnrichQuery.data;
    if (!dep) return;
    const hasIdentity =
      Boolean((dep.nome_eleitoral || dep.nome || "").trim()) ||
      Boolean((dep.email || "").trim()) ||
      Boolean((dep.partido || "").trim());
    if (!hasIdentity) {
      camaraEnrichApplied.current = true;
      return;
    }
    const enrich = aplicarVariaveisFonte(
      deputadoLookupToCorelPrefill(dep),
      contextQuery.data?.variaveis_fonte,
    );
    if (Object.keys(enrich).length === 0) {
      camaraEnrichApplied.current = true;
      return;
    }
    const clienteCampos = contextQuery.data?.cliente_alteracao?.campos ?? null;
    setFieldValues((prev) =>
      applyCamaraCorelEnrichment(prev, enrich, clienteCampos),
    );
    camaraEnrichApplied.current = true;
  }, [deputadoEnrichQuery.data, contextQuery.data?.cliente_alteracao?.campos]);

  useEffect(() => {
    const alt = contextQuery.data?.cliente_alteracao;
    if (!alt?.job_id) return;
    const jobId = Number(alt.job_id);
    if (Number.isFinite(jobId) && jobId > 0) {
      setActiveJobId(jobId);
      setMobilePanel("preview");
    }
  }, [contextQuery.data?.cliente_alteracao?.job_id]);

  useEffect(() => {
    if (!modelDetailQuery.data?.campos_formulario?.length) return;
    setFieldValues((prev) => {
      const next = { ...prev };
      for (const f of modelDetailQuery.data.campos_formulario) {
        if (f.default && !next[f.key]) {
          next[f.key] = f.default;
        }
      }
      return next;
    });
  }, [modelDetailQuery.data]);

  /** Frente escolhida na lista: troca o modelo (se for outro) e mantém o verso. */
  const handleSelectFrente = (fonte: PapelariaFaceFonte) => {
    const ref = { modelo_id: fonte.modelo_id, pagina: fonte.pagina };
    if (fonte.modelo_id === selectedModelId) {
      setComposicao((c) => (c ? { ...c, frente: ref } : c));
      return;
    }
    handleSelectModel({ id: fonte.modelo_id });
  };

  const handleSelectVerso = (fonte: PapelariaFaceFonte) => {
    const ref = { modelo_id: fonte.modelo_id, pagina: fonte.pagina };
    setComposicao((c) => (c ? { ...c, verso: ref } : c));
  };

  const handleSelectModel = (model: Pick<PapelariaCorelModelSummary, "id">) => {
    marcarEscolhaManual();
    setSelectedModelId(model.id);
    setActiveDynamicFields([]);
    setExcludedFields([]);
    // Campos do produto valem para o modelo da última prova.
    setCamposProduto(
      model.id === contextQuery.data?.autoSelectedModelId
        ? (contextQuery.data?.campos_produto ?? null)
        : null,
    );
    const clienteCampos = contextQuery.data?.cliente_alteracao?.campos ?? null;
    const base = mergePapelariaFieldValues(
      {},
      contextQuery.data?.prefill,
      clienteCampos,
    );
    const enrich = deputadoEnrichQuery.data
      ? aplicarVariaveisFonte(
          deputadoLookupToCorelPrefill(deputadoEnrichQuery.data),
          contextQuery.data?.variaveis_fonte,
        )
      : {};
    setFieldValues(applyCamaraCorelEnrichment(base, enrich, clienteCampos));
  };

  const clienteAlteracaoPendente = useMemo(() => {
    const alt = contextQuery.data?.cliente_alteracao;
    if (!alt) return null;
    return isClienteAlteracaoPendente(alt, jobsQuery.data) ? alt : null;
  }, [contextQuery.data?.cliente_alteracao, jobsQuery.data]);

  const camposAlteradosByKey = useMemo(() => {
    const items = clienteAlteracaoPendente?.campos_alterados;
    if (!items?.length) return {};
    return Object.fromEntries(items.map((item) => [item.key, item]));
  }, [clienteAlteracaoPendente?.campos_alterados]);

  /** Campos exibidos: modelo (sem variáveis só dos objetos do produto) + campos do produto. */
  const extrasCamposKey = modelosExtrasQueries.map((q) => q.dataUpdatedAt).join("|");

  // Redes sociais: bloco do modelo (ou do verso/frente da composição).
  const redesBloco = useMemo(() => {
    const detalhes = [modelDetailQuery.data, ...modelosExtrasQueries.map((q) => q.data)];
    const ids = composicao ? new Set([composicao.frente.modelo_id, composicao.verso.modelo_id]) : null;
    for (const d of detalhes) {
      if (!d?.redes_bloco?.redes.length) continue;
      if (ids && !ids.has(d.id)) continue;
      return d.redes_bloco;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelDetailQuery.data, composicao, extrasCamposKey]);
  const redesBlocoKey = redesBloco ? redesBloco.redes.map((r) => r.chave).join(",") : "";
  const [redesEscolha, setRedesEscolha] = useState<RedeEscolha[]>([]);
  const [redesEstilo, setRedesEstilo] = useState<PapelariaRedeEstilo>("quadrado_policromia");
  // Memória da escolha de redes: sobrevive à troca de modelo (o detalhe do
  // novo modelo ainda carregando não apaga o que o usuário já preencheu).
  const redesMemoriaRef = useRef<RedeEscolha[]>([]);
  const redesEstiloEscolhidoRef = useRef<PapelariaRedeEstilo | null>(null);
  useEffect(() => {
    if (redesEscolha.length) {
      redesMemoriaRef.current = lembrarRedes(redesMemoriaRef.current, redesEscolha);
    }
  }, [redesEscolha]);
  useEffect(() => {
    if (!redesBloco) return; // carregando ou modelo sem bloco: mantém a memória
    setRedesEscolha(redesParaBloco(redesBloco, redesMemoriaRef.current));
    const escolhido = redesEstiloEscolhidoRef.current;
    const disponiveis = redesBloco.estilos?.map((e) => e.id);
    setRedesEstilo(
      escolhido && (!disponiveis || disponiveis.includes(escolhido)) ? escolhido : estiloInicial(redesBloco),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redesBlocoKey]);
  const escolherEstiloRedes = useCallback((estilo: PapelariaRedeEstilo) => {
    redesEstiloEscolhidoRef.current = estilo;
    setRedesEstilo(estilo);
  }, []);
  const camposFormulario = useMemo(() => {
    if (!modelDetailQuery.data) return undefined;
    const base = camposVisiveis(
      modelDetailQuery.data.campos_formulario,
      modelDetailQuery.data.campos,
      camposProduto,
    );
    // Composição frente/verso: soma os campos dos modelos da frente e do verso.
    const vistos = new Set(base.map((f) => f.key));
    const extras = modelosExtrasQueries
      .flatMap((q) => q.data?.campos_formulario ?? [])
      .filter((f) => !vistos.has(f.key) && vistos.add(f.key));
    return extras.length ? [...base, ...extras] : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelDetailQuery.data, camposProduto, extrasCamposKey]);
  const previewConfigJsonEfetivo = useMemo(
    () =>
      previewConfigComProduto(
        modelDetailQuery.data?.preview_config_json,
        camposProduto,
      ) ?? undefined,
    [modelDetailQuery.data?.preview_config_json, camposProduto],
  );

  const previa = useMemo(() => {
    if (!modelDetailQuery.data?.campos) return null;
    return buildPreviaTextual(
      camposModeloComProduto(modelDetailQuery.data.campos, camposProduto),
      fieldValues,
    );
  }, [modelDetailQuery.data?.campos, fieldValues, camposProduto]);

  const restaurarCamposDoModelo = () => {
    setFieldValues((prev) => semValoresDoProduto(prev, camposProduto));
    setCamposProduto(null);
  };

  const validateFormForAction = (): boolean => {
    if (!selectedModelId) return false;
    const missing = validateRequiredFields(
      camposFormulario,
      fieldValues,
      excludedFields,
    );
    if (missing.length > 0) {
      setFormError(`Preencha os campos obrigatórios: ${missing.join(", ")}.`);
      return false;
    }
    setFormError(null);
    return true;
  };

  const ensureOsFolderThen = async (
    action: "gerar" | "digital" | "corel",
  ) => {
    setFolderCheckPending(true);
    setFormError(null);
    try {
      const browse = await fetchOsFolderBrowse(anoNum, nroNum, "");
      const folderMissing = Boolean(browse.error || !browse.root_path);
      if (folderMissing) {
        setFolderGateAction(action);
        return;
      }
      setAndamentoModal(action);
    } catch (e) {
      setFormError(
        e instanceof Error
          ? e.message
          : "Não foi possível verificar a pasta da OS na rede.",
      );
    } finally {
      setFolderCheckPending(false);
    }
  };

  const dadosForJob = useMemo(() => {
    const base = mergeDadosWithDynamicLayout(fieldValues, activeDynamicFields);
    if (excludedFields.length > 0) {
      base["__exclusoes"] = JSON.stringify(excludedFields);
    }
    if (camposProduto) {
      base[CAMPOS_PRODUTO_DADOS_KEY] = JSON.stringify(camposProduto);
    }
    if (composicao) {
      base[COMPOSICAO_DADOS_KEY] = JSON.stringify(composicao);
    }
    if (redesBloco) {
      base[REDES_DADOS_KEY] = redesParaDados(redesEscolha);
      base[REDES_ESTILO_DADOS_KEY] = redesEstilo;
    }
    const textos = textosParaDados(textosEditados);
    if (textos) base[TEXTOS_DADOS_KEY] = textos;
    return base;
  }, [activeDynamicFields, fieldValues, excludedFields, camposProduto, composicao, redesBloco, redesEscolha, redesEstilo, textosEditados]);

  const valoresPrevia = useMemo(() => {
    const textos = textosParaDados(textosEditados);
    if (!redesBloco && !textos) return fieldValues;
    return {
      ...fieldValues,
      ...(redesBloco
        ? {
            [REDES_DADOS_KEY]: redesParaDados(redesEscolha),
            [REDES_ESTILO_DADOS_KEY]: redesEstilo,
          }
        : {}),
      ...(textos ? { [TEXTOS_DADOS_KEY]: textos } : {}),
    };
  }, [fieldValues, redesBloco, redesEscolha, redesEstilo, textosEditados]);

  /** «Gerar Corel» parte do PDF final quando o modelo (ou a composição) tem Prova PDF. */
  const temProvaPdfModelo = Boolean(modelDetailQuery.data?.tem_prova_pdf) || Boolean(composicao);

  const camposEditaveisPrevia = useMemo(
    () => new Set((camposFormulario ?? []).map((f) => f.key)),
    [camposFormulario],
  );
  const removerTextoEditado = useCallback((chave: string) => {
    setTextosEditados((prev) => {
      if (!(chave in prev)) return prev;
      const { [chave]: _removido, ...resto } = prev;
      return resto;
    });
  }, []);
  /**
   * Texto editado na prévia: se a mudança é só numa variável (ex.: o nome),
   * atualiza o campo do formulário; senão o texto vale para aquele campo do PDF.
   * Regiões de rede social atualizam o picker (`redesEscolha` → `__redes`).
   */
  const handleEditarTextoPrevia = useCallback(
    (regiao: ProvaPdfRegiao, texto: string) => {
      if (regiao.tipo === "rede" && regiao.rede_chave) {
        const chaveRede = regiao.rede_chave;
        const valor = texto.trim();
        setRedesEscolha((prev) => {
          if (prev.some((r) => r.chave === chaveRede)) {
            return prev.map((r) =>
              r.chave === chaveRede ? { ...r, valor, ativo: Boolean(valor) } : r,
            );
          }
          return [...prev, { chave: chaveRede, valor, ativo: Boolean(valor) }];
        });
        return;
      }
      const edicao = interpretarEdicao(regiao, texto, camposEditaveisPrevia);
      if (edicao.tipo === "variavel") {
        removerTextoEditado(regiao.chave);
        setFieldValues((prev) => ({ ...prev, [edicao.chave]: edicao.valor }));
        return;
      }
      setTextosEditados((prev) => ({ ...prev, [regiao.chave]: edicao.texto }));
    },
    [camposEditaveisPrevia, removerTextoEditado],
  );

  const handleRestaurarTextoPrevia = useCallback(
    (regiao: ProvaPdfRegiao) => {
      if (regiao.tipo === "rede" && regiao.rede_chave) {
        const chaveRede = regiao.rede_chave;
        setRedesEscolha((prev) =>
          prev.map((r) => (r.chave === chaveRede ? { ...r, valor: "", ativo: false } : r)),
        );
        return;
      }
      removerTextoEditado(regiao.chave);
    },
    [removerTextoEditado],
  );

  const runGerarArquivo = (lancarAndamento: boolean) => {
    if (!selectedModelId) return;
    const gerarCorel = gerarCorelRef.current;
    const dados = { ...dadosForJob };
    // Sem PDF do modelo, o Corel sai do .cdr do modelo (frente e verso dele).
    if (gerarCorel && !temProvaPdfModelo) delete dados[COMPOSICAO_DADOS_KEY];
    createJobMutation.mutate({
      ano: anoNum,
      nro: nroNum,
      // Na composição (Prova PDF), a prova pertence ao modelo da frente.
      modelo_id:
        gerarCorel && !temProvaPdfModelo
          ? selectedModelId
          : (composicao?.frente.modelo_id ?? selectedModelId),
      dados,
      lancar_andamento: lancarAndamento,
      manter_dados_corel: manterDadosCorelRef.current,
      ...(gerarCorel ? { gerar_corel: true } : {}),
    });
    setCorelEditMode(false);
  };

  /**
   * Pré-leitura: assim que a SP abre com modelo e Corel na pasta, o worker já lê
   * os textos (o servidor reaproveita a leitura enquanto o arquivo não mudar).
   * Ao clicar em «Criar prova» a comparação sai na hora.
   */
  const preLeituraCorelRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasOs || !selectedModelId || provaPdfServidor) return;
    const arquivo = usableCdrFiles(cdrPathQuery.data)[0];
    if (!arquivo) return;
    const chave = `${selectedModelId}|${arquivo.relative_path}|${arquivo.mtime}`;
    if (preLeituraCorelRef.current === chave) return;
    preLeituraCorelRef.current = chave;
    void iniciarComparacaoCorelPapelariaOs(anoNum, nroNum, selectedModelId).catch(
      () => undefined,
    );
  }, [hasOs, anoNum, nroNum, selectedModelId, cdrPathQuery.data, provaPdfServidor]);

  /** Corel já na pasta: compara os textos dele com o formulário antes de criar a prova. */
  const verificarDadosCorelThenGerar = async () => {
    if (!selectedModelId) return;
    corelDadosAbortRef.current?.abort();
    const controller = new AbortController();
    corelDadosAbortRef.current = controller;
    const arquivo = usableCdrFiles(cdrPathQuery.data)[0]?.filename ?? null;
    setCorelDados({ fase: "lendo", arquivo });
    const res = await compararDadosCorel({
      ano: anoNum,
      nro: nroNum,
      modeloId: selectedModelId,
      dados: dadosForJob,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    if (
      res.status === "sem_corel" ||
      (res.status === "completed" && !(res.diferencas?.length ?? 0))
    ) {
      setCorelDados(null);
      void ensureOsFolderThen("gerar");
      return;
    }
    if (res.status === "completed") {
      setCorelDados({
        fase: "diferente",
        arquivo: res.arquivo ?? arquivo,
        diferencas: res.diferencas ?? [],
      });
      return;
    }
    setCorelDados({ fase: "falhou", arquivo: res.arquivo ?? arquivo, erro: res.erro });
  };

  const escolherDadosCorel = (manter: boolean) => {
    manterDadosCorelRef.current = manter;
    setCorelDados(null);
    void ensureOsFolderThen("gerar");
  };

  /** Modal de comparação: textos escolhidos viram os campos do produto real. */
  const confirmarDadosCorel = (escolhas: Record<string, string>) => {
    if (corelDados?.fase !== "diferente") return;
    const { camposProduto: novo, valores } = construirCamposProduto(
      corelDados.diferencas,
      escolhas,
      { arquivo: corelDados.arquivo, anterior: camposProduto },
    );
    // Sem face/posição (worker antigo): escolha global de manter o Corel.
    manterDadosCorelRef.current = corelDados.diferencas.some(
      (d) => d.editavel === false,
    );
    setCamposProduto(novo);
    setFieldValues((prev) => ({ ...semValoresDoProduto(prev, camposProduto), ...valores }));
    setCorelDados(null);
    void ensureOsFolderThen("gerar");
  };

  const cancelarDadosCorel = () => {
    corelDadosAbortRef.current?.abort();
    corelDadosAbortRef.current = null;
    setCorelDados(null);
  };

  const runTimbradoA4Digital = (lancarAndamento: boolean) => {
    if (!selectedModelId) return;
    createDigitalJobMutation.mutate({
      ano: anoNum,
      nro: nroNum,
      modelo_id: selectedModelId,
      dados: dadosForJob,
      lancar_andamento: lancarAndamento,
    });
    setCorelEditMode(false);
  };

  const runAbrirCorel = (lancarAndamento: boolean) => {
    abrirCorelMutation.mutate(lancarAndamento);
  };

  const handleAndamentoChoice = (lancarAndamento: boolean) => {
    const action = andamentoModal;
    setAndamentoModal(null);
    if (action === "gerar") {
      runGerarArquivo(lancarAndamento);
    } else if (action === "digital") {
      runTimbradoA4Digital(lancarAndamento);
    } else if (action === "corel") {
      runAbrirCorel(lancarAndamento);
    }
  };

  const handleGerarArquivo = () => {
    if (!validateFormForAction()) return;
    manterDadosCorelRef.current = false;
    gerarCorelRef.current = false;
    if (!provaPdfServidor && usableCdrFiles(cdrPathQuery.data).length > 0) {
      void verificarDadosCorelThenGerar();
      return;
    }
    void ensureOsFolderThen("gerar");
  };

  /** Exceção: gerar o arquivo CorelDRAW (worker) mesmo com Prova PDF disponível. */
  const handleGerarCorel = () => {
    if (!validateFormForAction()) return;
    if (temProvaPdfModelo) {
      // Corel a partir do PDF final (o mesmo da prova): textos editáveis,
      // frente/verso escolhidos e textos editados na prévia.
      const baseSefoc = usableCdrFiles(cdrPathQuery.data).find((f) =>
        /-BaseSefoc\.cdr$/i.test(f.filename),
      );
      if (
        baseSefoc &&
        !window.confirm(
          `O arquivo ${baseSefoc.filename} da pasta da OS será substituído pelo Corel ` +
            "gerado a partir do PDF desta prova. Continuar?",
        )
      ) {
        return;
      }
      manterDadosCorelRef.current = false;
      gerarCorelRef.current = true;
      void ensureOsFolderThen("gerar");
      return;
    }
    if (
      composicao &&
      (composicao.frente.modelo_id !== composicao.verso.modelo_id) &&
      !window.confirm(
        "O arquivo Corel é gerado a partir do .cdr do modelo selecionado (frente e verso do mesmo arquivo). " +
          "A combinação de frente e verso escolhida vale só para a Prova PDF. Continuar?",
      )
    ) {
      return;
    }
    manterDadosCorelRef.current = false;
    gerarCorelRef.current = true;
    if (usableCdrFiles(cdrPathQuery.data).length > 0) {
      void verificarDadosCorelThenGerar();
      return;
    }
    void ensureOsFolderThen("gerar");
  };

  const handleTimbradoA4Digital = () => {
    if (!validateFormForAction()) return;
    void ensureOsFolderThen("digital");
  };

  const handleAbrirCorel = () => {
    if (!validateFormForAction()) return;
    void ensureOsFolderThen("corel");
  };

  const handleAbrirPasta = () => {
    if (!hasOs || !canOpenOsFolder || abrirPastaPending) return;
    setAbrirPastaPending(true);
    void openNetworkFolder({ ano: anoNum, nr_os: nroNum }, (input) =>
      pathMutation.mutateAsync(input),
    ).finally(() => setAbrirPastaPending(false));
  };

  const openImposicaoModal = async () => {
    if (!selectedModelId) {
      setFormError("Selecione o modelo com configuração de imposição.");
      return;
    }
    setImposicaoModalOpen(true);
    setImposicaoModalError(null);
    setImposicaoOpcoesLoading(true);
    try {
      const opcoes = await fetchImposicaoVariantesOs(
        anoNum,
        nroNum,
        selectedModelId,
      );
      if (!(opcoes.variantes_disponiveis || []).length) {
        setImposicaoModalOpen(false);
        setFormError(
          "Nenhuma imposição Digital/Offset configurada para este produto/modelo.",
        );
        return;
      }
      setImposicaoOpcoes(opcoes);
      setFormError(null);
    } catch (e) {
      // Mantém o modal aberto e mostra o erro nele (não na barra da OS).
      setImposicaoModalError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar as opções de imposição.",
      );
    } finally {
      setImposicaoOpcoesLoading(false);
    }
  };

  const runImposicao = (payload?: {
    variante: ImposicaoVariante;
    juntada_os?: Array<{ ano: number; nro: number }>;
  }) => {
    if (!selectedModelId) {
      setFormError("Selecione o modelo com configuração de imposição.");
      return;
    }
    if (!payload) {
      void openImposicaoModal();
      return;
    }
    setImposicaoModalError(null);
    imposicaoMutation.mutate(
      {
        ano: anoNum,
        nro: nroNum,
        modelo_id: selectedModelId,
        variante: payload.variante,
        juntada_os: payload.juntada_os,
      },
      {
        onSuccess: () => {
          setImposicaoModalOpen(false);
          setImposicaoOpcoes(null);
        },
        onError: (err: Error) => {
          setImposicaoModalError(err.message || "Erro ao gerar imposição.");
        },
      },
    );
  };

  const ensureOsFolderThenImposicao = async () => {
    setFolderCheckPending(true);
    setFormError(null);
    try {
      const browse = await fetchOsFolderBrowse(anoNum, nroNum, "");
      const folderMissing = Boolean(browse.error || !browse.root_path);
      if (folderMissing) {
        setFolderGateAction("imposicao");
        return;
      }
      await openImposicaoModal();
    } catch (e) {
      setFormError(
        e instanceof Error
          ? e.message
          : "Não foi possível verificar a pasta da OS na rede.",
      );
    } finally {
      setFolderCheckPending(false);
    }
  };

  const handleImposicao = () => {
    if (!selectedModelId) {
      setFormError("Selecione o modelo antes de gerar a imposição (JDF).");
      return;
    }
    const modeloSel =
      contextQuery.data?.modelos.find((m) => m.id === selectedModelId) ??
      modelDetailQuery.data;
    if (!modeloSel?.tem_imposicao_config) {
      setFormError(
        "Não há imposição Digital/Offset configurada para este produto/modelo. Configure nas Configurações → Imposição.",
      );
      return;
    }
    setFormError(null);
    void ensureOsFolderThenImposicao();
  };

  const handleFinalizarCorel = () => {
    if (!selectedModelId) return;
    if (!validateFormForAction()) return;
    finalizeCorelMutation.mutate({
      ano: anoNum,
      nro: nroNum,
      modelo_id: selectedModelId,
      dados: dadosForJob,
    });
  };

  const activeJob = activeJobQuery.data ?? null;
  const produtoOs = contextQuery.data?.os.produto ?? "";
  const frenteVersoOs = contextQuery.data?.os.frente_verso ?? "";
  const coresOs = contextQuery.data?.os.cores ?? "";
  const arquivoModeloAtivo =
    activeJob?.arquivo_modelo ??
    modelDetailQuery.data?.arquivo_modelo ??
    "";

  const folderProofName = proofFilesQuery.data?.suggested ?? null;
  const hasFolderProof = (proofFilesQuery.data?.files.length ?? 0) > 0;
  const folderImposicaoName =
    proofFilesQuery.data?.imposicao_suggested ?? null;
  const hasFolderImposicao = Boolean(folderImposicaoName);
  const hasJobProof = Boolean(
    activeJob &&
      activeJob.status === "completed" &&
      activeJob.tipo_job !== "timbrado_a4_digital" &&
      activeJob.tipo_job !== "imposicao" &&
      activeJob.prova_revisao !== "discarded" &&
      (activeJob.tem_arquivo_pdf || activeJob.arquivo_pdf),
  );
  const hasJobImposicaoPdf = isReadyImposicaoPdf(activeJob);
  const listWaitingApogeeJob = useMemo(() => {
    if (!jobsQuery.data?.length) return null;
    return (
      [...jobsQuery.data]
        .filter((j) => isWaitingImposicaoApogee(j))
        .sort((a, b) => b.id - a.id)[0] ?? null
    );
  }, [jobsQuery.data]);
  const waitingApogeeRaw =
    isWaitingImposicaoApogee(activeJob) || Boolean(listWaitingApogeeJob);
  // PDF já na Digital encerra o loading visual / pipeline, mesmo se o job
  // ainda não foi atualizado pelo poll.
  const waitingApogee = waitingApogeeRaw && !hasFolderImposicao;
  const hasImposicaoPdf = hasJobImposicaoPdf || hasFolderImposicao;
  const folderProofPdfUrl =
    hasOs && folderProofName
      ? emailProofFileUrl(anoNum, nroNum, folderProofName)
      : null;
  const folderImposicaoPdfUrl =
    hasOs && folderImposicaoName
      ? emailProofFileUrl(anoNum, nroNum, folderImposicaoName)
      : null;

  useEffect(() => {
    // proof-files só roda após o contexto; não escolher aba antes disso.
    if (!hasOs || !contextReady || !proofFilesQuery.isFetched || jobsQuery.isLoading) {
      return;
    }
    if (viewModeInitialized.current) return;
    viewModeInitialized.current = true;
    setViewMode(
      resolveDefaultPapelariaViewMode({
        hasImposicao: hasImposicaoPdf,
        hasProof: hasFolderProof || hasJobProof,
        waitingApogee,
      }),
    );
  }, [
    hasOs,
    contextReady,
    proofFilesQuery.isFetched,
    jobsQuery.isLoading,
    hasFolderProof,
    hasJobProof,
    hasImposicaoPdf,
    waitingApogee,
  ]);

  const mutationGenerating =
    createJobMutation.isPending ||
    createDigitalJobMutation.isPending ||
    imposicaoMutation.isPending ||
    finalizeCorelMutation.isPending;
  const jobPipelineBusy = Boolean(
    activeJob &&
      (activeJob.status === "pending" || activeJob.status === "processing"),
  );

  useEffect(() => {
    if (!(mutationGenerating || jobPipelineBusy)) return;
    setViewMode("prova");
    setMobilePanel("preview");
  }, [mutationGenerating, jobPipelineBusy]);

  const listInFlightJob = useMemo(() => {
    if (!jobsQuery.data?.length) return null;
    return (
      [...jobsQuery.data]
        .filter(
          (j) => j.status === "pending" || j.status === "processing",
        )
        .sort((a, b) => b.id - a.id)[0] ?? null
    );
  }, [jobsQuery.data]);

  const formSlot = (node: ReactNode) =>
    formHost ? createPortal(node, formHost) : null;

  if (!hasOs) {
    return (
      <>
        {formSlot(
          <div className="flex h-full min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-sagra-border bg-white p-4 text-center text-xs text-neutral-500">
            Selecione uma SP para ver os modelos e preencher os campos.
          </div>,
        )}
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-sagra-border bg-white p-8 text-center text-sm text-neutral-500">
          Selecione uma SP na lista para ver a prévia.
        </div>
      </>
    );
  }

  if (contextQuery.isLoading) {
    return (
      <>
        {formSlot(
          <div className="flex h-full min-h-0 flex-1 items-center justify-center gap-2 rounded-lg border border-sagra-border bg-white text-xs text-neutral-600">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Carregando modelos...
          </div>,
        )}
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-neutral-600">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Carregando contexto da OS...
        </div>
      </>
    );
  }

  if (contextQuery.isError) {
    const detail =
      contextQuery.error instanceof Error
        ? contextQuery.error.message
        : "Erro desconhecido.";
    return (
      <>
        {formSlot(
          <div className="flex h-full min-h-0 flex-1 items-center justify-center rounded-lg border border-sagra-danger/30 bg-red-50 p-4 text-center text-xs text-sagra-danger">
            <div>
              <p className="font-semibold">Erro ao carregar os modelos.</p>
              <p className="mt-1 text-red-700/90">{detail}</p>
            </div>
          </div>,
        )}
        <div className="flex flex-1 items-center justify-center rounded-lg border border-sagra-danger/30 bg-red-50 p-6 text-center text-sm text-sagra-danger">
        <div>
          <p className="font-semibold">Erro ao carregar contexto da OS.</p>
          <p className="mt-2 text-xs text-red-700/90">{detail}</p>
          <button
            type="button"
            className="mt-3 rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
            onClick={() => void contextQuery.refetch()}
          >
            Tentar novamente
          </button>
        </div>
        </div>
      </>
    );
  }

  const ctx = contextQuery.data!;
  const modelos = ctx.modelos;
  const showTimbradoA4Digital = isTimbradoA4DigitalProduct(ctx.os.produto);
  const isJobGenerating =
    createJobMutation.isPending ||
    createDigitalJobMutation.isPending ||
    imposicaoMutation.isPending ||
    finalizeCorelMutation.isPending ||
    (!!activeJob &&
      (activeJob.status === "pending" ||
        activeJob.status === "processing")) ||
    !!listInFlightJob;
  const cdrFiles = usableCdrFiles(cdrPathQuery.data);

  const mobilePanelClass = (panel: "form" | "preview") =>
    cn(
      !formHost && mobilePanel !== panel && "max-md:hidden",
      panel === "preview"
        ? "flex min-h-[min(50vh,480px)] min-w-0 flex-1 flex-col md:min-h-0"
        : "flex min-h-[min(50vh,480px)] w-full flex-col md:min-h-0 md:w-[288px] md:shrink-0",
      "max-md:overflow-visible md:overflow-hidden",
    );

  return (
    <div className="flex min-h-min flex-1 flex-col gap-3 md:min-h-0 md:overflow-hidden">
      <section className="shrink-0 rounded-lg border border-sagra-border bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <span className="font-bold text-secondary-blue">
            OS {ctx.os.nro}/{ctx.os.ano}
          </span>
          {ctx.os.produto && (
            <span>
              Produto: <strong>{ctx.os.produto}</strong>
            </span>
          )}
          {ctx.os.titulo && <span>Título: {ctx.os.titulo}</span>}
          {ctx.os.solicitante && <span>Solicitante: {ctx.os.solicitante}</span>}
          {ctx.os.cores && <span>Cores: {ctx.os.cores}</span>}
          {ctx.os.frente_verso && <span>F/V: {ctx.os.frente_verso}</span>}
        </div>
        {ctx.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-[11px] text-amber-700">
            {ctx.warnings.map((w) => (
              <li key={w} className="flex items-start gap-1">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}
        {clienteAlteracaoPendente ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
            <p className="font-semibold text-amber-900">
              Alteração solicitada pelo cliente
              {clienteAlteracaoPendente.versao
                ? ` — prova v${clienteAlteracaoPendente.versao}`
                : ""}
            </p>
            <p className="mt-1 text-amber-900/90">
              Os campos do formulário foram preenchidos com os dados informados pelo cliente.
              Campos alterados estão destacados abaixo com o valor anterior e o novo valor.
              Revise e gere uma nova prova ou edite no CorelDRAW.
            </p>
            {clienteAlteracaoPendente.observacao ? (
              <p className="mt-2 rounded border border-amber-200 bg-white/70 px-2 py-1.5 whitespace-pre-wrap">
                <span className="font-medium">Observações adicionais: </span>
                {clienteAlteracaoPendente.observacao}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {formHost || dockForm ? null : (
      <div
        className="flex shrink-0 gap-1 rounded-lg border border-sagra-border bg-white p-1 shadow-sm md:hidden"
        role="tablist"
        aria-label="Painéis da papelaria"
      >
        {(
          [
            ["form", "Formulário"],
            ["preview", "Prévia / Prova"],
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
      )}

      <div className="flex min-h-min flex-col gap-2 md:min-h-0 md:flex-1 md:flex-row md:gap-3 md:overflow-hidden">
        {formHost
          ? createPortal(
              <section
                className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm md:flex-row"
                data-testid="papelaria-modelos-campos"
              >
                <div className="flex min-h-0 min-w-0 flex-col md:w-[42%] md:shrink-0 md:border-r md:border-sagra-border">
                  <div className="border-b border-sagra-border bg-slate-50/80 px-3 py-2">
                    <h2 className="text-xs font-bold text-secondary-blue">
                      Modelos disponíveis
                    </h2>
                    <p className="text-[10px] text-neutral-500">
                      {resumoListaModelos(modelos, facesComposicao, composicao)}
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2">
                    <PapelariaModelosLista
                      modelos={modelos}
                      selectedModelId={selectedModelId}
                      onSelectModel={handleSelectModel}
                      faces={facesComposicao}
                      composicao={composicao}
                      onSelectFrente={handleSelectFrente}
                      onSelectVerso={handleSelectVerso}
                    />
                  </div>
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-sagra-border md:border-t-0">
                  <div className="border-b border-sagra-border bg-slate-50/80 px-3 py-2">
                    <h2 className="text-xs font-bold text-secondary-blue">
                      Informações do cliente
                    </h2>
                    <p className="text-[10px] text-neutral-500">
                      {selectedModelId == null
                        ? "Selecione um modelo"
                        : "Campos do modelo selecionado"}
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                    {selectedModelId == null ? (
                      <p className="p-4 text-center text-xs text-neutral-500">
                        Selecione um modelo à esquerda para preencher os campos.
                      </p>
                    ) : (
                      <>
                        {camposProduto ? (
                          <CamposProdutoAviso
                            arquivo={camposProduto.arquivo}
                            onRestaurar={restaurarCamposDoModelo}
                          />
                        ) : null}
                        {redesBloco ? (
                          <PapelariaRedesPicker bloco={redesBloco} value={redesEscolha} onChange={setRedesEscolha} estilo={redesEstilo} onEstiloChange={escolherEstiloRedes} />
                        ) : null}
                        <DynamicFields
                          fields={camposFormulario}
                          isLoading={modelDetailQuery.isLoading}
                          values={fieldValues}
                          camposAlterados={camposAlteradosByKey}
                          onChange={(key, value) =>
                            setFieldValues((prev) => ({ ...prev, [key]: value }))
                          }
                          excludedFields={excludedFields}
                          onToggleExclude={(key) =>
                            setExcludedFields((prev) =>
                              prev.includes(key)
                                ? prev.filter((k) => k !== key)
                                : [...prev, key],
                            )
                          }
                        />
                        {formError ? (
                          <p className="mt-2 text-[11px] text-sagra-danger">{formError}</p>
                        ) : null}
                        {clienteAlteracaoPendente?.observacao ? (
                          <div className="mt-3">
                            <label className="mb-0.5 block text-[11px] font-medium text-amber-800">
                              Observações do cliente (alteração solicitada
                              {clienteAlteracaoPendente.versao
                                ? ` — prova v${clienteAlteracaoPendente.versao}`
                                : ""}
                              )
                            </label>
                            <textarea
                              readOnly
                              disabled
                              rows={3}
                              value={clienteAlteracaoPendente.observacao}
                              className="w-full resize-none rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-950"
                            />
                          </div>
                        ) : null}
                        {corelEditMode ? (
                          <p className="mt-3 text-[10px] leading-relaxed text-neutral-600">
                            Após editar no CorelDRAW e exportar o PDF de prova na pasta Sefoc,
                            use Finalizar na barra de ações para montar a visualização e aprovar.
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                  {selectedModelId !== null ? (
                    <div className="flex h-24 min-w-0 shrink-0 flex-col border-t border-sagra-border p-2">
                      <label className="mb-0.5 shrink-0 text-[11px] font-medium text-neutral-700">
                        Observações
                      </label>
                      <textarea
                        readOnly
                        disabled
                        value={contextQuery.data?.os.observ ?? ""}
                        className="min-h-0 w-full flex-1 resize-none rounded border border-sagra-border bg-slate-50 px-2 py-1 text-xs text-neutral-800"
                        placeholder="Sem observações na OS"
                      />
                    </div>
                  ) : null}
                </div>
              </section>,
              formHost,
            )
          : (
        <section
          className={cn(
            mobilePanelClass("form"),
            "max-md:order-1 rounded-lg border border-sagra-border bg-white shadow-sm",
          )}
        >
          <div className="border-b border-sagra-border bg-slate-50/80 px-3 py-2">
            <h2 className="text-xs font-bold text-secondary-blue">
              Modelos disponíveis
            </h2>
            <p className="text-[10px] text-neutral-500">
              {resumoListaModelos(modelos, facesComposicao, composicao)}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain">
              <PapelariaModelosLista
                modelos={modelos}
                selectedModelId={selectedModelId}
                onSelectModel={handleSelectModel}
                faces={facesComposicao}
                composicao={composicao}
                onSelectFrente={handleSelectFrente}
                onSelectVerso={handleSelectVerso}
              />

              {selectedModelId !== null ? (
                <div className="border-t border-neutral-200 pt-2">
                  <h3 className="mb-2 text-xs font-bold text-neutral-700">
                    Informações do cliente
                  </h3>
                  {camposProduto ? (
                    <CamposProdutoAviso
                      arquivo={camposProduto.arquivo}
                      onRestaurar={restaurarCamposDoModelo}
                    />
                  ) : null}
                  {redesBloco ? (
                    <PapelariaRedesPicker bloco={redesBloco} value={redesEscolha} onChange={setRedesEscolha} estilo={redesEstilo} onEstiloChange={escolherEstiloRedes} />
                  ) : null}
                  <DynamicFields
                    fields={camposFormulario}
                    isLoading={modelDetailQuery.isLoading}
                    values={fieldValues}
                    camposAlterados={camposAlteradosByKey}
                    onChange={(key, value) =>
                      setFieldValues((prev) => ({ ...prev, [key]: value }))
                    }
                    excludedFields={excludedFields}
                    onToggleExclude={(key) =>
                      setExcludedFields((prev) =>
                        prev.includes(key)
                          ? prev.filter((k) => k !== key)
                          : [...prev, key],
                      )
                    }
                  />
                  {formError ? (
                    <p className="mt-2 text-[11px] text-sagra-danger">{formError}</p>
                  ) : null}
                  {clienteAlteracaoPendente?.observacao ? (
                    <div className="mt-3">
                      <label className="mb-0.5 block text-[11px] font-medium text-amber-800">
                        Observações do cliente (alteração solicitada
                        {clienteAlteracaoPendente.versao
                          ? ` — prova v${clienteAlteracaoPendente.versao}`
                          : ""}
                        )
                      </label>
                      <textarea
                        readOnly
                        disabled
                        rows={3}
                        value={clienteAlteracaoPendente.observacao}
                        className="w-full resize-none rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-950"
                      />
                    </div>
                  ) : null}
                  {corelEditMode ? (
                    <p className="mt-3 text-[10px] leading-relaxed text-neutral-600">
                      Após editar no CorelDRAW e exportar o PDF de prova na pasta Sefoc,
                      use Finalizar na barra de ações para montar a visualização e aprovar.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {selectedModelId !== null ? (
              <div className="mt-2 flex h-28 min-w-0 shrink-0 flex-col">
                <label className="mb-0.5 shrink-0 text-[11px] font-medium text-neutral-700">
                  Observações
                </label>
                <textarea
                  readOnly
                  disabled
                  value={contextQuery.data?.os.observ ?? ""}
                  className="min-h-0 w-full flex-1 resize-none rounded border border-sagra-border bg-slate-50 px-2 py-1 text-xs text-neutral-800"
                  placeholder="Sem observações na OS"
                />
              </div>
            ) : null}
          </div>
        </section>
          )}

        <PapelariaActionBar
          className="max-md:order-2 max-md:h-auto max-md:w-full max-md:flex-row max-md:overflow-x-auto"
          showAbrirPasta={canOpenOsFolder}
          showTimbradoA4Digital={showTimbradoA4Digital}
          showFinalizar={corelEditMode}
          busy={
            createJobMutation.isPending ||
            createDigitalJobMutation.isPending ||
                    imposicaoMutation.isPending ||
            abrirCorelMutation.isPending
          }
          folderCheckPending={folderCheckPending}
          modelLoading={modelDetailQuery.isLoading}
          isJobGenerating={isJobGenerating}
          createJobPending={createJobMutation.isPending}
          createDigitalPending={createDigitalJobMutation.isPending}
          imposicaoPending={imposicaoMutation.isPending}
          abrirCorelPending={abrirCorelMutation.isPending}
          abrirPastaPending={abrirPastaPending}
          finalizeCorelPending={finalizeCorelMutation.isPending}
          hasOs={hasOs}
          selectedModelId={selectedModelId}
          corelDaPasta={cdrFiles[0]?.filename ?? null}
          canImposicao={Boolean(
            selectedModelId &&
              (
                contextQuery.data?.modelos.find((m) => m.id === selectedModelId)
                  ?.tem_imposicao_config ||
                modelDetailQuery.data?.tem_imposicao_config
              ),
          )}
          onAbrirPasta={handleAbrirPasta}
          onGerarArquivo={handleGerarArquivo}
          onGerarCorel={handleGerarCorel}
          onTimbradoA4Digital={handleTimbradoA4Digital}
          onAbrirCorel={handleAbrirCorel}
          onFinalizarCorel={handleFinalizarCorel}
          onImposicao={handleImposicao}
        />

        <div className={cn(mobilePanelClass("preview"), "max-md:order-3")}>
          <PapelariaProofPanel
            activeJob={activeJob}
            isJobGenerating={isJobGenerating}
            produto={produtoOs}
            frenteVerso={frenteVersoOs}
            cores={coresOs}
            arquivoModelo={arquivoModeloAtivo}
            mockupConfigJson={modelDetailQuery.data?.mockup_config_json}
            modeloMockup={modelDetailQuery.data ?? null}
            previewConfigJson={previewConfigJsonEfetivo}
            temProvaPdf={Boolean(modelDetailQuery.data?.tem_prova_pdf) || Boolean(composicao)}
            composicao={composicao}
            livePreviewValues={valoresPrevia}
            previa={previa}
            selectedModelId={selectedModelId}
            modelLoading={modelDetailQuery.isLoading}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            folderProofPdfUrl={folderProofPdfUrl}
            folderProofLabel={folderProofName}
            folderImposicaoPdfUrl={folderImposicaoPdfUrl}
            folderImposicaoLabel={folderImposicaoName}
            onCancelJob={handleCancelJob}
            cancelPending={cancelJobMutation.isPending}
            onApproveProva={handleApproveProva}
            onDiscardProva={handleDiscardProva}
            approveProvaPending={approveProvaMutation.isPending}
            discardProvaPending={discardProvaMutation.isPending}
            provaReviewMessage={provaReviewMessage}
            provaModo={contextQuery.data?.prova_modo}
            activeDynamicFields={activeDynamicFields}
            onActiveDynamicFieldsChange={setActiveDynamicFields}
            onLivePreviewValueChange={(key, value) =>
              setFieldValues((prev) => ({ ...prev, [key]: value }))
            }
            onEditarTextoPrevia={handleEditarTextoPrevia}
            onRestaurarTextoPrevia={handleRestaurarTextoPrevia}
          />
        </div>
      </div>

      {corelDados ? (
        <PapelariaCorelDadosModal
          estado={corelDados}
          onConfirmar={confirmarDadosCorel}
          onManterOriginais={() => escolherDadosCorel(true)}
          onUsarFormulario={() => escolherDadosCorel(false)}
          onCancelar={cancelarDadosCorel}
        />
      ) : null}

      {andamentoModal ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-center text-lg font-bold text-slate-800">
              Lançar execução no sistema?
            </h3>
            <p className="mt-2 text-center text-sm text-slate-600">
              Deseja registrar o andamento{" "}
              <strong>Em Execução</strong> com a observação{" "}
              <strong>Preparando Prova</strong> antes de continuar?
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={
                  createJobMutation.isPending ||
                  createDigitalJobMutation.isPending ||
                                abrirCorelMutation.isPending
                }
                className="flex-1 sagra-btn sagra-btn--outline sagra-btn--md"
                onClick={() => handleAndamentoChoice(false)}
              >
                Não, continuar
              </button>
              <button
                type="button"
                disabled={
                  createJobMutation.isPending ||
                  createDigitalJobMutation.isPending ||
                                abrirCorelMutation.isPending
                }
                className="sagra-btn sagra-btn--secondary sagra-btn--md"
                onClick={() => handleAndamentoChoice(true)}
              >
                Sim, lançar execução
              </button>
            </div>
            <button
              type="button"
              className="mt-3 w-full text-center text-xs text-slate-500 hover:text-slate-700"
              onClick={() => setAndamentoModal(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <OsFolderRequiredGateModal
        open={folderGateAction !== null}
        ano={anoNum}
        nro={nroNum}
        onClose={() => {
          setFolderGateAction(null);
          setFormError(
            "A pasta da OS é necessária para criar o arquivo de papelaria. Criação cancelada.",
          );
        }}
        onFolderReady={() => {
          const action = folderGateAction;
          setFolderGateAction(null);
          void queryClient.invalidateQueries({
            queryKey: queryKeys.papelaria.cdrPath(anoNum, nroNum),
          });
          if (action === "imposicao") {
            void openImposicaoModal();
            return;
          }
          if (action) {
            setAndamentoModal(action);
          }
        }}
      />

      <PapelariaImposicaoVarianteDialog
        open={imposicaoModalOpen}
        ano={anoNum}
        nro={nroNum}
        modeloId={selectedModelId ?? null}
        opcoes={imposicaoOpcoes}
        loading={imposicaoOpcoesLoading}
        submitting={imposicaoMutation.isPending}
        error={imposicaoModalError}
        onClose={() => {
          if (imposicaoMutation.isPending) return;
          setImposicaoModalOpen(false);
          setImposicaoOpcoes(null);
          setImposicaoModalError(null);
        }}
        onConfirm={(payload) => runImposicao(payload)}
      />
    </div>
  );
}

function formatCampoAlteracaoValor(value: string): string {
  return value.trim() || "—";
}

function fieldWidthClass(field: PapelariaField): string {
  if (field.type === "textarea") return "w-full";
  switch (field.key) {
    case "uf":
      return "w-[4.75rem]";
    case "anexo":
      return "w-[5.25rem]";
    case "gabinete":
      return "w-[6rem]";
    case "partido":
      return "w-[7.5rem]";
    case "email":
      return "w-[13rem] max-w-full";
    case "genero":
      return "min-w-[9.5rem] flex-1 basis-[12rem]";
    case "nome_deputado":
    case "nome_assessor":
      return "min-w-[11rem] flex-1 basis-[14rem]";
    default:
      return "min-w-[8rem] flex-1 basis-[10rem]";
  }
}

function fieldDisplayLabel(field: PapelariaField): string {
  const withoutExample = field.label
    .replace(/\s*\.\s*Ex:.*$/i, "")
    .replace(/\s+Ex:.*$/i, "")
    .trim();
  switch (field.key) {
    case "nome_deputado":
      return "Nome";
    case "genero":
      return "Gênero";
    case "partido":
      return "Partido";
    default:
      return withoutExample || field.label;
  }
}

function CamposProdutoAviso({
  arquivo,
  onRestaurar,
}: {
  arquivo?: string;
  onRestaurar: () => void;
}) {
  return (
    <div
      className="mb-2 flex items-start justify-between gap-2 rounded border border-amber-200 bg-amber-50/70 px-2 py-1.5 text-[10px] text-amber-900"
      data-testid="papelaria-campos-produto-aviso"
    >
      <span>
        Campos do produto real{arquivo ? ` (${arquivo})` : ""}: textos do Corel da
        pasta, editáveis aqui e no portal do cliente.
      </span>
      <button
        type="button"
        className="shrink-0 font-semibold text-secondary-blue hover:underline"
        onClick={onRestaurar}
      >
        Usar campos do modelo
      </button>
    </div>
  );
}

function DynamicFields({
  fields,
  isLoading,
  values,
  camposAlterados,
  onChange,
  excludedFields = [],
  onToggleExclude,
}: {
  fields: PapelariaField[] | undefined;
  isLoading: boolean;
  values: Record<string, string>;
  camposAlterados?: Record<string, { antes: string; depois: string }>;
  onChange: (key: string, value: string) => void;
  excludedFields?: string[];
  onToggleExclude?: (key: string) => void;
}) {
  if (isLoading) {
    return (
      <p className="flex items-center gap-2 py-4 text-xs text-neutral-500">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Carregando campos...
      </p>
    );
  }
  if (!fields?.length) {
    return (
      <p className="py-4 text-center text-xs text-neutral-500">
        Sem campos obrigatórios para este modelo.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
      {fields.map((field) => {
        const isExcluded = excludedFields.includes(field.key);
        const alteracao = camposAlterados?.[field.key];
        const label = fieldDisplayLabel(field);
        const inputClassName = cn(
          "w-full rounded border px-2 py-0.5 text-xs transition-colors",
          alteracao
            ? "border-amber-400 bg-amber-50/60 ring-1 ring-amber-200"
            : "border-sagra-border",
          isExcluded && "bg-neutral-100 text-neutral-400 border-neutral-200 line-through",
        );

        return (
          <div
            key={field.key}
            className={cn(
              "min-w-0 rounded-md border border-transparent px-0.5 py-0 transition-colors",
              fieldWidthClass(field),
              alteracao && "border-amber-200 bg-amber-50/40 px-1.5 py-1",
              isExcluded && "bg-neutral-50/70 opacity-70",
            )}
          >
            <div className="mb-0.5 flex items-center justify-between gap-1">
              <label
                title={label}
                className={cn(
                  "min-w-0 text-[11px] font-medium text-neutral-700 transition-all",
                  field.key === "uf" ? "whitespace-nowrap" : "flex-1 truncate",
                  isExcluded && "text-neutral-400 line-through",
                )}
              >
                {label}
                {field.required && !isExcluded ? " *" : ""}
                {alteracao ? (
                  <span className="ml-1.5 font-semibold text-amber-800">
                    (alterado)
                  </span>
                ) : null}
              </label>
              {onToggleExclude && (
                <button
                  type="button"
                  onClick={() => onToggleExclude(field.key)}
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
                    isExcluded
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : "border-neutral-200 bg-white text-neutral-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200",
                  )}
                  title={
                    isExcluded
                      ? "Restaurar campo no modelo"
                      : "Excluir campo do modelo"
                  }
                  aria-label={
                    isExcluded
                      ? "Restaurar campo no modelo"
                      : "Excluir campo do modelo"
                  }
                >
                  {isExcluded ? (
                    <RotateCcw className="size-3" aria-hidden />
                  ) : (
                    <Trash2 className="size-3" aria-hidden />
                  )}
                </button>
              )}
            </div>
            {field.type === "textarea" ? (
              <textarea
                className={inputClassName}
                rows={field.rows ?? 2}
                value={values[field.key] ?? ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                disabled={isExcluded}
              />
            ) : (
              <input
                type={field.type === "email" ? "email" : "text"}
                className={inputClassName}
                value={values[field.key] ?? ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                disabled={isExcluded}
              />
            )}
            {alteracao && !isExcluded ? (
              <p className="mt-1 text-[10px] leading-relaxed text-amber-900/90">
                <span className="font-medium">Anterior:</span>{" "}
                {formatCampoAlteracaoValor(alteracao.antes)}
                <span className="mx-1 text-amber-700">→</span>
                <span className="font-medium">Novo:</span>{" "}
                {formatCampoAlteracaoValor(alteracao.depois)}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
