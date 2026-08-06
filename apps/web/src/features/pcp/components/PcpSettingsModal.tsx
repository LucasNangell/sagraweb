import { X } from "lucide-react";
import { useState } from "react";

import type { PcpConfig } from "../pcpConfigStore";

interface PcpSettingsModalProps {
  open: boolean;
  setores: string[];
  andamentos: string[];
  config: PcpConfig;
  onClose: () => void;
  onSave: (config: PcpConfig) => void;
}

export function PcpSettingsModal({
  open,
  setores,
  andamentos,
  config,
  onClose,
  onSave,
}: PcpSettingsModalProps) {
  const [temp, setTemp] = useState<PcpConfig>(config);
  const [modalSetor, setModalSetor] = useState(
    config.selectedSetores[0] ?? setores[0] ?? "",
  );

  if (!open) {
    return null;
  }

  const toggleSetor = (setor: string) => {
    const list = new Set(temp.selectedSetores);
    if (list.has(setor)) {
      list.delete(setor);
    } else {
      list.add(setor);
    }
    const next = Array.from(list);
    setTemp((t) => ({ ...t, selectedSetores: next }));
    if (!next.includes(modalSetor)) {
      setModalSetor(next[0] ?? "");
    }
  };

  const toggleAndamento = (andamento: string) => {
    if (!modalSetor) {
      return;
    }
    const filters = { ...temp.filters };
    const set = new Set(filters[modalSetor] ?? []);
    if (set.has(andamento)) {
      set.delete(andamento);
    } else {
      set.add(andamento);
    }
    filters[modalSetor] = Array.from(set);
    setTemp((t) => ({ ...t, filters }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-sagra-border px-4 py-3">
          <h2 className="text-lg font-semibold text-secondary-blue">
            Configurações do PCP
          </h2>
          <button type="button" onClick={onClose} className="p-1 text-neutral-500">
            <X className="size-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-6 overflow-y-auto p-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-700">
              Setores exibidos
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {setores.map((setor) => (
                <label
                  key={setor}
                  className="flex cursor-pointer items-center gap-2 rounded border border-sagra-border px-2 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={temp.selectedSetores.includes(setor)}
                    onChange={() => toggleSetor(setor)}
                    className="accent-primary-green"
                  />
                  {setor}
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-neutral-700">
              Andamentos por setor
            </h3>
            <div className="mb-3 flex gap-2">
              <select
                value={modalSetor}
                onChange={(e) => setModalSetor(e.target.value)}
                className="h-9 flex-1 rounded border border-sagra-border px-2 text-sm"
              >
                {temp.selectedSetores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!modalSetor}
                onClick={() => {
                  const filters = { ...temp.filters };
                  delete filters[modalSetor];
                  setTemp((t) => ({ ...t, filters }));
                }}
                className="rounded border border-sagra-border px-3 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Limpar
              </button>
            </div>
            <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {andamentos.map((and) => (
                <label
                  key={and}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={(temp.filters[modalSetor] ?? []).includes(and)}
                    onChange={() => toggleAndamento(and)}
                    className="accent-primary-green"
                  />
                  {and}
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-sagra-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-sagra-border px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onSave(temp)}
            className="rounded bg-primary-green px-4 py-2 text-sm font-semibold text-white"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
