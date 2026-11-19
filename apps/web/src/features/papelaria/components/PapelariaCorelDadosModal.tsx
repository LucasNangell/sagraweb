import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@sagra/ui";

import {
  chaveEscolha,
  escolhasIniciais,
  escolherTodos,
  normalizarTextoCorel,
} from "../papelariaCamposProduto";
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
  /** Diferenças: valores finais por ocorrência (`campo#indice`). */
  onConfirmar: (escolhas: Record<string, string>) => void;
  /** Falha na leitura: manter os dados do Corel sem comparar. */
  onManterOriginais: () => void;
  onUsarFormulario: () => void;
  onCancelar: () => void;
};

function Leitura({ texto, tom }: { texto: string; tom: "corel" | "form" }) {
  return (
    <p
      className={cn(
        "whitespace-pre-line rounded px-2 py-1 font-mono text-[11px] leading-snug",
        tom === "corel" ? "bg-amber-50 text-slate-800" : "bg-emerald-50 text-slate-800",
      )}
    >
      {texto || <span className="italic text-slate-400">(vazio)</span>}
    </p>
  );
}

/**
 * Corel da pasta × formulário: cada ocorrência mostra o texto do Corel e o
 * do formulário, com um campo editável (começa com o do Corel) que vira o
 * campo do produto real.
 */
export function PapelariaCorelDadosModal({
  estado,
  onConfirmar,
  onManterOriginais,
  onUsarFormulario,
  onCancelar,
}: Props) {
  const arquivo = estado.arquivo?.trim();
  const diferencas = useMemo(
    () => (estado.fase === "diferente" ? estado.diferencas : []),
    [estado],
  );
  const [escolhas, setEscolhas] = useState<Record<string, string>>(() =>
    escolhasIniciais(diferencas),
  );
  useEffect(() => {
    setEscolhas(escolhasIniciais(diferencas));
  }, [diferencas]);

  const definir = (chave: string, valor: string) =>
    setEscolhas((prev) => ({ ...prev, [chave]: valor }));

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg bg-white p-6 shadow-xl"
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
        ) : estado.fase === "falhou" ? (
          <>
            <h3
              id="papelaria-corel-dados-title"
              className="flex items-center justify-center gap-2 text-center text-lg font-bold text-slate-800"
            >
              <AlertTriangle className="size-5 text-amber-500" aria-hidden />
              Não foi possível comparar os dados
            </h3>
            <p className="mt-2 text-center text-sm text-slate-600">
              {estado.erro || "Falha ao ler o Corel da pasta."} Deseja manter os
              dados originais do Corel ou aplicar os do formulário?
            </p>
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
        ) : (
          <>
            <h3
              id="papelaria-corel-dados-title"
              className="flex items-center justify-center gap-2 text-center text-lg font-bold text-slate-800"
            >
              <AlertTriangle className="size-5 text-amber-500" aria-hidden />
              Os dados do Corel são diferentes do formulário
            </h3>
            <p className="mt-2 text-center text-sm text-slate-600">
              O arquivo <strong>{arquivo || "da pasta"}</strong> tem textos
              diferentes das informações do cliente. Ajuste o texto que vai na
              prova — os campos viram as informações do cliente (e do portal de
              aprovação).
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--sm"
                onClick={() => setEscolhas(escolherTodos(diferencas, "original"))}
                data-testid="papelaria-corel-dados-tudo-corel"
              >
                Manter todos do Corel
              </button>
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--sm"
                onClick={() => setEscolhas(escolherTodos(diferencas, "novo"))}
                data-testid="papelaria-corel-dados-tudo-formulario"
              >
                Usar todos do formulário
              </button>
            </div>

            <div
              className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
              data-testid="papelaria-corel-dados-diferencas"
            >
              {diferencas.map((dif) => (
                <div key={dif.campo} className="rounded border border-slate-200 p-3">
                  <p className="mb-2 text-xs font-semibold text-secondary-blue">
                    {dif.rotulo}
                    {dif.rotulo !== dif.campo ? (
                      <span className="ml-1 font-mono font-normal text-slate-400">
                        ({dif.campo})
                      </span>
                    ) : null}
                  </p>
                  <div className="space-y-3">
                    {(dif.ocorrencias ?? []).map((oc, i) => {
                      const chave = chaveEscolha(dif.campo, i);
                      const valor = escolhas[chave] ?? oc.original;
                      const igual =
                        normalizarTextoCorel(oc.original) ===
                        normalizarTextoCorel(oc.novo);
                      return (
                        <div key={chave} className="rounded bg-slate-50 p-2">
                          <p className="mb-1 text-[11px] font-semibold text-slate-700">
                            {oc.rotulo}
                            {igual ? (
                              <span className="ml-1 font-normal text-emerald-700">
                                (igual ao formulário)
                              </span>
                            ) : null}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div>
                              <div className="mb-0.5 flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase text-amber-800">
                                  No Corel (original)
                                </span>
                                <button
                                  type="button"
                                  className="text-[10px] text-secondary-blue hover:underline"
                                  onClick={() => definir(chave, oc.original)}
                                >
                                  usar
                                </button>
                              </div>
                              <Leitura texto={oc.original} tom="corel" />
                            </div>
                            <div>
                              <div className="mb-0.5 flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase text-emerald-800">
                                  Formulário (cliente)
                                </span>
                                <button
                                  type="button"
                                  className="text-[10px] text-secondary-blue hover:underline"
                                  onClick={() => definir(chave, oc.novo)}
                                >
                                  usar
                                </button>
                              </div>
                              <Leitura texto={oc.novo} tom="form" />
                            </div>
                          </div>
                          <label className="mt-2 block">
                            <span className="mb-0.5 block text-[10px] font-bold uppercase text-slate-600">
                              Texto na prova
                            </span>
                            <textarea
                              className="w-full rounded border border-sagra-border px-2 py-1 font-mono text-[11px]"
                              rows={Math.max(2, Math.min(8, valor.split("\n").length))}
                              value={valor}
                              disabled={dif.editavel === false}
                              onChange={(e) => definir(chave, e.target.value)}
                              data-testid={`papelaria-corel-dados-valor-${dif.campo}-${i}`}
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--md"
                onClick={onCancelar}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="flex-1 sagra-btn sagra-btn--secondary sagra-btn--md"
                onClick={() => onConfirmar(escolhas)}
                data-testid="papelaria-corel-dados-confirmar"
              >
                Confirmar e criar prova
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
