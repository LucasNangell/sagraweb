import { Bold, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ProvaPdfRegiao } from "@/api/papelariaProvaPdf";
import {
  mmParaPt,
  ptParaMm,
  toggleNegritoRange,
  type CampoExtraAlignH,
  type CampoExtraAlignV,
} from "@/features/papelaria/papelariaCamposExtras";

import { PapelariaAlignPicker } from "./PapelariaAlignPicker";

const MARGEM = 8;
/** Largura mínima da caixa (px) — cabe a dica e os botões. */
const LARGURA_MINIMA = 288;
/** Folga da caixa em volta do campo: padding (2 × 8 px) + borda (2 × 1 px) + cursor. */
const FOLGA_CAIXA = 16 + 2 + 4;

/**
 * Aplica com Shift+Enter ou Ctrl+Enter (⌘+Enter no Mac); Enter sozinho
 * quebra a linha, como no texto do PDF.
 */
export function teclaAplica(e: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return e.key === "Enter" && (e.shiftKey || e.ctrlKey || e.metaKey);
}

/** Onde está o campo na tela (px da janela). */
export type AncoraEditor = { left: number; top: number; bottom: number };

export type ExtraEditorMeta = {
  tamanho_pt?: number | null;
  negrito?: Array<[number, number]>;
  align_h?: CampoExtraAlignH;
  align_v?: CampoExtraAlignV;
  x_pt?: number | null;
  y_pt?: number | null;
};

function isExtra(regiao: ProvaPdfRegiao): boolean {
  return regiao.tipo === "campo_extra" || regiao.tipo === "rede_extra";
}

/**
 * Caixa para editar o texto de um campo direto na prévia. Em extras, inclui
 * tamanho, negrito, alinhamento 3×3 e posição em mm.
 */
