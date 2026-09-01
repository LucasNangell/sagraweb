import { homeTestIds } from "@/lib/testId";

interface OsUnirSubOsModalProps {
  open: boolean;
  setor: string;
  osLabel?: string;
  onClose: () => void;
  onConfirm: (unir: boolean) => void;
}

export function OsUnirSubOsModal({
  open,
  setor,
  osLabel,
  onClose,
  onConfirm,
}: OsUnirSubOsModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10003] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unir-sub-os-title"
      data-testid={homeTestIds.osUnirSubOsRoot}
    >
      <div className="w-full max-w-md rounded-lg border-t-4 border-primary-green bg-white p-6 shadow-xl">
        <h3
          id="unir-sub-os-title"
          className="text-lg font-semibold text-primary-green"
        >
          Unir Sub OSs na OS principal
        </h3>
        <p className="mt-2 text-sm text-neutral-700">
          {osLabel ? (
            <>
              Os componentes da OS <strong>{osLabel}</strong> estão no setor{" "}
              <strong>{setor}</strong>.
            </>
          ) : (
            <>
              Os componentes estão no setor <strong>{setor}</strong>.
            </>
          )}
        </p>
        <p className="mt-2 text-sm text-neutral-700">
          Deseja unir novamente as Sub OSs na OS principal? O andamento será
          aplicado a todos os componentes.
        </p>
        <form
          className="mt-4 space-y-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            onConfirm(fd.get("unir_sub_os") === "unir");
          }}
        >
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="unir_sub_os" value="unir" defaultChecked />
            Unir na OS principal (andamento para ambos)
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="unir_sub_os" value="componente" />
            Somente neste componente
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-sagra-border px-4 py-2 text-sm"
              data-testid={homeTestIds.osUnirSubOsCancel}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded bg-secondary-blue px-4 py-2 text-sm font-semibold text-white"
              data-testid={homeTestIds.osUnirSubOsConfirm}
            >
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
