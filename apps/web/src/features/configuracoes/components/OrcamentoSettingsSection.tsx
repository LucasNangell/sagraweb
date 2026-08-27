import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  fetchOrcamentoFaixas,
  fetchOrcamentoFormatos,
  fetchOrcamentoParametros,
  updateOrcamentoFaixa,
  updateOrcamentoFormato,
  updateOrcamentoParametros,
} from "@/api/adminSystem";
import type {
  OrcamentoFaixaRecord,
  OrcamentoFormatoRecord,
  OrcamentoParametroRecord,
} from "@/features/configuracoes/types";

import {
  ConfigErrorState,
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
  ConfigSubsection,
} from "./ConfigSectionLayout";

const QK = ["admin", "orcamento"] as const;

type FieldKind = "number" | "money" | "percent" | "bool" | "text" | "textarea";

export type { FieldKind };

type FieldSpec = {
  chave: string;
  label: string;
  hint?: string;
  kind: FieldKind;
  span?: "full";
  prefix?: string;
  suffix?: string;
};

const DIGITAL_FIELDS: FieldSpec[] = [
  {
    chave: "clique_digital_pb",
    label: "Custo por clique P&B",
    hint: "Cobrado por página equivalente A4 na impressão digital.",
    kind: "money",
    prefix: "R$",
  },
  {
    chave: "clique_digital_cor",
    label: "Custo por clique colorido",
    hint: "Cobrado por página equivalente A4 quando o trabalho é em cor.",
    kind: "money",
    prefix: "R$",
  },
  {
    chave: "aliquota_indiretos_digital",
    label: "Indiretos Digital",
    hint: "Percentual sobre papel + acabamento (sem clique).",
    kind: "percent",
    suffix: "%",
  },
];

const OFFSET_FIELDS: FieldSpec[] = [
  {
    chave: "acerto_offset_folhas",
    label: "Folhas de acerto",
    hint: "Somadas à matriz na impressão Offset.",
    kind: "number",
  },
  {
    chave: "cotacao_prova",
    label: "Cotação da prova",
    hint: "Valor unitário quando o componente pede provas.",
    kind: "money",
    prefix: "R$",
  },
  {
    chave: "cotacao_fotolito",
    label: "Cotação do fotolito",
    hint: "Valor unitário quando o componente pede fotolitos.",
    kind: "money",
    prefix: "R$",
  },
  {
    chave: "aliquota_energia",
    label: "Energia elétrica",
    hint: "Sobre a base direta Offset (material).",
    kind: "percent",
  },
  {
    chave: "aliquota_depreciacao",
    label: "Depreciação",
    hint: "Sobre a base direta Offset.",
    kind: "percent",
  },
  {
    chave: "aliquota_perdas",
    label: "Perdas na produção",
    hint: "Sobre a base direta Offset.",
    kind: "percent",
  },
  {
    chave: "aliquota_manutencao",
    label: "Manutenção",
    hint: "Sobre a base direta Offset.",
    kind: "percent",
  },
  {
    chave: "aplicar_diagramacao",
    label: "Incluir diagramação",
    hint: "Soma a alíquota de diagramação aos indiretos Offset.",
    kind: "bool",
  },
  {
    chave: "aliquota_diagramacao",
    label: "Alíquota de diagramação",
    hint: "Usada somente se a opção acima estiver marcada.",
    kind: "percent",
  },
];

const ACABAMENTO_FIELDS: FieldSpec[] = [
  {
    chave: "bopp_metros",
    label: "Comprimento da bobina BOPP",
    hint: "Metros usados para ratear o custo da laminação.",
    kind: "number",
    suffix: "m",
  },
  {
    chave: "grampos_por_exemplar",
    label: "Grampos por exemplar",
    hint: "Quantidade cobrada quando o componente usa grampo.",
    kind: "number",
  },
  {
    chave: "grampo_max_paginas",
    label: "Máximo de páginas para grampo",
    hint: "Acima disso o grampo não entra no cálculo.",
    kind: "number",
  },
  {
    chave: "cola_min_paginas",
    label: "Mínimo de páginas para cola",
    hint: "Cola só é cobrada se o miolo passar desse número.",
    kind: "number",
  },
];

