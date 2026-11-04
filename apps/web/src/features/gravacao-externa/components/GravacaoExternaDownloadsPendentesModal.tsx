import { AlertTriangle, X } from "lucide-react";

import type { MaquinaDownloadPendente } from "@/features/gravacao-externa/utils/plateFilenameUtils";

interface GravacaoExternaDownloadsPendentesModalProps {
  open: boolean;
  maquinas: MaquinaDownloadPendente[] | string[];
  onClose: () => void;
}

function toItems(
  maquinas: MaquinaDownloadPendente[] | string[],
): MaquinaDownloadPendente[] {
  return maquinas.map((item) =>
    typeof item === "string"
      ? { key: item, label: item, quantidadeChapas: null }
      : item,
  );
}

function formatChapas(quantidade: number | null | undefined): string | null {
  if (quantidade == null || Number.isNaN(quantidade)) return null;
  const n = Math.max(0, Math.trunc(quantidade));
  return n === 1 ? "1 chapa" : `${n} chapas`;
}

export function GravacaoExternaDownloadsPendentesModal({
  open,
  maquinas,
  onClose,
}: GravacaoExternaDownloadsPendentesModalProps) {
  if (!open) return null;

  const items = toItems(maquinas);

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/70 p-3 sm:p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="downloads-pendentes-title"
      aria-describedby="downloads-pendentes-desc"
    >
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border-2 border-amber-500 bg-white shadow-2xl shadow-amber-900/20">
        <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-2 py-2.5">
          <span className="mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm">
            <AlertTriangle className="size-8" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3
              id="downloads-pendentes-title"
              className="text-base font-bold tracking-tight text-amber-950"
            >
              Conclusão de gravação desabilitada
            </h3>
            <p
              id="downloads-pendentes-desc"
              className="mt-1 text-sm font-medium text-amber-900"
            >
              Ainda há chapas pendentes de download. <br />
              Baixe os TIFFs ou PDF das respectivas máquinas.
            </p>

          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-amber-800/70 hover:bg-amber-100 hover:text-amber-950"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="bg-amber-50/40 px-4 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Máquinas pendentes
          </p>
          <ul className="mt-2 space-y-1.5">
            {items.map((item) => {
              const chapasLabel = formatChapas(item.quantidadeChapas);
              return (
                <li
                  key={item.key}
                  className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-950"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full bg-amber-500"
                      aria-hidden
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {chapasLabel ? (
                    <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                      {chapasLabel}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex justify-end border-t border-amber-200 bg-amber-50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-amber-600 bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}
