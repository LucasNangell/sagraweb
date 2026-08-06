import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { GravacaoExternaOsItem } from "@/api/gravacaoExterna";

export interface GravacaoExternaEntregaPayload {
  recebidoPorPonto: string;
  recebidoPorNome: string;
}

interface GravacaoExternaEntregaModalProps {
  open: boolean;
  item: GravacaoExternaOsItem | null;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (payload: GravacaoExternaEntregaPayload) => void;
}

function formatOsLabel(item: { nr_os: number; ano: number }): string {
  return `${String(item.nr_os).padStart(5, "0")}/${String(item.ano).slice(-2)}`;
}

export function GravacaoExternaEntregaModal({
  open,
  item,
  saving = false,
  onClose,
  onConfirm,
}: GravacaoExternaEntregaModalProps) {
  const [ponto, setPonto] = useState("");
  const [nome, setNome] = useState("");

  useEffect(() => {
    if (open) {
      setPonto("");
      setNome("");
    }
  }, [open, item?.ano, item?.nr_os]);

  if (!open || !item) {
    return null;
  }

  const chapas = item.chapas_por_maquina ?? [];
  const canConfirm = Boolean(ponto.trim() && nome.trim());

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Lançar recebimento das chapas"
    >
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-secondary-blue">
              Lançar recebimento das chapas
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              OS {formatOsLabel(item)}
              {item.solicitante ? ` · ${item.solicitante}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {chapas.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Chapas (somente leitura)
              </h4>
              <ul className="mt-1.5 flex flex-wrap gap-1.5 text-sm">
                {chapas.map((c) => (
                  <li
                    key={c.maquina}
                    className="rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-0.5"
                  >
                    {c.maquina}: <strong>{c.quantidade}</strong>
                  </li>
                ))}
              </ul>
              {item.total_chapas != null ? (
                <p className="mt-1 text-xs text-neutral-500">
                  Total: {item.total_chapas}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              Quantidade de chapas não informada na lista.
            </p>
          )}

          <label className="block text-xs text-neutral-600">
            Ponto de quem recebeu
            <input
              type="text"
              value={ponto}
              onChange={(e) => setPonto(e.target.value)}
              disabled={saving}
              placeholder="Ex.: 918713"
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
              autoFocus
            />
          </label>

          <label className="block text-xs text-neutral-600">
            Nome de quem recebeu
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={saving}
              placeholder="Nome completo"
              maxLength={128}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || !canConfirm}
            onClick={() =>
              onConfirm({
                recebidoPorPonto: ponto.trim(),
                recebidoPorNome: nome.trim(),
              })
            }
            className="inline-flex items-center gap-2 rounded bg-primary-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Confirmar recebimento
          </button>
        </div>
      </div>
    </div>
  );
}
