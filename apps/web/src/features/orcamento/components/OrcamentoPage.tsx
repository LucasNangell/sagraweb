import { useMutation, useQuery } from "@tanstack/react-query";
import { FileDown, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  calcularOrcamento,
  downloadOrcamentoPdf,
  fetchOrcamentoOs,
  gerarOrcamentoPdf,
} from "@/api/orcamento";
import type {
  OrcamentoComparativo,
  OrcamentoComponente,
  OrcamentoConsolidado,
  OrcamentoEntrada,
  OrcamentoResponse,
} from "@/features/orcamento/types";

function brl(n: number | undefined) {
  return (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface OrcamentoPageProps {
  ano?: string;
  id?: string;
}

export function OrcamentoPage({ ano, id }: OrcamentoPageProps) {
  const anoN = Number(ano);
  const idN = Number(id);
  const valid = Number.isFinite(anoN) && Number.isFinite(idN) && anoN > 0 && idN > 0;

  const query = useQuery({
    queryKey: ["orcamento", anoN, idN],
    queryFn: () => fetchOrcamentoOs(anoN, idN),
    enabled: valid,
  });

  const [entrada, setEntrada] = useState<OrcamentoEntrada | null>(null);
  const [computed, setComputed] = useState<OrcamentoResponse | null>(null);

  useEffect(() => {
    if (query.data) {
      setEntrada(query.data.entrada);
      setComputed(query.data);
    }
  }, [query.data]);

  const recalc = useMutation({
    mutationFn: (payload: OrcamentoEntrada) => calcularOrcamento(payload),
    onSuccess: (data) => setComputed(data),
  });

  const pdfMut = useMutation({
    mutationFn: async (payload: OrcamentoEntrada) => {
      const { blob, filename } = await gerarOrcamentoPdf(payload);
      downloadOrcamentoPdf(blob, filename);
      return filename;
    },
  });

  useEffect(() => {
    if (!entrada || entrada === query.data?.entrada) return;
    const handle = window.setTimeout(() => recalc.mutate(entrada), 350);
    return () => window.clearTimeout(handle);
  }, [entrada]); // eslint-disable-line react-hooks/exhaustive-deps

  const papeis = computed?.opcoes?.papeis ?? query.data?.opcoes?.papeis ?? [];

  if (!valid) {
    return (
      <p className="p-4 text-sm text-slate-600">
        Selecione uma OS na lista inicial e use o menu de contexto <strong>Orçamento</strong>.
      </p>
    );
  }
  if (query.isError) {
    return (
      <p className="p-4 text-sm text-red-700">
        {query.error instanceof Error ? query.error.message : "Não foi possível montar o orçamento."}
      </p>
    );
  }
  if (query.isLoading || !entrada || !computed) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-600">
        <Loader2 className="size-4 animate-spin" /> Carregando orçamento…
      </div>
    );
  }

  const r = computed.resultado;
  const oficio = computed.oficio;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-1 md:p-2">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">
            Orçamento OS {entrada.os.nro_protocolo}/{entrada.os.ano_protocolo}
          </h1>
          <p className="text-sm text-slate-600">
            {entrada.os.solicitante} — {entrada.os.titulo}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          onClick={() => pdfMut.mutate(entrada)}
          disabled={pdfMut.isPending}
        >
          {pdfMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
          Gerar PDF
        </button>
      </header>
      {pdfMut.isError ? (
        <p className="text-xs text-red-700">
          {pdfMut.error instanceof Error ? pdfMut.error.message : "Falha ao gerar o PDF."}
        </p>
      ) : null}

      {r.alertas.length > 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {r.alertas.join(" · ")}
        </div>
      ) : null}
      {recalc.isError ? (
        <p className="text-xs text-red-700">
          {recalc.error instanceof Error ? recalc.error.message : "Falha ao recalcular."}
        </p>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Dados do serviço
          </h2>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="col-span-2">
              Título
              <input
                className="mt-0.5 w-full rounded border px-2 py-1"
                value={entrada.os.titulo}
                onChange={(e) =>
                  setEntrada({ ...entrada, os: { ...entrada.os, titulo: e.target.value } })
                }
              />
            </label>
            <label>
              Tiragem
              <input
                type="number"
                className="mt-0.5 w-full rounded border px-2 py-1"
                value={entrada.tiragem}
                onChange={(e) =>
                  setEntrada({ ...entrada, tiragem: Number(e.target.value) || 1 })
                }
              />
            </label>
            <label>
              Tecnologia
              <select
                className="mt-0.5 w-full rounded border px-2 py-1"
                value={entrada.tecnologia}
                onChange={(e) => setEntrada({ ...entrada, tecnologia: e.target.value })}
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
              comp={comp}
              papeis={papeis}
              onChange={(next) => {
                const componentes = entrada.componentes.slice();
                componentes[idx] = next;
                setEntrada({ ...entrada, componentes });
              }}
            />
          ))}
        </div>

        <div className="space-y-3">
          <Comparativo digital={r.digital} offset={r.offset} escolhida={r.tecnologia_escolhida} />
          {computed.comparativo ? <EstimadoVsReal comparativo={computed.comparativo} /> : null}
          <Detalhe consolidado={r.escolhido} />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed">
        <h2 className="mb-2 text-center text-base font-bold">
          ORÇAMENTO{" "}
          {oficio.numero && oficio.ano ? `${oficio.numero}/${oficio.ano}` : "(prévia)"}
        </h2>
        {oficio.processo ? <p>Processo nº {oficio.processo}</p> : null}
        <p>Ordem de serviço nº {oficio.os_numero}/{oficio.os_ano}</p>
        <p className="mt-2">
          <strong>Solicitante:</strong> {oficio.solicitante}
        </p>
        <p>
          <strong>Título:</strong> {oficio.titulo}
        </p>
        <p className="mt-2">
          <strong>Especificação Solicitada:</strong> {oficio.especificacao}
        </p>
        <p>
          <strong>Especificação Orçada:</strong> {oficio.especificacao}
        </p>
        <p className="mt-2">Nº.de páginas: {String(oficio.paginas).padStart(2, "0")}</p>
        <p>Tiragem: {oficio.tiragem}</p>
        <p className="font-semibold">Valor total: {brl(oficio.valor_total)}</p>
        <p className="mt-3 text-xs text-slate-600">- {oficio.clausula_validade}</p>
        <p className="text-xs text-slate-600">- {oficio.clausula_entrega}</p>
        <div className="mt-6 grid grid-cols-2 gap-6 text-xs">
          <div>
            Encaminho o presente orçamento conforme solicitação recebida e obedecida a norma
            vigente.
            <p className="mt-8 font-semibold">{oficio.signatario}</p>
            <p>{oficio.cargo}</p>
          </div>
          <div>
            Autorizo a execução do trabalho especificado.
            <p className="mt-8">Responsável</p>
            <p>Assinatura e Carimbo</p>
          </div>
        </div>
        <p className="mt-6 text-center text-[11px] text-slate-500">
          Endereço: {oficio.endereco}
          <br />
          Telefone: {oficio.telefone}
        </p>
      </section>
    </div>
  );
}

