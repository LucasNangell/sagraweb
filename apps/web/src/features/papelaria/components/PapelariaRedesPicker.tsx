import { cn } from "@sagra/ui";
import { ArrowDown, ArrowUp, Share2 } from "lucide-react";

import { apiUrl } from "@/api/client";
import type { PapelariaRedeEstilo, PapelariaRedesBloco } from "@/features/papelaria/types";

export const REDES_DADOS_KEY = "__redes";
export const REDES_ESTILO_DADOS_KEY = "__redes_estilo";

/** Estilo inicial: o padrão do modelo, se alguma rede tiver logo nele; senão o primeiro disponível. */
export function estiloInicial(bloco: PapelariaRedesBloco | null | undefined): PapelariaRedeEstilo {
  const disponiveis = bloco?.estilos?.map((e) => e.id) ?? [];
  const padrao = bloco?.estilo_padrao ?? "quadrado_policromia";
  return disponiveis.length && !disponiveis.includes(padrao) ? disponiveis[0] : padrao;
}

function temEstilo(bloco: PapelariaRedesBloco, chave: string, estilo: PapelariaRedeEstilo): boolean {
  const rede = bloco.redes.find((r) => r.chave === chave);
  // Sem a lista de estilos (resposta antiga), não bloqueia.
  return !rede?.logos_url || Boolean(rede.logos_url[estilo]);
}

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
  estilo,
  onEstiloChange,
}: {
  bloco: PapelariaRedesBloco;
  value: RedeEscolha[];
  onChange: (next: RedeEscolha[]) => void;
  /** Estilo de logo da prova (todas as redes seguem o mesmo). */
  estilo?: PapelariaRedeEstilo;
  onEstiloChange?: (next: PapelariaRedeEstilo) => void;
}) {
  const estiloAtual = estilo ?? estiloInicial(bloco);
  const trocarEstilo = (next: PapelariaRedeEstilo) => {
    onEstiloChange?.(next);
    // Rede sem logo no novo estilo sai da prova (o perfil digitado é mantido).
    if (value.some((r) => r.ativo && !temEstilo(bloco, r.chave, next))) {
      onChange(value.map((r) => (r.ativo && !temEstilo(bloco, r.chave, next) ? { ...r, ativo: false } : r)));
    }
  };
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
      {bloco.estilos && bloco.estilos.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Estilo dos logos">
          {bloco.estilos.map((e) => (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={estiloAtual === e.id}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition",
                estiloAtual === e.id
                  ? "border-secondary-blue bg-secondary-blue text-white"
                  : "border-sagra-border text-neutral-600 hover:border-secondary-blue/50",
              )}
              onClick={() => trocarEstilo(e.id)}
            >
              {e.rotulo}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="space-y-1.5">
        {value.map((r, i) => {
          const rede = porChave.get(r.chave);
          if (!rede) return null;
          const semLogo = !temEstilo(bloco, r.chave, estiloAtual);
          const bloqueada = (!r.ativo && cheio) || semLogo;
          const logo = rede.logos_url ? (rede.logos_url[estiloAtual] ?? null) : rede.logo_url;
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
                title={
                  semLogo
                    ? "Sem logo neste estilo"
                    : bloqueada
                      ? `Este modelo aceita até ${bloco.max} redes`
                      : undefined
                }
                onChange={(e) => set(r.chave, { ativo: e.target.checked })}
              />
              {logo ? (
                <img src={apiUrl(logo.replace(/^\/api/, ""))} alt="" className="size-5 shrink-0 object-contain" />
              ) : (
                <span className="size-5 shrink-0 rounded bg-slate-100" aria-hidden />
              )}
              <span className={cn("w-20 shrink-0 truncate text-[11px] font-medium", semLogo ? "text-neutral-400" : "text-neutral-700")}>
                {rede.nome}
              </span>
              <input
                type="text"
                aria-label={`Perfil no ${rede.nome}`}
                className="min-w-0 flex-1 rounded border border-sagra-border px-2 py-1 text-xs disabled:bg-slate-50 disabled:text-neutral-400"
                placeholder={semLogo ? "Sem logo neste estilo" : rede.exemplo || "@usuario"}
                value={r.valor}
                disabled={!r.ativo || semLogo}
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
