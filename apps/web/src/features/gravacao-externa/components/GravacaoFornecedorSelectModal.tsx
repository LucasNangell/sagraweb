import { X } from "lucide-react";
import { useEffect, useState } from "react";

import type { GravacaoPendenteFornecedorItem } from "@/api/gravacaoPendente";

interface GravacaoFornecedorSelectModalProps {
  open: boolean;
  fornecedores: GravacaoPendenteFornecedorItem[];
  saving?: boolean;
  onClose: () => void;
  onConfirm: (fornecedorPonto: string) => void;
}

export function GravacaoFornecedorSelectModal({
  open,
  fornecedores,
  saving = false,
  onClose,
  onConfirm,
}: GravacaoFornecedorSelectModalProps) {
  const [selectedPonto, setSelectedPonto] = useState<string>("");

  useEffect(() => {
    if (open) {
      setSelectedPonto("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Selecionar fornecedor"
    >
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-secondary-blue">
              Selecionar fornecedor
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Escolha o fornecedor que receberá esta OS na Gravação Externa.
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

        <div className="space-y-2 px-4 py-4">
          {fornecedores.map((f) => {
            const checked = selectedPonto === f.ponto;
            return (
              <label
                key={f.ponto}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2.5 hover:bg-neutral-50"
              >
                <input
                  type="radio"
                  name="fornecedor"
                  value={f.ponto}
                  checked={checked}
                  onChange={() => setSelectedPonto(f.ponto)}
                  disabled={saving}
                />
                <span className="text-sm text-neutral-800">
                  <span className="font-medium">{f.nome || f.ponto}</span>
                  {f.nome ? (
                    <span className="ml-1 text-xs text-neutral-500">({f.ponto})</span>
                  ) : null}
                </span>
              </label>
            );
          })}
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
            disabled={saving || !selectedPonto}
            onClick={() => onConfirm(selectedPonto)}
            className="rounded bg-primary-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