function ComponenteFields({
  comp,
  papeis,
  onChange,
}: {
  comp: OrcamentoComponente;
  papeis: { codigo: string; especificacao: string }[];
  onChange: (next: OrcamentoComponente) => void;
}) {
  const flags: { key: keyof OrcamentoComponente; label: string }[] = [
    { key: "cor", label: "Colorido" },
    { key: "frente_verso", label: "Frente e verso" },
    { key: "laminacao", label: "Laminação" },
    { key: "laminacao_fv", label: "Laminação F/V" },
    { key: "grampo", label: "Grampo" },
    { key: "cola", label: "Cola" },
    { key: "espiral", label: "Espiral" },
    { key: "capa_pvc", label: "Capa PVC" },
  ];
  return (
    <div className="mt-3 rounded border border-slate-100 bg-slate-50/80 p-2">
      <p className="mb-1 text-[0.65rem] font-semibold uppercase text-slate-500">
        {comp.nome} ({comp.tipo})
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label>
          Menor (mm)
          <input
            type="number"
            className="mt-0.5 w-full rounded border px-2 py-1"
            value={comp.menor_mm}
            onChange={(e) => onChange({ ...comp, menor_mm: Number(e.target.value) || 0 })}
          />
        </label>
        <label>
          Maior (mm)
          <input
            type="number"
            className="mt-0.5 w-full rounded border px-2 py-1"
            value={comp.maior_mm}
            onChange={(e) => onChange({ ...comp, maior_mm: Number(e.target.value) || 0 })}
          />
        </label>
        <label>
          Páginas
          <input
            type="number"
            className="mt-0.5 w-full rounded border px-2 py-1"
            value={comp.paginas}
            onChange={(e) => onChange({ ...comp, paginas: Number(e.target.value) || 1 })}
          />
        </label>
        <label>
          Papel
          <select
            className="mt-0.5 w-full rounded border px-2 py-1"
            value={comp.papel_codigo ?? ""}
            onChange={(e) => onChange({ ...comp, papel_codigo: e.target.value || null })}
          >
            <option value="">Selecionar…</option>
            {papeis.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.codigo} — {p.especificacao}
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
              onChange={(e) => onChange({ ...comp, [key]: e.target.checked })}
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
}: {
  digital: OrcamentoConsolidado;
  offset: OrcamentoConsolidado;
  escolhida: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Comparativo Digital × Offset
      </h2>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <TechCard label="Digital" total={digital.total} unit={digital.unitario} active={escolhida === "digital"} />
        <TechCard label="Offset" total={offset.total} unit={offset.unitario} active={escolhida === "offset"} />
      </div>
    </div>
  );
}

