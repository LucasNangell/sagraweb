import type { OsVinculoGrupoMembro } from "../types";

interface OsDecisaoSaidaModalProps {
  open: boolean;
  currentOs?: { numero: number; ano: number } | null;
  situacao?: string;
  setor?: string;
  membros?: OsVinculoGrupoMembro[];
  /** "juntada" adapta o texto para OSs juntadas na gravação. */
  origem?: "juntada" | "vinculo" | null;
  onClose: () => void;
  onConfirm: (choice: "all" | "single") => void;
}

export function OsDecisaoSaidaModal({
  open,
  currentOs,
  situacao,
  setor,
  membros = [],
  origem = "vinculo",
  onClose,
  onConfirm,
}: OsDecisaoSaidaModalProps) {
  if (!open) {
    return null;
  }

  const isJuntada = origem === "juntada";
  const grupoLabel = membros.map((m) => `${m.numero}/${m.ano}`).join(", ");
  const andamentoLabel =
    situacao && setor ? `"${situacao}" (${setor})` : "este andamento";

  return (
    <div
      className="fixed inset-0 z-[10003] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="decisao-saida-title"
    >
      <div className="w-full max-w-md rounded-lg border-t-4 border-primary-green bg-white p-6 shadow-xl">
        <h3
          id="decisao-saida-title"
          className="text-lg font-semibold text-primary-green"
        >
          {isJuntada
            ? "Atenção: OS em juntada de gravação"
            : "Atenção: OS em grupo vinculado"}
        </h3>
        <p className="mt-2 text-sm text-neutral-700">
          {currentOs ? (
            <>
              A OS <strong>
                {currentOs.numero}/{currentOs.ano}
              </strong>{" "}
              {isJuntada ? (
                <>
                  foi juntada com as OSs{" "}
                  <strong>{grupoLabel || "—"}</strong>.
                </>
              ) : (
                <>
                  pertence a um grupo com as OSs{" "}
                  <strong>{grupoLabel || "—"}</strong>.
                </>
              )}
            </>
          ) : isJuntada ? (
            <>Esta OS faz parte de uma juntada de gravação.</>
          ) : (
            <>Esta OS pertence a um grupo vinculado.</>
          )}
        </p>
        <p className="mt-2 text-sm text-neutral-700">
          O andamento {andamentoLabel} pode ser replicado a todas as OSs{" "}
          {isJuntada ? "juntadas" : "do grupo"}. Deseja aplicar para:
        </p>
        <form
          className="mt-4 space-y-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const choice = fd.get("decisao_sa") as "all" | "single";
            onConfirm(choice === "single" ? "single" : "all");
          }}
        >
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="decisao_sa" value="all" defaultChecked />
            Todas as OSs {isJuntada ? "juntadas" : "do grupo"} (
            {grupoLabel || (isJuntada ? "juntadas" : "vinculadas")})
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="decisao_sa" value="single" />
            Somente esta OS
            {currentOs ? ` (${currentOs.numero}/${currentOs.ano})` : ""}
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-sagra-border px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded bg-secondary-blue px-4 py-2 text-sm font-semibold text-white"
            >
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
