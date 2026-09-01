import { X } from "lucide-react";

import { homeTestIds } from "@/lib/testId";
import type { OsSearchRow } from "../types";
import { OsVinculosEditor } from "./OsVinculosEditor";

interface OsVincularModalProps {
  row: OsSearchRow | null;
  open: boolean;
  onClose: () => void;
}

export function OsVincularModal({ row, open, onClose }: OsVincularModalProps) {
  if (!open || !row) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      data-testid={homeTestIds.osVincularRoot}
    >
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border-t-4 border-[#24344D] bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 text-neutral-500 hover:text-neutral-800"
          aria-label="Fechar"
          data-testid={homeTestIds.osVincularClose}
        >
          <X className="size-5" />
        </button>
        <h3 className="text-lg font-semibold text-primary-green">Vincular OS</h3>
        <p className="mt-1 text-sm text-neutral-600">
          OS selecionada: {row.nr_os}/{row.ano}
        </p>
        <div className="mt-4">
          <OsVinculosEditor key={`${row.ano}-${row.nr_os}`} row={row} />
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-sagra-border px-4 py-2 text-sm"
            data-testid={homeTestIds.osVincularCancel}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
