import { cn } from "@sagra/ui";
import { ArrowDown, ArrowUp, Share2 } from "lucide-react";

import { apiUrl } from "@/api/client";
import type { PapelariaRedesBloco } from "@/features/papelaria/types";

export const REDES_DADOS_KEY = "__redes";

export type RedeEscolha = { chave: string; valor: string; ativo: boolean };

/** Linhas iniciais (todas desmarcadas), na ordem do catálogo. */
export function redesIniciais(bloco: PapelariaRedesBloco | null | undefined): RedeEscolha[] {
  return (bloco?.redes ?? []).map((r) => ({ chave: r.chave, valor: "", ativo: false }));
}

/** JSON gravado nos dados da prova: só as redes marcadas e preenchidas, na ordem escolhida. */
export function redesParaDados(escolhas: RedeEscolha[]): string {
  return JSON.stringify(
    escolhas.filter((r) => r.ativo && r.valor.trim()).map((r) => ({ chave: r.chave, valor: r.valor.trim() })),
  );
}

/**
 * Página Papelaria: o usuário marca as redes que entram na prova, informa o
 * perfil de cada uma e define a ordem. O layout vem do bloco do modelo.
 */
export function PapelariaRedesPicker({
  bloco,
  value,
  onChange,
}: {
  bloco: PapelariaRedesBloco;
  value: RedeEscolha[];
  onChange: (next: RedeEscolha[]) => void;
}) {
  const porChave = new Map(bloco.redes.map((r) => [r.chave, r]));
  const marcadas = value.filter((r) => r.ativo).length;
  const cheio = marcadas >= bloco.max;

  const set = (chave: string, patch: Partial<RedeEscolha>) =>
    onChange(value.map((r) => (r.chave === chave ? { ...r, ...patch } : r)));
  const mover = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="mb-3 rounded-lg border border-sagra-border bg-white p-2.5" data-testid="papelaria-redes-picker">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-secondary-blue">
          <Share2 className="size-3.5" aria-hidden /> Redes sociais
        </p>
        <span className={cn("text-[10px]", cheio ? "font-semibold text-amber-700" : "text-neutral-500")}>
          {marcadas} de até {bloco.max}
        </span>
      </div>
      <ul className="space-y-1.5">
        {value.map((r, i) => {
          const rede = porChave.get(r.chave);
          if (!rede) return null;
          const bloqueada = !r.ativo && cheio;
          return (
            <li
              key={r.chave}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5",
                r.ativo ? "border-secondary-blue/30 bg-secondary-blue/[0.03]" : "border-transparent",
              )}
            >
              <input
                type="checkbox"
                aria-label={`Incluir ${rede.nome}`}
                checked={r.ativo}
                disabled={bloqueada}
                title={bloqueada ? `Este modelo aceita até ${bloco.max} redes` : undefined}
                onChange={(e) => set(r.chave, { ativo: e.target.checked })}
              />
              {rede.logo_url ? (
                <img src={apiUrl(rede.logo_url.replace(/^\/api/, ""))} alt="" className="size-5 shrink-0 object-contain" />
              ) : (
                <span className="size-5 shrink-0 rounded bg-slate-100" aria-hidden />
              )}
              <span className="w-20 shrink-0 truncate text-[11px] font-medium text-neutral-700">{rede.nome}</span>
              <input
                type="text"
                aria-label={`Perfil no ${rede.nome}`}
                className="min-w-0 flex-1 rounded border border-sagra-border px-2 py-1 text-xs disabled:bg-slate-50 disabled:text-neutral-400"
                placeholder={rede.exemplo || "@usuario"}
                value={r.valor}
                disabled={!r.ativo}
                maxLength={200}
                onChange={(e) => set(r.chave, { valor: e.target.value })}
              />
              <span className="flex shrink-0">
                <button
                  type="button"
                  className="rounded p-0.5 text-neutral-400 hover:bg-slate-100 hover:text-neutral-700 disabled:opacity-30"
                  aria-label={`Subir ${rede.nome}`}
                  disabled={i === 0}
                  onClick={() => mover(i, -1)}
                >
                  <ArrowUp className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-neutral-400 hover:bg-slate-100 hover:text-neutral-700 disabled:opacity-30"
                  aria-label={`Descer ${rede.nome}`}
                  disabled={i === value.length - 1}
                  onClick={() => mover(i, 1)}
                >
                  <ArrowDown className="size-3.5" aria-hidden />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[10px] text-neutral-500">
        Só as redes marcadas e preenchidas entram na prova, nesta ordem; o bloco se reorganiza sozinho.
      </p>
    </div>
  );
}
