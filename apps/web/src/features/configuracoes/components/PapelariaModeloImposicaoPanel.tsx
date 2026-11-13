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
  validateImposicaoConfigObject,
} from "@/features/papelaria/imposicao";

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
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
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-700">
      <input
        type="checkbox"
        className="size-3.5 rounded border-slate-300"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
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

  const handleClear = () => {
    setCleared(true);
    setLocalMsg(null);
    setLocalError(null);
  };

  const handleResetDefaults = () => {
    setCleared(false);
    setConfig(cloneDefaultImposicaoConfig());
    setLocalMsg(null);
    setLocalError(null);
  };

  const busy = saveMutation.isPending || validateMutation.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <p className="text-[11px] text-slate-500">
        Configuração salva para uso futuro na geração do PDF de Imposição. Não altera o
        worker nesta versão.
      </p>

      <section className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <NumberField
          label="Folha — largura (mm)"
          value={config.folha.largura_mm}
          min={1}
          step={0.1}
          onChange={(n) =>
            patch("folha", { ...config.folha, largura_mm: n })
          }
        />
        <NumberField
          label="Folha — altura (mm)"
          value={config.folha.altura_mm}
          min={1}
          step={0.1}
          onChange={(n) =>
            patch("folha", { ...config.folha, altura_mm: n })
          }
        />
      </section>

      <section className="grid max-w-3xl gap-3 sm:grid-cols-3">
        <NumberField
          label="Grid — colunas"
          value={config.grid.colunas}
          min={1}
          onChange={(n) => patch("grid", { ...config.grid, colunas: n })}
        />
        <NumberField
          label="Grid — linhas"
          value={config.grid.linhas}
          min={1}
          onChange={(n) => patch("grid", { ...config.grid, linhas: n })}
        />
        <NumberField
          label="Repetições"
          value={config.grid.repeticoes}
          min={1}
          onChange={(n) => patch("grid", { ...config.grid, repeticoes: n })}
        />
      </section>

      <section className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <NumberField
          label="Espaçamento horizontal (mm)"
          value={config.espacamento_mm.horizontal}
          min={0}
          step={0.1}
          onChange={(n) =>
            patch("espacamento_mm", {
              ...config.espacamento_mm,
              horizontal: n,
            })
          }
        />
        <NumberField
          label="Espaçamento vertical (mm)"
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
      </section>

      <section className="grid max-w-3xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField
          label="Margem esquerda (mm)"
          value={config.margens_mm.esquerda}
          min={0}
          step={0.1}
          onChange={(n) =>
            patch("margens_mm", { ...config.margens_mm, esquerda: n })
          }
        />
        <NumberField
          label="Margem direita (mm)"
          value={config.margens_mm.direita}
          min={0}
          step={0.1}
          onChange={(n) =>
            patch("margens_mm", { ...config.margens_mm, direita: n })
          }
        />
        <NumberField
          label="Margem superior (mm)"
          value={config.margens_mm.superior}
          min={0}
          step={0.1}
          onChange={(n) =>
            patch("margens_mm", { ...config.margens_mm, superior: n })
          }
        />
        <NumberField
          label="Margem inferior (mm)"
          value={config.margens_mm.inferior}
          min={0}
          step={0.1}
          onChange={(n) =>
            patch("margens_mm", { ...config.margens_mm, inferior: n })
          }
        />
      </section>

      <section className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <NumberField
          label="Rotação da página (graus)"
          value={config.pagina.rotacao_graus}
          step={1}
          onChange={(n) =>
            patch("pagina", { ...config.pagina, rotacao_graus: n })
          }
        />
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Origem do tamanho da página
          <input
            type="text"
            className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600"
            value="borda (BordaF/BordaV)"
            readOnly
          />
        </label>
      </section>

      <section className="flex max-w-3xl flex-col gap-2">
        <CheckboxField
          label="Marcas de corte"
          checked={config.marcas_corte}
          onChange={(v) => patch("marcas_corte", v)}
        />
        <CheckboxField
          label="Separação entre páginas"
          checked={config.separacao_paginas}
          onChange={(v) => patch("separacao_paginas", v)}
        />
        <CheckboxField
          label="Incluir verso"
          checked={config.incluir_verso}
          onChange={(v) => patch("incluir_verso", v)}
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
          onClick={handleResetDefaults}
        >
          Valores padrão
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          disabled={busy || (cleared && !modelo.imposicao_config_json)}
          onClick={handleClear}
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
