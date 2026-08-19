import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  AlertTriangle,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  approvePapelariaJobProva,
  abrirCorelPapelariaOs,
  cancelPapelariaJob,
  createPapelariaJob,
  discardPapelariaJobProva,
  fetchPapelariaCdrPath,
  fetchPapelariaCorelModelo,
  fetchPapelariaJob,
  fetchPapelariaJobsForOs,
  fetchPapelariaOsContext,
  finalizarCorelPapelariaOs,
  gerarProvaCdrExistentePapelariaOs,
  papelariaJobFileUrl,
} from "@/api/papelaria";
import { fetchOsFolderBrowse } from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";
import { tryOpenFileLocally } from "@/lib/sagraLocalOpener";
import { OsFolderRequiredGateModal } from "@/features/os/components/OsFolderRequiredGateModal";
import { PapelariaProofPanel } from "./PapelariaProofPanel";
import {
  mergeDadosWithDynamicLayout,
  applyPreviewTemplate,
  type ActiveDynamicFieldPlacement,
} from "../preview";
import type {
  PapelariaCorelModelSummary,
  PapelariaField,
  PapelariaJob,
  PapelariaJobStatus,
} from "../types";

type Props = {
  osId: string | null;
  osAno: string | null;
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

function jobStatusLabel(status: PapelariaJobStatus): string {
  switch (status) {
    case "pending":
      return "Aguardando na fila";
    case "processing":
      return "Processando";
    case "completed":
      return "Concluído";
    case "failed":
      return "Erro";
    case "cancelled":
      return "Cancelado";
    default:
      return status;
  }
}

function jobStatusClass(status: PapelariaJobStatus): string {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-800";
    case "processing":
      return "bg-blue-100 text-blue-800";
    case "completed":
      return "bg-emerald-100 text-emerald-800";
    case "failed":
      return "bg-red-100 text-red-800";
    case "cancelled":
      return "bg-neutral-200 text-neutral-600";
    default:
      return "bg-neutral-100 text-neutral-700";
  }
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

export function PapelariaCorelPanel({ osId, osAno }: Props) {
  const anoNum = osAno ? parseInt(osAno, 10) : NaN;
  const nroNum = osId ? parseInt(osId, 10) : NaN;
  const hasOs = Number.isFinite(anoNum) && Number.isFinite(nroNum);

  const queryClient = useQueryClient();
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [excludedFields, setExcludedFields] = useState<string[]>([]);
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
    "gerar" | "corel" | "export" | null
  >(null);
  const [folderGateAction, setFolderGateAction] = useState<
    "gerar" | "corel" | "export" | null
  >(null);
  const [folderCheckPending, setFolderCheckPending] = useState(false);
  const autoSelectDone = useRef(false);
  const [mobilePanel, setMobilePanel] = useState<"form" | "preview">("form");

  const contextQuery = useQuery({
    queryKey: queryKeys.papelaria.contexto(anoNum, nroNum),
    queryFn: () => fetchPapelariaOsContext(anoNum, nroNum),
    enabled: hasOs,
    staleTime: 30_000,
    retry: 2,
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
    enabled: hasOs,
    staleTime: 30_000,
    retry: false,
  });

  const modelDetailQuery = useQuery({
    queryKey: queryKeys.papelaria.corelModelo(selectedModelId ?? 0),
    queryFn: () => fetchPapelariaCorelModelo(selectedModelId!),
    enabled: selectedModelId !== null,
  });

  const jobsQuery = useQuery({
    queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
    queryFn: () => fetchPapelariaJobsForOs(anoNum, nroNum),
    enabled: hasOs,
    refetchInterval: 12_000,
  });

  const activeJobQuery = useQuery({
    queryKey: queryKeys.papelaria.job(activeJobId ?? 0),
    queryFn: () => fetchPapelariaJob(activeJobId!),
    enabled: activeJobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const revisao = query.state.data?.prova_revisao;
      if (!status) return 2_000;
      if (status === "pending" || status === "processing") return 2_000;
      if (
        status === "completed" &&
        revisao !== "approved" &&
        revisao !== "discarded"
      ) {
        return 5_000;
      }
      return false;
    },
  });

  useEffect(() => {
    if (activeJobId === null || !jobsQuery.data?.length) return;
    const listed = jobsQuery.data.find((j) => j.id === activeJobId);
    const cached = activeJobQuery.data;
    if (
      listed?.status === "completed" &&
      cached &&
      cached.status !== "completed"
    ) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.job(activeJobId),
      });
    }
  }, [activeJobId, activeJobQuery.data, jobsQuery.data, queryClient]);

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

  useSagraWebSocket<{
    type?: string;
    job_id?: number;
    ano?: number;
    nro?: number;
  }>({
    path: "/ws",
    enabled: hasOs,
    onMessage: (data) => {
      if (data.type !== "papelaria_job_update") return;
      if (data.ano !== anoNum || data.nro !== nroNum) return;
      refreshPapelariaJobs();
      if (data.job_id && data.job_id === activeJobId) {
        void queryClient.fetchQuery({
          queryKey: queryKeys.papelaria.job(data.job_id),
          queryFn: () => fetchPapelariaJob(data.job_id!),
        });
      }
    },
  });

  const createJobMutation = useMutation({
    mutationFn: createPapelariaJob,
    onSuccess: (job) => {
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
      setMobilePanel("preview");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
      });
    },
    onError: (err: Error) => {
      setFormError(err.message || "Erro ao criar solicitação.");
    },
  });

  const exportCdrMutation = useMutation({
    mutationFn: gerarProvaCdrExistentePapelariaOs,
    onSuccess: (job) => {
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
      setProvaReviewMessage(null);
      setMobilePanel("preview");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.papelaria.jobsOs(anoNum, nroNum),
      });
    },
    onError: (err: Error) => {
      setFormError(err.message || "Erro ao solicitar exportação de prova.");
    },
  });

  const cancelJobMutation = useMutation({
    mutationFn: cancelPapelariaJob,
    onSuccess: (job) => {
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
    },
    onError: (err: Error) => {
      setFormError(err.message || "Não foi possível aprovar a prova.");
    },
  });

  const discardProvaMutation = useMutation({
    mutationFn: discardPapelariaJobProva,
    onSuccess: (job) => {
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
      if (!job?.id) {
        setFormError("Finalização concluída, mas a resposta da API veio inválida.");
        return;
      }
      setActiveJobId(job.id);
      setCorelEditMode(false);
      setFormError(null);
      setProvaReviewMessage(null);
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
    const ctx = contextQuery.data;
    if (ctx.autoSelectedModelId) {
      setSelectedModelId(ctx.autoSelectedModelId);
    }
    if (ctx.prefill && Object.keys(ctx.prefill).length > 0) {
      setFieldValues((prev) => ({ ...ctx.prefill, ...prev }));
    }
    autoSelectDone.current = true;
  }, [contextQuery.data]);

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

  const handleSelectModel = (model: PapelariaCorelModelSummary) => {
    setSelectedModelId(model.id);
    setActiveDynamicFields([]);
    setExcludedFields([]);
    if (contextQuery.data?.prefill) {
      setFieldValues({ ...contextQuery.data.prefill });
    } else {
      setFieldValues({});
    }
  };

  const camposAlteradosByKey = useMemo(() => {
    const items = contextQuery.data?.cliente_alteracao?.campos_alterados;
    if (!items?.length) return {};
    return Object.fromEntries(items.map((item) => [item.key, item]));
  }, [contextQuery.data?.cliente_alteracao?.campos_alterados]);

  const previa = useMemo(() => {
    if (!modelDetailQuery.data?.campos) return null;
    return buildPreviaTextual(modelDetailQuery.data.campos, fieldValues);
  }, [modelDetailQuery.data?.campos, fieldValues]);

  const validateFormForAction = (): boolean => {
    if (!selectedModelId) return false;
    const missing = validateRequiredFields(
      modelDetailQuery.data?.campos_formulario,
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
    action: "gerar" | "corel" | "export",
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
    return base;
  }, [activeDynamicFields, fieldValues, excludedFields]);

  const runGerarArquivo = (lancarAndamento: boolean) => {
    if (!selectedModelId) return;
    createJobMutation.mutate({
      ano: anoNum,
      nro: nroNum,
      modelo_id: selectedModelId,
      dados: dadosForJob,
      lancar_andamento: lancarAndamento,
    });
    setCorelEditMode(false);
  };

  const runExportCdrExistente = (lancarAndamento: boolean) => {
    if (!selectedModelId) return;
    exportCdrMutation.mutate({
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
    } else if (action === "corel") {
      runAbrirCorel(lancarAndamento);
    } else if (action === "export") {
      runExportCdrExistente(lancarAndamento);
    }
  };

  const handleGerarArquivo = () => {
    if (!validateFormForAction()) return;
    void ensureOsFolderThen("gerar");
  };

  const handleAbrirCorel = () => {
    if (!validateFormForAction()) return;
    void ensureOsFolderThen("corel");
  };

  const handleGerarProvaCdrExistente = () => {
    if (!selectedModelId) {
      setFormError("Selecione um modelo antes de gerar a prova.");
      return;
    }
    if (!cdrPathQuery.data) {
      setFormError("Nenhum arquivo Corel utilizável encontrado na pasta desta OS.");
      return;
    }
    setFormError(null);
    void ensureOsFolderThen("export");
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

  if (!hasOs) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-sagra-border bg-white p-8 text-center text-sm text-neutral-500">
        Selecione uma OS de papelaria (número &gt; 5000) na página Início e abra
        Papelaria pelo menu lateral.
      </div>
    );
  }

  if (contextQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-neutral-600">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        Carregando contexto da OS...
      </div>
    );
  }

  if (contextQuery.isError) {
    const detail =
      contextQuery.error instanceof Error
        ? contextQuery.error.message
        : "Erro desconhecido.";
    return (
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
    );
  }

  const ctx = contextQuery.data!;
  const modelos = ctx.modelos;
  const isJobGenerating =
    createJobMutation.isPending ||
    exportCdrMutation.isPending ||
    (!!activeJob &&
      (activeJob.status === "pending" || activeJob.status === "processing"));
  const cdrExistente = cdrPathQuery.data;

  const mobilePanelClass = (panel: "form" | "preview") =>
    cn(
      mobilePanel !== panel && "max-md:hidden",
      panel === "preview"
        ? "flex min-h-[min(50vh,480px)] min-w-0 flex-1 flex-col md:min-h-0"
        : "flex min-h-[min(50vh,480px)] w-full flex-col md:min-h-0 md:w-[360px] md:shrink-0",
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
        {ctx.cliente_alteracao ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
            <p className="font-semibold text-amber-900">
              Alteração solicitada pelo cliente
              {ctx.cliente_alteracao.versao
                ? ` — prova v${ctx.cliente_alteracao.versao}`
                : ""}
            </p>
            <p className="mt-1 text-amber-900/90">
              Os campos do formulário foram preenchidos com os dados informados pelo cliente.
              Campos alterados estão destacados abaixo com o valor anterior e o novo valor.
              Revise e gere uma nova prova ou edite no CorelDRAW.
            </p>
            {ctx.cliente_alteracao.observacao ? (
              <p className="mt-2 rounded border border-amber-200 bg-white/70 px-2 py-1.5 whitespace-pre-wrap">
                <span className="font-medium">Observações adicionais: </span>
                {ctx.cliente_alteracao.observacao}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

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

      <div className="flex min-h-min flex-col gap-2 md:min-h-0 md:flex-1 md:flex-row md:gap-3 md:overflow-hidden">
        <section
          className={cn(
            mobilePanelClass("form"),
            "rounded-lg border border-sagra-border bg-white shadow-sm",
          )}
        >
          <div className="border-b border-sagra-border bg-slate-50/80 px-3 py-2">
            <h2 className="text-xs font-bold text-secondary-blue">
              Modelos compatíveis
            </h2>
            <p className="text-[10px] text-neutral-500">
              {modelos.length === 0
                ? "Nenhum modelo para este produto"
                : `${modelos.length} opção(ões)`}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            {modelos.length === 0 ? (
              <p className="p-4 text-center text-xs text-neutral-500">
                Importe a planilha de modelos ou verifique o produto da OS.
              </p>
            ) : (
              modelos.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={cn(
                    "rounded-lg border p-3 text-left text-xs transition-colors",
                    selectedModelId === m.id
                      ? "border-secondary-blue bg-secondary-blue/5 ring-1 ring-secondary-blue/30"
                      : "border-sagra-border hover:border-secondary-blue/40 hover:bg-slate-50",
                  )}
                  onClick={() => handleSelectModel(m)}
                >
                  <p className="font-semibold text-secondary-blue">
                    {m.nome_exibicao}
                  </p>
                  <p className="mt-1 text-neutral-600">{m.frente_versao}</p>
                  <p className="text-neutral-500">{m.cores}</p>
                  <p className="mt-1 font-mono text-[10px] text-neutral-400">
                    {m.arquivo_modelo}
                  </p>
                </button>
              ))
            )}

            {selectedModelId !== null && (
              <div className="mt-2 border-t border-neutral-200 pt-2">
                <h3 className="mb-2 text-xs font-bold text-neutral-700">
                  Campos do formulário
                </h3>
                <DynamicFields
                  fields={modelDetailQuery.data?.campos_formulario}
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
                {formError && (
                  <p className="mt-2 text-[11px] text-sagra-danger">{formError}</p>
                )}
                {contextQuery.data?.cliente_alteracao?.observacao ? (
                  <div className="mt-3">
                    <label className="mb-0.5 block text-[11px] font-medium text-amber-800">
                      Observações do cliente (alteração solicitada
                      {contextQuery.data.cliente_alteracao.versao
                        ? ` — prova v${contextQuery.data.cliente_alteracao.versao}`
                        : ""}
                      )
                    </label>
                    <textarea
                      readOnly
                      disabled
                      rows={3}
                      value={contextQuery.data.cliente_alteracao.observacao}
                      className="w-full resize-none rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-950"
                    />
                  </div>
                ) : null}
                <div className="mt-3">
                  <label className="mb-0.5 block text-[11px] font-medium text-neutral-700">
                    Observações
                  </label>
                  <textarea
                    readOnly
                    disabled
                    rows={3}
                    value={contextQuery.data?.os.observ ?? ""}
                    className="w-full resize-none rounded border border-sagra-border bg-slate-50 px-2 py-1 text-xs text-neutral-800"
                    placeholder="Sem observações na OS"
                  />
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={
                        createJobMutation.isPending ||
                        exportCdrMutation.isPending ||
                        abrirCorelMutation.isPending ||
                        modelDetailQuery.isLoading ||
                        folderCheckPending
                      }
                      className="inline-flex min-h-9 flex-1 items-center justify-center rounded-lg bg-secondary-blue px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-secondary-blue/90 disabled:opacity-60"
                      onClick={handleGerarArquivo}
                    >
                      {createJobMutation.isPending ? (
                        <span className="inline-flex items-center justify-center gap-2">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          Enviando...
                        </span>
                      ) : (
                        "Gerar arquivo"
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={
                        createJobMutation.isPending ||
                        exportCdrMutation.isPending ||
                        abrirCorelMutation.isPending ||
                        finalizeCorelMutation.isPending ||
                        modelDetailQuery.isLoading ||
                        folderCheckPending
                      }
                      className="inline-flex min-h-9 flex-1 items-center justify-center rounded-lg border border-secondary-blue bg-white px-3 py-2 text-xs font-semibold text-secondary-blue shadow-sm transition hover:bg-secondary-blue/5 disabled:opacity-60"
                      onClick={handleAbrirCorel}
                    >
                      {abrirCorelMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        "Abrir Corel"
                      )}
                    </button>
                  </div>
                  {corelEditMode ? (
                    <button
                      type="button"
                      disabled={finalizeCorelMutation.isPending}
                      className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-emerald-600 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100 disabled:opacity-60"
                      onClick={handleFinalizarCorel}
                    >
                      {finalizeCorelMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : null}
                      Finalizar
                    </button>
                  ) : null}
                  {corelEditMode ? (
                    <p className="text-[10px] leading-relaxed text-neutral-600">
                      Após editar no CorelDRAW e exportar o PDF de prova na pasta Sefoc,
                      clique em Finalizar para montar a visualização e aprovar.
                    </p>
                  ) : null}
                  {cdrExistente ? (
                    <>
                      <button
                        type="button"
                        disabled={
                          !selectedModelId ||
                          createJobMutation.isPending ||
                          exportCdrMutation.isPending ||
                          abrirCorelMutation.isPending ||
                          finalizeCorelMutation.isPending ||
                          modelDetailQuery.isLoading ||
                          isJobGenerating ||
                          folderCheckPending
                        }
                        className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-violet-600 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900 shadow-sm transition hover:bg-violet-100 disabled:opacity-60"
                        onClick={handleGerarProvaCdrExistente}
                      >
                        {exportCdrMutation.isPending ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : null}
                        Gerar prova do Corel pronto
                      </button>
                      <p className="text-[10px] leading-relaxed text-neutral-600">
                        Usa o arquivo{" "}
                        <span className="font-mono">{cdrExistente.filename}</span> da
                        pasta da OS (qualquer .cdr, exceto cópia de segurança) — não
                        recria o Corel a partir do modelo.
                      </p>
                    </>
                  ) : null}
                </div>
              </div>
            )}

            <JobsSection
              activeJob={activeJob}
              activeJobLoading={activeJobId !== null && activeJobQuery.isLoading}
              history={jobsQuery.data ?? []}
              historyLoading={jobsQuery.isLoading}
              onSelectJob={(jobId) => {
                setActiveJobId(jobId);
                setMobilePanel("preview");
              }}
              onCancel={handleCancelJob}
              cancelPending={cancelJobMutation.isPending}
              compact
            />
          </div>
        </section>

        <div className={mobilePanelClass("preview")}>
          <PapelariaProofPanel
            activeJob={activeJob}
            isJobGenerating={isJobGenerating}
            produto={produtoOs}
            frenteVerso={frenteVersoOs}
            cores={coresOs}
            arquivoModelo={arquivoModeloAtivo}
            mockupConfigJson={modelDetailQuery.data?.mockup_config_json}
            previewConfigJson={modelDetailQuery.data?.preview_config_json}
            livePreviewValues={fieldValues}
            previa={previa}
            selectedModelId={selectedModelId}
            modelLoading={modelDetailQuery.isLoading}
            onCancelJob={handleCancelJob}
            cancelPending={cancelJobMutation.isPending}
            onApproveProva={handleApproveProva}
            onDiscardProva={handleDiscardProva}
            approveProvaPending={approveProvaMutation.isPending}
            discardProvaPending={discardProvaMutation.isPending}
            provaReviewMessage={provaReviewMessage}
            activeDynamicFields={activeDynamicFields}
            onActiveDynamicFieldsChange={setActiveDynamicFields}
            onLivePreviewValueChange={(key, value) =>
              setFieldValues((prev) => ({ ...prev, [key]: value }))
            }
          />
        </div>
      </div>

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
                  exportCdrMutation.isPending ||
                  abrirCorelMutation.isPending
                }
                className="flex-1 rounded border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                onClick={() => handleAndamentoChoice(false)}
              >
                Não, continuar
              </button>
              <button
                type="button"
                disabled={
                  createJobMutation.isPending ||
                  exportCdrMutation.isPending ||
                  abrirCorelMutation.isPending
                }
                className="flex-1 rounded bg-secondary-blue py-2 text-sm font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-60"
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
          if (action) {
            setAndamentoModal(action);
          }
        }}
      />
    </div>
  );
}

