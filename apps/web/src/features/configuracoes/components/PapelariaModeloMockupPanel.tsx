import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Braces, CheckCircle2, Loader2, Save, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
  savePapelariaAdminMockupConfig,
  validatePapelariaAdminMockupConfig,
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

import { EmptyState, InlineMessage, PanelCard, StatusPill } from "./PapelariaWorkspaceUi";

function prettyMockupJsonForDisplay(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  try {
    return formatMockupConfigJson(raw);
  } catch {
    return raw;
  }
}

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

type ValidateMsg = { tone: "ok" | "error" | "info"; text: string };

export function PapelariaModeloMockupPanel({
  modelo,
}: {
  modelo: PapelariaAdminModelRecord;
}) {
  const qc = useQueryClient();
  const [jsonText, setJsonText] = useState(() =>
    prettyMockupJsonForDisplay(modelo.mockup_config_json),
  );
  const [savedText, setSavedText] = useState(jsonText);
  const [presetId, setPresetId] =
    useState<keyof typeof PAPELARIA_MOCKUP_CONFIGS>("folha_a4_simples");
  const [localError, setLocalError] = useState<string | null>(null);
  const [validateMsg, setValidateMsg] = useState<ValidateMsg | null>(null);

  const parsed = useMemo(() => (jsonText.trim() ? parseMockupConfigJson(jsonText) : null), [jsonText]);
  const previewConfig = parsed?.ok ? parsed.config : null;
  const dirty = jsonText.trim() !== savedText.trim();

  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmed = jsonText.trim();
      return savePapelariaAdminMockupConfig(modelo.id, trimmed ? trimmed : null);
    },
    onSuccess: () => {
      setLocalError(null);
      setSavedText(jsonText);
      toast.success("Mockup salvo.");
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalError(err.message),
  });

  const validateMutation = useMutation({
    mutationFn: () => validatePapelariaAdminMockupConfig(jsonText.trim() || null),
    onSuccess: (data) => setValidateMsg({ tone: data.valid === false ? "error" : "ok", text: data.message }),
    onError: (err: Error) => setValidateMsg({ tone: "error", text: err.message }),
  });

  const applyPreset = () => {
    const preset = PAPELARIA_MOCKUP_CONFIGS[presetId];
    setJsonText(JSON.stringify(preset, null, 2));
    setLocalError(null);
    setValidateMsg(null);
  };

  const formatJson = () => {
    try {
      setJsonText(formatMockupConfigJson(jsonText));
      setLocalError(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "JSON inválido.");
    }
  };

  const validateLocal = () => {
    if (!jsonText.trim()) {
      setValidateMsg({ tone: "info", text: "Configuração vazia (usará preset automático)." });
      return;
    }
    try {
      const parsedJson = JSON.parse(jsonText) as unknown;
      const err = validateMockupConfigObject(parsedJson);
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
          description="Vazio = preset automático no runtime. Aplique um preset e salve para gravar no modelo."
          actions={
            modelo.tem_mockup_config ? (
              <StatusPill tone="ok">Mockup custom</StatusPill>
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
            <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--sm" onClick={applyPreset}>
              Aplicar preset
            </button>
          </div>
        </PanelCard>

        <PanelCard
          className="pw-card--grow"
          bodyClassName="pw-card__body--grow"
          icon={<Braces className="size-3.5" aria-hidden />}
          title="Configuração (MockupConfigJson)"
          actions={
            <>
              <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--xs" onClick={formatJson}>
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
            aria-label="MockupConfigJson"
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
            {dirty ? "Alterações não salvas" : "Sem alterações pendentes"}
          </span>
          <button
            type="button"
            className="sagra-btn sagra-btn--save sagra-btn--sm"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="size-3.5" aria-hidden />
            )}
            Salvar mockup
          </button>
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
