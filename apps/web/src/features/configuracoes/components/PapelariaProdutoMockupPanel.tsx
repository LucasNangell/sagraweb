import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Braces, CheckCircle2, Copy, Loader2, Save, Trash2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
  fetchPapelariaProdutoMockup,
  savePapelariaProdutoMockup,
  validatePapelariaAdminMockupConfig,
  type PapelariaMockupHerdado,
} from "@/api/adminSystem";
import { toast } from "@/components/ui/toastStore";
import { PapelariaProofMockup3D } from "@/features/papelaria/components/PapelariaProofMockup3D";
import {
  formatMockupConfigJson,
  MOCKUP_DEMO_PAGE_URLS,
  PAPELARIA_MOCKUP_CONFIGS,
  parseMockupConfigJson,
  validateMockupConfigObject,
} from "@/features/papelaria/mockup";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

import { EmptyState, InlineMessage, PanelCard, SegmentedControl, StatusPill } from "./PapelariaWorkspaceUi";

type Variante = "frente" | "frente_verso";

const PRESET_OPTIONS: { id: keyof typeof PAPELARIA_MOCKUP_CONFIGS; label: string }[] = [
  { id: "folha_a4_simples", label: "Folha simples" },
  { id: "cartao_visita_frente", label: "Cartão simples" },
  { id: "cartao_visita_frente_verso", label: "Cartão frente e verso" },
  { id: "cartao_duplo_retrato_lateral", label: "Cartão dobrado lateral" },
  { id: "cartao_duplo_paisagem_topo", label: "Cartão dobrado topo" },
  { id: "pasta_com_bolso", label: "Pasta" },
  { id: "bloco_a5", label: "Bloco" },
  { id: "folha_simples", label: "Fallback genérico" },
];

function pretty(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  try {
    return formatMockupConfigJson(raw);
  } catch {
    return raw;
  }
}

type ValidateMsg = { tone: "ok" | "error" | "info"; text: string };

/**
 * Mockup 3D do PRODUTO: uma configuração para «Só frente» e outra para
 * «Frente e verso». Vale para todos os modelos do produto (a prova escolhe a
 * variação pelo número de páginas).
 */
export function PapelariaProdutoMockupPanel({
  produto,
  modelos,
}: {
  produto: string;
  modelos: PapelariaAdminModelRecord[];
}) {
  const query = useQuery({
    queryKey: ["admin", "papelaria-produto-mockup", produto],
    queryFn: () => fetchPapelariaProdutoMockup(produto),
  });
  const temVerso = modelos.some((m) => (m.frente_versao ?? "").toLowerCase().includes("verso"));
  const [variante, setVariante] = useState<Variante>("frente");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="pw-fonte-bar">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-800">
            Mockup 3D do produto
            {query.isPending ? <Loader2 className="size-3.5 animate-spin text-slate-400" aria-hidden /> : null}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Vale para todos os modelos de {produto}. A prova usa «Só frente» quando tem 1 página e «Frente e
            verso» quando tem 2.
          </p>
        </div>
        <SegmentedControl<Variante>
          ariaLabel="Variação do mockup"
          size="sm"
          value={variante}
          onChange={setVariante}
          options={[
            {
              id: "frente",
              label: (
                <>
                  Só frente{query.data?.salvo?.frente ? " ✓" : query.data?.herdado?.frente ? " ↺" : ""}
                </>
              ),
            },
            {
              id: "frente_verso",
              label: (
                <>
                  Frente e verso{query.data?.salvo?.frente_verso ? " ✓" : query.data?.herdado?.frente_verso ? " ↺" : ""}
                </>
              ),
              title: temVerso ? undefined : "Este produto ainda não tem versos cadastrados",
            },
          ]}
        />
      </div>
      {query.isPending ? (
        <EmptyState icon={<Loader2 className="size-6 animate-spin" />} title="Carregando mockup do produto…" />
      ) : query.isError ? (
        <div className="p-4">
          <InlineMessage tone="error">{(query.error as Error).message || "Erro ao carregar o mockup."}</InlineMessage>
        </div>
      ) : (
        <MockupEditor
          key={`${produto}:${variante}`}
          produto={produto}
          variante={variante}
          salvo={query.data?.[variante] ?? null}
          salvoNoProduto={Boolean(query.data?.salvo?.[variante])}
          herdado={query.data?.herdado?.[variante] ?? null}
          modelos={modelos}
        />
      )}
    </div>
  );
}

