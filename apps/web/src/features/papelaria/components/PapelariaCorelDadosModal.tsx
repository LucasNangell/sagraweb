import { AlertTriangle, Loader2 } from "lucide-react";

import type { PapelariaCorelDiferenca } from "../types";

export type PapelariaCorelDadosEstado =
  | { fase: "lendo"; arquivo?: string | null }
  | {
      fase: "diferente";
      arquivo?: string | null;
      diferencas: PapelariaCorelDiferenca[];
    }
  | { fase: "falhou"; arquivo?: string | null; erro?: string | null };

type Props = {
  estado: PapelariaCorelDadosEstado;
  onManterOriginais: () => void;
  onUsarFormulario: () => void;
  onCancelar: () => void;
};

function Texto({ linhas }: { linhas: string[] }) {
  return (
    <div className="space-y-1">
      {linhas.map((linha, idx) => (
        <p
          key={idx}
          className="whitespace-pre-line rounded bg-white/70 px-2 py-1 font-mono text-[11px] leading-snug text-slate-800"
        >
          {linha || <span className="italic text-slate-400">(vazio)</span>}
        </p>
      ))}
    </div>
  );
}

/** Pergunta se a prova mantém os dados do Corel da pasta ou aplica o formulário. */
export function PapelariaCorelDadosModal({
  estado,
  onManterOriginais,
  onUsarFormulario,
  onCancelar,
}: Props) {
  const arquivo = estado.arquivo?.trim();
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="papelaria-corel-dados-title"
        data-testid="papelaria-corel-dados-modal"
      >
        {estado.fase === "lendo" ? (
          <>
            <h3
              id="papelaria-corel-dados-title"
              className="text-center text-lg font-bold text-slate-800"
            >
              Conferindo o Corel da pasta
            </h3>
            <p className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-600">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Lendo os dados de {arquivo || "arquivo .cdr"} para comparar com o
              formulário…
            </p>
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--md"
                onClick={onCancelar}
              >
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <>
            <h3
              id="papelaria-corel-dados-title"
              className="flex items-center justify-center gap-2 text-center text-lg font-bold text-slate-800"
            >
              <AlertTriangle className="size-5 text-amber-500" aria-hidden />
              {estado.fase === "diferente"
                ? "Os dados do Corel são diferentes do formulário"
                : "Não foi possível comparar os dados"}
            </h3>
            <p className="mt-2 text-center text-sm text-slate-600">
              {estado.fase === "diferente" ? (
                <>
                  O arquivo <strong>{arquivo || "da pasta"}</strong> tem textos
                  diferentes das informações do cliente. Deseja manter os dados
                  originais do Corel ou alterar para os do formulário?
                </>
              ) : (
                <>
                  {estado.erro || "Falha ao ler o Corel da pasta."} Deseja manter
                  os dados originais do Corel ou aplicar os do formulário?
                </>
              )}
            </p>

            {estado.fase === "diferente" ? (
              <div
                className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
                data-testid="papelaria-corel-dados-diferencas"
              >
                {estado.diferencas.map((dif) => (
                  <div
                    key={dif.campo}
                    className="rounded border border-slate-200 p-3"
                  >
                    <p className="mb-2 text-xs font-semibold text-secondary-blue">
                      {dif.rotulo}
                      {dif.rotulo !== dif.campo ? (
                        <span className="ml-1 font-mono font-normal text-slate-400">
                          ({dif.campo})
                        </span>
                      ) : null}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded bg-amber-50 p-2">
                        <p className="mb-1 text-[10px] font-bold uppercase text-amber-800">
                          No Corel (original)
                        </p>
                        <Texto linhas={dif.original} />
                      </div>
                      <div className="rounded bg-emerald-50 p-2">
                        <p className="mb-1 text-[10px] font-bold uppercase text-emerald-800">
                          Formulário (cliente)
                        </p>
                        <Texto linhas={dif.novo} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="flex-1 sagra-btn sagra-btn--outline sagra-btn--md"
                onClick={onManterOriginais}
                data-testid="papelaria-corel-dados-manter"
              >
                Manter dados do Corel
              </button>
              <button
                type="button"
                className="flex-1 sagra-btn sagra-btn--secondary sagra-btn--md"
                onClick={onUsarFormulario}
                data-testid="papelaria-corel-dados-formulario"
              >
                Usar dados do formulário
              </button>
            </div>
            <button
              type="button"
              className="mt-3 w-full text-center text-xs text-slate-500 hover:text-slate-700"
              onClick={onCancelar}
            >
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
