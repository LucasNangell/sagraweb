import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fetchOrcamentoFaixas,
  fetchOrcamentoFormatos,
  fetchOrcamentoInsumos,
  fetchOrcamentoParametros,
  updateOrcamentoFaixa,
  updateOrcamentoFormato,
  updateOrcamentoInsumo,
  updateOrcamentoParametros,
} from "@/api/adminSystem";
import type {
  OrcamentoFaixaRecord,
  OrcamentoFormatoRecord,
  OrcamentoInsumoRecord,
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

function money(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function OrcamentoSettingsSection() {
  const qc = useQueryClient();
  const insumosQ = useQuery({
    queryKey: [...QK, "insumos"],
    queryFn: () => fetchOrcamentoInsumos(true),
  });
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

  const loading =
    insumosQ.isLoading || paramsQ.isLoading || formatosQ.isLoading || faixasQ.isLoading;
  const error = insumosQ.error || paramsQ.error || formatosQ.error || faixasQ.error;

  if (loading) {
    return <ConfigLoadingState label="Carregando cadastro de orçamento…" />;
  }
  if (error) {
    return (
      <ConfigErrorState message={error instanceof Error ? error.message : "Erro ao carregar."} />
    );
  }

  return (
    <ConfigSection>
      <ConfigSectionHeader
        title="Orçamento gráfico"
        description="Insumos, alíquotas, formatos e faixas de pessoal usados no cálculo Digital/Offset."
        icon={<Calculator className="size-4" />}
      />
      <ConfigSectionBody>
        <ParametrosBlock
          items={paramsQ.data?.items ?? []}
          onSaved={() => void qc.invalidateQueries({ queryKey: QK })}
        />
        <ConfigSubsection title="Insumos" description="Preço bruto da embalagem; o unitário vem do custo médio do estoque quando o insumo está ligado a um SKU.">
          <InsumosTable items={insumosQ.data?.items ?? []} onSaved={() => void qc.invalidateQueries({ queryKey: QK })} />
        </ConfigSubsection>
        <ConfigSubsection title="Formatos sugeridos" description="Envelope em mm e fator equivalente em A4.">
          <FormatosTable items={formatosQ.data?.items ?? []} onSaved={() => void qc.invalidateQueries({ queryKey: QK })} />
        </ConfigSubsection>
        <ConfigSubsection title="Faixas de pessoal" description="Percentual sobre a base direta Offset conforme a tiragem.">
          <FaixasTable items={faixasQ.data?.items ?? []} onSaved={() => void qc.invalidateQueries({ queryKey: QK })} />
        </ConfigSubsection>
      </ConfigSectionBody>
    </ConfigSection>
  );
}

function ParametrosBlock({
  items,
  onSaved,
}: {
  items: OrcamentoParametroRecord[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const item of items) next[item.chave] = item.valor;
    setDraft(next);
  }, [items]);

  const mut = useMutation({
    mutationFn: () => updateOrcamentoParametros(draft),
    onSuccess: onSaved,
  });

  return (
    <ConfigSubsection title="Parâmetros de cálculo e textos do ofício">
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <label key={item.chave} className="block text-xs">
            <span className="font-medium text-slate-700">{item.descricao || item.chave}</span>
            <input
              className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-xs"
              value={draft[item.chave] ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, [item.chave]: e.target.value }))}
            />
            <span className="text-[10px] text-slate-400">{item.chave}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="mt-3 inline-flex items-center gap-1 rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white"
        onClick={() => mut.mutate()}
        disabled={mut.isPending}
      >
        {mut.isPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
        Salvar parâmetros
      </button>
    </ConfigSubsection>
  );
}