function JobsSection({
  activeJob,
  activeJobLoading,
  history,
  historyLoading,
  onSelectJob,
  onCancel,
  cancelPending,
  compact = false,
}: {
  activeJob: PapelariaJob | null;
  activeJobLoading: boolean;
  history: PapelariaJob[];
  historyLoading: boolean;
  onSelectJob: (id: number) => void;
  onCancel: (id: number) => void;
  cancelPending: boolean;
  compact?: boolean;
}) {
  return (
    <section
      className={cn(
        "mt-3 shrink-0 rounded-lg border border-sagra-border bg-slate-50/50",
        compact ? "p-2" : "shadow-sm",
      )}
    >
      <div className={cn(!compact && "border-b border-sagra-border bg-slate-50/80 px-4 py-2")}>
        <h2 className="text-[11px] font-bold text-secondary-blue">
          Fila / histórico
        </h2>
        {!compact && (
          <p className="text-[10px] text-neutral-500">
            Status atualizado automaticamente quando o worker Windows processa o job.
          </p>
        )}
      </div>

      <div className={cn("space-y-3", compact ? "pt-2" : "grid gap-4 p-4 lg:grid-cols-2")}>
        <div>
          <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-600">
            Solicitação ativa
          </h3>
          {activeJobLoading && !activeJob ? (
            <p className="flex items-center gap-2 text-xs text-neutral-500">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Carregando job...
            </p>
          ) : !activeJob ? (
            <p className="text-[11px] text-neutral-500">
              Nenhuma solicitação selecionada.
            </p>
          ) : (
            <ActiveJobCard
              job={activeJob}
              onCancel={() => onCancel(activeJob.id)}
              cancelPending={cancelPending}
              compact={compact}
            />
          )}
        </div>

        <div>
          <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-600">
            Histórico da OS
          </h3>
          {historyLoading && history.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-neutral-500">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Carregando...
            </p>
          ) : history.length === 0 ? (
            <p className="text-[11px] text-neutral-500">
              Nenhuma geração para esta OS.
            </p>
          ) : (
            <ul className="max-h-32 space-y-1 overflow-y-auto">
              {history.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left text-[10px] transition",
                      activeJob?.id === job.id
                        ? "border-secondary-blue bg-secondary-blue/5"
                        : "border-sagra-border hover:bg-white",
                    )}
                    onClick={() => onSelectJob(job.id)}
                  >
                    <span className="truncate">
                      <span className="font-mono text-neutral-500">#{job.id}</span>{" "}
                      {job.arquivo_modelo}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold",
                        jobStatusClass(job.status),
                      )}
                    >
                      {jobStatusLabel(job.status)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function ActiveJobCard({
  job,
  onCancel,
  cancelPending,
  compact = false,
}: {
  job: PapelariaJob;
  onCancel: () => void;
  cancelPending: boolean;
  compact?: boolean;
}) {
  const canCancel = job.status === "pending" || job.status === "processing";

  return (
    <div
      className={cn(
        "rounded-lg border border-sagra-border bg-white",
        compact ? "p-2" : "p-3",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-bold text-secondary-blue">
          Job #{job.id}
        </span>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-semibold",
            jobStatusClass(job.status),
          )}
        >
          {jobStatusLabel(job.status)}
        </span>
        {job.ordem_fila != null && job.status === "pending" && (
          <span className="flex items-center gap-1 text-[10px] text-neutral-500">
            <Clock className="size-3" aria-hidden />
            Posição na fila: {job.ordem_fila}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-neutral-700">
        Modelo: <strong>{job.arquivo_modelo}</strong>
      </p>
      <p className="text-[11px] text-neutral-500">
        Solicitado por {job.solicitado_por} em {job.solicitado_em ?? "—"}
      </p>

      {job.status === "pending" && (
        <p className="mt-2 flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Aguardando processamento pelo computador CorelDRAW.
        </p>
      )}

      {job.status === "processing" && (
        <p className="mt-2 flex items-start gap-1.5 rounded bg-blue-50 px-2 py-1.5 text-[11px] text-blue-800">
          <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden />
          CorelDRAW em execução no worker. Você pode cancelar; o worker descarta o
          resultado ao detectar o cancelamento.
        </p>
      )}

      {job.status === "cancelled" && (
        <p className="mt-2 rounded bg-neutral-100 px-2 py-1.5 text-[11px] text-neutral-600">
          Solicitação cancelada.
          {job.erro ? ` ${job.erro}` : ""}
        </p>
      )}

      {job.status === "failed" && job.erro && (
        <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
          {job.erro}
        </p>
      )}

      {job.warnings?.map((w) => (
        <p
          key={w}
          className="mt-1 flex items-start gap-1 text-[10px] text-amber-700"
        >
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          {w}
        </p>
      ))}

      <div className="mt-3 flex flex-wrap gap-2">
        {canCancel && (
          <button
            type="button"
            disabled={cancelPending}
            className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            onClick={onCancel}
          >
            <XCircle className="size-3.5" aria-hidden />
            {cancelPending
              ? "Cancelando..."
              : job.status === "processing"
                ? "Cancelar processamento"
                : "Cancelar"}
          </button>
        )}
        {job.status === "completed" && (
          <>
            {(job.tem_arquivo_pdf || job.arquivo_pdf) && (
              <a
                href={papelariaJobFileUrl(job.id, "pdf")}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded bg-secondary-blue px-2 py-1 text-[11px] font-medium text-white hover:bg-secondary-blue/90"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Abrir PDF
              </a>
            )}
            {(job.tem_arquivo_cdr || job.arquivo_cdr) && (
              <a
                href={papelariaJobFileUrl(job.id, "cdr")}
                className="inline-flex items-center gap-1 rounded border border-secondary-blue px-2 py-1 text-[11px] font-medium text-secondary-blue hover:bg-secondary-blue/5"
              >
                <Download className="size-3.5" aria-hidden />
                Baixar CDR
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function formatCampoAlteracaoValor(value: string): string {
  return value.trim() || "—";
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
    <div className="flex flex-col gap-2">
      {fields.map((field) => {
        const isExcluded = excludedFields.includes(field.key);
        const alteracao = camposAlterados?.[field.key];
        const inputClassName = cn(
          "w-full rounded border px-2 py-1 text-xs transition-colors",
          alteracao
            ? "border-amber-400 bg-amber-50/60 ring-1 ring-amber-200"
            : "border-sagra-border",
          isExcluded && "bg-neutral-100 text-neutral-400 border-neutral-200 line-through",
        );

        return (
          <div
            key={field.key}
            className={cn(
              "rounded-md border border-transparent p-1 transition-colors",
              alteracao && "border-amber-200 bg-amber-50/40 p-2",
              isExcluded && "bg-neutral-50/70 opacity-70",
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <label
                className={cn(
                  "block text-[11px] font-medium text-neutral-700 transition-all",
                  isExcluded && "text-neutral-400 line-through",
                )}
              >
                {field.label}
                {field.required && !isExcluded ? " *" : ""}
                {alteracao ? (
                  <span className="ml-1.5 font-semibold text-amber-800">
                    (alterado pelo cliente)
                  </span>
                ) : null}
              </label>
              {onToggleExclude && (
                <button
                  type="button"
                  onClick={() => onToggleExclude(field.key)}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[9px] font-semibold transition-colors border",
                    isExcluded
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : "border-neutral-200 bg-white text-neutral-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200",
                  )}
                  title={
                    isExcluded
                      ? "Restaurar campo no modelo"
                      : "Excluir campo do modelo"
                  }
                >
                  {isExcluded ? "Restaurar" : "Excluir"}
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
