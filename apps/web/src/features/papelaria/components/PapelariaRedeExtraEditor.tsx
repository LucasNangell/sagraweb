import { Plus, Trash2 } from "lucide-react";

import { cn } from "@sagra/ui";

import {
  ESTILOS_LOGO_EXTRA,
  REDES_EXTRA_MAX,
  type CampoExtraRedeItem,
} from "@/features/papelaria/papelariaCamposExtras";
import type { PapelariaRedeEstilo, PapelariaRedeOpcao } from "@/features/papelaria/types";

const ROTULOS_ESTILO: Record<PapelariaRedeEstilo, string> = {
  quadrado_policromia: "Quadrado policromia",
  quadrado_pb: "Quadrado PB",
  policromia: "Policromia",
  pb: "PB",
};

const campoCls =
  "h-7 w-full rounded-md border border-sagra-border bg-white px-1.5 text-xs text-neutral-800 outline-none focus:border-secondary-blue focus:ring-1 focus:ring-secondary-blue/30";

export type RedeExtraCatalogoItem = Pick<PapelariaRedeOpcao, "chave" | "nome"> & {
  exemplo?: string;
  logos_url?: Partial<Record<PapelariaRedeEstilo, string>>;
};

export type PapelariaRedeExtraEditorProps = {
  redes: CampoExtraRedeItem[];
  onRedesChange: (next: CampoExtraRedeItem[]) => void;
  estilo: PapelariaRedeEstilo | null;
  onEstiloChange: (next: PapelariaRedeEstilo | null) => void;
  catalogo: RedeExtraCatalogoItem[];
  /** Estilos oferecidos (do bloco do modelo); fallback = todos. */
  estilosDisponiveis?: Array<{ id: PapelariaRedeEstilo; rotulo: string }>;
  className?: string;
};

function temLogo(
  item: RedeExtraCatalogoItem | undefined,
  estilo: PapelariaRedeEstilo,
): boolean {
  if (!item) return false;
  if (!item.logos_url) return true;
  return Boolean(item.logos_url[estilo]);
}

/** Lista de redes + pills de variante de logo para extras. */
export function PapelariaRedeExtraEditor({
  redes,
  onRedesChange,
  estilo,
  onEstiloChange,
  catalogo,
  estilosDisponiveis,
  className,
}: PapelariaRedeExtraEditorProps) {
  const catalogoFallback: RedeExtraCatalogoItem[] = catalogo.length
    ? catalogo
    : [
        { chave: "instagram", nome: "Instagram" },
        { chave: "facebook", nome: "Facebook" },
        { chave: "x", nome: "X" },
        { chave: "linkedin", nome: "LinkedIn" },
        { chave: "youtube", nome: "YouTube" },
        { chave: "tiktok", nome: "TikTok" },
        { chave: "threads", nome: "Threads" },
        { chave: "whatsapp", nome: "WhatsApp" },
      ];

  const pills =
    estilosDisponiveis && estilosDisponiveis.length
      ? estilosDisponiveis
      : ESTILOS_LOGO_EXTRA.map((id) => ({ id, rotulo: ROTULOS_ESTILO[id] }));

  const usadas = new Set(redes.map((r) => r.chave));
  const podeAdd = redes.length < REDES_EXTRA_MAX;

  const setLinha = (idx: number, patch: Partial<CampoExtraRedeItem>) => {
    onRedesChange(
      redes.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };

  const addLinha = () => {
    if (!podeAdd) return;
    const livre = catalogoFallback.find((c) => !usadas.has(c.chave));
    if (!livre) return;
    onRedesChange([...redes, { chave: livre.chave, valor: "" }]);
  };

  const remover = (idx: number) => {
    if (redes.length <= 1) return;
    onRedesChange(redes.filter((_, i) => i !== idx));
  };

  return (
    <div className={cn("space-y-2", className)} data-testid="papelaria-rede-extra-editor">
      {pills.length > 1 ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Logo
          </p>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Estilo dos logos">
            <button
              type="button"
              role="radio"
              aria-checked={estilo == null}
              data-testid="papelaria-rede-extra-estilo-herdar"
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition",
                estilo == null
                  ? "border-secondary-blue bg-secondary-blue text-white"
                  : "border-sagra-border text-neutral-600 hover:border-secondary-blue/50",
              )}
              onClick={() => onEstiloChange(null)}
            >
              Padrão da prova
            </button>
            {pills.map((e) => {
              const ok = redes.every((r) => {
                const cat = catalogoFallback.find((c) => c.chave === r.chave);
                return temLogo(cat, e.id);
              });
              return (
                <button
                  key={e.id}
                  type="button"
                  role="radio"
                  aria-checked={estilo === e.id}
                  disabled={!ok}
                  title={ok ? e.rotulo : "Sem logo neste estilo para alguma rede escolhida"}
                  data-testid={`papelaria-rede-extra-estilo-${e.id}`}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition",
                    estilo === e.id
                      ? "border-secondary-blue bg-secondary-blue text-white"
                      : "border-sagra-border text-neutral-600 hover:border-secondary-blue/50",
                    !ok && "cursor-not-allowed opacity-40",
                  )}
                  onClick={() => ok && onEstiloChange(e.id)}
                >
                  {e.rotulo}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <ul className="space-y-1.5">
        {redes.map((r, idx) => {
          const opcoes = catalogoFallback.filter(
            (c) => c.chave === r.chave || !usadas.has(c.chave),
          );
          const cat = catalogoFallback.find((c) => c.chave === r.chave);
          return (
            <li
              key={`${r.chave}-${idx}`}
              className="flex items-center gap-1.5 rounded-md border border-sagra-border/80 bg-white px-1.5 py-1"
            >
              <select
                aria-label={`Rede ${idx + 1}`}
                className={cn(campoCls, "w-[7.5rem] shrink-0")}
                value={r.chave}
                onChange={(e) => setLinha(idx, { chave: e.target.value })}
              >
                {opcoes.map((c) => (
                  <option key={c.chave} value={c.chave}>
                    {c.nome}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Perfil ${idx + 1}`}
                className={campoCls}
                value={r.valor}
                placeholder={cat?.exemplo || "@usuario"}
                onChange={(e) => setLinha(idx, { valor: e.target.value })}
              />
              <button
                type="button"
                title="Remover rede"
                aria-label="Remover rede"
                disabled={redes.length <= 1}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-sagra-border text-neutral-500 hover:bg-slate-50 disabled:opacity-40"
                onClick={() => remover(idx)}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        data-testid="papelaria-rede-extra-add"
        disabled={!podeAdd || !catalogoFallback.some((c) => !usadas.has(c.chave))}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-sagra-border px-2 text-[11px] font-semibold text-secondary-blue hover:bg-secondary-blue/5 disabled:opacity-40"
        onClick={addLinha}
      >
        <Plus className="size-3.5" aria-hidden />
        Adicionar rede
      </button>
    </div>
  );
}
