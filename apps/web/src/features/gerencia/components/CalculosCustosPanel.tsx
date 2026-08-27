import { cn } from "@sagra/ui";
import { useId } from "react";

import type { GerenciaFormState, GerenciaFormUpdater } from "../types";
import {
  type ComponenteCalcResumo,
  type ComponenteTipo,
  getCalculosDisplayRows,
  type TechSpec,
} from "../techSpec";
import { patchTiragemMaximaFromCota, recalculateGerenciaCalcs, applyUsarTodaCota, computeTiragemMaximaFromForm } from "../utils";
import { Field, gerenciaInputClass } from "./gerenciaFormUi";

const CALC_FIELD_BY_TIPO: Record<
  ComponenteTipo,
  { color: keyof GerenciaFormState; pb: keyof GerenciaFormState }
> = {
  CAPA: { color: "calc_capa_color", pb: "calc_capa_pb" },
  MIOLO: { color: "calc_miolo_color", pb: "calc_miolo_pb" },
  ENCARTE: { color: "calc_encarte_color", pb: "calc_encarte_pb" },
};

interface CalculosCustosPanelProps {
  form: GerenciaFormState;
  update: GerenciaFormUpdater;
  techSpec: TechSpec;
  readOnly: boolean;
}

function sumRows(rows: ComponenteCalcResumo[]) {
  return rows.reduce(
    (acc, r) => ({
      color: acc.color + r.color,
      pb: acc.pb + r.pb,
      outras: acc.outras + r.outras,
      total: acc.total + r.total,
    }),
    { color: 0, pb: 0, outras: 0, total: 0 },
  );
}

