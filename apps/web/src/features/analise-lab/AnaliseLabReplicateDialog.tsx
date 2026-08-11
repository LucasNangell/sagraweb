import { useEffect, useMemo, useState } from "react";

import type { AnaliseLabItem } from "@/api/analiseLab";

interface AnaliseLabReplicateDialogProps {
  open: boolean;
  versaoLabel: string;
  items: AnaliseLabItem[];
  busy?: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    itemIds: number[];
    copiarMarcas: boolean;
  }) => void;
}

export function AnaliseLabReplicateDialog({
  open,
  versaoLabel,
  items,
  busy,
  onClose,
  onConfirm,
}: AnaliseLabReplicateDialogProps) {
  const sourceItems = useMemo(
    () =>
      items.filter(
        (i) => (i.versaoLabel || "(sem versão)") === versaoLabel,
      ),
    [items, versaoLabel],
  );
  const [selected, setSelected] = useState<number[]>([]);
  const [copiarMarcas, setCopiarMarcas] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(sourceItems.map((i) => i.id));
    setCopiarMarcas(false);
  }, [open, sourceItems]);

  if (!open) return null;

  const toggle = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal
      aria-label="Replicar problemas"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-sagra-border bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-neutral-900">
          Replicar de {versaoLabel}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Selecione os problemas técnicos para trazer à versão atual.
        </p>

        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto text-sm">
          {sourceItems.map((item) => (
            <li key={item.id}>
              <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-neutral-50">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.includes(item.id)}
                  onChange={() => toggle(item.id)}
                  disabled={busy}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.titulo}</span>
                  <span className="text-[11px] text-neutral-500">
                    {item.componente}
                  </span>
                </span>
              </label>
            </li>
          ))}
          {!sourceItems.length ? (
            <li className="text-xs text-neutral-400">Nenhum item nesta versão.</li>
          ) : null}
        </ul>

        <label className="mt-3 flex items-center gap-2 text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={copiarMarcas}
            onChange={(e) => setCopiarMarcas(e.target.checked)}
            disabled={busy}
          />
          Copiar marcas vinculadas
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-sagra-border px-3 py-1.5 text-xs"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || selected.length === 0}
            className="rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            onClick={() =>
              onConfirm({ itemIds: selected, copiarMarcas })
            }
          >
            Replicar ({selected.length})
          </button>
        </div>
      </div>
    </div>
  );
}