const OFICIO_FIELDS: FieldSpec[] = [
  { chave: "validade_dias", label: "Validade (dias)", kind: "number" },
  { chave: "prazo_entrega_dias", label: "Prazo de entrega (dias úteis)", kind: "number" },
  { chave: "pdf_signatario", label: "Signatário", kind: "text" },
  { chave: "pdf_cargo", label: "Cargo", kind: "text" },
  { chave: "pdf_telefone", label: "Telefone", kind: "text" },
  { chave: "pdf_endereco", label: "Endereço no rodapé", kind: "text", span: "full" },
  {
    chave: "pdf_clausula_validade",
    label: "Cláusula de validade",
    hint: "Pode usar {validade_dias}.",
    kind: "textarea",
    span: "full",
  },
  {
    chave: "pdf_clausula_entrega",
    label: "Cláusula de prazo e tecnologia",
    hint: "Pode usar {tecnologia}, {prazo_entrega_dias} e {prazo_extenso}.",
    kind: "textarea",
    span: "full",
  },
];

const VISIBLE_FIELDS: FieldSpec[] = [
  ...DIGITAL_FIELDS,
  ...OFFSET_FIELDS,
  ...ACABAMENTO_FIELDS,
  ...OFICIO_FIELDS,
];

function parseLocaleNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function toDisplay(valor: string, kind: FieldKind): string {
  if (kind === "bool") return valor === "1" || valor.toLowerCase() === "true" ? "1" : "0";
  if (kind === "percent") {
    const n = parseLocaleNumber(valor);
    if (n == null) return "";
    const pct = n * 100;
    return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(4)));
  }
  return valor;
}

export function fromDisplay(display: string, kind: FieldKind): string {
  if (kind === "bool") return display === "1" ? "1" : "0";
  if (kind === "percent") {
    const n = parseLocaleNumber(display);
    if (n == null) return display;
    return String(n / 100);
  }
  if (kind === "number" || kind === "money") {
    const n = parseLocaleNumber(display);
    return n == null ? display.trim() : String(n);
  }
  return display;
}

function inputClass(wide = false) {
  return `rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm focus:border-secondary-blue focus:outline-none focus:ring-1 focus:ring-secondary-blue ${
    wide ? "w-full" : "w-28 tabular-nums"
  }`;
}

function FieldControl({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (next: string) => void;
}) {
  const suffix = spec.suffix ?? (spec.kind === "percent" ? "%" : undefined);
  const prefix = spec.prefix ?? (spec.kind === "money" ? "R$" : undefined);

  if (spec.kind === "bool") {
    const checked = value === "1";
    return (
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 size-4 rounded border-slate-300 text-secondary-blue"
          checked={checked}
          onChange={(e) => onChange(e.target.checked ? "1" : "0")}
        />
        <span>
          <span className="block text-sm font-medium text-slate-800">{spec.label}</span>
          {spec.hint ? <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{spec.hint}</span> : null}
        </span>
      </label>
    );
  }

  if (spec.kind === "textarea") {
    return (
      <label className="block">
        <span className="text-sm font-medium text-slate-800">{spec.label}</span>
        {spec.hint ? <span className="mt-0.5 block text-xs text-slate-500">{spec.hint}</span> : null}
        <textarea
          rows={3}
          className={`${inputClass(true)} mt-1.5 min-h-[4.5rem] resize-y`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    );
  }

  const wide = spec.kind === "text" || spec.span === "full";
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-800">{spec.label}</span>
      {spec.hint ? <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{spec.hint}</span> : null}
      <span className="mt-1.5 flex items-center gap-1.5">
        {prefix ? <span className="text-xs font-medium text-slate-500">{prefix}</span> : null}
        <input
          className={inputClass(wide)}
          value={value}
          inputMode={spec.kind === "text" ? "text" : "decimal"}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix ? <span className="text-xs font-medium text-slate-500">{suffix}</span> : null}
      </span>
    </label>
  );
}

function FieldsGrid({
  fields,
  draft,
  onChange,
  columns = "sm:grid-cols-2 lg:grid-cols-3",
}: {
  fields: FieldSpec[];
  draft: Record<string, string>;
  onChange: (chave: string, value: string) => void;
  columns?: string;
}) {
  return (
    <div className={`grid gap-x-6 gap-y-4 ${columns}`}>
      {fields.map((spec) => (
        <div key={spec.chave} className={spec.span === "full" || spec.kind === "textarea" ? "sm:col-span-2 lg:col-span-3" : undefined}>
          <FieldControl spec={spec} value={draft[spec.chave] ?? ""} onChange={(v) => onChange(spec.chave, v)} />
        </div>
      ))}
    </div>
  );
}

