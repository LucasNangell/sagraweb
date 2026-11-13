import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Eraser, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  fetchPapelariaProdutoImposicaoConfigs,
  savePapelariaAdminImposicaoConfig,
  savePapelariaProdutoImposicaoConfig,
} from "@/api/adminSystem";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";
import {
  cloneDefaultImposicaoConfig,
  formatImposicaoConfigJson,
  formatImposicaoVariantsJson,
  ImposicaoConfigEditor,
  type PapelariaImposicaoConfig,
  type PapelariaImposicaoVariante,
  type PapelariaImposicaoVariants,
  validateImposicaoConfigObject,
  variantsFromModeloOrEmpty,
} from "@/features/papelaria/imposicao";

const VARIANTES: { id: PapelariaImposicaoVariante; label: string }[] = [
  { id: "digital", label: "Digital" },
  { id: "offset", label: "Offset" },
];

function VariantTabs({
  value,
  onChange,
}: {
  value: PapelariaImposicaoVariante;
  onChange: (v: PapelariaImposicaoVariante) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {VARIANTES.map((v) => (
        <button
          key={v.id}
          type="button"
          className={cn(
            "rounded-md px-3 py-1 text-xs font-semibold",
            value === v.id
              ? "bg-white text-secondary-blue shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
          onClick={() => onChange(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

export function PapelariaModeloImposicaoPanel({
  modelo,
}: {
  modelo: PapelariaAdminModelRecord;
}) {
  const qc = useQueryClient();
  const produto = (modelo.produto || "").trim();
  const [produtoTab, setProdutoTab] =
    useState<PapelariaImposicaoVariante>("digital");
  const [modeloTab, setModeloTab] =
    useState<PapelariaImposicaoVariante>("digital");
  const [produtoConfigs, setProdutoConfigs] = useState<
    Record<PapelariaImposicaoVariante, PapelariaImposicaoConfig | null>
  >({ digital: null, offset: null });
  const [modeloVariants, setModeloVariants] = useState<PapelariaImposicaoVariants>(
    () => variantsFromModeloOrEmpty(modelo.imposicao_config_json),
  );
  const [localMsg, setLocalMsg] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const produtoQuery = useQuery({
    queryKey: ["admin", "papelaria-produto-imposicao", produto],
    queryFn: () => fetchPapelariaProdutoImposicaoConfigs(produto),
    enabled: Boolean(produto),
  });

  useEffect(() => {
    setModeloVariants(variantsFromModeloOrEmpty(modelo.imposicao_config_json));
  }, [modelo.id, modelo.imposicao_config_json]);

  useEffect(() => {
    const mapa = produtoQuery.data?.mapa;
    if (!mapa) return;
    const next: Record<PapelariaImposicaoVariante, PapelariaImposicaoConfig | null> = {
      digital: null,
      offset: null,
    };
    for (const key of ["digital", "offset"] as const) {
      const raw = mapa[key];
      if (!raw) continue;
      try {
        next[key] = validateImposicaoConfigObject(raw);
      } catch {
        next[key] = null;
      }
    }
    setProdutoConfigs(next);
  }, [produtoQuery.data]);

  const modeloSnapshot = useMemo(
    () => formatImposicaoVariantsJson(modeloVariants) ?? "",
    [modeloVariants],
  );
  const savedModeloSnapshot = useMemo(() => {
    try {
      return formatImposicaoVariantsJson(
        variantsFromModeloOrEmpty(modelo.imposicao_config_json),
      ) ?? "";
    } catch {
      return "";
    }
  }, [modelo.imposicao_config_json]);
  const modeloDirty = modeloSnapshot !== savedModeloSnapshot;

  const produtoConfig = produtoConfigs[produtoTab];
  const modeloConfig = modeloVariants[modeloTab];

  const saveProdutoMutation = useMutation({
    mutationFn: async (payload: {
      variante: PapelariaImposicaoVariante;
      config: PapelariaImposicaoConfig | null;
    }) =>
      savePapelariaProdutoImposicaoConfig({
        produto,
        variante: payload.variante,
        imposicao_config_json: payload.config
          ? formatImposicaoConfigJson(
              validateImposicaoConfigObject(payload.config),
            )
          : null,
      }),
    onSuccess: (_data, vars) => {
      setLocalError(null);
      setLocalMsg(
        vars.config
          ? `Padrão ${vars.variante} do produto salvo.`
          : `Padrão ${vars.variante} removido.`,
      );
      void qc.invalidateQueries({
        queryKey: ["admin", "papelaria-produto-imposicao", produto],
      });
    },
    onError: (err: Error) => setLocalError(err.message),
  });

  const saveModeloMutation = useMutation({
    mutationFn: (variants: PapelariaImposicaoVariants) =>
      savePapelariaAdminImposicaoConfig(
        modelo.id,
        formatImposicaoVariantsJson(variants),
      ),
    onSuccess: (data) => {
      setLocalError(null);
      setLocalMsg(
        data.imposicao_config_json
          ? "Override do modelo salvo."
          : "Override do modelo removido (usa padrão do produto).",
      );
      setModeloVariants(variantsFromModeloOrEmpty(data.imposicao_config_json));
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalError(err.message),
  });

  const busy =
    saveProdutoMutation.isPending ||
    saveModeloMutation.isPending ||
    produtoQuery.isLoading;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
      <p className="max-w-3xl text-[11px] text-slate-500">
        O padrão do <strong>produto</strong> vale para todos os modelos. Neste
        modelo você pode sobrescrever Digital e/ou Offset. Na OS, se houver mais
        de uma opção, o operador escolhe a aba no modal.
      </p>

      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-slate-800">
              Padrão do produto — {produto || "—"}
            </h3>
            <p className="text-[10px] text-slate-500">
              Digital e Offset independentes.
            </p>
          </div>
          <VariantTabs value={produtoTab} onChange={setProdutoTab} />
        </div>
        {produtoConfig ? (
          <ImposicaoConfigEditor
            config={produtoConfig}
            onChange={(next) =>
              setProdutoConfigs((prev) => ({ ...prev, [produtoTab]: next }))
            }
          />
        ) : (
          <p className="mb-3 text-[11px] text-amber-700">
            Sem padrão {produtoTab} neste produto.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            disabled={!produto || busy}
            onClick={() => {
              const cfg =
                produtoConfigs[produtoTab] ?? cloneDefaultImposicaoConfig();
              setProdutoConfigs((prev) => ({ ...prev, [produtoTab]: cfg }));
              saveProdutoMutation.mutate({
                variante: produtoTab,
                config: cfg,
              });
            }}
          >
            {saveProdutoMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="size-3.5" aria-hidden />
            )}
            Salvar padrão {produtoTab}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            disabled={!produto || busy}
            onClick={() =>
              setProdutoConfigs((prev) => ({
                ...prev,
                [produtoTab]: cloneDefaultImposicaoConfig(),
              }))
            }
          >
            Exemplo A5 2×1
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-60"
            disabled={!produto || busy || !produtoConfigs[produtoTab]}
            onClick={() => {
              setProdutoConfigs((prev) => ({ ...prev, [produtoTab]: null }));
              saveProdutoMutation.mutate({
                variante: produtoTab,
                config: null,
              });
            }}
          >
            <Eraser className="size-3.5" aria-hidden />
            Remover {produtoTab}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-violet-950">
              Override deste modelo
            </h3>
            <p className="text-[10px] text-violet-800/80">
              Opcional. Em branco = usa o padrão do produto na variante.
            </p>
          </div>
          <VariantTabs value={modeloTab} onChange={setModeloTab} />
        </div>
        <label className="mb-3 inline-flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            className="size-3.5"
            checked={modeloConfig != null}
            onChange={(e) => {
              setModeloVariants((prev) => ({
                ...prev,
                [modeloTab]: e.target.checked
                  ? produtoConfigs[modeloTab] ?? cloneDefaultImposicaoConfig()
                  : null,
              }));
            }}
          />
          Sobrescrever {modeloTab} neste modelo
        </label>
        {modeloConfig ? (
          <ImposicaoConfigEditor
            config={modeloConfig}
            onChange={(next) =>
              setModeloVariants((prev) => ({ ...prev, [modeloTab]: next }))
            }
          />
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-semibold",
              modeloDirty
                ? "bg-secondary-blue text-white"
                : "border border-slate-300 text-slate-500",
            )}
            disabled={!modeloDirty || busy}
            onClick={() => saveModeloMutation.mutate(modeloVariants)}
          >
            {saveModeloMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="size-3.5" aria-hidden />
            )}
            Salvar override do modelo
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-60"
            disabled={busy || (!modeloVariants.digital && !modeloVariants.offset)}
            onClick={() => {
              const empty = { digital: null, offset: null };
              setModeloVariants(empty);
              saveModeloMutation.mutate(empty);
            }}
          >
            <Eraser className="size-3.5" aria-hidden />
            Limpar overrides
          </button>
        </div>
      </section>

      {localError ? <p className="text-xs text-red-600">{localError}</p> : null}
      {!localError && localMsg ? (
        <p className="text-xs text-emerald-700">{localMsg}</p>
      ) : null}
    </div>
  );
}
