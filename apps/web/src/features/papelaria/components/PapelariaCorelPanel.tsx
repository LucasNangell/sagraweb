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
import { fetchImposicaoVariantesOs, refazerImposicaoOs } from "@/api/imposicaoPerfil";
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
import {
  PapelariaCorelDadosModal,
  type PapelariaCorelDadosEstado,
} from "./PapelariaCorelDadosModal";
import { PapelariaImposicaoSetupPanel } from "./PapelariaImposicaoSetupPanel";
import {
  PAPELARIA_SP_ACTION_EVENT,
} from "./PapelariaSpContextMenu";
import { takePapelariaSpAction } from "../papelariaPendingSpAction";
import type { PapelariaFaceFonte, PapelariaRedeEstilo, PapelariaRedesBloco } from "@/features/papelaria/types";
import {
  COMPOSICAO_DADOS_KEY,
  usePapelariaComposicao,
} from "./PapelariaFrenteVersoPicker";
import type { ProvaPdfRegiao } from "@/api/papelariaProvaPdf";
import {
  CAMPOS_ESTILO_DADOS_KEY,
  camposEstiloParaDados,
  type CampoEstilo,
} from "@/features/papelaria/papelariaCamposEstilo";
import {
  CAMPOS_EXTRAS_DADOS_KEY,
  camposExtrasParaDados,
  espelhoRedePrincipal,
  normalizarRedesDoExtra,
  novoIdCampoExtra,
  type CampoExtra,
} from "@/features/papelaria/papelariaCamposExtras";
import {
  clearExtrasDraft,
  extrasDeInternos,
  loadExtrasDraft,
  saveExtrasDraft,
} from "@/features/papelaria/papelariaExtrasDraft";
import {
  interpretarEdicao,
  TEXTOS_DADOS_KEY,
  textoComMarcasNegrito,
  textosParaDados,
} from "@/features/papelaria/papelariaTextosEditados";
import type {
  AdicionarCampoExtraPayload,
  MoverCampoExtraPayload,
} from "./PapelariaPdfLivePreview";
import type { ExtraEditorMeta } from "./PapelariaTextoEditor";

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
  camposClienteFormulario,
  internosCliente,
} from "../applyPapelariaPrefill";
import { PapelariaAlteracoesCliente } from "./PapelariaAlteracoesCliente";
import { PapelariaReplicarSp } from "./PapelariaReplicarSp";
import { replicarSp } from "@/api/papelariaProvaPdf";