export function OrcamentoSettingsSection() {
  const qc = useQueryClient();
  const paramsQ = useQuery({
    queryKey: [...QK, "parametros"],
    queryFn: fetchOrcamentoParametros,
  });
  const formatosQ = useQuery({
    queryKey: [...QK, "formatos"],
    queryFn: fetchOrcamentoFormatos,
  });
  const faixasQ = useQuery({
    queryKey: [...QK, "faixas"],
    queryFn: fetchOrcamentoFaixas,
  });

  const loading = paramsQ.isLoading || formatosQ.isLoading || faixasQ.isLoading;
  const error = paramsQ.error || formatosQ.error || faixasQ.error;

  if (loading) {
    return <ConfigLoadingState>Carregando cadastro de orçamento…</ConfigLoadingState>;
  }
  if (error) {
    return (
      <ConfigErrorState>
        {error instanceof Error ? error.message : "Erro ao carregar."}
      </ConfigErrorState>
    );
  }

  return (
    <ParametrosLayout
      items={paramsQ.data?.items ?? []}
      formatos={formatosQ.data?.items ?? []}
      faixas={faixasQ.data?.items ?? []}
      onInvalidate={() => void qc.invalidateQueries({ queryKey: QK })}
    />
  );
}

function ParametrosLayout({
  items,
  formatos,
  faixas,
  onInvalidate,
}: {
  items: OrcamentoParametroRecord[];
  formatos: OrcamentoFormatoRecord[];
  faixas: OrcamentoFaixaRecord[];
  onInvalidate: () => void;
}) {
  const byChave = useMemo(() => {
    const map: Record<string, OrcamentoParametroRecord> = {};
    for (const item of items) map[item.chave] = item;
    return map;
  }, [items]);

  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const spec of VISIBLE_FIELDS) {
      const raw = byChave[spec.chave]?.valor ?? "";
      next[spec.chave] = toDisplay(raw, spec.kind);
    }
    setDraft(next);
  }, [byChave]);

  const mut = useMutation({
    mutationFn: () => {
      const valores: Record<string, string> = {};
      for (const spec of VISIBLE_FIELDS) {
        valores[spec.chave] = fromDisplay(draft[spec.chave] ?? "", spec.kind);
      }
      return updateOrcamentoParametros(valores);
    },
    onSuccess: onInvalidate,
  });

  const setField = (chave: string, value: string) => {
    setDraft((prev) => ({ ...prev, [chave]: value }));
  };

  return (
    <ConfigSection>
      <ConfigSectionHeader
        title="Orçamento gráfico"
        description="Ajustes que entram no cálculo Digital/Offset e no texto do ofício. Preços de papel, tinta, chapa e BOPP vêm do estoque."
        icon={<Calculator className="size-4" />}
        actions={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-60"
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
          >
            {mut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Salvar parâmetros
          </button>
        }
      />
      <ConfigSectionBody className="space-y-4">
        {mut.isSuccess ? (
          <p className="text-xs text-emerald-700">Parâmetros salvos.</p>
        ) : null}
        {mut.isError ? (
          <p className="text-xs text-red-700">
            {mut.error instanceof Error ? mut.error.message : "Não foi possível salvar."}
          </p>
        ) : null}

        <ConfigSubsection
          title="Impressão digital"
          description="Custos por clique e o percentual de indiretos aplicado quando não há custeio por hora."
        >
          <FieldsGrid fields={DIGITAL_FIELDS} draft={draft} onChange={setField} />
        </ConfigSubsection>

        <ConfigSubsection
          title="Impressão Offset"
          description="Acerto, pré-impressão e alíquotas sobre a base direta (papel, chapas, tinta e acabamento)."
        >
          <FieldsGrid fields={OFFSET_FIELDS} draft={draft} onChange={setField} />
        </ConfigSubsection>

        <ConfigSubsection
          title="Acabamento"
          description="Constantes usadas só quando o componente pede laminação, grampo ou cola."
        >
          <FieldsGrid fields={ACABAMENTO_FIELDS} draft={draft} onChange={setField} columns="sm:grid-cols-2 lg:grid-cols-4" />
        </ConfigSubsection>

        <ConfigSubsection
          title="Formatos sugeridos"
          description="O envelope em milímetros define o formato (A6–A1) e o fator equivalente em A4 do componente."
        >
          <FormatosTable items={formatos} onSaved={onInvalidate} />
        </ConfigSubsection>

        <ConfigSubsection
          title="Pessoal Offset"
          description="Percentual sobre a base direta Offset conforme a faixa de tiragem, quando o cálculo não usa custo/hora."
        >
          <FaixasTable items={faixas} onSaved={onInvalidate} />
        </ConfigSubsection>

        <ConfigSubsection
          title="Ofício (PDF)"
          description="Textos e prazos impressos no ofício. Não alteram o valor do orçamento."
          tone="muted"
        >
          <FieldsGrid fields={OFICIO_FIELDS} draft={draft} onChange={setField} columns="sm:grid-cols-2" />
        </ConfigSubsection>
      </ConfigSectionBody>
    </ConfigSection>
  );
}

