import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { CheckCircle2, Eraser, Loader2, Save } from "lucide-react";
import { useMemo, useState } from "react";

import {
  savePapelariaAdminImposicaoConfig,
  validatePapelariaAdminImposicaoConfig,
} from "@/api/adminSystem";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";
import {
  cloneDefaultImposicaoConfig,
  configFromModeloOrDefault,
  formatImposicaoConfigJson,
  parseImposicaoConfigJson,
  type PapelariaImposicaoConfig,
  type PapelariaImposicaoPaginaOrigem,
  validateImposicaoConfigObject,
} from "@/features/papelaria/imposicao";

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      <input
        type="number"
        className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-800"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <span className="text-[10px] text-slate-400">{hint}</span> : null}
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-xs text-slate-700">
      <span className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          className="size-3.5 rounded border-slate-300"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </span>
      {hint ? <span className="pl-5 text-[10px] text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function PapelariaModeloImposicaoPanel({
  modelo,
}: {
  modelo: PapelariaAdminModelRecord;
}) {
  const qc = useQueryClient();
  const [config, setConfig] = useState<PapelariaImposicaoConfig>(() =>
    configFromModeloOrDefault(modelo.imposicao_config_json),
  );
  const [cleared, setCleared] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const savedSnapshot = useMemo(() => {
    try {
      const parsed = parseImposicaoConfigJson(modelo.imposicao_config_json);
      return parsed ? formatImposicaoConfigJson(parsed) : "";
    } catch {
      return "";
    }
  }, [modelo.imposicao_config_json]);

  const currentSnapshot = cleared ? "" : formatImposicaoConfigJson(config);
  const dirty = currentSnapshot !== savedSnapshot;

  const patch = <K extends keyof PapelariaImposicaoConfig>(
    key: K,
    value: PapelariaImposicaoConfig[K],
  ) => {
    setCleared(false);
    setConfig((prev) => ({ ...prev, [key]: value }));
    setLocalMsg(null);
    setLocalError(null);
  };

  const setPaginaOrigem = (origem: PapelariaImposicaoPaginaOrigem) => {
    setCleared(false);
    setConfig((prev) => ({
      ...prev,
      pagina:
        origem === "fixixa"
          ? {
              origem,
              largura_mm: prev.pagina.largura_mm ?? 148,
              altura_mm: prev.pagina.altura_mm ?? 210,
            }
          : { origem },
    }));
    setLocalMsg(null);
    setLocalError(null);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (cleared) {
        return savePapelariaAdminImposicaoConfig(modelo.id, null);
      }
      const normalized = validateImposicaoConfigObject(config);
      return savePapelariaAdminImposicaoConfig(
        modelo.id,
        formatImposicaoConfigJson(normalized),
      );
    },
    onSuccess: (data) => {
      setLocalError(null);
      setLocalMsg(
        data.imposicao_config_json
          ? "Configuração de imposição salva."
          : "Configuração de imposição removida.",
      );
      if (data.imposicao_config_json) {
        setConfig(configFromModeloOrDefault(data.imposicao_config_json));
        setCleared(false);
      } else {
        setCleared(true);
      }
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalError(err.message),
  });

  const validateMutation = useMutation({
    mutationFn: () => {
      if (cleared) {
        return validatePapelariaAdminImposicaoConfig(null);
      }
      const normalized = validateImposicaoConfigObject(config);
      return validatePapelariaAdminImposicaoConfig(
        formatImposicaoConfigJson(normalized),
      );
    },
    onSuccess: (data) => {
      setLocalError(null);
      setLocalMsg(data.message);
    },
    onError: (err: Error) => setLocalError(err.message),
  });

  const busy = saveMutation.isPending || validateMutation.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <p className="max-w-3xl text-[11px] text-slate-500">
        Parâmetros usados futuramente para montar o JDF Apogee (Media, TrimSize, Layout
        N×M step&amp;repeat, marcas, sangria e WorkStyle). Ordem, pasta e PDF de entrada
        vêm da OS em runtime.
      </p>

      <section className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <NumberField
          label="Folha — largura (mm)"
          value={config.folha_mm.largura}
          min={1}
          step={0.1}
          hint="Media Dimension (ex.: A4 paisagem = 297)"
          onChange={(n) =>
            patch("folha_mm", { ...config.folha_mm, largura: n })
          }
        />
        <NumberField
          label="Folha — altura (mm)"
          value={config.folha_mm.altura}
          min={1}
          step={0.1}
          hint="Media Dimension (ex.: A4 paisagem = 210)"
          onChange={(n) =>
            patch("folha_mm", { ...config.folha_mm, altura: n })
          }
        />
      </section>

      <section className="flex max-w-3xl flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Tamanho da página (TrimSize)
          <select
            className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-800"
            value={config.pagina.origem}
            onChange={(e) =>
              setPaginaOrigem(e.target.value as PapelariaImposicaoPaginaOrigem)
            }
          >
            <option value="fixixa">Fixo (mm)</option>
            <option value="borda">Da BordaF/BordaV do CDR</option>
          </select>
        </label>
        {config.pagina.origem === "fixixa" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Página — largura (mm)"
              value={config.pagina.largura_mm ?? 0}
              min={1}
              step={0.1}
              hint="Ex.: A5 = 148"
              onChange={(n) =>
                patch("pagina", {
                  ...config.pagina,
                  origem: "fixixa",
                  largura_mm: n,
                })
              }
            />
            <NumberField
              label="Página — altura (mm)"
              value={config.pagina.altura_mm ?? 0}
              min={1}
              step={0.1}
              hint="Ex.: A5 = 210"
              onChange={(n) =>
                patch("pagina", {
                  ...config.pagina,
                  origem: "fixixa",
                  altura_mm: n,
                })
              }
            />
          </div>
        ) : null}
      </section>

      <section className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <NumberField
          label="Colunas (N)"
          value={config.grid.colunas}
          min={1}
          hint="Step & repeat — ex.: 2×1"
          onChange={(n) => patch("grid", { ...config.grid, colunas: n })}
        />
        <NumberField
          label="Linhas (M)"
          value={config.grid.linhas}
          min={1}
          onChange={(n) => patch("grid", { ...config.grid, linhas: n })}
        />
      </section>

      <section className="grid max-w-3xl gap-3 sm:grid-cols-3">
        <NumberField
          label="Espaço horizontal (mm)"
          value={config.espacamento_mm.horizontal}
          min={0}
          step={0.1}
          hint="0 = páginas encostadas"
          onChange={(n) =>
            patch("espacamento_mm", {
              ...config.espacamento_mm,
              horizontal: n,
            })
          }
        />
        <NumberField
          label="Espaço vertical (mm)"
          value={config.espacamento_mm.vertical}
          min={0}
          step={0.1}
          onChange={(n) =>
            patch("espacamento_mm", {
              ...config.espacamento_mm,
              vertical: n,
            })
          }
        />
        <NumberField
          label="Sangria (mm)"
          value={config.sangria_mm}
          min={0}
          step={0.1}
          hint="0 = corte seco"
          onChange={(n) => patch("sangria_mm", n)}
        />
      </section>

      <section className="flex max-w-3xl flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          WorkStyle (Sheet)
          <select
            className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-800"
            value={config.work_style}
            onChange={(e) =>
              patch("work_style", e.target.value as PapelariaImposicaoConfig["work_style"])
            }
          >
            <option value="Simplex">Simplex</option>
          </select>
        </label>
        <CheckboxField
          label="Centralizar na folha"
          checked={config.centralizar_na_folha}
          hint="Sobra de largura/altura vira margem igual dos dois lados"
          onChange={(v) => patch("centralizar_na_folha", v)}
        />
        <CheckboxField
          label="Marcas de corte"
          checked={config.marcas_corte}
          hint="false = sem MarkObject no Layout"
          onChange={(v) => patch("marcas_corte", v)}
        />
      </section>

      {cleared ? (
        <p className="text-[11px] text-amber-700">
          Configuração marcada para remoção. Salve para limpar no banco.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center gap-1 rounded px-3 py-1.5 text-xs font-semibold",
            dirty
              ? "bg-secondary-blue text-white hover:bg-secondary-blue/90"
              : "border border-slate-300 text-slate-500",
          )}
          disabled={!dirty || busy}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="size-3.5" aria-hidden />
          )}
          Salvar
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          disabled={busy}
          onClick={() => {
            try {
              validateMutation.mutate();
            } catch (err) {
              setLocalError(err instanceof Error ? err.message : "Config inválida.");
            }
          }}
        >
          {validateMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 className="size-3.5" aria-hidden />
          )}
          Validar
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          disabled={busy}
          onClick={() => {
            setCleared(false);
            setConfig(cloneDefaultImposicaoConfig());
            setLocalMsg(null);
            setLocalError(null);
          }}
        >
          Exemplo A5 2×1
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          disabled={busy || (cleared && !modelo.imposicao_config_json)}
          onClick={() => {
            setCleared(true);
            setLocalMsg(null);
            setLocalError(null);
          }}
        >
          <Eraser className="size-3.5" aria-hidden />
          Limpar config
        </button>
      </div>

      {localError ? <p className="text-xs text-red-600">{localError}</p> : null}
      {!localError && localMsg ? (
        <p className="text-xs text-emerald-700">{localMsg}</p>
      ) : null}
    </div>
  );
}
