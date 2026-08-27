import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  copyProdutoPassos,
  fetchProdutoPassos,
  saveProdutoPassos,
} from "@/api/adminSystem";
import type { ProdutoPassoRecord } from "@/features/configuracoes/types";

const EMPTY_PASSO = (): ProdutoPassoRecord => ({
  ordem: 10,
  nome: "",
  setor_link: "",
  tipo: "produtiva",
  cobra_pessoal: true,
  tecnologia: "qualquer",
  setup_min: 0,
  min_por_un: 0,
  min_por_pag: 0,
  min_por_folha: 0,
  funcoes: [],
});

export function ProdutoEtapasPanel({
  catalogId,
  rotulo,
}: {
  catalogId: number;
  rotulo: string;
}) {
  const qc = useQueryClient();
  const queryKey = ["admin", "produto-passos", catalogId] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => fetchProdutoPassos(catalogId),
  });
  const [draft, setDraft] = useState<ProdutoPassoRecord[]>([]);
  const [copyFrom, setCopyFrom] = useState("");

  useEffect(() => {
    if (query.data?.passos) setDraft(query.data.passos);
  }, [query.data]);

  const saveMut = useMutation({
    mutationFn: () =>
      saveProdutoPassos(catalogId, {
        rotulo,
        passos: draft.map((p, i) => ({ ...p, ordem: (i + 1) * 10 })),
      }),
    onSuccess: (data) => {
      setDraft(data.passos);
      void qc.invalidateQueries({ queryKey });
    },
    onError: (err) =>
      window.alert(err instanceof Error ? err.message : "Falha ao salvar etapas."),
  });

  const copyMut = useMutation({
    mutationFn: () => copyProdutoPassos(catalogId, Number(copyFrom), rotulo),
    onSuccess: (data) => {
      setDraft(data.passos);
      void qc.invalidateQueries({ queryKey });
    },
    onError: (err) =>
      window.alert(err instanceof Error ? err.message : "Falha ao copiar etapas."),
  });

  const setores = query.data?.setores ?? [];
  const funcoes = (query.data?.funcoes ?? []).filter((f) => f.alocacao !== "overhead");
  const produtos = (query.data?.produtos ?? []).filter((p) => p.id !== catalogId);

  if (query.isPending) {
    return (
      <div className="mx-3 mb-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-500">
        <Loader2 className="size-3 animate-spin" />
        Carregando etapas…
      </div>
    );
  }
  if (query.isError) {
    return (
      <p className="mx-3 mb-3 text-xs text-red-600">
        {query.error instanceof Error ? query.error.message : "Erro ao carregar etapas."}
      </p>
    );
  }

  return (
    <div className="mx-3 mb-3 rounded-md border border-slate-200 bg-slate-50/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Etapas de produção
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {produtos.length > 0 ? (
            <>
              <select
                className="h-7 rounded border border-slate-200 bg-white px-1 text-[11px]"
                value={copyFrom}
                onChange={(e) => setCopyFrom(e.target.value)}
              >
                <option value="">Copiar de…</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!copyFrom || copyMut.isPending}
                onClick={() => void copyMut.mutate()}
                className="h-7 rounded border border-slate-200 bg-white px-2 text-[11px] font-semibold disabled:opacity-50"
              >
                Copiar
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setDraft((d) => [...d, EMPTY_PASSO()])}
            className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-semibold"
          >
            <Plus className="size-3" />
            Etapa
          </button>
          <button
            type="button"
            disabled={saveMut.isPending}
            onClick={() => void saveMut.mutate()}
            className="inline-flex h-7 items-center gap-1 rounded bg-secondary-blue px-2 text-[11px] font-semibold text-white disabled:opacity-60"
          >
            {saveMut.isPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            Salvar
          </button>
        </div>
      </div>

      {draft.length === 0 ? (
        <p className="px-3 py-2 text-xs italic text-slate-400">
          Nenhuma etapa. O orçamento usará o percentual da planilha até você cadastrar o fluxo.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {draft.map((passo, idx) => (
            <li key={passo.id ?? `new-${idx}`} className="space-y-2 px-3 py-2">
              <div className="grid gap-2 sm:grid-cols-4">
                <input
                  className="h-7 rounded border px-2 text-xs"
                  placeholder="Nome da etapa"
                  value={passo.nome}
                  onChange={(e) =>
                    setDraft((d) => d.map((p, i) => (i === idx ? { ...p, nome: e.target.value } : p)))
                  }
                />
                <select
                  className="h-7 rounded border px-1 text-xs"
                  value={passo.setor_link}
                  onChange={(e) =>
                    setDraft((d) =>
                      d.map((p, i) => (i === idx ? { ...p, setor_link: e.target.value } : p)),
                    )
                  }
                >
                  <option value="">Setor…</option>
                  {setores.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  className="h-7 rounded border px-1 text-xs"
                  value={passo.tipo}
                  onChange={(e) => {
                    const tipo = e.target.value;
                    const cobra = tipo === "produtiva";
                    setDraft((d) =>
                      d.map((p, i) =>
                        i === idx ? { ...p, tipo, cobra_pessoal: cobra } : p,
                      ),
                    );
                  }}
                >
                  <option value="produtiva">Produtiva</option>
                  <option value="espera_cliente">Espera do cliente (R$ 0)</option>
                  <option value="fim">Fim / expedição (R$ 0)</option>
                </select>
                <select
                  className="h-7 rounded border px-1 text-xs"
                  value={passo.tecnologia}
                  onChange={(e) =>
                    setDraft((d) =>
                      d.map((p, i) => (i === idx ? { ...p, tecnologia: e.target.value } : p)),
                    )
                  }
                >
                  <option value="qualquer">Qualquer tecnologia</option>
                  <option value="digital">Só Digital</option>
                  <option value="offset">Só Offset</option>
                </select>
              </div>
              {passo.tipo === "produtiva" ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ["setup_min", "Setup (min)"],
                      ["min_por_un", "Min / un."],
                      ["min_por_pag", "Min / pág."],
                      ["min_por_folha", "Min / folha"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="text-[10px] text-slate-500">
                      {label}
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="mt-0.5 h-7 w-full rounded border px-2 text-xs"
                        value={passo[key]}
                        onChange={(e) =>
                          setDraft((d) =>
                            d.map((p, i) =>
                              i === idx ? { ...p, [key]: Number(e.target.value) || 0 } : p,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              ) : null}
              {passo.tipo === "produtiva" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase text-slate-500">Funções</span>
                  {(passo.funcoes || []).map((crew, ci) => (
                    <span
                      key={`${crew.funcao_id}-${ci}`}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-slate-200"
                    >
                      {crew.nome || funcoes.find((f) => f.id === crew.funcao_id)?.nome || crew.funcao_id}
                      ×
                      <input
                        type="number"
                        min={0.1}
                        step={0.5}
                        className="w-12 rounded border px-1 text-[11px]"
                        value={crew.quantidade}
                        onChange={(e) => {
                          const qtd = Number(e.target.value) || 1;
                          setDraft((d) =>
                            d.map((p, i) =>
                              i === idx
                                ? {
                                    ...p,
                                    funcoes: p.funcoes.map((c, j) =>
                                      j === ci ? { ...c, quantidade: qtd } : c,
                                    ),
                                  }
                                : p,
                            ),
                          );
                        }}
                      />
                      <button
                        type="button"
                        className="text-red-500"
                        onClick={() =>
                          setDraft((d) =>
                            d.map((p, i) =>
                              i === idx
                                ? { ...p, funcoes: p.funcoes.filter((_, j) => j !== ci) }
                                : p,
                            ),
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <select
                    className="h-7 rounded border px-1 text-[11px]"
                    value=""
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const fn = funcoes.find((f) => f.id === id);
                      if (!fn) return;
                      setDraft((d) =>
                        d.map((p, i) =>
                          i === idx
                            ? {
                                ...p,
                                funcoes: [
                                  ...p.funcoes,
                                  { funcao_id: fn.id, quantidade: 1, nome: fn.nome },
                                ],
                              }
                            : p,
                        ),
                      );
                    }}
                  >
                    <option value="">+ função</option>
                    {funcoes
                      .filter((f) => !(passo.funcoes || []).some((c) => c.funcao_id === f.id))
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}
              {passo.aprendido && (passo.aprendido.n || 0) > 0 ? (
                <p className="text-[10px] text-slate-500">
                  Aprendizado: n={passo.aprendido.n}
                  {passo.aprendido.mediana_horas != null
                    ? ` · mediana ${passo.aprendido.mediana_horas.toFixed(2)} h`
                    : ""}
                  {passo.setup_min
                    ? ` · prior ${(passo.setup_min / 60).toFixed(2)} h de setup`
                    : ""}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={idx === 0}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-600 disabled:opacity-40"
                  onClick={() =>
                    setDraft((d) => {
                      if (idx === 0) return d;
                      const next = d.slice();
                      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                      return next;
                    })
                  }
                >
                  <ChevronUp className="size-3" />
                  Subir
                </button>
                <button
                  type="button"
                  disabled={idx === draft.length - 1}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-600 disabled:opacity-40"
                  onClick={() =>
                    setDraft((d) => {
                      if (idx >= d.length - 1) return d;
                      const next = d.slice();
                      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                      return next;
                    })
                  }
                >
                  <ChevronDown className="size-3" />
                  Descer
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-red-600"
                  onClick={() => setDraft((d) => d.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="size-3" />
                  Remover etapa
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
