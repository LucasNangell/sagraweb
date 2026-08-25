import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createPapelariaModeloFromCdr,
  fetchPapelariaCdrInspect,
  inspectPapelariaCdr,
  type PapelariaCdrInspectResult,
} from "@/api/adminSystem";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";
import {
  buildInitialPreviewConfigFromInspect,
  buildInitialPreviewConfigFromVariaveis,
  normalizeInspectCampos,
} from "@/features/papelaria/preview";
import { PAPELARIA_MOCKUP_CONFIGS } from "@/features/papelaria/mockup/papelariaMockupConfigs";

const PRESET_OPTIONS = [
  { id: "folha_a4_simples", label: "Folha simples" },
  { id: "cartao_visita_frente", label: "Cartão simples" },
  { id: "cartao_visita_frente_verso", label: "Cartão frente e verso" },
  { id: "cartao_duplo_retrato_lateral", label: "Cartão dobrado lateral" },
  { id: "folha_simples", label: "Fallback genérico" },
] as const;

const CORES_OPCOES = ["Policromia", "Relevo seco", "Port/Inglês"];

const INSPECT_POLL_MS = 2000;
const INSPECT_TIMEOUT_MS = 120_000;

function isInspectPending(status: PapelariaCdrInspectResult["status"]): boolean {
  return status === "pending" || status === "processing";
}

