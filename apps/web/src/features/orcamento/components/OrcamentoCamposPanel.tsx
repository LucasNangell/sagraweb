import { Loader2 } from "lucide-react";
import { useMemo } from "react";

import { PermissionGate } from "@/components/auth/PermissionGate";
import type {
  OrcamentoComparativo,
  OrcamentoComponente,
  OrcamentoConsolidado,
  OrcamentoEntrada,
  OrcamentoResponse,
} from "@/features/orcamento/types";
import {
  flagsFromImpressao,
  IMPRESSAO_OPTIONS,
  impressaoFromFlags,
} from "@/features/gerencia/techSpec";
import { useOrcamentoEditorContext } from "@/features/orcamento/hooks/useOrcamentoEditor";
import { cn } from "@sagra/ui";

export function formatOrcamentoBrl(n: number | undefined) {
  return (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type OrcamentoCamposVariant = "page" | "compact";

export function OrcamentoCamposPanel({
  variant = "page",
  entrada,
  computed,
  onEntradaChange,
  recalcError,
  pdfError,
}: {
  variant?: OrcamentoCamposVariant;
  entrada: OrcamentoEntrada;
  computed: OrcamentoResponse;
  onEntradaChange: (next: OrcamentoEntrada) => void;
  recalcError?: string | null;
  pdfError?: string | null;
}) {
  const compact = variant === "compact";
  const r = computed.resultado;
  const papeis = computed.opcoes?.papeis ?? [];

  const dados = (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-white",
        compact ? "p-2" : "p-3",
      )}
    >
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Dados do serviço
      </h2>
      <div
        className={cn(
          "text-xs",
          compact ? "flex flex-wrap items-end gap-1.5" : "grid grid-cols-2 gap-2",
        )}
      >
        <label className={compact ? "min-w-[10rem] flex-[2]" : "col-span-2"}>
          Título
          <input
            className="mt-0.5 w-full rounded border px-2 py-1"
            value={entrada.os.titulo}
            onChange={(e) =>
              onEntradaChange({
                ...entrada,
                os: { ...entrada.os, titulo: e.target.value },
              })
            }
          />
        </label>
        <label className={compact ? "w-[5.5rem] shrink-0" : undefined}>
          Tiragem
          <input
            type="number"
            className="mt-0.5 w-full rounded border px-2 py-1"
            value={entrada.tiragem}
            onChange={(e) =>
              onEntradaChange({
                ...entrada,
                tiragem: Number(e.target.value) || 1,
              })
            }
          />
        </label>
        <label className={compact ? "w-[11rem] shrink-0" : undefined}>
          Tecnologia
          <select
            className="mt-0.5 w-full rounded border px-2 py-1"
            value={entrada.tecnologia}
            onChange={(e) =>
              onEntradaChange({ ...entrada, tecnologia: e.target.value })
            }
          >
            <option value="auto">Automática (mais econômica)</option>
            <option value="digital">Digital</option>
            <option value="offset">Offset</option>
          </select>
        </label>
      </div>
      {entrada.componentes.map((comp, idx) => (
        <ComponenteFields
          key={`${comp.tipo}-${idx}`}
          compact={compact}
          comp={comp}
          papeis={papeis}
          onChange={(next) => {
            const componentes = entrada.componentes.slice();
            componentes[idx] = next;
            onEntradaChange({ ...entrada, componentes });
          }}
        />
      ))}
    </div>
  );

  const resultado = (
    <div className="space-y-3">
      <Comparativo
        digital={r.digital}
        offset={r.offset}
        escolhida={r.tecnologia_escolhida}
        onEscolher={(tec) => onEntradaChange({ ...entrada, tecnologia: tec })}
      />
      {computed.comparativo && r.escolhido.usa_pessoal_hora ? (
        <EstimadoVsReal comparativo={computed.comparativo} />
      ) : null}
      <Detalhe consolidado={r.escolhido} />
    </div>
  );

  return (
    <div className="space-y-3">
      {pdfError ? <p className="text-xs text-red-700">{pdfError}</p> : null}
      {r.alertas.length > 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {r.alertas.join(" · ")}
        </div>
      ) : null}
      {recalcError ? <p className="text-xs text-red-700">{recalcError}</p> : null}
      {compact ? (
        <div className="space-y-3">
          {dados}
          {resultado}
        </div>
      ) : (
        <section className="grid gap-3 lg:grid-cols-2">
          {dados}
          {resultado}
        </section>
      )}
    </div>
  );
}

export function OrcamentoCamposEmbed({
  variant = "compact",
}: {
  variant?: OrcamentoCamposVariant;
}) {
  const editor = useOrcamentoEditorContext();
  if (!editor?.enabled) return null;

  return (
    <PermissionGate permission="ctx_orcamento">
      <OrcamentoCamposEmbedBody variant={variant} />
    </PermissionGate>
  );
}

