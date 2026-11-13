import { cn } from "@sagra/ui";
import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { PapelariaImposicaoOpcoes } from "@/api/papelaria";
import {
  ImposicaoConfigEditor,
  validateImposicaoConfigObject,
  type PapelariaImposicaoConfig,
  type PapelariaImposicaoVariante,
} from "@/features/papelaria/imposicao";

const TABS: { id: PapelariaImposicaoVariante; label: string }[] = [
  { id: "digital", label: "Digital" },
  { id: "offset", label: "Offset" },
];

function asConfig(raw: unknown): PapelariaImposicaoConfig | null {
  if (!raw) return null;
  try {
    return validateImposicaoConfigObject(raw);
  } catch {
    return null;
  }
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
  }, [open, opcoes]);

  if (!open) return null;

  const current = drafts[tab];
  const fonte = opcoes?.fontes?.[tab];
  const tabsVisiveis = TABS.filter((t) => disponiveis.includes(t.id));

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
            <ImposicaoConfigEditor
              config={current}
              onChange={(next) =>
                setDrafts((prev) => ({ ...prev, [tab]: next }))
              }
            />
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
                const cfg = validateImposicaoConfigObject(current);
                onConfirm({ variante: tab, imposicao_config: cfg });
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
