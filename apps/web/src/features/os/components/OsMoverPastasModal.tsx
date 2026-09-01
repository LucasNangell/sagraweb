import { FolderInput, X } from "lucide-react";

import { OsFolderMoveForm } from "./OsFolderMoveForm";
import type { OsSearchRow } from "../types";

interface OsMoverPastasModalProps {
  row: OsSearchRow | null;
  open: boolean;
  onClose: () => void;
}

export function OsMoverPastasModal({
  row,
  open,
  onClose,
}: OsMoverPastasModalProps) {
  if (!open || !row) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10005] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mover-pastas-title"
    >
      <div className="relative w-full max-w-xl rounded-lg border-t-4 border-[#24344D] bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 text-neutral-500 hover:text-neutral-800"
          aria-label="Fechar"
        >
          <X className="size-5" />
        </button>

        <h3
          id="mover-pastas-title"
          className="flex items-center gap-2 text-lg font-semibold text-primary-green"
        >
          <FolderInput className="size-5" aria-hidden />
          Mover Pastas
        </h3>
        <p className="mt-1 text-sm text-neutral-600">
          OS destino (atual):{" "}
          <strong>
            {row.nr_os}/{row.ano}
          </strong>
        </p>

        <OsFolderMoveForm
          destAno={row.ano}
          destId={row.nr_os}
          variant="mover"
          onCancel={onClose}
          onSuccess={(result) => {
            const moved = result.moved_folders.map((item) => item.to_name).join(", ");
            window.alert(
              `Pastas movidas com sucesso para OS ${row.nr_os}/${row.ano}.\n\n` +
                `Itens: ${moved}\n` +
                (result.dest_folder_created
                  ? "\nA pasta de destino foi criada na rede."
                  : ""),
            );
            onClose();
          }}
        />
      </div>
    </div>
  );
}
