import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fetchGerenciaSettingsConfig,
  saveGerenciaSettingsConfig,
} from "@/api/adminSystem";

import {
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
} from "./ConfigSectionLayout";

export function GerenciaSettingsSection() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "gerencia-settings"],
    queryFn: fetchGerenciaSettingsConfig,
  });

  const [emailEnabled, setEmailEnabled] = useState(true);

  useEffect(() => {
    if (!query.data) return;
    setEmailEnabled(query.data.os_arquivos_client_email_enabled);
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveGerenciaSettingsConfig({
        os_arquivos_client_email_enabled: emailEnabled,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "gerencia-settings"] });
      void qc.invalidateQueries({ queryKey: ["gerencia", "settings"] });
      window.alert("Configurações de gerência salvas.");
    },
  });

  return (
    <ConfigSection>
      <ConfigSectionHeader
        title="Abertura de OS"
        description="Controle o fluxo de arquivos exibido após salvar uma nova OS (número &lt; 5000)."
        icon={<Briefcase className="size-4" aria-hidden />}
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
            Salvar gerência
          </button>
        }
      />

      <ConfigSectionBody>
      {query.isPending ? (
        <ConfigLoadingState>
          <Loader2 className="size-4 animate-spin" />
          Carregando configurações…
        </ConfigLoadingState>
      ) : (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300"
            checked={emailEnabled}
            onChange={(e) => setEmailEnabled(e.target.checked)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-800">
              Solicitar arquivos ao cliente por e-mail
            </span>
            <span className="mt-0.5 block text-xs text-slate-600">
              Quando habilitado, o modal após salvar a OS oferece enviar e-mail com link do
              portal ou incluir os arquivos diretamente. Quando desabilitado, apenas o envio
              de arquivos fica disponível.
            </span>
          </span>
        </label>
      )}
      </ConfigSectionBody>
    </ConfigSection>
  );
}
