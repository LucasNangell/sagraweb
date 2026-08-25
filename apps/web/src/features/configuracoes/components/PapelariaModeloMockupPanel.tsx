import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { useMemo, useState } from "react";

import {
  savePapelariaAdminMockupConfig,
  validatePapelariaAdminMockupConfig,
} from "@/api/adminSystem";
import { PapelariaProofMockup3D } from "@/features/papelaria/components/PapelariaProofMockup3D";
import {
  formatMockupConfigJson,
  MOCKUP_DEMO_PAGE_URLS,
  PAPELARIA_MOCKUP_CONFIGS,
  parseMockupConfigJson,
  validateMockupConfigObject,
} from "@/features/papelaria/mockup";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

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

export function PapelariaModeloMockupPanel({
  modelo,
}: {
  modelo: PapelariaAdminModelRecord;
}) {
  const qc = useQueryClient();
  const [jsonText, setJsonText] = useState(() =>
    prettyMockupJsonForDisplay(modelo.mockup_config_json),
  );
  const [presetId, setPresetId] =
    useState<keyof typeof PAPELARIA_MOCKUP_CONFIGS>("folha_a4_simples");
  const [localError, setLocalError] = useState<string | null>(null);
  const [validateMsg, setValidateMsg] = useState<string | null>(null);

  const previewConfig = useMemo(() => {
    if (!jsonText.trim()) return null;
    const parsed = parseMockupConfigJson(jsonText);
    return parsed.ok ? parsed.config : null;
  }, [jsonText]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmed = jsonText.trim();
      return savePapelariaAdminMockupConfig(modelo.id, trimmed ? trimmed : null);
    },
    onSuccess: () => {
      setLocalError(null);
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalError(err.message),
  });

  const validateMutation = useMutation({
    mutationFn: () => validatePapelariaAdminMockupConfig(jsonText.trim() || null),
    onSuccess: (data) => setValidateMsg(data.message),
    onError: (err: Error) => setValidateMsg(err.message),
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
      setValidateMsg("Configuração vazia (usará preset automático).");
      return;
    }
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const err = validateMockupConfigObject(parsed);
      setValidateMsg(err ?? "Configuração válida.");
      if (!err) void validateMutation.mutate();
    } catch {
      setValidateMsg("JSON inválido.");
    }
  };

  return (
    <div className="papelaria-admin-three-col min-h-0 flex-1 p-4">
      <div className="papelaria-admin-col gap-2">
        <p className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          MockupConfigJson
        </p>
        <textarea
          className="papelaria-admin-json-editor w-full flex-1 rounded border border-slate-300 p-2 font-mono text-[11px] leading-relaxed"
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder='{"modo":"cartao_dobrado","larguraAbertaMm":210,...}'
          spellCheck={false}
        />
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
            onClick={formatJson}
          >
            Formatar JSON
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
            onClick={validateLocal}
            disabled={validateMutation.isPending}
          >
            Validar configuração
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-60"
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
        {localError ? <p className="text-xs text-red-600">{localError}</p> : null}
        {validateMsg ? (
          <p className="flex items-center gap-1 text-xs text-emerald-700">
            <CheckCircle2 className="size-3.5" aria-hidden />
            {validateMsg}
          </p>
        ) : null}
      </div>

      <div className="papelaria-admin-col gap-3 overflow-y-auto">
        <p className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Preset
        </p>
        <p className="text-[10px] leading-relaxed text-slate-500">
          Vazio = preset automático no runtime. Aplique um preset e salve para gravar no modelo.
        </p>
        <label className="text-xs text-slate-600">
          Preset base
          <select
            className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
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
        <button
          type="button"
          className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
          onClick={applyPreset}
        >
          Aplicar preset
        </button>
        {modelo.tem_mockup_config ? (
          <span className="inline-block w-fit rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800">
            Mockup custom
          </span>
        ) : (
          <span className="inline-block w-fit rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
            Preset automático
          </span>
        )}
      </div>

      <div className="papelaria-admin-col overflow-hidden rounded border border-slate-200">
        <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Pré-visualização 3D
        </p>
        <div className="papelaria-admin-preview-panel">
          {previewConfig ? (
            <PapelariaProofMockup3D pages={MOCKUP_DEMO_PAGE_URLS} config={previewConfig} />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-slate-500">
              {jsonText.trim()
                ? "JSON inválido — corrija para ver a prévia."
                : "Aplique um preset ou edite o JSON para pré-visualizar."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
