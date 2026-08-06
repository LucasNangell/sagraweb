import { Loader2, X } from "lucide-react";

interface ChapaItem {
  maquina: string;
  quantidade: number;
}

interface GravacaoConcluirInterceptModalProps {
  open: boolean;
  osLabel: string;
  chapas: ChapaItem[];
  pendingSituacao: string;
  pendingSetor: string;
  saving?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function GravacaoConcluirInterceptModal({
  open,
  osLabel,
  chapas,
  pendingSituacao,
  pendingSetor,
  saving = false,
  onClose,
  onConfirm,
}: GravacaoConcluirInterceptModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Concluir Gravação Externa antes do andamento"
    >
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-secondary-blue">
              Concluir Gravação Externa
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">OS {osLabel}</p>
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

        <div className="space-y-3 px-4 py-4 text-sm text-slate-700">
          <p>
            Esta OS está em <strong>Grav. Externa</strong>. Antes de lançar{" "}
            <strong>
              {pendingSituacao} / {pendingSetor}
            </strong>
            , o sistema registrará <strong>Gravação Ext. Concluída / SEGEP</strong>.
          </p>

          {chapas.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Chapas
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
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              Quantidade de chapas não informada (será registrada como não informado).
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded bg-secondary-blue px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Confirmar e continuar
          </button>
        </div>
      </div>
    </div>
  );
}