function FormatosTable({
  items,
  onSaved,
}: {
  items: OrcamentoFormatoRecord[];
  onSaved: () => void;
}) {
  const mut = useMutation({
    mutationFn: (item: OrcamentoFormatoRecord) =>
      updateOrcamentoFormato(item.id, {
        menor_mm: item.menor_mm,
        maior_mm: item.maior_mm,
        fator_a4: item.fator_a4,
      }),
    onSuccess: onSaved,
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full max-w-xl border-collapse text-sm">
        <thead>
          <tr className="text-left text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-2 py-1.5">Formato</th>
            <th className="px-2 py-1.5">Menor lado (mm)</th>
            <th className="px-2 py-1.5">Maior lado (mm)</th>
            <th className="px-2 py-1.5">Fator A4</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-slate-100">
              <td className="px-2 py-1.5 font-medium text-slate-800">{item.codigo}</td>
              <td className="px-2 py-1.5">
                <input
                  className={inputClass()}
                  defaultValue={item.menor_mm}
                  inputMode="decimal"
                  aria-label={`Menor lado ${item.codigo}`}
                  onBlur={(e) => {
                    const n = parseLocaleNumber(e.target.value);
                    if (n != null && n !== item.menor_mm) {
                      mut.mutate({ ...item, menor_mm: n });
                    }
                  }}
                />
              </td>
              <td className="px-2 py-1.5">
                <input
                  className={inputClass()}
                  defaultValue={item.maior_mm}
                  inputMode="decimal"
                  aria-label={`Maior lado ${item.codigo}`}
                  onBlur={(e) => {
                    const n = parseLocaleNumber(e.target.value);
                    if (n != null && n !== item.maior_mm) {
                      mut.mutate({ ...item, maior_mm: n });
                    }
                  }}
                />
              </td>
              <td className="px-2 py-1.5">
                <input
                  className={inputClass()}
                  defaultValue={item.fator_a4}
                  inputMode="decimal"
                  aria-label={`Fator A4 ${item.codigo}`}
                  onBlur={(e) => {
                    const n = parseLocaleNumber(e.target.value);
                    if (n != null && n !== item.fator_a4) {
                      mut.mutate({ ...item, fator_a4: n });
                    }
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FaixasTable({
  items,
  onSaved,
}: {
  items: OrcamentoFaixaRecord[];
  onSaved: () => void;
}) {
  const mut = useMutation({
    mutationFn: (item: OrcamentoFaixaRecord) =>
      updateOrcamentoFaixa(item.id, { percentual: item.percentual }),
    onSuccess: onSaved,
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full max-w-lg border-collapse text-sm">
        <thead>
          <tr className="text-left text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-2 py-1.5">De (exemplares)</th>
            <th className="px-2 py-1.5">Até</th>
            <th className="px-2 py-1.5">Percentual</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const display = Number((item.percentual * 100).toFixed(4));
            return (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-2 py-1.5 tabular-nums text-slate-700">{item.limite_inf}</td>
                <td className="px-2 py-1.5 tabular-nums text-slate-700">{item.limite_sup ?? "sem limite"}</td>
                <td className="px-2 py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <input
                      className={inputClass()}
                      defaultValue={display}
                      inputMode="decimal"
                      aria-label={`Percentual da faixa ${item.limite_inf}`}
                      onBlur={(e) => {
                        const n = parseLocaleNumber(e.target.value);
                        if (n == null) return;
                        const stored = n / 100;
                        if (stored !== item.percentual) {
                          mut.mutate({ ...item, percentual: stored });
                        }
                      }}
                    />
                    <span className="text-xs font-medium text-slate-500">%</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
