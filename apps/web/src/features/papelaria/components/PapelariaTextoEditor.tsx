import { RotateCcw } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import type { ProvaPdfRegiao } from "@/api/papelariaProvaPdf";

const MARGEM = 8;

/**
 * Caixa para editar o texto de um campo direto na prévia. O texto digitado é
 * desenhado pelo servidor com a mesma fonte, cor, alinhamento, âncora,
 * entrelinha e «reduzir para caber» configurados no campo do PDF.
 */
export function PapelariaTextoEditor({
  regiao,
  posicao,
  onAplicar,
  onRestaurar,
  onCancelar,
}: {
  regiao: ProvaPdfRegiao;
  /** Posição do campo na área da prévia (px). */
  posicao: { left: number; top: number; bottom: number };
  onAplicar: (texto: string) => void;
  onRestaurar?: () => void;
  onCancelar: () => void;
}) {
  const [texto, setTexto] = useState(regiao.texto);
  const caixaRef = useRef<HTMLDivElement>(null);
  const [estilo, setEstilo] = useState<{ left: number; top: number }>({
    left: Math.max(MARGEM, posicao.left),
    top: posicao.bottom + 6,
  });

  // Mantém a caixa dentro da área da prévia (abre acima do campo se faltar espaço).
  useLayoutEffect(() => {
    const el = caixaRef.current;
    const pai = el?.offsetParent as HTMLElement | null;
    if (!el || !pai) return;
    const largura = pai.clientWidth;
    const altura = Math.max(pai.clientHeight, pai.scrollHeight);
    const left = Math.min(Math.max(MARGEM, posicao.left), Math.max(MARGEM, largura - el.offsetWidth - MARGEM));
    let top = posicao.bottom + 6;
    if (top + el.offsetHeight > altura - MARGEM && posicao.top - el.offsetHeight - 6 >= MARGEM) {
      top = posicao.top - el.offsetHeight - 6;
    }
    setEstilo({ left, top });
  }, [posicao.left, posicao.top, posicao.bottom]);

  const linhas = Math.min(6, Math.max(2, texto.split("\n").length));

  return (
    <div
      ref={caixaRef}
      role="dialog"
      aria-label="Editar texto da prévia"
      className="absolute z-10 w-72 max-w-[calc(100%-16px)] rounded-lg border border-sagra-border bg-white p-2 shadow-lg"
      style={estilo}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <textarea
        autoFocus
        aria-label="Texto"
        value={texto}
        rows={linhas}
        onChange={(e) => setTexto(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancelar();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onAplicar(texto);
          }
        }}
        className="block w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-xs leading-snug text-neutral-800 focus:border-secondary-blue focus:outline-none focus:ring-1 focus:ring-secondary-blue/40"
      />
      <p className="mt-1 text-[10px] leading-snug text-neutral-500">
        Enter aplica · Shift+Enter quebra a linha · Esc cancela. Mantém a fonte e o alinhamento do campo.
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        {onRestaurar ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900"
            onClick={onRestaurar}
          >
            <RotateCcw className="size-3" aria-hidden />
            Restaurar original
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-slate-50"
            onClick={onCancelar}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-md bg-secondary-blue px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-secondary-blue/90"
            onClick={() => onAplicar(texto)}
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
