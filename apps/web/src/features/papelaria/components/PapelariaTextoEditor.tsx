import { RotateCcw } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import type { ProvaPdfRegiao } from "@/api/papelariaProvaPdf";

const MARGEM = 8;
/** Largura mínima da caixa (px) — cabe a dica e os botões. */
const LARGURA_MINIMA = 288;
/** Folga da caixa: padding (2 × 8 px) + borda do campo (2 × 1 px) + cursor. */
const FOLGA_CAIXA = 16 + 2 + 6;

/**
 * Aplica com Shift+Enter ou Ctrl+Enter (⌘+Enter no Mac); Enter sozinho
 * quebra a linha, como no texto do PDF.
 */
export function teclaAplica(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.key === "Enter" && (e.shiftKey || e.ctrlKey || e.metaKey);
}

/**
 * Caixa para editar o texto de um campo direto na prévia. O texto digitado é
 * desenhado pelo servidor com a mesma fonte, cor, alinhamento, âncora,
 * entrelinha e «reduzir para caber» configurados no campo do PDF.
 *
 * A caixa se ajusta ao texto: largura da linha mais longa (sem quebra
 * automática — cada linha aqui é uma linha no PDF) e altura de todas as
 * linhas, crescendo conforme o usuário acrescenta linhas.
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
  const medidaRef = useRef<HTMLSpanElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const [larguraTexto, setLarguraTexto] = useState(0);
  const [estilo, setEstilo] = useState<{ left: number; top: number }>({
    left: Math.max(MARGEM, posicao.left),
    top: posicao.bottom + 6,
  });

  // Largura da linha mais longa, medida com a mesma fonte do campo.
  useLayoutEffect(() => {
    const medida = medidaRef.current;
    if (!medida) return;
    setLarguraTexto(Math.ceil(medida.getBoundingClientRect().width));
  }, [texto]);

  // Altura acompanha o texto: todas as linhas à vista, crescendo a cada linha nova
  // (scrollHeight já conta a barra horizontal quando a linha não cabe).
  useLayoutEffect(() => {
    const campo = campoRef.current;
    if (!campo) return;
    campo.style.height = "auto";
    campo.style.height = `${campo.scrollHeight + 2}px`;
  }, [texto, larguraTexto]);

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
  }, [posicao.left, posicao.top, posicao.bottom, larguraTexto, texto]);

  const linhasTexto = texto.split("\n");
  const linhas = Math.max(1, linhasTexto.length);
  const larguraCaixa = Math.max(LARGURA_MINIMA, larguraTexto + FOLGA_CAIXA);
  const classeTexto = "text-xs leading-snug";

  return (
    <div
      ref={caixaRef}
      role="dialog"
      aria-label="Editar texto da prévia"
      className="absolute z-10 max-w-[calc(100%-16px)] rounded-lg border border-sagra-border bg-white p-2 shadow-lg"
      style={{ ...estilo, width: larguraCaixa }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Régua invisível: mede a linha mais longa com a fonte do campo. */}
      <span
        ref={medidaRef}
        aria-hidden
        className={`pointer-events-none invisible absolute left-0 top-0 whitespace-pre px-2 ${classeTexto}`}
      >
        {linhasTexto.reduce((a, b) => (b.length > a.length ? b : a), "") || " "}
      </span>
      <textarea
        ref={campoRef}
        autoFocus
        aria-label="Texto"
        value={texto}
        rows={linhas}
        wrap="off"
        spellCheck={false}
        onChange={(e) => setTexto(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancelar();
          } else if (teclaAplica(e)) {
            e.preventDefault();
            onAplicar(texto);
          }
          // Enter sozinho: quebra a linha (comportamento normal do campo).
        }}
        className={`block w-full resize-none overflow-x-auto overflow-y-hidden whitespace-pre rounded-md border border-slate-300 px-2 py-1.5 text-neutral-800 focus:border-secondary-blue focus:outline-none focus:ring-1 focus:ring-secondary-blue/40 ${classeTexto}`}
      />
      <p className="mt-1 text-[10px] leading-snug text-neutral-500">
        Enter quebra a linha · Shift+Enter ou Ctrl+Enter aplica · Esc cancela. Mantém a fonte e o
        alinhamento do campo.
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
            title="Shift+Enter ou Ctrl+Enter"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
