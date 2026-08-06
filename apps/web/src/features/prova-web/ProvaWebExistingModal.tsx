import { BookOpen, Plus } from "lucide-react";

interface ProvaWebExistingModalProps {
  open: boolean;
  versao: number;
  onView: () => void;
  onCreateNew: () => void;
  onCancel: () => void;
}

/**
 * Exibido ao gerar quando já existe Prova WEB — visualizar a existente ou criar nova.
 */
export function ProvaWebExistingModal({
  open,
  versao,
  onView,
  onCreateNew,
  onCancel,
}: ProvaWebExistingModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prova-web-existing-title"
    >
      <div className="w-full max-w-md rounded-lg border-t-4 border-[#24344D] bg-white shadow-xl">
        <div className="border-b border-sagra-border px-5 py-4">
          <h3
            id="prova-web-existing-title"
            className="text-lg font-semibold text-secondary-blue"
          >
            Prova WEB já existe
          </h3>
          <p className="mt-1 text-sm text-neutral-600">
            Já existe uma prova criada (Prova {versao}). Deseja visualizar a
            criada ou gerar uma nova (Prova {versao + 1})?
          </p>
        </div>
        <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-sagra-border bg-white px-4 py-2 text-sm text-neutral-700 shadow-sm hover:bg-neutral-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onView}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-sagra-border bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50"
          >
            <BookOpen className="size-4" aria-hidden />
            Visualizar Prova {versao}
          </button>
          <button
            type="button"
            onClick={onCreateNew}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-110"
          >
            <Plus className="size-4" aria-hidden />
            Criar Prova {versao + 1}
          </button>
        </div>
      </div>
    </div>
  );
}
