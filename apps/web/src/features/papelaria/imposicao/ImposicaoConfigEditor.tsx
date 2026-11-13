import type { PapelariaImposicaoConfig, PapelariaImposicaoPaginaOrigem } from "./types";

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

export function ImposicaoConfigEditor({
  config,
  onChange,
}: {
  config: PapelariaImposicaoConfig;
  onChange: (next: PapelariaImposicaoConfig) => void;
}) {
  const patch = <K extends keyof PapelariaImposicaoConfig>(
    key: K,
    value: PapelariaImposicaoConfig[K],
  ) => onChange({ ...config, [key]: value });

  const setPaginaOrigem = (origem: PapelariaImposicaoPaginaOrigem) => {
    onChange({
      ...config,
      pagina:
        origem === "fixixa"
          ? {
              origem,
              largura_mm: config.pagina.largura_mm ?? 148,
              altura_mm: config.pagina.altura_mm ?? 210,
            }
          : { origem },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <NumberField
          label="Folha — largura (mm)"
          value={config.folha_mm.largura}
          min={1}
          step={0.1}
          hint="Media Dimension (ex.: A4 paisagem = 297)"
          onChange={(n) => patch("folha_mm", { ...config.folha_mm, largura: n })}
        />
        <NumberField
          label="Folha — altura (mm)"
          value={config.folha_mm.altura}
          min={1}
          step={0.1}
          hint="Media Dimension (ex.: A4 paisagem = 210)"
          onChange={(n) => patch("folha_mm", { ...config.folha_mm, altura: n })}
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
              patch(
                "work_style",
                e.target.value as PapelariaImposicaoConfig["work_style"],
              )
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
          hint="true = MarkObject/CutMark no JDF (Apogee)"
          onChange={(v) => patch("marcas_corte", v)}
        />
      </section>
    </div>
  );
}
