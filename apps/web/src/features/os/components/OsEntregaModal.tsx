import { useEffect, useState } from "react";

import type { ProtocoloEntregaPayload } from "../types";

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const emptyForm = (): ProtocoloEntregaPayload => ({
  data: todayIsoDate(),
  armazenado_em: "",
  recado_com: "",
  entregue_para: "",
  nr_ponto: "",
  data_entrega: todayIsoDate(),
  entregue_por: "",
  setor: "",
});

interface OsEntregaModalProps {
  open: boolean;
  defaults?: Partial<ProtocoloEntregaPayload>;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (payload: ProtocoloEntregaPayload) => void;
}

export function OsEntregaModal({
  open,
  defaults,
  saving = false,
  onClose,
  onConfirm,
}: OsEntregaModalProps) {
  const [form, setForm] = useState<ProtocoloEntregaPayload>(emptyForm);

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm({
      ...emptyForm(),
      ...defaults,
    });
  }, [open, defaults]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="entrega-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border-t-4 border-primary-green bg-white p-6 shadow-xl">
        <h3
          id="entrega-modal-title"
          className="text-lg font-semibold text-primary-green"
        >
          Dados de entrega
        </h3>
        <p className="mt-1 text-sm text-neutral-600">
          Informe os dados para registro na OS (tabProtocolos).
        </p>

        <form
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(form);
          }}
        >
          <label className="text-xs">
            <span className="font-semibold text-neutral-700">Data</span>
            <input
              type="date"
              value={form.data ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, data: e.target.value }))
              }
              className="mt-0.5 h-8 w-full rounded border border-sagra-border px-2 text-xs"
            />
          </label>
          <label className="text-xs">
            <span className="font-semibold text-neutral-700">Data de Entrega</span>
            <input
              type="date"
              value={form.data_entrega ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, data_entrega: e.target.value }))
              }
              className="mt-0.5 h-8 w-full rounded border border-sagra-border px-2 text-xs"
            />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="font-semibold text-neutral-700">Armazenado em</span>
            <input
              type="text"
              value={form.armazenado_em ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, armazenado_em: e.target.value }))
              }
              className="mt-0.5 h-8 w-full rounded border border-sagra-border px-2 text-xs"
            />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="font-semibold text-neutral-700">Recado com</span>
            <input
              type="text"
              value={form.recado_com ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, recado_com: e.target.value }))
              }
              className="mt-0.5 h-8 w-full rounded border border-sagra-border px-2 text-xs"
            />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="font-semibold text-neutral-700">Entregue para</span>
            <input
              type="text"
              value={form.entregue_para ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, entregue_para: e.target.value }))
              }
              className="mt-0.5 h-8 w-full rounded border border-sagra-border px-2 text-xs"
            />
          </label>
          <label className="text-xs">
            <span className="font-semibold text-neutral-700">Nr de Ponto</span>
            <input
              type="text"
              value={form.nr_ponto ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, nr_ponto: e.target.value }))
              }
              className="mt-0.5 h-8 w-full rounded border border-sagra-border px-2 text-xs"
            />
          </label>
          <label className="text-xs">
            <span className="font-semibold text-neutral-700">Entregue por</span>
            <input
              type="text"
              value={form.entregue_por ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, entregue_por: e.target.value }))
              }
              className="mt-0.5 h-8 w-full rounded border border-sagra-border px-2 text-xs"
            />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="font-semibold text-neutral-700">Setor</span>
            <input
              type="text"
              value={form.setor ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, setor: e.target.value }))
              }
              className="mt-0.5 h-8 w-full rounded border border-sagra-border px-2 text-xs"
            />
          </label>

          <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded border border-sagra-border px-4 py-2 text-sm disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-primary-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Confirmar entrega
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
