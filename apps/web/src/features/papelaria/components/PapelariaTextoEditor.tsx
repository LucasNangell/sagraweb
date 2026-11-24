import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ProvaPdfRegiao } from "@/api/papelariaProvaPdf";

const MARGEM = 8;
/** Largura mínima da caixa (px) — cabe a dica e os botões. */
const LARGURA_MINIMA = 288;
/** Folga da caixa em volta do campo: padding (2 × 8 px) + borda (2 × 1 px) + cursor. */
const FOLGA_CAIXA = 16 + 2 + 4;

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
/** Onde está o campo na tela (px da janela). */
export type AncoraEditor = { left: number; top: number; bottom: number };

export function PapelariaTextoEditor({
  regiao,
  ancora,
  onAplicar,
  onRestaurar,
  onCancelar,
}: {
  regiao: ProvaPdfRegiao;
  /**
   * Posição atual do campo na janela. A caixa abre numa camada própria
   * (fora da prévia), então a largura não fica presa à largura da prévia.
   */
  ancora: () => AncoraEditor | null;
  onAplicar: (texto: string) => void;
  onRestaurar?: () => void;
  onCancelar: () => void;
}) {
  const [texto, setTexto] = useState(regiao.texto);
  const caixaRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const [larguraTexto, setLarguraTexto] = useState(0);
  const [estilo, setEstilo] = useState<{ left: number; top: number } | null>(null);
  const ancoraRef = useRef(ancora);
  ancoraRef.current = ancora;

  // A fonte da página pode terminar de carregar depois: mede de novo quando ficar pronta.
  const [fontesProntas, setFontesProntas] = useState(0);
  useEffect(() => {
    let ativo = true;
    void document.fonts?.ready.then(() => {
      if (ativo) setFontesProntas((v) => v + 1);
    });
    return () => {
      ativo = false;
    };
  }, []);

  // Largura da linha mais longa, medida no próprio campo (mesma fonte): com
  // largura zero, scrollWidth é a largura do conteúdo (+ padding da esquerda).
  useLayoutEffect(() => {
    const campo = campoRef.current;
    if (!campo) return;
    const anterior = campo.style.width;
    campo.style.width = "0px";
    // scrollWidth do textarea não conta o padding da direita (Chrome/Edge).
    const conteudo = campo.scrollWidth + (parseFloat(getComputedStyle(campo).paddingRight) || 0);
    const bordas = campo.offsetWidth - campo.clientWidth;
    campo.style.width = anterior;
    setLarguraTexto(Math.ceil(conteudo + bordas));
  }, [texto, fontesProntas]);

  // Altura acompanha o texto: todas as linhas à vista, crescendo a cada linha nova
  // (scrollHeight já conta a barra horizontal quando a linha não cabe).
  useLayoutEffect(() => {
    const campo = campoRef.current;
    if (!campo) return;
    campo.style.height = "auto";
    const extra = campo.offsetHeight - campo.clientHeight; // bordas + barra horizontal
    campo.style.height = `${campo.scrollHeight + extra}px`;
  }, [texto, larguraTexto]);

  // Fica perto do campo e dentro da janela (abre acima se faltar espaço embaixo).
  const posicionar = useCallback(() => {
    const el = caixaRef.current;
    const a = ancoraRef.current();
    if (!el || !a) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(MARGEM, a.left), Math.max(MARGEM, vw - w - MARGEM));
    let top = a.bottom + 6;
    if (top + h > vh - MARGEM) {
      top = a.top - h - 6 >= MARGEM ? a.top - h - 6 : Math.max(MARGEM, vh - h - MARGEM);
    }
    setEstilo((atual) =>
      atual && Math.abs(atual.left - left) < 0.5 && Math.abs(atual.top - top) < 0.5
        ? atual
        : { left, top },
    );
  }, []);

  useLayoutEffect(() => {
    posicionar();
  }, [posicionar, larguraTexto, texto]);

  useEffect(() => {
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [posicionar]);

  const linhasTexto = texto.split("\n");
  const linhas = Math.max(1, linhasTexto.length);
  const larguraCaixa = Math.max(LARGURA_MINIMA, larguraTexto + FOLGA_CAIXA);

  const caixa = (
    <div
      ref={caixaRef}
      role="dialog"
      aria-label="Editar texto da prévia"
      className="fixed z-[200] rounded-lg border border-sagra-border bg-white p-2 shadow-xl"
      style={{
        left: estilo?.left ?? 0,
        top: estilo?.top ?? 0,
        visibility: estilo ? "visible" : "hidden",
        width: larguraCaixa,
        maxWidth: `calc(100vw - ${2 * MARGEM}px)`,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
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
        className={`block w-full resize-none overflow-x-auto overflow-y-hidden whitespace-pre rounded-md border border-slate-300 px-2 py-1.5 text-xs leading-snug text-neutral-800 focus:border-secondary-blue focus:outline-none focus:ring-1 focus:ring-secondary-blue/40`}
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

  // Camada própria: a caixa não fica presa à largura (nem ao overflow) da prévia.
  return typeof document !== "undefined" ? createPortal(caixa, document.body) : caixa;
}
