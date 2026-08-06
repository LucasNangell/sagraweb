import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@sagra/ui";

import {
  useGravacaoPendenteConfigDetalhes,
  usePutGravacaoPendenteFornecedorCotasMutation,
} from "@/api/hooks/useGravacaoPendente";
import type {
  GravacaoPendenteFornecedorCotasMap,
  GravacaoPendenteFornecedorPrecosMap,
} from "@/api/gravacaoPendente";

const FIXED_MAQUINAS = ["Komori", "SM74", "PM52"] as const;

interface GravacaoPendenteDetalhesModalProps {
  open: boolean;
  onClose: () => void;
}

interface FornecedorDraft {
  ponto: string;
  nome?: string | null;
  cotas: Record<(typeof FIXED_MAQUINAS)[number], string>;
  precos: Record<(typeof FIXED_MAQUINAS)[number], string>;
}

/** Soma cotas do draft fornecedor×máquina; inválidos/vazios contam como 0. */
export function sumCotasFromFornecedorDrafts(
  fornecedores: ReadonlyArray<{
    cotas: Record<(typeof FIXED_MAQUINAS)[number], string>;
  }>,
): { maquinaKpis: { maquina: (typeof FIXED_MAQUINAS)[number]; cota: number }[]; total: number } {
  const maquinaKpis = FIXED_MAQUINAS.map((maquina) => {
    let cota = 0;
    for (const f of fornecedores) {
      const n = Number(f.cotas[maquina] ?? "0");
      if (Number.isFinite(n) && n >= 0) cota += n;
    }
    return { maquina, cota };
  });
  const total = maquinaKpis.reduce((acc, k) => acc + k.cota, 0);
  return { maquinaKpis, total };
}