function TechCard({
  label,
  total,
  unit,
  active,
}: {
  label: string;
  total: number;
  unit: number;
  active: boolean;
}) {
  return (
    <div
      className={
        active
          ? "rounded border border-primary-green bg-emerald-50 p-2"
          : "rounded border border-slate-200 p-2"
      }
    >
      <p className="font-semibold">{label}</p>
      <p className="text-base font-bold tabular-nums">{brl(total)}</p>
      <p className="text-[11px] text-slate-500">{brl(unit)} / un.</p>
    </div>
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
                <td className="py-1 text-right tabular-nums">{brl(row.est)}</td>
                <td className="py-1 text-right tabular-nums">
                  {real ? brl(row.real) : "—"}
                </td>
                <td className="py-1 text-right tabular-nums text-slate-500">
                  {delta != null ? brl(delta) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {real?.desperdicio ? (
        <p className="mt-2 text-[11px] text-amber-700">
          Desperdício extra (consumo − teórico): {brl(real.desperdicio)}
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
                {d.capped ? " (teto)" : ""} · {brl(d.valor)}
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
              <td className="py-1 text-right tabular-nums">{brl(Number(value))}</td>
            </tr>
          ))}
          {consolidado.indiretos_detalhe?.map((linha) => (
            <tr key={linha.nome} className="border-t border-slate-50 text-slate-500">
              <td className="py-0.5 pl-3">{linha.nome}</td>
              <td className="py-0.5 text-right tabular-nums">{brl(linha.valor)}</td>
            </tr>
          ))}
          <tr className="border-t border-slate-200 font-semibold">
            <td className="py-1.5">Total</td>
            <td className="py-1.5 text-right tabular-nums">{brl(consolidado.total)}</td>
          </tr>
          <tr>
            <td className="py-1 text-slate-500">Unitário</td>
            <td className="py-1 text-right tabular-nums text-slate-500">
              {brl(consolidado.unitario)}
            </td>
          </tr>
          <tr>
            <td className="py-1 text-slate-500">Valor / 100 páginas</td>
            <td className="py-1 text-right tabular-nums text-slate-500">
              {brl(consolidado.por_cento_paginas)}
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