export function PapelariaTextoEditor({
  regiao,
  ancora,
  onAplicar,
  onRestaurar,
  onCancelar,
  extraMeta,
}: {
  regiao: ProvaPdfRegiao;
  ancora: () => AncoraEditor | null;
  onAplicar: (texto: string, meta?: ExtraEditorMeta) => void;
  onRestaurar?: () => void;
  onCancelar: () => void;
  /** Estado atual do extra (quando a região é campo/rede extra). */
  extraMeta?: ExtraEditorMeta;
}) {
  const modoExtra = isExtra(regiao);
  const [texto, setTexto] = useState(regiao.texto);
  const [tamanhoPt, setTamanhoPt] = useState<number>(
    extraMeta?.tamanho_pt ?? (regiao as { tamanho_pt?: number }).tamanho_pt ?? 11,
  );
  const [negrito, setNegrito] = useState<Array<[number, number]>>(
    extraMeta?.negrito ?? regiao.negrito ?? [],
  );
  const [alignH, setAlignH] = useState<CampoExtraAlignH>(extraMeta?.align_h ?? "esquerda");
  const [alignV, setAlignV] = useState<CampoExtraAlignV>(extraMeta?.align_v ?? "topo");
  const [xMm, setXMm] = useState(() =>
    extraMeta?.x_pt != null ? Number(ptParaMm(extraMeta.x_pt).toFixed(2)) : 0,
  );
  const [yMm, setYMm] = useState(() =>
    extraMeta?.y_pt != null ? Number(ptParaMm(extraMeta.y_pt).toFixed(2)) : 0,
  );
  const [temPosicao, setTemPosicao] = useState(
    extraMeta?.x_pt != null && extraMeta?.y_pt != null,
  );

  const caixaRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const [larguraTexto, setLarguraTexto] = useState(0);
  const [estilo, setEstilo] = useState<{ left: number; top: number } | null>(null);
  const ancoraRef = useRef(ancora);
  ancoraRef.current = ancora;

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

  useLayoutEffect(() => {
    const campo = campoRef.current;
    if (!campo) return;
    const anterior = campo.style.width;
    campo.style.width = "0px";
    const conteudo =
      campo.scrollWidth + (parseFloat(getComputedStyle(campo).paddingRight) || 0);
    const bordas = campo.offsetWidth - campo.clientWidth;
    campo.style.width = anterior;
    setLarguraTexto(Math.ceil(conteudo + bordas));
  }, [texto, fontesProntas, tamanhoPt]);

  useLayoutEffect(() => {
    const campo = campoRef.current;
    if (!campo) return;
    campo.style.height = "auto";
    const extra = campo.offsetHeight - campo.clientHeight;
    campo.style.height = `${campo.scrollHeight + extra}px`;
  }, [texto, larguraTexto, tamanhoPt]);

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
  }, [posicionar, larguraTexto, texto, modoExtra, tamanhoPt]);

  useEffect(() => {
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [posicionar]);

  const aplicar = () => {
    if (!modoExtra) {
      onAplicar(texto);
      return;
    }
    onAplicar(texto, {
      tamanho_pt: tamanhoPt,
      negrito: regiao.tipo === "campo_extra" ? negrito : [],
      align_h: alignH,
      align_v: alignV,
      x_pt: temPosicao ? mmParaPt(xMm) : extraMeta?.x_pt ?? null,
      y_pt: temPosicao ? mmParaPt(yMm) : extraMeta?.y_pt ?? null,
    });
  };

  const aplicarNegritoSelecao = () => {
    const campo = campoRef.current;
    if (!campo) return;
    let start = campo.selectionStart;
    let end = campo.selectionEnd;
    if (start === end) {
      // palavra sob o cursor
      const left = texto.slice(0, start).search(/\S+$/);
      const rightMatch = texto.slice(end).match(/^\S+/);
      start = left >= 0 ? left : start;
      end = end + (rightMatch ? rightMatch[0].length : 0);
    }
    if (end <= start) return;
    setNegrito(toggleNegritoRange(negrito, start, end, texto.length));
  };

  const linhasTexto = texto.split("\n");
  const linhas = Math.max(1, linhasTexto.length);
  const larguraCaixa = Math.max(
    LARGURA_MINIMA,
    modoExtra ? LARGURA_MINIMA + 40 : larguraTexto + FOLGA_CAIXA,
  );

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
      {modoExtra ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2">
          {regiao.tipo === "campo_extra" ? (
            <>
              <label className="flex items-center gap-1 text-[10px] font-medium text-neutral-600">
                pt
                <input
                  type="number"
                  min={4}
                  max={72}
                  step={0.5}
                  value={tamanhoPt}
                  data-testid="papelaria-extra-tamanho"
                  className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs"
                  onChange={(e) => setTamanhoPt(Number(e.target.value) || 11)}
                />
              </label>
              <button
                type="button"
                title="Negrito na seleção"
                aria-label="Negrito"
                data-testid="papelaria-extra-negrito"
                className="inline-flex size-7 items-center justify-center rounded border border-slate-300 text-neutral-700 hover:bg-slate-50"
                onClick={aplicarNegritoSelecao}
              >
                <Bold className="size-3.5" aria-hidden />
              </button>
            </>
          ) : (
            <label className="flex items-center gap-1 text-[10px] font-medium text-neutral-600">
              pt
              <input
                type="number"
                min={4}
                max={72}
                step={0.5}
                value={tamanhoPt}
                className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs"
                onChange={(e) => setTamanhoPt(Number(e.target.value) || 11)}
              />
            </label>
          )}
          <PapelariaAlignPicker
            align_h={alignH}
            align_v={alignV}
            onChange={({ align_h, align_v }) => {
              setAlignH(align_h);
              setAlignV(align_v);
            }}
          />
          <label className="flex items-center gap-1 text-[10px] font-medium text-neutral-600">
            X mm
            <input
              type="number"
              step={0.1}
              value={xMm}
              data-testid="papelaria-extra-x-mm"
              className="w-16 rounded border border-slate-300 px-1 py-0.5 text-xs"
              onChange={(e) => {
                setTemPosicao(true);
                setXMm(Number(e.target.value) || 0);
              }}
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] font-medium text-neutral-600">
            Y mm
            <input
              type="number"
              step={0.1}
              value={yMm}
              data-testid="papelaria-extra-y-mm"
              className="w-16 rounded border border-slate-300 px-1 py-0.5 text-xs"
              onChange={(e) => {
                setTemPosicao(true);
                setYMm(Number(e.target.value) || 0);
              }}
            />
          </label>
        </div>
      ) : null}
      <textarea
        ref={campoRef}
        autoFocus
        aria-label="Texto"
        value={texto}
        rows={linhas}
        wrap="off"
        spellCheck={false}
        onChange={(e) => setTexto(e.target.value)}
        onFocus={(e) => {
          if (!modoExtra) e.currentTarget.select();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancelar();
          } else if (teclaAplica(e)) {
            e.preventDefault();
            aplicar();
          } else if (modoExtra && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
            e.preventDefault();
            aplicarNegritoSelecao();
          }
        }}
        style={modoExtra ? { fontSize: `${Math.max(10, Math.min(22, tamanhoPt))}px` } : undefined}
        className={`block w-full resize-none overflow-x-auto overflow-y-hidden whitespace-pre rounded-md border border-slate-300 px-2 py-1.5 text-xs leading-snug text-neutral-800 focus:border-secondary-blue focus:outline-none focus:ring-1 focus:ring-secondary-blue/40`}
      />
      <p className="mt-1 text-[10px] leading-snug text-neutral-500">
        {modoExtra
          ? "Enter quebra a linha · Shift+Enter aplica · Ctrl+B negrito · Esc cancela."
          : "Enter quebra a linha · Shift+Enter ou Ctrl+Enter aplica · Esc cancela. Mantém a fonte e o alinhamento do campo."}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        {onRestaurar ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900"
            onClick={onRestaurar}
          >
            <RotateCcw className="size-3" aria-hidden />
            {modoExtra ? "Remover campo extra" : "Restaurar original"}
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
            onClick={aplicar}
            title="Shift+Enter ou Ctrl+Enter"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(caixa, document.body) : caixa;
}
