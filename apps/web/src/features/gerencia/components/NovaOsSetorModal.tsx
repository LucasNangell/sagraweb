import { useEffect, useMemo, useState } from "react";

import { useSetoresLookup } from "@/api/hooks/useAuxLookups";
import { homeTestIds } from "@/lib/testId";

import { defaultEntradaInicialSetor } from "../utils";

export interface NovaOsSetorModalProps {
  open: boolean;
  defaultSetor?: string | null;
  confirming?: boolean;
  onClose: () => void;
  onConfirm: (setor: string) => void;
}

export function NovaOsSetorModal({
  open,
  defaultSetor,
  confirming = false,
  onClose,
  onConfirm,
}: NovaOsSetorModalProps) {
  const setoresQuery = useSetoresLookup();
  const initialSetor = defaultEntradaInicialSetor(defaultSetor);
  const [setor, setSetor] = useState(initialSetor);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSetor(defaultEntradaInicialSetor(defaultSetor));
  }, [open, defaultSetor]);

  const setores = useMemo(() => {
    const list = [...(setoresQuery.data ?? [])];
    for (const extra of [initialSetor, setor]) {
      if (extra && !list.includes(extra)) {
        list.unshift(extra);
      }
    }
    return list;
  }, [setoresQuery.data, initialSetor, setor]);

  if (!open) {
    return null;
  }

  const canConfirm = Boolean(setor.trim()) && !confirming;

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nova-os-setor-title"
      data-testid={homeTestIds.osNovaSetorRoot}
    >
      <div className="w-full max-w-md rounded-lg border-t-4 border-primary-green bg-white p-6 shadow-xl">
        <h3
          id="nova-os-setor-title"
          className="text-lg font-semibold text-primary-green"
        >
          Setor da nova OS
        </h3>
        <p className="mt-2 text-sm text-neutral-600">
          A OS será criada com andamento{" "}
          <span className="font-semibold">Entrada Inicial</span> no setor{" "}
          <span className="font-semibold">{setor.trim() || initialSetor}</span>.
          Altere abaixo se necessário.
        </p>

        <label className="mt-4 block text-xs">
          <span className="font-semibold text-neutral-700">Setor</span>
          <select
            value={setor}
            disabled={confirming}
            onChange={(e) => setSetor(e.target.value)}
            className="mt-0.5 h-9 w-full rounded border border-sagra-border px-2 text-sm disabled:bg-slate-50"
            data-testid={homeTestIds.osNovaSetorSelect}
          >
            {setores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={confirming}
            onClick={onClose}
            className="rounded border border-sagra-border px-4 py-2 text-sm disabled:opacity-60"
            data-testid={homeTestIds.osNovaSetorCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm(setor.trim())}
            className="rounded bg-primary-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            data-testid={homeTestIds.osNovaSetorConfirm}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
