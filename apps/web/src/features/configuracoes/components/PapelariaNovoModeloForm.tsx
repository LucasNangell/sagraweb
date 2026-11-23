import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { ArrowLeft, CheckCircle2, FileUp, Loader2, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";

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

import { Field, InlineMessage, normalizeSearch, SegmentedControl } from "./PapelariaWorkspaceUi";

const PRESET_OPTIONS = [
  { id: "folha_a4_simples", label: "Folha simples", hint: "Folha única, sem dobra" },
  { id: "cartao_visita_frente", label: "Cartão simples", hint: "Cartão com uma face" },
  { id: "cartao_visita_frente_verso", label: "Cartão frente e verso", hint: "Cartão que gira para mostrar o verso" },
  { id: "cartao_duplo_retrato_lateral", label: "Cartão dobrado lateral", hint: "Dobra vertical, abre como livro" },
  { id: "folha_simples", label: "Fallback genérico", hint: "Preset neutro para casos não previstos" },
] as const;

const FRENTE_VERSO = ["Frente", "Frente e Verso", "Verso"] as const;
const CORES_OPCOES = ["Policromia", "Relevo seco", "Port/Inglês"];

const INSPECT_POLL_MS = 2000;
const INSPECT_TIMEOUT_MS = 120_000;

function isInspectPending(status: PapelariaCdrInspectResult["status"]): boolean {
  return status === "pending" || status === "processing";
}

export function PapelariaNovoModeloForm({
  lockedProduto,
  produtosExistentes,
  onCreated,
  onCancel,
}: {
  lockedProduto?: string | null;
  /** Nomes já cadastrados — avisa quando o "novo" produto já existe. */
  produtosExistentes?: string[];
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
  const [dragOver, setDragOver] = useState(false);

  const produtoFinal = (lockedProduto ?? produtoNovo).trim();
  const variaveisDetectadas = inspectResult?.variaveis ?? [];
  const camposDetectados = inspectResult?.campos ?? {};
  const camposNomes = Object.keys(camposDetectados);

  const canSubmit = useMemo(
    () => Boolean(produtoFinal && cdrFile && !inspectLoading),
    [produtoFinal, cdrFile, inspectLoading],
  );

  const produtoJaExiste = useMemo(() => {
    if (lockedProduto || !produtoNovo.trim()) return null;
    const alvo = normalizeSearch(produtoNovo);
    return (produtosExistentes ?? []).find((p) => normalizeSearch(p) === alvo) ?? null;
  }, [lockedProduto, produtoNovo, produtosExistentes]);

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
      if (fileRef.current) fileRef.current.value = "";
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

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".cdr")) {
      setLocalError("Envie um arquivo CorelDRAW (.cdr).");
      return;
    }
    void handleCdrChange(file);
  };

  const pendencia = !cdrFile
    ? "Selecione o arquivo .cdr."
    : !produtoFinal
      ? "Informe o nome do produto."
      : inspectLoading
        ? "Aguardando a análise do arquivo…"
        : null;

  return (
    <div className="pw-panel pw-scroll">
      <div className="pw-form">
        <div className="pw-form__header">
          {onCancel ? (
            <button
              type="button"
              className="pw-icon-btn"
              aria-label="Voltar"
              title="Voltar"
              onClick={onCancel}
            >
              <ArrowLeft className="size-4" aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800">
              {lockedProduto ? `Novo modelo em ${lockedProduto}` : "Novo produto"}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Envie o template CorelDRAW. O modelo é criado com mockup e prévia iniciais, que você
              ajusta em seguida.
            </p>
          </div>
        </div>

        {/* 1. Arquivo */}
        <fieldset className="pw-step">
          <legend className="pw-step__legend">
            <span className="pw-step__num">1</span> Arquivo Corel (.cdr)
          </legend>
          <input
            ref={fileRef}
            type="file"
            accept=".cdr,application/x-coreldraw"
            className="hidden"
            onChange={(e) => void handleCdrChange(e.target.files?.[0] ?? null)}
          />
          {cdrFile ? (
            <div className="pw-file-row">
              {inspectLoading ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-secondary-blue" aria-hidden />
              ) : inspectResult?.status === "completed" ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <FileUp className="size-4 shrink-0 text-slate-400" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] font-medium text-slate-800">{cdrFile.name}</p>
                <p className="text-[10px] text-slate-500">
                  {inspectLoading
                    ? "Analisando objetos nomeados no CorelDRAW (worker)…"
                    : inspectResult?.status === "completed"
                      ? `${camposNomes.length} campo(s) Corel detectado(s)`
                      : `${(cdrFile.size / 1024).toFixed(0)} KB`}
                </p>
              </div>
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--xs"
                onClick={() => fileRef.current?.click()}
              >
                Trocar
              </button>
              <button
                type="button"
                className="pw-icon-btn"
                aria-label="Remover arquivo"
                title="Remover arquivo"
                onClick={() => void handleCdrChange(null)}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              className={cn("pw-dropzone", dragOver && "is-over")}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <UploadCloud className="size-6 text-slate-400" aria-hidden />
              <p className="text-xs font-semibold text-slate-700">
                Arraste o .cdr aqui ou <span className="text-secondary-blue underline">escolha o arquivo</span>
              </p>
              <p className="text-[10px] text-slate-500">
                O worker CorelDRAW lê os objetos nomeados para montar os campos da prévia.
              </p>
            </div>
          )}

          {!inspectLoading && inspectResult?.status === "completed" ? (
            camposNomes.length > 0 ? (
              <div className="pw-detected">
                <p className="text-[11px] font-semibold text-emerald-900">
                  {camposNomes.length} campo(s) detectado(s)
                  {variaveisDetectadas.length > 0 ? ` · variáveis: ${variaveisDetectadas.join(", ")}` : ""}
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {camposNomes.map((nome) => (
                    <li key={nome} className="pw-chip font-mono">
                      {nome}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <InlineMessage tone="warn" className="mt-2">
                Nenhum objeto nomeado com texto encontrado. O modelo será criado com campos padrão.
              </InlineMessage>
            )
          ) : null}
        </fieldset>

        {/* 2. Identificação */}
        <fieldset className="pw-step">
          <legend className="pw-step__legend">
            <span className="pw-step__num">2</span> Identificação
          </legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Produto" htmlFor="pw-novo-produto">
              {lockedProduto ? (
                <input id="pw-novo-produto" className="pw-input" value={lockedProduto} readOnly />
              ) : (
                <input
                  id="pw-novo-produto"
                  className="pw-input"
                  value={produtoNovo}
                  onChange={(e) => setProdutoNovo(e.target.value)}
                  placeholder="Ex.: Cartão de visita"
                  autoComplete="off"
                />
              )}
            </Field>
            <Field label="Nome de exibição (opcional)" htmlFor="pw-novo-nome">
              <input
                id="pw-novo-nome"
                className="pw-input"
                value={nomeExibicao}
                onChange={(e) => setNomeExibicao(e.target.value)}
                maxLength={255}
                placeholder="Ex.: Cartão visita clássico — frente e verso"
              />
            </Field>
            <Field label="Frente / verso">
              <SegmentedControl
                ariaLabel="Frente / verso"
                size="sm"
                value={frenteVerso as (typeof FRENTE_VERSO)[number]}
                onChange={setFrenteVerso}
                options={FRENTE_VERSO.map((v) => ({ id: v, label: v }))}
              />
            </Field>
            <Field label="Cores">
              <SegmentedControl
                ariaLabel="Cores"
                size="sm"
                value={cores}
                onChange={setCores}
                options={CORES_OPCOES.map((c) => ({ id: c, label: c }))}
              />
            </Field>
          </div>
          {produtoJaExiste ? (
            <InlineMessage tone="info" className="mt-2">
              Já existe o produto “{produtoJaExiste}”. O modelo será criado como nova variação dele se
              o nome for idêntico.
            </InlineMessage>
          ) : null}
        </fieldset>

        {/* 3. Mockup */}
        <fieldset className="pw-step">
          <legend className="pw-step__legend">
            <span className="pw-step__num">3</span> Mockup 3D inicial
          </legend>
          <div className="pw-preset-grid" role="radiogroup" aria-label="Preset de mockup inicial">
            {PRESET_OPTIONS.map((p) => {
              const active = presetId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={cn("pw-preset", active && "is-active")}
                  onClick={() => setPresetId(p.id)}
                >
                  <span className="pw-preset__label">{p.label}</span>
                  <span className="pw-preset__hint">{p.hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {localError ? <InlineMessage tone="error">{localError}</InlineMessage> : null}

        <div className="pw-form__footer">
          <span className="text-[11px] text-slate-500">{pendencia ?? "Tudo pronto para criar o modelo."}</span>
          <div className="flex flex-wrap gap-2">
            {onCancel ? (
              <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--sm" onClick={onCancel}>
                Cancelar
              </button>
            ) : null}
            <button
              type="button"
              className="sagra-btn sagra-btn--add sagra-btn--sm"
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
          </div>
        </div>
      </div>
    </div>
  );
}
