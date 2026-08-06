import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  fetchPreAnaliseChecksConfig,
  savePreAnaliseChecksConfig,
} from "@/api/adminSystem";

import {
  ConfigErrorState,
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
} from "./ConfigSectionLayout";

export function PreAnaliseChecksSection() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "pre-analise-checks"],
    queryFn: fetchPreAnaliseChecksConfig,
  });

  const [disabled, setDisabled] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!query.data) return;
    const next = new Set(
      query.data.filter((c) => !c.enabled).map((c) => c.id),
    );
    setDisabled(next);
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: () => savePreAnaliseChecksConfig(Array.from(disabled)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "pre-analise-checks"] });
      window.alert("Scripts de pré-análise salvos.");
    },
  });

  const sortedChecks = useMemo(
    () => (query.data ?? []).slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [query.data],
  );

  const toggle = (id: string) => {
    setDisabled((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <ConfigSection>
      <ConfigSectionHeader
        title="Scripts de pré-análise"
        description="Marque para habilitar cada verificação automática de PDF na análise."
        icon={<ClipboardList className="size-4" aria-hidden />}
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
            Salvar scripts
          </button>
        }
      />

      <ConfigSectionBody>
      {query.isPending ? (
        <ConfigLoadingState>
          <Loader2 className="size-4 animate-spin" />
          Carregando verificações…
        </ConfigLoadingState>
      ) : null}

      {query.isError ? (
        <ConfigErrorState>
          {query.error instanceof Error
            ? query.error.message
            : "Erro ao carregar scripts."}
        </ConfigErrorState>
      ) : null}

      {!query.isPending && !query.isError ? (
        <div className="configuracoes-checks-scroll space-y-2 pr-1">
          {sortedChecks.map((check) => {
            const enabled = !disabled.has(check.id);
            return (
              <label
                key={check.id}
                className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50/80"
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggle(check.id)}
                  className="mt-0.5 accent-primary-green"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800">
                    {check.nome}
                  </span>
                  <span className="block text-xs text-slate-500">{check.descricao}</span>
                  <span className="mt-0.5 block font-mono text-[10px] text-slate-400">
                    {check.id}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
      </ConfigSectionBody>
    </ConfigSection>
  );
}