/** Dados do job: repetição de SP («ano-nro» da base desta OS). */
const REPETICAO_DADOS_KEY = "__repeticao";
import {
  applyCamaraCorelEnrichment,
  aplicarVariaveisFonte,
  deputadoLookupToCorelPrefill,
} from "../deputadoCorelPrefill";
import {
  isReadyImposicaoPdf,
  isWaitingImposicaoApogee,
} from "../papelariaImposicaoStatus";
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
  resolverVisualizacaoInicial,
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
  const [camposExtras, setCamposExtras] = useState<CampoExtra[]>([]);
  /** Estilo tipográfico de campos do modelo (tamanho/align). */
  const [camposEstilo, setCamposEstilo] = useState<Record<string, CampoEstilo>>({});
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
  const [imposicaoOpcoes, setImposicaoOpcoes] =
    useState<ImposicaoVariantesResponse | null>(null);
  const [imposicaoOpcoesLoading, setImposicaoOpcoesLoading] = useState(false);
  const [imposicaoSetupError, setImposicaoSetupError] = useState<string | null>(
    null,
  );
  const [refazerConfirmOpen, setRefazerConfirmOpen] = useState(false);
  const autoSelectDone = useRef(false);
  const prefillApplied = useRef(false);
  const camaraEnrichApplied = useRef(false);
  const appliedAlteracaoRef = useRef<string | null>(null);
  /** Extras já hidratados nesta montagem (OS) — evita sobrescrever edição local. */
  const extrasHydratedRef = useRef(false);
  /** Evita gravar rascunho vazio antes da hidratação. */
  const extrasDraftReadyRef = useRef(false);
  /** Bloco de redes em vigor (lido pelo efeito que aplica o pedido do cliente). */
  const redesBlocoAtualRef = useRef<PapelariaRedesBloco | null>(null);
  /** Repetição de SP: prévia e prova a partir da base recortada da prova antiga. */
  const [usarRepeticao, setUsarRepeticao] = useState(false);
  const repeticaoInicializada = useRef(false);
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
    // Modelo 0 = face da repetição de SP (não é um modelo do cadastro).
    return [...new Set([composicao.frente.modelo_id, composicao.verso.modelo_id])].filter(
      (id) => id !== selectedModelId && id !== 0,
    );
  }, [composicao, selectedModelId]);
  /** Repetição em uso: card único (só frente) ou alguma face da composição vinda dela. */
  const repeticaoAtiva =
    usarRepeticao ||
    Boolean(composicao && (composicao.frente.modelo_id === 0 || composicao.verso.modelo_id === 0));
  const repeticaoAmbasFaces = Boolean(
    composicao && composicao.frente.modelo_id === 0 && composicao.verso.modelo_id === 0,
  );
  // Origem frente e verso: a composição abre com as faces da repetição.
  const repeticaoComposicaoAplicada = useRef(false);
  useEffect(() => {
    if (repeticaoComposicaoAplicada.current) return;
    const ctx = contextQuery.data;
    const base = ctx?.repeticao?.base;
    if (!base || (ctx?.cliente_alteracao && !ctx.repeticao?.propria) || !composicao) return;
    repeticaoComposicaoAplicada.current = true;
    const faces = (base.faces ?? []).map((f) => f.face);
    setUsarRepeticao(false);
    setComposicao((c) =>
      c
        ? {
            frente: faces.includes("frente") ? { modelo_id: 0, pagina: 1 } : c.frente,
            verso: faces.includes("verso") ? { modelo_id: 0, pagina: 2 } : c.verso,
          }
        : c,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextQuery.data, composicao]);
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
      // Alinha rascunho ao que foi gravado no job (permanece na OS).
      saveExtrasDraft(anoNum, nroNum, camposExtras, camposEstilo);
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

  const refazerImposicaoMutation = useMutation({
    mutationFn: () => refazerImposicaoOs(anoNum, nroNum),
    onSuccess: async () => {
      setRefazerConfirmOpen(false);
      setActiveJobId(null);
      setProvaReviewMessage(null);
      invalidateSpStatusResumo();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.email.proofFiles(anoNum, nroNum),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.contexto(anoNum, nroNum),
      });
      setViewMode("imposicao");
      await loadImposicaoSetup();
    },
    onError: (err: Error) => {
      setFormError(err.message || "Erro ao refazer a imposição.");
      setRefazerConfirmOpen(false);
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
      const pdfIds = contextQuery.data.prova_pdf_modelos ?? [];
      // Seed precisa de tem_prova_pdf: o detalhe embutido / cache de 30s
      // sem a flag fazia só Ct Visita FV (via composição) usar a prévia PDF.
      queryClient.setQueryData(queryKeys.papelaria.corelModelo(autoId), {
        ...embedded,
        tem_prova_pdf:
          Boolean(embedded.tem_prova_pdf) || pdfIds.includes(autoId),
      });
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

  // Base da repetição já montada: abre nela (o usuário pode trocar de modelo).
  useEffect(() => {
    const ctx = contextQuery.data;
    if (!ctx || repeticaoInicializada.current) return;
    repeticaoInicializada.current = true;
    // Prova anterior no padrão antigo: a base é o caminho da alteração.
    if (ctx.repeticao?.base && (!ctx.cliente_alteracao || ctx.repeticao.propria)) setUsarRepeticao(true);
  }, [contextQuery.data]);

  const replicarMutation = useMutation({
    mutationFn: (origem: { ano: number; nro: number } | null) =>
      replicarSp(anoNum, nroNum, origem, { propria: Boolean(contextQuery.data?.repeticao?.propria) }),
    onSuccess: () => {
      setTextosEditados({});
      setCamposExtras([]);
      setCamposEstilo({});
      clearExtrasDraft(anoNum, nroNum);
      setUsarRepeticao(true);
      repeticaoComposicaoAplicada.current = false;
      setViewMode("previa");
      void queryClient.invalidateQueries({ queryKey: ["papelaria-repeticao"] });
      void contextQuery.refetch();
    },
  });

  useEffect(() => {
    const ctx = contextQuery.data;
    if (!ctx) return;
    const camposCliente = camposClienteFormulario(ctx.cliente_alteracao?.campos);
    const alteracaoKey = clienteAlteracaoIdentity(ctx.cliente_alteracao);

    if (alteracaoKey && alteracaoKey !== appliedAlteracaoRef.current) {
      setFieldValues((prev) =>
        mergePapelariaFieldValues(prev, ctx.prefill, camposCliente),
      );
      // Textos editados e redes do pedido do cliente: a prévia abre igual ao pedido.
      const internos = internosCliente(ctx.cliente_alteracao?.internos);
      if (internos.textos) setTextosEditados(internos.textos);
      if (internos.redes) {
        const doCliente = internos.redes.map((r) => ({ ...r, ativo: true }));
        const chaves = new Set(doCliente.map((r) => r.chave));
        redesMemoriaRef.current = [
          ...doCliente,
          ...redesMemoriaRef.current.filter((r) => !chaves.has(r.chave)).map((r) => ({ ...r, ativo: false })),
        ];
        if (redesBlocoAtualRef.current) {
          setRedesEscolha(redesParaBloco(redesBlocoAtualRef.current, redesMemoriaRef.current));
        }
      }
      if (internos.redesEstilo) {
        redesEstiloEscolhidoRef.current = internos.redesEstilo as PapelariaRedeEstilo;
        setRedesEstilo(internos.redesEstilo as PapelariaRedeEstilo);
      }
      // Extras da alteração (prioridade sobre última prova / rascunho).
      if (!extrasHydratedRef.current) {
        const deAlt = extrasDeInternos(ctx.cliente_alteracao?.internos ?? null);
        if (deAlt.extras.length || Object.keys(deAlt.estilos).length) {
          if (deAlt.extras.length) setCamposExtras(deAlt.extras);
          if (Object.keys(deAlt.estilos).length) setCamposEstilo(deAlt.estilos);
          extrasHydratedRef.current = true;
          extrasDraftReadyRef.current = true;
        }
      }
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

  // Hidrata extras: alteração (acima) → última prova → rascunho local.
  useEffect(() => {
    if (!hasOs || extrasHydratedRef.current) return;
    const ctx = contextQuery.data;
    if (!ctx && contextQuery.isLoading) return;

    const deAlt = extrasDeInternos(ctx?.cliente_alteracao?.internos ?? null);
    const deUltima = extrasDeInternos(ctx?.ultima_prova?.internos ?? null);
    const draft = loadExtrasDraft(anoNum, nroNum);

    const fonte =
      deAlt.extras.length || Object.keys(deAlt.estilos).length
        ? deAlt
        : deUltima.extras.length || Object.keys(deUltima.estilos).length
          ? deUltima
          : draft
            ? { extras: draft.extras, estilos: draft.estilos }
            : null;

    if (fonte) {
      if (fonte.extras.length) setCamposExtras(fonte.extras);
      if (Object.keys(fonte.estilos).length) setCamposEstilo(fonte.estilos);
    }
    extrasHydratedRef.current = true;
    extrasDraftReadyRef.current = true;
  }, [hasOs, anoNum, nroNum, contextQuery.data, contextQuery.isLoading]);

  // Persiste rascunho local (F5) — só depois da hidratação.
  useEffect(() => {
    if (!hasOs || !extrasDraftReadyRef.current) return;
    const t = window.setTimeout(() => {
      saveExtrasDraft(anoNum, nroNum, camposExtras, camposEstilo);
    }, 300);
    return () => window.clearTimeout(t);
  }, [hasOs, anoNum, nroNum, camposExtras, camposEstilo]);

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
    const clienteCampos = camposClienteFormulario(contextQuery.data?.cliente_alteracao?.campos);
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
    // Frente da repetição (modelo 0) ou do próprio modelo: só troca a face.
    if (fonte.modelo_id === 0 || fonte.modelo_id === selectedModelId) {
      setComposicao((c) => (c ? { ...c, frente: ref } : c));
      return;
    }
    setComposicao((c) => (c ? { ...c, frente: ref } : c));
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
    const clienteCampos = camposClienteFormulario(contextQuery.data?.cliente_alteracao?.campos);
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
  redesBlocoAtualRef.current = redesBloco;
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
    if (repeticaoAmbasFaces || usarRepeticao) {
      // Repetição: os textos vêm da prova antiga (editados na prévia).
      setFormError(null);
      return true;
    }
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
    const extras = camposExtrasParaDados(camposExtras);
    if (extras) base[CAMPOS_EXTRAS_DADOS_KEY] = extras;
    const estilos = camposEstiloParaDados(camposEstilo);
    if (estilos) base[CAMPOS_ESTILO_DADOS_KEY] = estilos;
    if (repeticaoAtiva) {
      // Repetição de SP: a prova sai da base recortada da prova antiga; cada
      // face da composição vem dela (modelo 0) ou de um modelo escolhido.
      base[REPETICAO_DADOS_KEY] = `${anoNum}-${nroNum}`;
    }
    return base;
  }, [activeDynamicFields, fieldValues, excludedFields, camposProduto, composicao, redesBloco, redesEscolha, redesEstilo, textosEditados, camposExtras, camposEstilo, repeticaoAtiva]);

  const valoresPrevia = useMemo(() => {
    const textos = textosParaDados(textosEditados);
    const extras = camposExtrasParaDados(camposExtras);
    const estilos = camposEstiloParaDados(camposEstilo);
    const temEstiloRede = Boolean(redesBloco) || Boolean(extras);
    if (!redesBloco && !textos && !extras && !estilos) return fieldValues;
    return {
      ...fieldValues,
      ...(redesBloco
        ? {
            [REDES_DADOS_KEY]: redesParaDados(redesEscolha),
          }
        : {}),
      ...(temEstiloRede ? { [REDES_ESTILO_DADOS_KEY]: redesEstilo } : {}),
      ...(textos ? { [TEXTOS_DADOS_KEY]: textos } : {}),
      ...(extras ? { [CAMPOS_EXTRAS_DADOS_KEY]: extras } : {}),
      ...(estilos ? { [CAMPOS_ESTILO_DADOS_KEY]: estilos } : {}),
    };
  }, [fieldValues, redesBloco, redesEscolha, redesEstilo, textosEditados, camposExtras, camposEstilo]);

  const extrasMeta = useMemo(() => {
    const map: Record<string, ExtraEditorMeta> = {};
    for (const e of camposExtras) {
      map[e.id] = {
        tamanho_pt: e.tamanho_pt,
        negrito: e.negrito,
        align_h: e.align_h,
        align_v: e.align_v,
        x_pt: e.x_pt,
        y_pt: e.y_pt,
        ...(e.tipo === "rede"
          ? {
              redes: e.redes,
              estilo: e.estilo,
              icone_pt: e.icone_pt,
            }
          : {}),
      };
    }
    for (const [chave, est] of Object.entries(camposEstilo)) {
      map[chave] = {
        ...(map[chave] ?? {}),
        tamanho_pt: est.tamanho_pt ?? map[chave]?.tamanho_pt,
        align_h: est.align_h ?? map[chave]?.align_h,
        align_v: est.align_v ?? map[chave]?.align_v,
      };
    }
    return map;
  }, [camposExtras, camposEstilo]);

  /** Prova PDF: detalhe do modelo, lista do contexto ou composição frente/verso. */
  const temProvaPdfModelo =
    Boolean(modelDetailQuery.data?.tem_prova_pdf) ||
    provaPdfServidor ||
    Boolean(composicao) ||
    repeticaoAtiva;

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
    (regiao: ProvaPdfRegiao, texto: string, meta?: ExtraEditorMeta) => {
      if (regiao.tipo === "campo_extra" || regiao.tipo === "rede_extra") {
        const eid = regiao.extra_id ?? regiao.chave.replace(/^extra:/, "");
        setCamposExtras((prev) =>
          prev.map((e) => {
            if (e.id !== eid) return e;
            const next: CampoExtra = {
              ...e,
              ...(meta?.tamanho_pt !== undefined ? { tamanho_pt: meta.tamanho_pt } : {}),
              ...(meta?.align_h ? { align_h: meta.align_h } : {}),
              ...(meta?.align_v ? { align_v: meta.align_v } : {}),
              ...(meta?.x_pt !== undefined ? { x_pt: meta.x_pt } : {}),
              ...(meta?.y_pt !== undefined ? { y_pt: meta.y_pt } : {}),
            };
            if (e.tipo === "rede") {
              const redes =
                meta?.redes?.length
                  ? meta.redes.map((r) => ({
                      chave: String(r.chave || "").trim().toLowerCase(),
                      valor: String(r.valor || "").trim(),
                    }))
                  : normalizarRedesDoExtra(e.redes, e.rede_chave, texto.trim());
              const espelho = espelhoRedePrincipal(redes);
              next.redes = redes;
              next.rede_chave = espelho.rede_chave;
              next.rede_valor = espelho.rede_valor;
              if (meta?.estilo !== undefined) next.estilo = meta.estilo ?? null;
              if (meta?.icone_pt !== undefined) next.icone_pt = meta.icone_pt;
              return next;
            }
            next.texto = texto;
            if (meta?.negrito) next.negrito = meta.negrito;
            return next;
          }),
        );
        return;
      }
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
      if (meta) {
        setCamposEstilo((prev) => ({
          ...prev,
          [regiao.chave]: {
            tamanho_pt: meta.tamanho_pt ?? null,
            align_h: meta.align_h,
            align_v: meta.align_v,
          },
        }));
      }
      const textoFinal =
        meta?.negrito?.length
          ? textoComMarcasNegrito(texto, meta.negrito)
          : texto;
      const edicao = interpretarEdicao(regiao, textoFinal, camposEditaveisPrevia);
      // Tipografia vai em `__campos_estilo`; texto de variável continua no formulário
      // salvo quando há negrito (precisa de `__textos` com marcas).
      if (edicao.tipo === "variavel" && !(meta?.negrito?.length)) {
        removerTextoEditado(regiao.chave);
        setFieldValues((prev) => ({ ...prev, [edicao.chave]: edicao.valor }));
        return;
      }
      setTextosEditados((prev) => ({
        ...prev,
        [regiao.chave]: edicao.tipo === "texto" ? edicao.texto : textoFinal,
      }));
    },
    [camposEditaveisPrevia, removerTextoEditado],
  );

  const handleRestaurarTextoPrevia = useCallback(
    (regiao: ProvaPdfRegiao) => {
      if (regiao.tipo === "campo_extra" || regiao.tipo === "rede_extra") {
        const eid = regiao.extra_id ?? regiao.chave.replace(/^extra:/, "");
        setCamposExtras((prev) => prev.filter((e) => e.id !== eid));
        return;
      }
      if (regiao.tipo === "rede" && regiao.rede_chave) {
        const chaveRede = regiao.rede_chave;
        setRedesEscolha((prev) =>
          prev.map((r) => (r.chave === chaveRede ? { ...r, valor: "", ativo: false } : r)),
        );
        return;
      }
      removerTextoEditado(regiao.chave);
      setCamposEstilo((prev) => {
        if (!(regiao.chave in prev)) return prev;
        const { [regiao.chave]: _rem, ...resto } = prev;
        return resto;
      });
    },
    [removerTextoEditado],
  );

  const handleAdicionarCampoExtra = useCallback((payload: AdicionarCampoExtraPayload) => {
    const redes =
      payload.tipo === "rede"
        ? payload.redes?.length
          ? payload.redes.map((r) => ({
              chave: String(r.chave || "").trim().toLowerCase(),
              valor: String(r.valor || "").trim(),
            }))
          : normalizarRedesDoExtra(
              null,
              payload.rede_chave ?? "",
              payload.rede_valor ?? "",
            )
        : [];
    const espelho = espelhoRedePrincipal(redes);
    setCamposExtras((prev) => [
      ...prev,
      {
        id: novoIdCampoExtra(),
        tipo: payload.tipo,
        ancora_chave: payload.ancora_chave,
        direcao: payload.direcao,
        texto: payload.tipo === "texto" ? (payload.texto ?? "") : "",
        rede_chave: payload.tipo === "rede" ? espelho.rede_chave : "",
        rede_valor: payload.tipo === "rede" ? espelho.rede_valor : "",
        redes,
        estilo: payload.tipo === "rede" ? (payload.estilo ?? null) : null,
        icone_pt: payload.tipo === "rede" ? (payload.icone_pt ?? null) : null,
        x_pt: payload.x_pt ?? null,
        y_pt: payload.y_pt ?? null,
        offset_x_pt: 0,
        offset_y_pt: 0,
        align_h: payload.align_h ?? "esquerda",
        align_v: payload.align_v ?? "topo",
        tamanho_pt: payload.tamanho_pt ?? null,
        negrito: payload.negrito ?? [],
      },
    ]);
  }, []);

  const handleRemoverCampoExtra = useCallback((extraId: string) => {
    setCamposExtras((prev) => prev.filter((e) => e.id !== extraId));
  }, []);

  const handleMoverCampoExtra = useCallback((payload: MoverCampoExtraPayload) => {
    setCamposExtras((prev) =>
      prev.map((e) =>
        e.id === payload.extraId
          ? { ...e, x_pt: payload.x_pt, y_pt: payload.y_pt, offset_x_pt: 0, offset_y_pt: 0 }
          : e,
      ),
    );
  }, []);

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
          : (composicao?.frente.modelo_id || selectedModelId),
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

  const loadImposicaoSetup = async () => {
    if (!selectedModelId) {
      setFormError("Selecione o modelo com configuração de imposição.");
      return;
    }
    setViewMode("imposicao");
    setMobilePanel("preview");
    setImposicaoSetupError(null);
    setImposicaoOpcoesLoading(true);
    try {
      const opcoes = await fetchImposicaoVariantesOs(
        anoNum,
        nroNum,
        selectedModelId,
      );
      if (!(opcoes.variantes_disponiveis || []).length) {
        setFormError(
          "Nenhuma imposição Digital/Offset configurada para este produto/modelo.",
        );
        return;
      }
      setImposicaoOpcoes(opcoes);
      setFormError(null);
    } catch (e) {
      setImposicaoSetupError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar as opções de imposição.",
      );
    } finally {
      setImposicaoOpcoesLoading(false);
    }
  };

  const runImposicao = (payload: {
    variante: ImposicaoVariante;
    juntada_os?: Array<{ ano: number; nro: number }>;
    slot_os?: Array<{ slot: number; ano: number; nro: number }>;
  }) => {
    if (!selectedModelId) {
      setFormError("Selecione o modelo com configuração de imposição.");
      return;
    }
    setImposicaoSetupError(null);
    imposicaoMutation.mutate(
      {
        ano: anoNum,
        nro: nroNum,
        modelo_id: selectedModelId,
        variante: payload.variante,
        juntada_os: payload.juntada_os,
        slot_os: payload.slot_os,
      },
      {
        onError: (err: Error) => {
          setImposicaoSetupError(err.message || "Erro ao gerar imposição.");
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
      await loadImposicaoSetup();
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

  const spMenuHandlersRef = useRef({
    handleAbrirPasta,
    handleGerarCorel,
    handleAbrirCorel,
    handleImposicao,
    handleTimbradoA4Digital,
  });
  spMenuHandlersRef.current = {
    handleAbrirPasta,
    handleGerarCorel,
    handleAbrirCorel,
    handleImposicao,
    handleTimbradoA4Digital,
  };

  useEffect(() => {
    if (!hasOs) return;
    const runPending = () => {
      const action = takePapelariaSpAction(anoNum, nroNum);
      if (!action) return;
      const h = spMenuHandlersRef.current;
      switch (action) {
        case "abrir-pasta":
          h.handleAbrirPasta();
          break;
        case "gerar-corel":
          h.handleGerarCorel();
          break;
        case "abrir-corel":
          h.handleAbrirCorel();
          break;
        case "imposicao":
          h.handleImposicao();
          break;
        case "timbrado-digital":
          h.handleTimbradoA4Digital();
          break;
        default:
          break;
      }
    };
    runPending();
    window.addEventListener(PAPELARIA_SP_ACTION_EVENT, runPending);
    return () => window.removeEventListener(PAPELARIA_SP_ACTION_EVENT, runPending);
  }, [hasOs, anoNum, nroNum]);

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
    if (viewMode !== "imposicao") return;
    if (hasImposicaoPdf || waitingApogee) return;
    if (!selectedModelId || imposicaoOpcoesLoading) return;
    if (imposicaoOpcoes) return;
    void loadImposicaoSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewMode,
    hasImposicaoPdf,
    waitingApogee,
    selectedModelId,
    imposicaoOpcoes,
    imposicaoOpcoesLoading,
  ]);

  useEffect(() => {
    // proof-files só roda após o contexto; não escolher aba antes disso.
    if (!hasOs || !contextReady || !proofFilesQuery.isFetched || jobsQuery.isLoading) {
      return;
    }
    if (viewModeInitialized.current) return;
    viewModeInitialized.current = true;
    const jobEmAndamento = (jobsQuery.data ?? []).some(
      (j) => j.status === "pending" || j.status === "processing",
    );
    // Situação da SP decide: «Saída p/» (trabalho novo / alteração) → prévia;
    // demais → última prova. Trabalho em andamento abre o acompanhamento.
    setViewMode(
      resolverVisualizacaoInicial({
        situacao: contextQuery.data?.andamento?.situacao,
        faseProva: contextQuery.data?.prova_status?.phase,
        hasProof: hasFolderProof || hasJobProof,
        hasImposicao: hasImposicaoPdf,
        waitingApogee,
        jobEmAndamento,
      }),
    );
  }, [
    hasOs,
    contextReady,
    proofFilesQuery.isFetched,
    jobsQuery.isLoading,
    jobsQuery.data,
    contextQuery.data?.andamento?.situacao,
    contextQuery.data?.prova_status?.phase,
    hasFolderProof,
    hasJobProof,
    hasImposicaoPdf,
    waitingApogee,
  ]);

  // Prova da própria OS no padrão antigo (folha A4): ao abrir a prévia para
  // alterar, monta a base editável a partir dela (como na repetição de SP).
  const provaAntigaMontada = useRef(false);
  useEffect(() => {
    const rep = contextQuery.data?.repeticao;
    if (!viewModeInitialized.current || provaAntigaMontada.current) return;
    if (!rep?.propria || rep.base || viewMode !== "previa" || replicarMutation.isPending) return;
    provaAntigaMontada.current = true;
    replicarMutation.mutate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextQuery.data?.repeticao, viewMode, proofFilesQuery.isFetched, jobsQuery.isLoading]);

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
            Selecione uma SP para preencher os campos.
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
                className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm"
                data-testid="papelaria-modelos-campos"
              >
                <div
                  className="flex min-w-0 shrink-0 flex-col border-b border-sagra-border"
                  data-testid="papelaria-observacoes-os"
                >
                  <div className="border-b border-sagra-border bg-slate-50/80 px-3 py-2">
                    <h2 className="text-xs font-bold text-secondary-blue">Observações</h2>
                  </div>
                  <div className="p-2">
                    <div
                      aria-label="Observações da OS"
                      className="w-full whitespace-pre-wrap break-words rounded border border-sagra-border bg-slate-50 px-2 py-1 text-xs leading-relaxed text-neutral-800"
                    >
                      {(contextQuery.data?.os.observ ?? "").trim() ? (
                        contextQuery.data?.os.observ
                      ) : (
                        <span className="text-neutral-400">Sem observações na OS</span>
                      )}
                    </div>
                  </div>
                  {contextQuery.data?.repeticao ? (
                    <div className="px-2 pb-2">
                      <PapelariaReplicarSp
                        repeticao={contextQuery.data.repeticao}
                        pending={replicarMutation.isPending}
                        erro={replicarMutation.error instanceof Error ? replicarMutation.error.message : null}
                        onReplicar={(origem) => replicarMutation.mutate(origem)}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div className="border-b border-sagra-border bg-slate-50/80 px-3 py-2">
                    <h2 className="text-xs font-bold text-secondary-blue">
                      Informações do cliente
                    </h2>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                    {usarRepeticao || repeticaoAmbasFaces ? (
                      <p className="p-4 text-center text-xs text-neutral-500" data-testid="papelaria-repeticao-aviso-campos">
                        {contextQuery.data?.repeticao?.propria
                          ? "Prova anterior (padrão antigo)"
                          : `Repetição da SP ${contextQuery.data?.repeticao?.rotulo ?? ""}`}
                        : os textos vêm da prova antiga — clique neles na prévia para editar.
                      </p>
                    ) : selectedModelId == null ? (
                      <p className="p-4 text-center text-xs text-neutral-500">
                        Selecione um modelo na Visualização para preencher os campos.
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
              Informações do cliente
            </h2>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain">
              {selectedModelId !== null ? (
                <div>
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
              <div className="mt-2 min-w-0 shrink-0">
                <label className="mb-0.5 block text-[11px] font-medium text-neutral-700">
                  Observações
                </label>
                <div
                  aria-label="Observações da OS"
                  className="w-full whitespace-pre-wrap break-words rounded border border-sagra-border bg-slate-50 px-2 py-1 text-xs leading-relaxed text-neutral-800"
                >
                  {(contextQuery.data?.os.observ ?? "").trim() ? (
                    contextQuery.data?.os.observ
                  ) : (
                    <span className="text-neutral-400">Sem observações na OS</span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </section>
          )}

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
            temProvaPdf={temProvaPdfModelo}
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
            permitirCamposExtras
            redesCatalogoExtras={(redesBloco?.redes ?? []).map((r) => ({
              chave: r.chave,
              nome: r.nome,
              exemplo: r.exemplo,
              logos_url: r.logos_url,
            }))}
            redesEstilosExtras={redesBloco?.estilos}
            onAdicionarCampoExtra={handleAdicionarCampoExtra}
            onRemoverCampoExtra={handleRemoverCampoExtra}
            onMoverCampoExtra={handleMoverCampoExtra}
            extrasMeta={extrasMeta}
            provaStatus={contextQuery.data?.prova_status ?? null}
            previaRepeticao={repeticaoAtiva ? { ano: anoNum, nro: nroNum } : null}
            topoPrevia={
              clienteAlteracaoPendente ? (
                <PapelariaAlteracoesCliente
                  alteracao={clienteAlteracaoPendente}
                  rotulos={Object.fromEntries((camposFormulario ?? []).map((f) => [f.key, f.label]))}
                />
              ) : null
            }
            criarProva={{
              onClick: handleGerarArquivo,
              pending: createJobMutation.isPending,
              // Mesmas regras do botão que ficava na linha de ações.
              disabled:
                createJobMutation.isPending ||
                createDigitalJobMutation.isPending ||
                imposicaoMutation.isPending ||
                abrirCorelMutation.isPending ||
                folderCheckPending ||
                modelDetailQuery.isLoading ||
                !selectedModelId,
              title:
                cdrFiles[0]?.filename && !temProvaPdfModelo
                  ? `Criar prova a partir do Corel da pasta (${cdrFiles[0].filename}), aplicando os campos do formulário`
                  : "Criar a prova (Prova PDF, gerada no servidor a partir da prévia)",
            }}
            imposicaoSetup={
              <PapelariaImposicaoSetupPanel
                ano={anoNum}
                nro={nroNum}
                modeloId={selectedModelId ?? null}
                opcoes={imposicaoOpcoes}
                loading={imposicaoOpcoesLoading}
                submitting={imposicaoMutation.isPending}
                error={imposicaoSetupError}
                onGenerate={runImposicao}
              />
            }
            refazerImposicao={{
              onClick: () => setRefazerConfirmOpen(true),
              pending: refazerImposicaoMutation.isPending,
              disabled:
                refazerImposicaoMutation.isPending || imposicaoMutation.isPending,
              title:
                "Refazer imposição — as OSs juntadas voltam a Aguard. Juntada",
            }}
            ladoEsquerdo={
              <>
                <div className="shrink-0 border-b border-sagra-border bg-slate-50/80 px-3 py-2">
                  <h3 className="text-xs font-bold text-secondary-blue">Modelos disponíveis</h3>
                  <p className="text-[10px] text-neutral-500">
                    {resumoListaModelos(modelos, facesComposicao, composicao)}
                  </p>
                </div>
                <div
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
                  data-testid="papelaria-modelos-na-visualizacao"
                >
                  <PapelariaModelosLista
                    modelos={modelos}
                    selectedModelId={selectedModelId}
                    onSelectModel={(m) => {
                      setUsarRepeticao(false);
                      handleSelectModel(m);
                    }}
                    faces={facesComposicao}
                    composicao={composicao}
                    onSelectFrente={(f) => {
                      setUsarRepeticao(false);
                      handleSelectFrente(f);
                    }}
                    onSelectVerso={(f) => {
                      setUsarRepeticao(false);
                      handleSelectVerso(f);
                    }}
                    repeticao={
                      contextQuery.data?.repeticao?.base
                        ? {
                            rotulo: contextQuery.data.repeticao.rotulo ?? "",
                            nome: contextQuery.data.repeticao.propria ? "Prova anterior" : undefined,
                            ativo: usarRepeticao,
                            faces: (contextQuery.data.repeticao.base.faces ?? []).map(
                              (f) => f.face as "frente" | "verso",
                            ),
                            onSelect: () => {
                              setUsarRepeticao(true);
                              setTextosEditados({});
                              setCamposExtras([]);
                              setCamposEstilo({});
                              clearExtrasDraft(anoNum, nroNum);
                            },
                          }
                        : null
                    }
                  />
                </div>
              </>
            }
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
            void loadImposicaoSetup();
            return;
          }
          if (action) {
            setAndamentoModal(action);
          }
        }}
      />

      {refazerConfirmOpen ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="refazer-imposicao-title"
          >
            <h3
              id="refazer-imposicao-title"
              className="text-center text-lg font-bold text-slate-800"
            >
              Refazer imposição?
            </h3>
            <p className="mt-2 text-center text-sm text-slate-600">
              Isso afeta todas as SPs juntadas neste trabalho. Ao confirmar, todas
              voltam à situação <strong>Aguard. Juntada</strong> e a imposição
              atual deixa de valer.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="flex-1 sagra-btn sagra-btn--outline sagra-btn--md"
                disabled={refazerImposicaoMutation.isPending}
                onClick={() => setRefazerConfirmOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="sagra-btn sagra-btn--secondary sagra-btn--md"
                disabled={refazerImposicaoMutation.isPending}
                data-testid="papelaria-refazer-imposicao-confirmar"
                onClick={() => refazerImposicaoMutation.mutate()}
              >
                {refazerImposicaoMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatCampoAlteracaoValor(value: string): string {
  return value.trim() || "—";
}

function fieldWidthClass(
  field: PapelariaField,
  options?: { pairNomeGenero?: boolean },
): string {
  if (field.type === "textarea") return "w-full";
  const pairNomeGenero = options?.pairNomeGenero ?? false;
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
      // Com Nome na mesma linha: 1/3 (desconta o gap-x-2).
      return pairNomeGenero
        ? "w-[calc((100%-0.5rem)/3)]"
        : "min-w-[9.5rem] flex-1 basis-[12rem]";
    case "nome_deputado":
    case "nome_assessor":
      // Com Gênero na mesma linha: 2/3.
      return pairNomeGenero
        ? "w-[calc((100%-0.5rem)*2/3)]"
        : "min-w-[11rem] flex-1 basis-[14rem]";
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

  const fieldKeys = new Set(fields.map((field) => field.key));
  const pairNomeGenero =
    fieldKeys.has("genero") &&
    (fieldKeys.has("nome_deputado") || fieldKeys.has("nome_assessor"));

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
              fieldWidthClass(field, { pairNomeGenero }),
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