export function GravacaoPendenteDetalhesModal({
  open,
  onClose,
}: GravacaoPendenteDetalhesModalProps) {
  const configQuery = useGravacaoPendenteConfigDetalhes(open);
  const putFornecedorMutation = usePutGravacaoPendenteFornecedorCotasMutation();

  const configReady = configQuery.isSuccess && configQuery.data != null;
  const configLoading = configQuery.isLoading;

  const [fornecedores, setFornecedores] = useState<FornecedorDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!configReady || !configQuery.data) return;
    setFornecedores(
      (configQuery.data.fornecedor_cotas ?? []).map((f) => {
        const cotas = f.cotas ?? ({} as GravacaoPendenteFornecedorCotasMap);
        const precos = f.precos ?? ({} as GravacaoPendenteFornecedorPrecosMap);
        return {
          ponto: f.ponto,
          nome: f.nome,
          cotas: {
            Komori: String(cotas.Komori ?? 0),
            SM74: String(cotas.SM74 ?? 0),
            PM52: String(cotas.PM52 ?? 0),
          },
          precos: {
            Komori: String(precos.Komori ?? 0),
            SM74: String(precos.SM74 ?? 0),
            PM52: String(precos.PM52 ?? 0),
          },
        };
      }),
    );
  }, [configReady, configQuery.data]);

  const { maquinaKpis, total: cotaTotalGeral } = useMemo(
    () => sumCotasFromFornecedorDrafts(fornecedores),
    [fornecedores],
  );

  if (!open) {
    return null;
  }

  const busy = putFornecedorMutation.isPending;

  const handleSave = async () => {
    setError(null);
    const payload: {
      ponto: string;
      maquina: string;
      cota_chapas: number;
      preco_chapa: number;
    }[] = [];
    for (const f of fornecedores) {
      for (const maquina of FIXED_MAQUINAS) {
        const cota = Number(f.cotas[maquina] ?? "0");
        if (!Number.isFinite(cota) || cota < 0 || !Number.isInteger(cota)) {
          setError(`Cota inválida para ${f.nome || f.ponto} / ${maquina}.`);
          return;
        }
        const preco = Number(f.precos[maquina] ?? "0");
        if (!Number.isFinite(preco) || preco < 0) {
          setError(`Preço inválido para ${f.nome || f.ponto} / ${maquina}.`);
          return;
        }
        payload.push({
          ponto: f.ponto,
          maquina,
          cota_chapas: cota,
          preco_chapa: preco,
        });
      }
    }
    try {
      await putFornecedorMutation.mutateAsync(payload);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível salvar cotas e preços por fornecedor/máquina.",
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Detalhes de cotas e preços"
    >
      <div className="flex max-h-[min(90vh,820px)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-secondary-blue">
              Detalhes — cotas e preços
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Cotas totais por máquina são a soma das cotas por fornecedor.
              Informe cotas e preços por fornecedor × máquina.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Resumo de cotas
            </h4>
            {configLoading ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-lg bg-neutral-100"
                    aria-hidden
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {maquinaKpis.map((k) => (
                  <div
                    key={k.maquina}
                    className="rounded-lg border border-slate-200 bg-gradient-to-b from-slate-50 to-white px-3 py-2.5"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {k.maquina}
                    </p>
                    <p
                      className="mt-1 text-xl font-semibold tabular-nums text-neutral-900"
                      aria-label={`Cota total ${k.maquina}`}
                    >
                      {k.cota}
                    </p>
                  </div>
                ))}
                <div className="rounded-lg border border-primary-green/30 bg-gradient-to-b from-primary-green/10 to-white px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-green">
                    Cota total geral
                  </p>
                  <p
                    className="mt-1 text-xl font-semibold tabular-nums text-neutral-900"
                    aria-label="Cota total geral"
                  >
                    {cotaTotalGeral}
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Cotas e preços por fornecedor × máquina
            </h4>
            {configLoading ? (
              <div className="space-y-2">
                <div className="h-10 animate-pulse rounded bg-neutral-100" />
                <div className="h-10 animate-pulse rounded bg-neutral-100" />
              </div>
            ) : !configReady ? (
              <p className="text-xs text-neutral-500">
                Configuração de fornecedores ainda não disponível no servidor.
              </p>
            ) : fornecedores.length === 0 ? (
              <p className="text-xs text-neutral-500">Nenhum fornecedor cadastrado.</p>
            ) : (
              <>
                <div className="space-y-3">
                  {fornecedores.map((f, idx) => (
                    <div
                      key={f.ponto}
                      className="overflow-hidden rounded-lg border border-slate-200"
                    >
                      <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="truncate text-sm font-medium text-neutral-800">
                          {f.nome || f.ponto}
                          {f.nome ? (
                            <span className="ml-1 text-xs font-normal text-neutral-500">
                              ({f.ponto})
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="overflow-x-auto p-2">
                        <table className="w-full min-w-[28rem] border-collapse text-sm">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                              <th className="px-1 py-1 font-semibold">Máquina</th>
                              <th className="px-1 py-1 font-semibold">Cota</th>
                              <th className="px-1 py-1 font-semibold">Preço (R$)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {FIXED_MAQUINAS.map((maquina) => (
                              <tr key={maquina} className="border-t border-slate-100">
                                <td className="px-1 py-1.5 font-medium text-neutral-800">
                                  {maquina}
                                </td>
                                <td className="px-1 py-1.5">
                                  <input
                                    type="number"
                                    min={0}
                                    value={f.cotas[maquina] ?? "0"}
                                    aria-label={`Cota ${f.nome || f.ponto} ${maquina}`}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setFornecedores((prev) =>
                                        prev.map((row, i) =>
                                          i === idx
                                            ? {
                                                ...row,
                                                cotas: { ...row.cotas, [maquina]: v },
                                              }
                                            : row,
                                        ),
                                      );
                                    }}
                                    className="w-full min-w-[5rem] rounded border border-neutral-300 px-1.5 py-1 text-xs"
                                  />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={f.precos[maquina] ?? "0"}
                                    aria-label={`Preço ${f.nome || f.ponto} ${maquina}`}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setFornecedores((prev) =>
                                        prev.map((row, i) =>
                                          i === idx
                                            ? {
                                                ...row,
                                                precos: {
                                                  ...row.precos,
                                                  [maquina]: v,
                                                },
                                              }
                                            : row,
                                        ),
                                      );
                                    }}
                                    className="w-full min-w-[5rem] rounded border border-neutral-300 px-1.5 py-1 text-xs"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSave()}
                  className={cn(
                    "inline-flex items-center gap-2 rounded bg-primary-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90",
                    busy && "opacity-50",
                  )}
                >
                  {putFornecedorMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Salvar cotas e preços
                </button>
              </>
            )}
          </section>

          {error ? (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
