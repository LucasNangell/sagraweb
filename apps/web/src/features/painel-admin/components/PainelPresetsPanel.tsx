import { Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  createPainelPreset,
  deletePainelPreset,
  fetchPainelPresets,
  type PainelCardPreset,
} from "@/api/painelRemote";
import type { DashboardConfig } from "@/features/dashboard-setor/types";
import { applyPresetPayload } from "@/features/painel-admin/presetPayload";

export function PainelPresetsPanel({
  config,
  onApply,
}: {
  config: DashboardConfig;
  onApply: (next: DashboardConfig) => void;
}) {
  const [presets, setPresets] = useState<PainelCardPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);

  const refreshPresets = () => {
    void fetchPainelPresets()
      .then((data) => setPresets(data.presets))
      .catch((err) => {
        setPresetError(
          err instanceof Error ? err.message : "Falha ao listar presets.",
        );
      });
  };

  useEffect(() => {
    refreshPresets();
  }, []);

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) {
      setPresetError("Informe um nome para o preset.");
      return;
    }
    setPresetError(null);
    try {
      await createPainelPreset(name, config);
      setPresetName("");
      refreshPresets();
    } catch (err) {
      setPresetError(
        err instanceof Error ? err.message : "Falha ao salvar o preset.",
      );
    }
  };

  const applyPreset = (preset: PainelCardPreset) => {
    onApply(applyPresetPayload(config, preset.payload));
  };

  const removePreset = async (preset: PainelCardPreset) => {
    if (!window.confirm(`Excluir o preset “${preset.nome}”?`)) {
      return;
    }
    try {
      await deletePainelPreset(preset.id);
      refreshPresets();
    } catch (err) {
      setPresetError(
        err instanceof Error ? err.message : "Falha ao excluir o preset.",
      );
    }
  };

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <h4 className="text-xs font-semibold text-slate-800">Presets</h4>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Grava todas as abas (geral, colunas, visual, animação e fonte).
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Nome do preset"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
        />
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          onClick={() => void savePreset()}
        >
          <Save className="size-3.5" />
          Salvar preset
        </button>
      </div>
      {presetError ? (
        <p className="mt-2 text-xs text-red-700">{presetError}</p>
      ) : null}
      {presets.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">Nenhum preset salvo.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {presets.map((preset) => (
            <li
              key={preset.id}
              className="flex items-center justify-between gap-2 py-1.5"
            >
              <span className="text-sm text-slate-800">{preset.nome}</span>
              <span className="flex gap-1">
                <button
                  type="button"
                  className="rounded px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-50"
                  onClick={() => applyPreset(preset)}
                >
                  Aplicar
                </button>
                <button
                  type="button"
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50"
                  onClick={() => void removePreset(preset)}
                  aria-label={`Excluir ${preset.nome}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