export function PapelariaNovoModeloForm({
  lockedProduto,
  onCreated,
  onCancel,
}: {
  lockedProduto?: string | null;
  onCreated: (modelo: PapelariaAdminModelRecord) => void;
  onCancel?: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<number | null>(null);

  const [produtoNovo, setProdutoNovo] = useState("");
  const [frenteVerso, setFrenteVerso] = useState("Frente");
  const [cores, setCores] = useState("Policromia");
  const [nomeExibicao, setNomeExibicao] = useState("");
  const [presetId, setPresetId] =
    useState<keyof typeof PAPELARIA_MOCKUP_CONFIGS>("folha_a4_simples");
  const [cdrFile, setCdrFile] = useState<File | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<PapelariaCdrInspectResult | null>(
    null,
  );
  const [inspectLoading, setInspectLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const produtoFinal = (lockedProduto ?? produtoNovo).trim();
  const variaveisDetectadas = inspectResult?.variaveis ?? [];
  const camposDetectados = inspectResult?.campos ?? {};
  const camposNomes = Object.keys(camposDetectados);

  const canSubmit = useMemo(
    () => Boolean(produtoFinal && cdrFile && !inspectLoading),
    [produtoFinal, cdrFile, inspectLoading],
  );

  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  const pollInspect = async (id: string, startedAt: number) => {
    if (Date.now() - startedAt > INSPECT_TIMEOUT_MS) {
      setInspectLoading(false);
      setLocalError(
        "Tempo esgotado aguardando o worker CorelDRAW. Verifique se o worker está em execução.",
      );
      return;
    }

    try {
      const data = await fetchPapelariaCdrInspect(id);
      setInspectResult(data);

      if (data.status === "completed") {
        setInspectLoading(false);
        setLocalError(null);
        return;
      }
      if (data.status === "failed") {
        setInspectLoading(false);
        setLocalError(
          data.erro?.trim() ||
            "Falha ao inspecionar o .cdr no CorelDRAW. Verifique se o worker está ativo.",
        );
        return;
      }

      pollTimerRef.current = window.setTimeout(
        () => void pollInspect(id, startedAt),
        INSPECT_POLL_MS,
      );
    } catch (err) {
      setInspectLoading(false);
      setLocalError(err instanceof Error ? err.message : "Erro ao consultar inspeção.");
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!cdrFile) throw new Error("Selecione um arquivo .cdr.");
      const normalized =
        inspectResult?.status === "completed" && camposNomes.length > 0
          ? normalizeInspectCampos(camposDetectados, variaveisDetectadas)
          : null;
      const variaveis = normalized?.variaveis.length
        ? normalized.variaveis
        : variaveisDetectadas.length > 0
          ? variaveisDetectadas
          : ["nome_deputado", "partido", "uf", "gabinete"];
      const mockupConfig = PAPELARIA_MOCKUP_CONFIGS[presetId];
      const previewConfig =
        normalized && camposNomes.length > 0
          ? buildInitialPreviewConfigFromInspect(normalized.campos, variaveis, {
              frenteVerso,
              habilitarCamposDinamicos: true,
              campoLabels: normalized.campoLabels,
              previewLayout: inspectResult?.preview_layout ?? null,
            })
          : buildInitialPreviewConfigFromVariaveis(variaveis, {
              frenteVerso,
              habilitarCamposDinamicos: true,
            });
      return createPapelariaModeloFromCdr({
        produto: produtoFinal,
        frenteVerso,
        cores,
        nomeExibicao: nomeExibicao.trim() || undefined,
        inspectId: inspectResult?.status === "completed" ? inspectId ?? undefined : undefined,
        mockupConfigJson: JSON.stringify(mockupConfig),
        previewConfigJson: JSON.stringify(previewConfig),
        file: cdrFile,
      });
    },
    onSuccess: (data) => {
      setLocalError(null);
      setCdrFile(null);
      setInspectId(null);
      setInspectResult(null);
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-produtos"] });
      onCreated(data);
    },
    onError: (err: Error) => {
      setLocalError(err.message);
    },
  });

  const handleCdrChange = async (file: File | null) => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    setCdrFile(file);
    setInspectId(null);
    setInspectResult(null);
    setLocalError(null);

    if (!file) {
      setInspectLoading(false);
      return;
    }

    const name = file.name.toLowerCase();
    if (name.includes("fv") || name.includes("frenteverso")) {
      setFrenteVerso("Frente e Verso");
    }

    setInspectLoading(true);
    try {
      const queued = await inspectPapelariaCdr(file);
      setInspectId(queued.inspect_id);
      setInspectResult(queued);
      if (isInspectPending(queued.status)) {
        void pollInspect(queued.inspect_id, Date.now());
      } else if (queued.status === "failed") {
        setInspectLoading(false);
        setLocalError(queued.erro ?? "Falha na inspeção do .cdr.");
      } else {
        setInspectLoading(false);
      }
    } catch (err) {
      setInspectLoading(false);
      setLocalError(
        err instanceof Error
          ? err.message
          : "Não foi possível enfileirar a inspeção do .cdr.",
      );
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">
          {lockedProduto ? "Novo modelo" : "Novo produto"}
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
          Envie o template Corel. O sistema registra o modelo com configurações iniciais de
          mockup e prévia — ajuste-as em seguida nas abas do modelo.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Produto
          {lockedProduto ? (
            <input
              className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-800"
              value={lockedProduto}
              readOnly
            />
          ) : (
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-xs"
              value={produtoNovo}
              onChange={(e) => setProdutoNovo(e.target.value)}
              placeholder="Nome do produto"
            />
          )}
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Frente / Verso
          <select
            className="rounded border border-slate-300 px-2 py-1.5 text-xs"
            value={frenteVerso}
            onChange={(e) => setFrenteVerso(e.target.value)}
          >
            <option value="Frente">Frente</option>
            <option value="Frente e Verso">Frente e Verso</option>
            <option value="Verso">Verso</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Cores
          <select
            className="rounded border border-slate-300 px-2 py-1.5 text-xs"
            value={cores}
            onChange={(e) => setCores(e.target.value)}
          >
            {CORES_OPCOES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Preset mockup inicial
          <select
            className="rounded border border-slate-300 px-2 py-1.5 text-xs"
            value={presetId}
            onChange={(e) =>
              setPresetId(e.target.value as keyof typeof PAPELARIA_MOCKUP_CONFIGS)
            }
          >
            {PRESET_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-600 md:col-span-2">
          Nome de exibição (opcional)
          <input
            className="rounded border border-slate-300 px-2 py-1.5 text-xs"
            value={nomeExibicao}
            onChange={(e) => setNomeExibicao(e.target.value)}
            maxLength={255}
            placeholder="Ex.: Cartão visita clássico — frente e verso"
          />
        </label>

        <div className="flex flex-col gap-1 text-xs text-slate-600 md:col-span-2">
          Arquivo .cdr
          <input
            ref={fileRef}
            type="file"
            accept=".cdr,application/x-coreldraw"
            className="text-xs"
            onChange={(e) => void handleCdrChange(e.target.files?.[0] ?? null)}
          />
          {cdrFile ? (
            <span className="font-mono text-[10px] text-slate-500">{cdrFile.name}</span>
          ) : null}
          {inspectLoading ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-600">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Analisando objetos nomeados no CorelDRAW (worker)...
            </span>
          ) : null}
          {!inspectLoading && inspectResult?.status === "completed" ? (
            <div className="mt-1 space-y-1 rounded border border-emerald-200 bg-emerald-50/60 p-2 text-[10px] text-emerald-900">
              <p>
                <strong>{camposNomes.length}</strong> campo(s) Corel detectado(s)
                {variaveisDetectadas.length > 0
                  ? ` — variáveis: ${variaveisDetectadas.join(", ")}`
                  : ""}
              </p>
              {camposNomes.length > 0 ? (
                <ul className="list-inside list-disc font-mono text-[10px]">
                  {camposNomes.map((nome) => (
                    <li key={nome}>{nome}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-amber-800">
                  Nenhum objeto nomeado com texto encontrado. O modelo será criado com campos
                  padrão.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded bg-secondary-blue px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          disabled={!canSubmit || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <FileUp className="size-3.5" aria-hidden />
          )}
          Criar modelo
        </button>
        {onCancel ? (
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={onCancel}
          >
            Cancelar
          </button>
        ) : null}
      </div>

      {localError ? <p className="text-xs text-red-600">{localError}</p> : null}
    </div>
  );
}