export function CalculosCustosPanel({
  form,
  update,
  techSpec,
  readOnly,
}: CalculosCustosPanelProps) {
  const rows = getCalculosDisplayRows(techSpec, form);
  const totals = sumRows(rows);
  const hasOutras = rows.some((r) => r.outras > 0);
  const tiragemFinalId = useId();
  const calcOpts = { techSpec };

  const setCalc = (field: keyof GerenciaFormState, value: string) => {
    update((prev) => {
      const merged = { ...prev, [field]: value };
      const withCalcs = { ...merged, ...recalculateGerenciaCalcs(merged, calcOpts) };
      return { ...withCalcs, ...patchTiragemMaximaFromCota(withCalcs, calcOpts) };
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
          Páginas por componente
        </p>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 bg-slate-50/80 px-2 py-3 text-center text-xs text-slate-500">
            Adicione componentes em Detalhes Técnicos para calcular automaticamente.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[280px] border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-left text-[0.65rem] font-semibold uppercase text-slate-500">
                  <th className="px-2 py-1.5">Componente</th>
                  <th className="px-2 py-1.5 text-right">Policromia</th>
                  <th className="px-2 py-1.5 text-right">P/B</th>
                  {hasOutras ? (
                    <th className="px-2 py-1.5 text-right" title="Cores não classificadas no lote">
                      Outras
                    </th>
                  ) : null}
                  <th className="px-2 py-1.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const fields = row.tipo ? CALC_FIELD_BY_TIPO[row.tipo] : undefined;
                  return (
                  <ComponenteCalcRow
                    key={row.tipo ?? row.label}
                    row={row}
                    readOnly={readOnly}
                    autoFromSpec={techSpec.componentes.length > 0}
                    showOutras={hasOutras}
                    colorValue={
                      fields ? (form[fields.color] as string) : String(row.color)
                    }
                    pbValue={
                      fields ? (form[fields.pb] as string) : String(row.pb)
                    }
                    onColorChange={(v) => {
                      if (fields) setCalc(fields.color, v);
                    }}
                    onPbChange={(v) => {
                      if (fields) setCalc(fields.pb, v);
                    }}
                  />
                  );
                })}
                <tr className="border-t border-slate-200 bg-slate-50/90 font-semibold text-slate-800">
                  <td className="px-2 py-1.5">Total</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{totals.color}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{totals.pb}</td>
                  {hasOutras ? (
                    <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">
                      {totals.outras}
                    </td>
                  ) : null}
                  <td className="px-2 py-1.5 text-right tabular-nums">{totals.total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {hasOutras ? (
          <p className="mt-1 text-[0.6rem] text-amber-700">
            &quot;Outras&quot;: páginas sem tipo de cor definido no lote — selecione P/B ou policromia
            nas variações.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:gap-4">
        <div className="grid min-w-0 flex-1 grid-cols-3 items-end gap-2">
          <Field label="Cota atual" className="min-w-0">
            <input
              readOnly
              tabIndex={-1}
              inputMode="decimal"
              value={form.op_cota_atual}
              className={cn(
                gerenciaInputClass,
                "min-w-0 bg-slate-50 text-slate-700",
              )}
              placeholder="—"
              title="Saldo de cota do semestre (CotasGraf)"
            />
          </Field>
          <Field label="Tiragem máxima" className="min-w-0">
            <input
              readOnly
              tabIndex={-1}
              value={
                form.op_cota_atual.trim()
                  ? computeTiragemMaximaFromForm(form, calcOpts)
                  : form.op_tiragem_pret
              }
              className={cn(
                gerenciaInputClass,
                "min-w-0 bg-slate-50 text-slate-700",
              )}
              title="Calculada a partir da cota atual, páginas e formato"
            />
          </Field>
          <div className="min-w-0">
            <div className="flex min-h-[1rem] items-center justify-between gap-1">
              <label
                htmlFor={tiragemFinalId}
                className="text-xs font-semibold text-slate-600"
              >
                Tiragem final
              </label>
              {!readOnly ? (
                <button
                  type="button"
                  disabled={!computeTiragemMaximaFromForm(form, calcOpts)}
                  onClick={() =>
                    update((prev) => applyUsarTodaCota(prev, calcOpts))
                  }
                  className="shrink-0 text-[0.6rem] font-semibold leading-none text-secondary-blue underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
                  title="Define tiragem final e sincroniza cálculos"
                >
                  Usar toda cota
                </button>
              ) : null}
            </div>
            <input
              id={tiragemFinalId}
              readOnly={readOnly}
              value={form.op_tiragem_final}
              onChange={(e) => {
                const v = e.target.value;
                update((prev) => {
                  const merged = {
                    ...prev,
                    op_tiragem_final: v,
                    val_tiragem: v,
                    calc_tiragem: v,
                  };
                  const withCalcs = {
                    ...merged,
                    ...recalculateGerenciaCalcs(merged, calcOpts),
                  };
                  return {
                    ...withCalcs,
                    ...patchTiragemMaximaFromCota(withCalcs, calcOpts),
                  };
                });
              }}
              className={cn(gerenciaInputClass, "min-w-0")}
            />
          </div>
        </div>

        <div
          className="hidden h-10 w-px shrink-0 bg-slate-200 xl:block"
          aria-hidden
        />

        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
          <Field label="Coeficiente A4" className="min-w-0">
            <input
              readOnly
              value={form.calc_coef_a4}
              title="Unidades por folha A4"
              className={cn(
                gerenciaInputClass,
                "min-w-0 bg-slate-100 font-bold text-secondary-blue",
              )}
            />
          </Field>
          <Field label="Cota estimada" className="min-w-0">
            <input
              readOnly
              value={form.calc_cota_total}
              className={cn(
                gerenciaInputClass,
                "min-w-0 border-emerald-200 bg-emerald-50 font-bold text-primary-green",
              )}
            />
          </Field>
          <DebitarCgrafToggle
            checked={form.chk_debitar_cgraf}
            readOnly={readOnly}
            onChange={(v) => update({ chk_debitar_cgraf: v })}
          />
        </div>
      </div>
    </div>
  );
}

function ComponenteCalcRow({
  row,
  readOnly,
  autoFromSpec,
  showOutras,
  colorValue,
  pbValue,
  onColorChange,
  onPbChange,
}: {
  row: ComponenteCalcResumo;
  readOnly: boolean;
  autoFromSpec: boolean;
  showOutras: boolean;
  colorValue: string;
  pbValue: string;
  onColorChange: (v: string) => void;
  onPbChange: (v: string) => void;
}) {
  const displayColor = autoFromSpec ? String(row.color) : colorValue;
  const displayPb = autoFromSpec ? String(row.pb) : pbValue;

  return (
    <tr className="border-t border-slate-100">
      <td className="px-2 py-1 font-medium text-slate-700">{row.label}</td>
      <td className="px-2 py-1 text-right">
        <CalcCellInput
          readOnly={readOnly || autoFromSpec}
          value={displayColor}
          onChange={onColorChange}
        />
      </td>
      <td className="px-2 py-1 text-right">
        <CalcCellInput
          readOnly={readOnly || autoFromSpec}
          value={displayPb}
          onChange={onPbChange}
        />
      </td>
      {showOutras ? (
        <td className="px-2 py-1 text-right tabular-nums text-amber-700">
          {row.outras || "—"}
        </td>
      ) : null}
      <td className="px-2 py-1 text-right tabular-nums font-medium">{row.total}</td>
    </tr>
  );
}

function CalcCellInput({
  value,
  readOnly,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  if (readOnly) {
    return <span className="tabular-nums">{value || "0"}</span>;
  }
  return (
    <input
      type="number"
      min={0}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-right text-xs tabular-nums"
    />
  );
}

function DebitarCgrafToggle({
  checked,
  readOnly,
  onChange,
}: {
  checked: boolean;
  readOnly: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col items-center">
      <span className="max-w-[5.5rem] text-center text-xs font-semibold leading-tight text-slate-600">
        Debitar cota CGraf
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Debitar cota CGraf"
        disabled={readOnly}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-1 inline-flex h-8 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary-blue/30",
          checked ? "bg-primary-green" : "bg-slate-200",
          readOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block size-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}