function MockupEditor({
  produto,
  variante,
  salvo,
  salvoNoProduto = true,
  herdado = null,
  modelos,
}: {
  produto: string;
  variante: Variante;
  /** Configuração em vigor (salva no produto ou herdada dos modelos). */
  salvo: string | null;
  salvoNoProduto?: boolean;
  herdado?: PapelariaMockupHerdado;
  modelos: PapelariaAdminModelRecord[];
}) {
  const qc = useQueryClient();
  const [jsonText, setJsonText] = useState(() => pretty(salvo));
  // Herdada ainda não está gravada no produto: salvar fixa.
  const [savedText, setSavedText] = useState(() => (salvoNoProduto ? pretty(salvo) : ""));
  const [herdadoAtivo, setHerdadoAtivo] = useState(Boolean(herdado) && !salvoNoProduto);
  const textoHerdado = herdado ? pretty(salvo) : "";
  const [presetId, setPresetId] = useState<keyof typeof PAPELARIA_MOCKUP_CONFIGS>(
    variante === "frente_verso" ? "cartao_visita_frente_verso" : "folha_a4_simples",
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [validateMsg, setValidateMsg] = useState<ValidateMsg | null>(null);

  const parsed = useMemo(() => (jsonText.trim() ? parseMockupConfigJson(jsonText) : null), [jsonText]);
  const previewConfig = parsed?.ok ? parsed.config : null;
  const dirty = jsonText.trim() !== savedText.trim();
  const herdadoIntacto = herdadoAtivo && jsonText.trim() === textoHerdado.trim();

  // Mockups antigos configurados por modelo, para migrar para o produto.
  const legados = useMemo(
    () =>
      modelos.filter((m) => {
        const fv = (m.frente_versao ?? "").toLowerCase();
        const ehFv = fv.includes("frente") && fv.includes("verso");
        return Boolean(m.mockup_config_json_modelo?.trim()) && ehFv === (variante === "frente_verso");
      }),
    [modelos, variante],
  );

  const saveMutation = useMutation({
    mutationFn: (texto: string | null) => savePapelariaProdutoMockup(produto, variante, texto),
    onSuccess: (data) => {
      setLocalError(null);
      const novo = pretty(data[variante]);
      setJsonText(novo);
      setSavedText(data.salvo?.[variante] === false ? "" : novo);
      setHerdadoAtivo(Boolean(data.herdado?.[variante]) && !data.salvo?.[variante]);
      toast.success(
        data[variante]
          ? `Mockup «${variante === "frente" ? "Só frente" : "Frente e verso"}» de ${produto} salvo.`
          : "Mockup removido — o produto volta ao preset automático.",
      );
      qc.setQueryData(["admin", "papelaria-produto-mockup", produto], data);
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
      void qc.invalidateQueries({ queryKey: ["papelaria", "corelModelo"] });
    },
    onError: (err: Error) => setLocalError(err.message),
  });

  const validateMutation = useMutation({
    mutationFn: () => validatePapelariaAdminMockupConfig(jsonText.trim() || null),
    onSuccess: (data) => setValidateMsg({ tone: data.valid === false ? "error" : "ok", text: data.message }),
    onError: (err: Error) => setValidateMsg({ tone: "error", text: err.message }),
  });

  const aplicar = (texto: string) => {
    setJsonText(pretty(texto));
    setLocalError(null);
    setValidateMsg(null);
  };

  const validateLocal = () => {
    if (!jsonText.trim()) {
      setValidateMsg({ tone: "info", text: "Configuração vazia (usará preset automático)." });
      return;
    }
    try {
      const err = validateMockupConfigObject(JSON.parse(jsonText) as unknown);
      setValidateMsg(err ? { tone: "error", text: err } : { tone: "ok", text: "Configuração válida." });
      if (!err) void validateMutation.mutate();
    } catch {
      setValidateMsg({ tone: "error", text: "JSON inválido." });
    }
  };

  return (
    <div className="pw-split">
      <div className="pw-split__editor pw-scroll">
        <PanelCard
          icon={<Wand2 className="size-3.5" aria-hidden />}
          title="Ponto de partida"
          description="Aplique um preset (ou copie o mockup antigo de um modelo) e salve para gravar no produto."
          actions={
            savedText.trim() ? (
              <StatusPill tone="ok">Configurado no produto</StatusPill>
            ) : herdadoAtivo && herdado ? (
              <StatusPill
                tone="warn"
                title="Configuração antiga do modelo, usada enquanto o produto não tem a sua. Salve para fixar no produto."
              >
                Herdado de {herdado.arquivo || `modelo ${herdado.modelo_id}`}
                {herdado.ativo ? "" : " (modelo excluído)"}
              </StatusPill>
            ) : (
              <StatusPill tone="muted">Preset automático</StatusPill>
            )
          }
        >
          <div className="pw-input-group">
            <select
              aria-label="Preset base"
              className="pw-input"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value as keyof typeof PAPELARIA_MOCKUP_CONFIGS)}
            >
              {PRESET_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="sagra-btn sagra-btn--outline sagra-btn--sm"
              onClick={() => aplicar(JSON.stringify(PAPELARIA_MOCKUP_CONFIGS[presetId], null, 2))}
            >
              Aplicar preset
            </button>
          </div>
          {legados.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-500">Copiar mockup antigo de:</span>
              {legados.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="pw-chip pw-chip--action"
                  onClick={() => aplicar(m.mockup_config_json_modelo ?? "")}
                  title={m.arquivo_modelo}
                >
                  <Copy className="size-3" aria-hidden /> {m.nome_exibicao || m.arquivo_modelo}
                </button>
              ))}
            </div>
          ) : null}
        </PanelCard>

        <PanelCard
          className="pw-card--grow"
          bodyClassName="pw-card__body--grow"
          icon={<Braces className="size-3.5" aria-hidden />}
          title="Configuração (MockupConfigJson)"
          actions={
            <>
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--xs"
                onClick={() => {
                  try {
                    setJsonText(formatMockupConfigJson(jsonText));
                    setLocalError(null);
                  } catch (err) {
                    setLocalError(err instanceof Error ? err.message : "JSON inválido.");
                  }
                }}
              >
                Formatar
              </button>
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--xs"
                onClick={validateLocal}
                disabled={validateMutation.isPending}
              >
                {validateMutation.isPending ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-3" aria-hidden />
                )}
                Validar
              </button>
            </>
          }
        >
          <textarea
            aria-label="MockupConfigJson do produto"
            className="pw-code"
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setValidateMsg(null);
            }}
            placeholder='{"modo":"cartao_dobrado","larguraAbertaMm":210,...}'
            spellCheck={false}
          />
          {parsed && !parsed.ok ? (
            <InlineMessage tone="warn" className="mt-2">
              JSON com erro de sintaxe — corrija para atualizar a prévia.
            </InlineMessage>
          ) : null}
          {validateMsg ? (
            <InlineMessage tone={validateMsg.tone} className="mt-2">
              {validateMsg.text}
            </InlineMessage>
          ) : null}
          {localError ? <InlineMessage tone="error" className="mt-2">{localError}</InlineMessage> : null}
        </PanelCard>

        <div className="pw-savebar">
          <span className={dirty ? "pw-savebar__dirty" : "pw-savebar__clean"}>
            {herdadoIntacto
              ? "Em uso a configuração herdada do modelo — salve para fixar no produto"
              : dirty
                ? "Alterações não salvas"
                : "Sem alterações pendentes"}
          </span>
          <div className="flex flex-wrap gap-2">
            {savedText.trim() ? (
              <button
                type="button"
                className="sagra-btn sagra-btn--delete-outline sagra-btn--sm"
                disabled={saveMutation.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Remover o mockup desta variação do produto? Volta a valer o mockup antigo dos modelos (se houver) ou o preset automático.",
                    )
                  ) {
                    saveMutation.mutate(null);
                  }
                }}
              >
                <Trash2 className="size-3.5" aria-hidden /> Remover
              </button>
            ) : null}
            <button
              type="button"
              className="sagra-btn sagra-btn--save sagra-btn--sm"
              disabled={saveMutation.isPending || !jsonText.trim()}
              onClick={() => saveMutation.mutate(jsonText.trim())}
            >
              {saveMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Save className="size-3.5" aria-hidden />
              )}
              Salvar no produto
            </button>
          </div>
        </div>
      </div>

      <div className="pw-split__preview">
        <div className="pw-preview-card">
          <p className="pw-preview-card__title">
            <Box className="size-3.5" aria-hidden /> Pré-visualização 3D
          </p>
          <div className="pw-preview-card__stage">
            {previewConfig ? (
              <PapelariaProofMockup3D pages={MOCKUP_DEMO_PAGE_URLS} config={previewConfig} />
            ) : (
              <EmptyState icon={<Box className="size-6" />} title="Sem pré-visualização">
                {jsonText.trim()
                  ? "JSON inválido — corrija para ver a prévia."
                  : "Aplique um preset ou edite o JSON para pré-visualizar."}
              </EmptyState>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
