import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fetchDevFeaturesConfig,
  saveDevFeaturesConfig,
} from "@/api/adminSystem";
import { queryKeys } from "@/api/query-keys";

import {
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
} from "./ConfigSectionLayout";

export function DesenvolvimentoSettingsSection() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "dev-features"],
    queryFn: fetchDevFeaturesConfig,
  });

  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!query.data) return;
    setEnabledMap({ ...query.data.enabled });
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: () => saveDevFeaturesConfig({ enabled: enabledMap }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "dev-features"] });
      void qc.invalidateQueries({ queryKey: queryKeys.devFeatures.all });
      window.alert("Flags de desenvolvimento salvas.");
    },
  });

  const features = query.data?.features ?? [];

  return (
    <ConfigSection>
      <ConfigSectionHeader
        title="Ferramentas em desenvolvimento"
        description="Habilite ou oculte recursos ainda em desenvolvimento para os usuários do sistema."
        icon={<FlaskConical className="size-4" aria-hidden />}
        actions={
          <button
            type="button"
            disabled={saveMutation.isPending || query.isPending}
            onClick={() => void saveMutation.mutate()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-green px-3 text-xs font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
          >
            {saveMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Salvar desenvolvimento
          </button>
        }
      />

      <ConfigSectionBody>
        {query.isPending ? (
          <ConfigLoadingState>
            <Loader2 className="size-4 animate-spin" />
            Carregando flags…
          </ConfigLoadingState>
        ) : features.length === 0 ? (
          <p className="text-xs text-slate-600">Nenhuma flag cadastrada.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {features.map((feature) => (
              <li key={feature.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 rounded border-slate-300"
                    checked={Boolean(enabledMap[feature.id])}
                    onChange={(e) =>
                      setEnabledMap((prev) => ({
                        ...prev,
                        [feature.id]: e.target.checked,
                      }))
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800">
                      {feature.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-600">
                      {feature.description}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </ConfigSectionBody>
    </ConfigSection>
  );
}
