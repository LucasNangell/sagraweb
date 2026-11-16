import { cn } from "@sagra/ui";
import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  PapelariaImposicaoCandidata,
  PapelariaImposicaoOpcoes,
} from "@/api/papelaria";
import {
  ImposicaoConfigEditor,
  validateImposicaoConfigObject,
  type PapelariaImposicaoConfig,
  type PapelariaImposicaoVariante,
} from "@/features/papelaria/imposicao";
import { isPreImpressoImposicaoProduct } from "@/features/papelaria/papelariaSession";

const TABS: { id: PapelariaImposicaoVariante; label: string }[] = [
  { id: "digital", label: "Digital" },
  { id: "offset", label: "Offset" },
];

function asConfig(raw: unknown): PapelariaImposicaoConfig | null {
  if (!raw) return null;
  try {
    // Leitura permissiva: PDF de marcas pode estar vazio e ser preenchido aqui.
    return validateImposicaoConfigObject(raw, { requireMarcasPdf: false });
  } catch {
    return null;
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function previewSlots(
  produto: string,
  tiragens: number[],
  maxSlots: number,
): { ok: boolean; slots: number[]; total: number; message?: string } {
  if (!tiragens.length) {
    return { ok: false, slots: [], total: 0, message: "Sem tiragens." };
  }
  const name = produto.trim().toLowerCase();
  if (name.startsWith("pasta avulso")) {
    if (new Set(tiragens).size !== 1) {
      return {
        ok: false,
        slots: [],
        total: 0,
        message: "Pasta: tiragens devem ser iguais.",
      };
    }
    const slots = tiragens.map(() => 1);
    const total = slots.reduce((a, b) => a + b, 0);
    if (total > maxSlots) {
      return {
        ok: false,
        slots,
        total,
        message: `Pasta: máximo ${maxSlots} OS(s).`,
      };
    }
    return { ok: true, slots, total };
  }
  if (name === "timbrado a4") {
    const unit = tiragens.reduce((g, t) => gcd(g, t), tiragens[0] ?? 1);
    const slots = tiragens.map((t) => Math.floor(t / unit));
    const total = slots.reduce((a, b) => a + b, 0);
    if (total > maxSlots) {
      return {
        ok: false,
        slots,
        total,
        message: `Timbrado: slots ${slots.join("+")} = ${total} (máx. ${maxSlots}).`,
      };
    }
    return { ok: true, slots, total };
  }
  return { ok: false, slots: [], total: 0, message: "Produto sem juntada." };
}

export function PapelariaImposicaoOsModal({
  open,
  opcoes,
  loading,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  opcoes: PapelariaImposicaoOpcoes | null;
  loading?: boolean;
  submitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (payload: {
    variante: PapelariaImposicaoVariante;
    imposicao_config: PapelariaImposicaoConfig;
    juntada_os?: Array<{ ano: number; nro: number }>;
  }) => void;
}) {
  const disponiveis = useMemo(() => {
    return (opcoes?.variantes_disponiveis || []).filter(
      (v): v is PapelariaImposicaoVariante =>
        v === "digital" || v === "offset",
    );
  }, [opcoes]);

  const [tab, setTab] = useState<PapelariaImposicaoVariante>("digital");
  const [drafts, setDrafts] = useState<
    Record<PapelariaImposicaoVariante, PapelariaImposicaoConfig | null>
  >({ digital: null, offset: null });
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !opcoes) return;
    const digital = asConfig(opcoes.digital);
    const offset = asConfig(opcoes.offset);
    setDrafts({ digital, offset });
    const first =
      (opcoes.variantes_disponiveis || []).find(
        (v): v is PapelariaImposicaoVariante =>
          v === "digital" || v === "offset",
      ) || (digital ? "digital" : offset ? "offset" : "digital");
    setTab(first);
    setLocalError(null);
    setSelectedKeys(new Set());
  }, [open, opcoes]);

  if (!open) return null;

  const current = drafts[tab];
  const fonte = opcoes?.fontes?.[tab];
  const tabsVisiveis = TABS.filter((t) => disponiveis.includes(t.id));
  const produto = (opcoes?.produto || opcoes?.juntada?.ancora?.produto || "").trim();
  const juntada = opcoes?.juntada;
  const showJuntada =
    Boolean(current?.usar_pre_impresso) &&
    isPreImpressoImposicaoProduct(produto) &&
    Boolean(juntada);
  const candidatas: PapelariaImposicaoCandidata[] = juntada?.candidatas || [];
  const ancoraTiragem = Number(juntada?.ancora?.tiragem || 0);
  const maxSlots = Number(juntada?.max_slots || 1);

  const selectedCands = candidatas.filter((c) =>
    selectedKeys.has(`${c.ano}-${c.nro}`),
  );
  const tiragensPreview = [
    ancoraTiragem,
    ...selectedCands.map((c) => Number(c.tiragem) || 0),
  ].filter((t) => t > 0);
  const slotsPreview = showJuntada
    ? previewSlots(produto, tiragensPreview, maxSlots)
    : null;

  const toggleCand = (c: PapelariaImposicaoCandidata) => {
    const key = `${c.ano}-${c.nro}`;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setLocalError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Imposição (JDF)</h2>
            <p className="text-[11px] text-slate-500">
              Escolha Digital ou Offset. Os valores vêm do produto/modelo e
              podem ser ajustados só para esta geração.
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="border-b border-slate-100 px-4 py-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {tabsVisiveis.map((t) => (
              <button
                key={t.id}
                type="button"
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-semibold",
                  tab === t.id
                    ? "bg-white text-secondary-blue shadow-sm"
                    : "text-slate-600 hover:text-slate-900",
                )}
                onClick={() => {
                  setTab(t.id);
                  setLocalError(null);
                }}
              >
                {t.label}
                {fonte && tab === t.id ? (
                  <span className="ml-1 font-normal text-slate-400">
                    ({fonte})
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-600">
              <Loader2 className="size-4 animate-spin" />
              Carregando configurações…
            </div>
          ) : current ? (
            <div className="flex flex-col gap-4">
              <ImposicaoConfigEditor
                config={current}
                produto={produto}
                onChange={(next) =>
                  setDrafts((prev) => ({ ...prev, [tab]: next }))
                }
              />
              {showJuntada ? (
                <section className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                  <h3 className="text-xs font-bold text-slate-800">
                    Juntada (pré-impresso)
                  </h3>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Andamento: {juntada?.situacao || "—"}. Âncora tiragem{" "}
                    {ancoraTiragem || "—"}. Máx. {maxSlots} slot(s) na folha.
                  </p>
                  {candidatas.length === 0 ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Nenhuma OS compatível no mesmo status.
                    </p>
                  ) : (
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                      {candidatas.map((c) => {
                        const key = `${c.ano}-${c.nro}`;
                        const checked = selectedKeys.has(key);
                        return (
                          <li key={key}>
                            <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs text-slate-700 hover:bg-white">
                              <input
                                type="checkbox"
                                className="mt-0.5 size-3.5 rounded border-slate-300"
                                checked={checked}
                                onChange={() => toggleCand(c)}
                              />
                              <span>
                                <span className="font-semibold">
                                  {String(c.nro).padStart(5, "0")}
                                </span>
                                {" — "}
                                {c.label || c.produto}
                                <span className="text-slate-400">
                                  {" "}
                                  · tiragem {c.tiragem}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {slotsPreview ? (
                    <p
                      className={cn(
                        "mt-2 text-[11px]",
                        slotsPreview.ok ? "text-slate-600" : "text-amber-700",
                      )}
                    >
                      {slotsPreview.ok
                        ? `Slots: ${slotsPreview.slots.join(" + ")} = ${slotsPreview.total}`
                        : slotsPreview.message}
                    </p>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : (
            <p className="py-6 text-sm text-amber-700">
              Nenhuma configuração {tab} disponível. Configure o padrão do
              produto ou o override do modelo.
            </p>
          )}
        </div>

        {(localError || error) && (
          <p className="px-4 pb-2 text-xs text-red-600">{localError || error}</p>
        )}

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            disabled={submitting || loading || !current}
            onClick={() => {
              if (!current) {
                setLocalError(`Configure a imposição ${tab} antes de gerar.`);
                return;
              }
              try {
                const cfg = validateImposicaoConfigObject(current, {
                  requireMarcasPdf: true,
                });
                if (
                  cfg.usar_pre_impresso &&
                  isPreImpressoImposicaoProduct(produto) &&
                  selectedCands.length > 0
                ) {
                  const check = previewSlots(
                    produto,
                    [
                      ancoraTiragem,
                      ...selectedCands.map((c) => Number(c.tiragem) || 0),
                    ],
                    maxSlots,
                  );
                  if (!check.ok) {
                    setLocalError(check.message || "Juntada incompatível.");
                    return;
                  }
                }
                onConfirm({
                  variante: tab,
                  imposicao_config: cfg,
                  juntada_os: selectedCands.map((c) => ({
                    ano: c.ano,
                    nro: c.nro,
                  })),
                });
              } catch (e) {
                setLocalError(
                  e instanceof Error ? e.message : "Configuração inválida.",
                );
              }
            }}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            Gerar JDF {tab}
          </button>
        </footer>
      </div>
    </div>
  );
}
