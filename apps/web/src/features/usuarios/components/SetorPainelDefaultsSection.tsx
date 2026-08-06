import { LayoutGrid, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  fetchSetorPainelDefault,
  saveSetorPainelDefault,
} from "@/api/adminUsers";
import { fetchAndamentos } from "@/api/pcp";
import { useSetoresLookup } from "@/api/hooks/useAuxLookups";
import { DashboardSetorSettingsModal } from "@/features/dashboard-setor/components/DashboardSetorSettingsModal";
import { DEFAULT_DASHBOARD_CONFIG } from "@/features/dashboard-setor/constants";
import { normalizeDashboardConfigFromRemote } from "@/features/dashboard-setor/normalizeConfig";
import type { DashboardConfig } from "@/features/dashboard-setor/types";

interface SetorPainelDefaultsSectionProps {
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function SetorPainelDefaultsSection({
  onSuccess,
  onError,
}: SetorPainelDefaultsSectionProps) {
  const setoresQuery = useSetoresLookup();
  const setoresList = setoresQuery.data ?? [];

  const [setor, setSetor] = useState("SEFOC");
  const [config, setConfig] = useState<DashboardConfig>(() => ({
    ...DEFAULT_DASHBOARD_CONFIG,
    columnCount: DEFAULT_DASHBOARD_CONFIG.columns.length,
  }));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [andamentosList, setAndamentosList] = useState<string[]>([]);

  useEffect(() => {
    void fetchAndamentos()
      .then(setAndamentosList)
      .catch(() => undefined);
  }, []);

  const loadDefault = useCallback(async () => {
    if (!setor) {
      return;
    }
    setLoading(true);
    try {
      const remote = await fetchSetorPainelDefault(setor);
      const normalized = normalizeDashboardConfigFromRemote(remote, setor);
      setConfig(normalized);
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Erro ao carregar padrão do setor.",
      );
    } finally {
      setLoading(false);
    }
  }, [onError, setor]);

  useEffect(() => {
    void loadDefault();
  }, [loadDefault]);

  const handleSave = async (next: DashboardConfig) => {
    setSaving(true);
    try {
      await saveSetorPainelDefault(setor, {
        ...next,
        sector: setor,
        columnCount: next.columns.length,
      });
      setConfig(next);
      setShowModal(false);
      onSuccess(`Padrão do painel salvo para ${setor}.`);
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Erro ao salvar padrão do setor.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-secondary-blue">
        <LayoutGrid className="size-5" aria-hidden />
        Padrão do painel por setor
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Usuários sem configuração salva recebem este layout na primeira abertura do
        painel de setor, conforme o setor cadastrado no usuário.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="setor-painel-default"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Setor
          </label>
          <select
            id="setor-painel-default"
            value={setor}
            onChange={(e) => setSetor(e.target.value)}
            disabled={setoresQuery.isLoading || loading}
            className="min-w-[10rem] rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {setoresList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => setShowModal(true)}
          disabled={loading || saving}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <LayoutGrid className="size-4" aria-hidden />
          )}
          Editar colunas ({config.columns.length})
        </button>

        <button
          type="button"
          onClick={() => void loadDefault()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Recarregar
        </button>
      </div>

      <DashboardSetorSettingsModal
        open={showModal}
        config={config}
        setoresList={setoresList}
        andamentosList={andamentosList}
        onClose={() => setShowModal(false)}
        onSave={(next) => void handleSave(next)}
        onClearCache={() => {
          setConfig({
            ...DEFAULT_DASHBOARD_CONFIG,
            sector: setor,
            columnCount: DEFAULT_DASHBOARD_CONFIG.columns.length,
          });
        }}
      />

      {saving ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Salvando…
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-500">
          <Save className="mr-1 inline size-3" aria-hidden />
          Alterações são gravadas ao confirmar no modal de configuração.
        </p>
      )}
    </section>
  );
}