function InsumosTable({
  items,
  onSaved,
}: {
  items: OrcamentoInsumoRecord[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<Record<number, string>>({});
  const mut = useMutation({
    mutationFn: ({ id, bruto, item }: { id: number; bruto: number; item: OrcamentoInsumoRecord }) =>
      updateOrcamentoInsumo(id, {
        codigo: item.codigo,
        categoria: item.categoria,
        especificacao: item.especificacao,
        unidade: item.unidade,
        qtd_embalagem: item.qtd_embalagem,
        preco_bruto: bruto,
        rendimento_a4: item.rendimento_a4,
        formato_folha: item.formato_folha,
        aliases: item.aliases,
        atualizado_em: new Date().toISOString().slice(0, 10),
        ativo: item.ativo,
      }),
    onSuccess: onSaved,
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50 text-left text-[0.65rem] uppercase text-slate-500">
            <th className="px-2 py-1.5">Cód</th>
            <th className="px-2 py-1.5">Especificação</th>
            <th className="px-2 py-1.5">Qtd</th>
            <th className="px-2 py-1.5">Preço bruto</th>
            <th className="px-2 py-1.5">SKU estoque</th>
            <th className="px-2 py-1.5">Custo estoque</th>
            <th className="px-2 py-1.5">Unitário</th>
            <th className="px-2 py-1.5">A4</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-slate-100">
              <td className="px-2 py-1 font-mono">{item.codigo}</td>
              <td className="px-2 py-1">{item.especificacao}</td>
              <td className="px-2 py-1 tabular-nums">{item.qtd_embalagem}</td>
              <td className="px-2 py-1">
                <input
                  className="w-24 rounded border border-slate-200 px-1 py-0.5 text-right"
                  value={editing[item.id] ?? String(item.preco_bruto)}
                  onChange={(e) => setEditing((p) => ({ ...p, [item.id]: e.target.value }))}
                  onBlur={() => {
                    const raw = (editing[item.id] ?? "").replace(",", ".");
                    const n = Number(raw);
                    if (Number.isFinite(n) && n !== item.preco_bruto) {
                      mut.mutate({ id: item.id, bruto: n, item });
                    }
                  }}
                />
              </td>
              <td className="px-2 py-1 font-mono text-slate-600">
                {item.estoque_sku_codigo ?? "—"}
              </td>
              <td className="px-2 py-1 tabular-nums text-slate-600">
                {item.custo_estoque != null ? money(item.custo_estoque) : "—"}
              </td>
              <td className="px-2 py-1 tabular-nums">
                {money(item.preco_unitario)}
                {item.custo_estoque != null ? (
                  <span className="ml-1 text-[10px] text-slate-400">estoque</span>
                ) : null}
              </td>
              <td className="px-2 py-1 tabular-nums">{item.rendimento_a4 ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    <table className="w-full max-w-xl border-collapse text-xs">
      <thead>
        <tr className="bg-slate-50 text-left text-[0.65rem] uppercase text-slate-500">
          <th className="px-2 py-1.5">Formato</th>
          <th className="px-2 py-1.5">Menor mm</th>
          <th className="px-2 py-1.5">Maior mm</th>
          <th className="px-2 py-1.5">Fator A4</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-t border-slate-100">
            <td className="px-2 py-1 font-medium">{item.codigo}</td>
            <td className="px-2 py-1">
              <input
                className="w-20 rounded border px-1 py-0.5 text-right"
                defaultValue={item.menor_mm}
                onBlur={(e) => {
                  const n = Number(e.target.value.replace(",", "."));
                  if (Number.isFinite(n) && n !== item.menor_mm) {
                    mut.mutate({ ...item, menor_mm: n });
                  }
                }}
              />
            </td>
            <td className="px-2 py-1">
              <input
                className="w-20 rounded border px-1 py-0.5 text-right"
                defaultValue={item.maior_mm}
                onBlur={(e) => {
                  const n = Number(e.target.value.replace(",", "."));
                  if (Number.isFinite(n) && n !== item.maior_mm) {
                    mut.mutate({ ...item, maior_mm: n });
                  }
                }}
              />
            </td>
            <td className="px-2 py-1">
              <input
                className="w-20 rounded border px-1 py-0.5 text-right"
                defaultValue={item.fator_a4}
                onBlur={(e) => {
                  const n = Number(e.target.value.replace(",", "."));
                  if (Number.isFinite(n) && n !== item.fator_a4) {
                    mut.mutate({ ...item, fator_a4: n });
                  }
                }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
    <table className="w-full max-w-lg border-collapse text-xs">
      <thead>
        <tr className="bg-slate-50 text-left text-[0.65rem] uppercase text-slate-500">
          <th className="px-2 py-1.5">De</th>
          <th className="px-2 py-1.5">Até</th>
          <th className="px-2 py-1.5">Percentual</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-t border-slate-100">
            <td className="px-2 py-1 tabular-nums">{item.limite_inf}</td>
            <td className="px-2 py-1 tabular-nums">{item.limite_sup ?? "∞"}</td>
            <td className="px-2 py-1">
              <input
                className="w-24 rounded border px-1 py-0.5 text-right"
                defaultValue={item.percentual}
                onBlur={(e) => {
                  const n = Number(e.target.value.replace(",", "."));
                  if (Number.isFinite(n) && n !== item.percentual) {
                    mut.mutate({ ...item, percentual: n });
                  }
                }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