function OrcamentoCamposEmbedBody({
  variant,
}: {
  variant: OrcamentoCamposVariant;
}) {
  const editor = useOrcamentoEditorContext();
  if (!editor?.enabled) return null;

  if (editor.query.isError) {
    return (
      <p className="text-xs text-red-700">
        {editor.query.error instanceof Error
          ? editor.query.error.message
          : "Não foi possível montar o orçamento."}
      </p>
    );
  }
  if (editor.query.isLoading || !editor.entrada || !editor.computed) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-slate-600">
        <Loader2 className="size-3.5 animate-spin" /> Carregando orçamento…
      </div>
    );
  }

  return (
    <OrcamentoCamposPanel
      variant={variant}
      entrada={editor.entrada}
      computed={editor.computed}
      onEntradaChange={editor.setEntrada}
      recalcError={editor.recalcError}
      pdfError={editor.pdfError}
    />
  );
}

function ComponenteFields({
  compact,
  comp,
  papeis,
  onChange,
}: {
  compact: boolean;
  comp: OrcamentoComponente;
  papeis: { codigo: string; especificacao: string }[];
  onChange: (next: OrcamentoComponente) => void;
}) {
  const flags: { key: keyof OrcamentoComponente; label: string }[] = [
    { key: "laminacao", label: "Laminação" },
    { key: "laminacao_fv", label: "Laminação F/V" },
    { key: "grampo", label: "Grampo" },
    { key: "cola", label: "Cola" },
    { key: "espiral", label: "Espiral" },
    { key: "capa_pvc", label: "Capa PVC" },
  ];
  const impressaoValue =
    comp.impressao?.trim() ||
    impressaoFromFlags(comp.cor, comp.frente_verso, comp.verso_cor);
  const inputClass = "mt-0.5 w-full rounded border px-2 py-1";
  return (
    <div
      className={cn(
        "rounded border border-slate-100 bg-slate-50/80",
        compact ? "mt-2 p-1.5" : "mt-3 p-2",
      )}
    >
      <p className="mb-1 text-[0.65rem] font-semibold uppercase text-slate-500">
        {comp.nome} ({comp.tipo})
      </p>
      <div
        className={cn(
          "text-xs",
          compact ? "flex flex-wrap gap-1.5" : "grid grid-cols-2 gap-2",
        )}
      >
        <label className={compact ? "w-[4.75rem] shrink-0" : undefined}>
          Menor (mm)
          <input
            type="number"
            className={inputClass}
            value={comp.menor_mm}
            onChange={(e) =>
              onChange({ ...comp, menor_mm: Number(e.target.value) || 0 })
            }
          />
        </label>
        <label className={compact ? "w-[4.75rem] shrink-0" : undefined}>
          Maior (mm)
          <input
            type="number"
            className={inputClass}
            value={comp.maior_mm}
            onChange={(e) =>
              onChange({ ...comp, maior_mm: Number(e.target.value) || 0 })
            }
          />
        </label>
        <label className={compact ? "w-[4.25rem] shrink-0" : undefined}>
          Páginas
          <input
            type="number"
            className={inputClass}
            value={comp.paginas}
            onChange={(e) =>
              onChange({ ...comp, paginas: Number(e.target.value) || 1 })
            }
          />
        </label>
        <label className={compact ? "min-w-[8rem] flex-[2]" : undefined}>
          Papel
          <select
            className={inputClass}
            value={comp.papel_codigo ?? ""}
            onChange={(e) =>
              onChange({ ...comp, papel_codigo: e.target.value || null })
            }
          >
            <option value="">Selecionar…</option>
            {papeis.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.codigo} — {p.especificacao}
              </option>
            ))}
          </select>
        </label>
        <label className={compact ? "min-w-[7rem] flex-1" : undefined}>
          Impressão
          <select
            className={inputClass}
            value={impressaoValue}
            onChange={(e) => {
              const value = e.target.value;
              onChange({
                ...comp,
                impressao: value,
                ...flagsFromImpressao(value),
              });
            }}
          >
            {IMPRESSAO_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {flags.map(({ key, label }) => (
          <label key={key} className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={Boolean(comp[key])}
              onChange={(e) => {
                onChange({ ...comp, [key]: e.target.checked });
              }}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function Comparativo({
  digital,
  offset,
  escolhida,
  onEscolher,
}: {
  digital: OrcamentoConsolidado;
  offset: OrcamentoConsolidado;
  escolhida: string;
  onEscolher: (tec: "digital" | "offset") => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Comparativo Digital × Offset
      </h2>
      <p className="mb-2 text-[11px] text-slate-500">
        Clique no card para orçar nessa máquina.
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <TechCard
          label="Digital"
          total={digital.total}
          unit={digital.unitario}
          active={escolhida === "digital"}
          onClick={() => onEscolher("digital")}
        />
        <TechCard
          label="Offset"
          total={offset.total}
          unit={offset.unitario}
          active={escolhida === "offset"}
          onClick={() => onEscolher("offset")}
        />
      </div>
    </div>
  );
}

function TechCard({
  label,
  total,
  unit,
  active,
  onClick,
}: {
  label: string;
  total: number;
  unit: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded border border-primary-green bg-emerald-50 p-2 text-left"
          : "rounded border border-slate-200 p-2 text-left hover:border-secondary-blue hover:bg-slate-50"
      }
    >
      <p className="font-semibold">{label}</p>
      <p className="text-base font-bold tabular-nums">{formatOrcamentoBrl(total)}</p>
      <p className="text-[11px] text-slate-500">{formatOrcamentoBrl(unit)} / un.</p>
    </button>
  );
}

function EstimadoVsReal({ comparativo }: { comparativo: OrcamentoComparativo }) {
  const est = comparativo.estimado;
  const real = comparativo.realizado;
  const fonte =
    comparativo.estimado_fonte === "snapshot"
      ? "snapshot do ofício"
      : "sem snapshot (recálculo atual)";
  const rows: { label: string; est?: number; real?: number }[] = [
    { label: "Pessoal", est: est.custo_pessoal, real: real?.custo_pessoal },
    { label: "Material", est: est.custo_material, real: real?.custo_material },
    { label: "Total", est: est.total, real: real?.total },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Estimado × realizado
        </h2>
        {comparativo.confianca ? (
          <span className="text-[10px] text-slate-500">
            n={comparativo.confianca.n} · {comparativo.confianca.rotulo}
          </span>
        ) : null}
      </div>
      <p className="mb-2 text-[11px] text-slate-500">Estimado: {fonte}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 font-medium"> </th>
            <th className="py-1 text-right font-medium">Estimado</th>
            <th className="py-1 text-right font-medium">Realizado</th>
            <th className="py-1 text-right font-medium">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta =
              row.est != null && row.real != null ? row.real - row.est : null;
            return (
              <tr key={row.label} className="border-t border-slate-100">
                <td className="py-1">{row.label}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatOrcamentoBrl(row.est)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {real ? formatOrcamentoBrl(row.real) : "—"}
                </td>
                <td className="py-1 text-right tabular-nums text-slate-500">
                  {delta != null ? formatOrcamentoBrl(delta) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {real?.desperdicio ? (
        <p className="mt-2 text-[11px] text-amber-700">
          Desperdício extra (consumo − teórico): {formatOrcamentoBrl(real.desperdicio)}
        </p>
      ) : null}
      {real?.nota_material ? (
        <p className="mt-1 text-[11px] text-slate-500">{real.nota_material}</p>
      ) : null}
      {(real?.pessoal_detalhe || []).filter((d) => d.cobra_pessoal).length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-slate-600">
          {real?.pessoal_detalhe
            ?.filter((d) => d.cobra_pessoal)
            .map((d) => (
              <li key={`${d.passo_id}-${d.nome}`}>
                {d.nome}: {Number(d.horas || 0).toFixed(2)} h
                {d.capped ? " (teto)" : ""} · {formatOrcamentoBrl(d.valor)}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

function Detalhe({ consolidado }: { consolidado: OrcamentoConsolidado }) {
  const rows = useMemo(
    () => [
      ["Papel", consolidado.custo_papel],
      ["Cliques (Digital)", consolidado.custo_clique],
      ["Pré-impressão", consolidado.custo_pre],
      ["Tinta / impressão", consolidado.custo_tinta],
      ["Acabamento", consolidado.custo_acabamento],
      ["Indiretos", consolidado.custo_indiretos],
    ],
    [consolidado],
  );
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Detalhamento ({consolidado.tecnologia})
      </h2>
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-t border-slate-100">
              <td className="py-1">{label}</td>
              <td className="py-1 text-right tabular-nums">
                {formatOrcamentoBrl(Number(value))}
              </td>
            </tr>
          ))}
          {consolidado.indiretos_detalhe?.map((linha) => (
            <tr key={linha.nome} className="border-t border-slate-50 text-slate-500">
              <td className="py-0.5 pl-3">{linha.nome}</td>
              <td className="py-0.5 text-right tabular-nums">
                {formatOrcamentoBrl(linha.valor)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-slate-200 font-semibold">
            <td className="py-1.5">Total</td>
            <td className="py-1.5 text-right tabular-nums">
              {formatOrcamentoBrl(consolidado.total)}
            </td>
          </tr>
          <tr>
            <td className="py-1 text-slate-500">Unitário</td>
            <td className="py-1 text-right tabular-nums text-slate-500">
              {formatOrcamentoBrl(consolidado.unitario)}
            </td>
          </tr>
          <tr>
            <td className="py-1 text-slate-500">Valor / 100 páginas</td>
            <td className="py-1 text-right tabular-nums text-slate-500">
              {formatOrcamentoBrl(consolidado.por_cento_paginas)}
            </td>
          </tr>
        </tbody>
      </table>
      {(consolidado.pessoal_detalhe || []).some((d) => d.cobra_pessoal) ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500">
          {consolidado.pessoal_detalhe
            ?.filter((d) => d.cobra_pessoal)
            .map((d) => (
              <li key={`h-${d.passo_id}-${d.nome}`}>
                {d.nome}: {Number(d.horas || 0).toFixed(2)} h
                {d.n_amostras ? ` (n=${d.n_amostras})` : " (prior)"}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
