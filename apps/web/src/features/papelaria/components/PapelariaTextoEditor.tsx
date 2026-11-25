import { RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import type { ProvaPdfRegiao } from "@/api/papelariaProvaPdf";
import {
  mmParaPt,
  ptParaMm,
  segmentosComNegrito,
  selecaoEstaEmNegrito,
  toggleNegritoRange,
  type CampoExtraAlignH,
  type CampoExtraAlignV,
  type CampoExtraRedeItem,
} from "@/features/papelaria/papelariaCamposExtras";
import type { PapelariaRedeEstilo } from "@/features/papelaria/types";
import { cn } from "@sagra/ui";

import { PapelariaEstiloToolbar } from "./PapelariaEstiloToolbar";
import {
  PapelariaRedeExtraEditor,
  type RedeExtraCatalogoItem,
} from "./PapelariaRedeExtraEditor";

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
  redes?: CampoExtraRedeItem[];
  estilo?: PapelariaRedeEstilo | null;
  icone_pt?: number | null;
};

function isExtra(regiao: ProvaPdfRegiao): boolean {
  return regiao.tipo === "campo_extra" || regiao.tipo === "rede_extra";
}

function fonteCss(nome: string | null | undefined): string | undefined {
  const limpo = String(nome || "")
    .replace(/^[A-Z]{6}\+/, "")
    .trim();
  if (!limpo) return undefined;
  return `"${limpo.replace(/"/g, "")}", Arial, Helvetica, sans-serif`;
}

function alignCss(align: CampoExtraAlignH): "left" | "center" | "right" {
  if (align === "centro") return "center";
  if (align === "direita") return "right";
  return "left";
}

/**
 * Caixa para editar texto na prévia. Sempre oferece tamanho, negrito e alinhamento
 * 3×3 (extras e campos do modelo). Posição em mm só nos extras.
 */
export function PapelariaTextoEditor({
  regiao,
  ancora,
  onAplicar,
  onRestaurar,
  onCancelar,
  extraMeta,
  redesCatalogo,
  redesEstilos,
}: {
  regiao: ProvaPdfRegiao;
  ancora: () => AncoraEditor | null;
  onAplicar: (texto: string, meta?: ExtraEditorMeta) => void;
  onRestaurar?: () => void;
  onCancelar: () => void;
  /** Estado atual do extra / estilo do campo do modelo. */
  extraMeta?: ExtraEditorMeta;
  redesCatalogo?: RedeExtraCatalogoItem[];
  redesEstilos?: Array<{ id: PapelariaRedeEstilo; rotulo: string }>;
}) {
  const modoExtra = isExtra(regiao);
  const modoRedeExtra = regiao.tipo === "rede_extra";
  const permiteNegrito = regiao.tipo !== "rede" && regiao.tipo !== "rede_extra";
  const [texto, setTexto] = useState(regiao.texto);
  const [tamanhoPt, setTamanhoPt] = useState<number>(
    extraMeta?.tamanho_pt ?? regiao.tamanho_pt ?? 11,
  );
  const [negrito, setNegrito] = useState<Array<[number, number]>>(
    extraMeta?.negrito ?? regiao.negrito ?? [],
  );
  const [alignH, setAlignH] = useState<CampoExtraAlignH>(
    extraMeta?.align_h ?? regiao.align_h ?? "esquerda",
  );
  const [alignV, setAlignV] = useState<CampoExtraAlignV>(
    extraMeta?.align_v ?? regiao.align_v ?? "topo",
  );
  const [xMm, setXMm] = useState(() =>
    extraMeta?.x_pt != null ? Number(ptParaMm(extraMeta.x_pt).toFixed(2)) : 0,
  );
  const [yMm, setYMm] = useState(() =>
    extraMeta?.y_pt != null ? Number(ptParaMm(extraMeta.y_pt).toFixed(2)) : 0,
  );
  const [temPosicao, setTemPosicao] = useState(
    extraMeta?.x_pt != null && extraMeta?.y_pt != null,
  );
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [redesExtra, setRedesExtra] = useState<CampoExtraRedeItem[]>(() => {
    if (extraMeta?.redes?.length) return extraMeta.redes;
    if (regiao.redes?.length) return regiao.redes.map((r) => ({ chave: r.chave, valor: r.valor }));
    if (regiao.rede_chave) return [{ chave: regiao.rede_chave, valor: regiao.texto || "" }];
    return [{ chave: "instagram", valor: regiao.texto || "" }];
  });
  const [estiloRede, setEstiloRede] = useState<PapelariaRedeEstilo | null>(
    extraMeta?.estilo ?? (regiao.estilo as PapelariaRedeEstilo | null) ?? null,
  );
  const [iconePt, setIconePt] = useState<number | null>(
    extraMeta?.icone_pt ?? regiao.icone_pt ?? null,
  );

  const caixaRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const [larguraTexto, setLarguraTexto] = useState(0);
  const [estilo, setEstilo] = useState<{ left: number; top: number } | null>(null);
  const ancoraRef = useRef(ancora);
  ancoraRef.current = ancora;

  const fonteFamilia = fonteCss(regiao.fonte);
  const fontSizeCss = `${Math.max(4, Math.min(72, tamanhoPt))}pt`;
  const negritoAtivo =
    permiteNegrito && selecaoEstaEmNegrito(negrito, sel.start, sel.end, texto.length);

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

  const atualizarSelecao = useCallback(() => {
    const campo = campoRef.current;
    if (!campo) return;
    setSel({ start: campo.selectionStart, end: campo.selectionEnd });
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
  }, [texto, fontesProntas, tamanhoPt, fonteFamilia, negrito]);

  useLayoutEffect(() => {
    const campo = campoRef.current;
    if (!campo) return;
    campo.style.height = "auto";
    const extra = campo.offsetHeight - campo.clientHeight;
    campo.style.height = `${campo.scrollHeight + extra}px`;
  }, [texto, larguraTexto, tamanhoPt, negrito]);

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
  }, [posicionar, larguraTexto, texto, modoExtra, tamanhoPt, negrito]);

  useEffect(() => {
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [posicionar]);

  const onCancelarRef = useRef(onCancelar);
  onCancelarRef.current = onCancelar;
  // ESC cancela mesmo com foco na toolbar (pt / mm / alinhamento), não só no textarea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCancelarRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const aplicar = () => {
    const textoFinal = modoRedeExtra
      ? redesExtra.map((r) => r.valor).join("\n")
      : texto;
    onAplicar(textoFinal, {
      tamanho_pt: tamanhoPt,
      negrito: permiteNegrito ? negrito : [],
      align_h: alignH,
      align_v: alignV,
      x_pt: modoExtra
        ? temPosicao
          ? mmParaPt(xMm)
          : (extraMeta?.x_pt ?? null)
        : null,
      y_pt: modoExtra
        ? temPosicao
          ? mmParaPt(yMm)
          : (extraMeta?.y_pt ?? null)
        : null,
      ...(modoRedeExtra
        ? {
            redes: redesExtra,
            estilo: estiloRede,
            icone_pt: iconePt,
          }
        : {}),
    });
  };

  const aplicarNegritoSelecao = () => {
    const campo = campoRef.current;
    if (!campo) return;
    let start = campo.selectionStart;
    let end = campo.selectionEnd;
    if (start === end) {
      const left = texto.slice(0, start).search(/\S+$/);
      const rightMatch = texto.slice(end).match(/^\S+/);
      start = left >= 0 ? left : start;
      end = end + (rightMatch ? rightMatch[0].length : 0);
    }
    if (end <= start) return;
    setNegrito(toggleNegritoRange(negrito, start, end, texto.length));
    requestAnimationFrame(() => {
      campo.focus();
      campo.setSelectionRange(start, end);
      setSel({ start, end });
    });
  };

  const linhasTexto = texto.split("\n");
  const linhas = Math.max(1, linhasTexto.length);
  const larguraCaixa = Math.max(
    LARGURA_MINIMA,
    modoRedeExtra
      ? LARGURA_MINIMA + 80
      : modoExtra
        ? LARGURA_MINIMA + 40
        : larguraTexto + FOLGA_CAIXA,
  );

  const segsPreview = segmentosComNegrito(texto.length ? texto : " ", negrito);

  const tipografiaStyle: CSSProperties = {
    fontSize: fontSizeCss,
    fontFamily: fonteFamilia,
    lineHeight: 1.2,
    textAlign: alignCss(alignH),
  };

  const caixa = (
    <div
      ref={caixaRef}
      role="dialog"
      aria-label="Editar texto da prévia"
      className="fixed z-[200] rounded-lg border border-sagra-border bg-white p-3 shadow-xl"
      style={{
        left: estilo?.left ?? 0,
        top: estilo?.top ?? 0,
        visibility: estilo ? "visible" : "hidden",
        width: Math.max(larguraCaixa, LARGURA_MINIMA + 40),
        maxWidth: `calc(100vw - ${2 * MARGEM}px)`,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        // Se o clique direito cair no modal (sobre a região), fecha para o menu da prévia aparecer no próximo uso.
        e.preventDefault();
        onCancelarRef.current();
      }}
    >
      <PapelariaEstiloToolbar
        className="mb-2.5"
        tamanhoPt={tamanhoPt}
        onTamanhoPt={setTamanhoPt}
        align_h={alignH}
        align_v={alignV}
        onAlign={({ align_h, align_v }) => {
          setAlignH(align_h);
          setAlignV(align_v);
        }}
        mostrarNegrito={permiteNegrito}
        negritoAtivo={negritoAtivo}
        onNegrito={aplicarNegritoSelecao}
        mostrarIconePt={modoRedeExtra}
        iconePt={iconePt}
        onIconePt={setIconePt}
        mostrarMm={modoExtra}
        xMm={xMm}
        yMm={yMm}
        onXMm={(v) => {
          setTemPosicao(true);
          setXMm(v);
        }}
        onYMm={(v) => {
          setTemPosicao(true);
          setYMm(v);
        }}
      />
      {modoRedeExtra ? (
        <PapelariaRedeExtraEditor
          className="mb-1"
          redes={redesExtra}
          onRedesChange={setRedesExtra}
          estilo={estiloRede}
          onEstiloChange={setEstiloRede}
          catalogo={redesCatalogo ?? []}
          estilosDisponiveis={redesEstilos}
        />
      ) : (
        <div className="relative">
          {segsPreview ? (
            <div
              aria-hidden
              data-testid="papelaria-texto-preview"
              className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre break-spaces rounded-md border border-transparent px-2.5 py-2 text-neutral-800"
              style={tipografiaStyle}
            >
              {segsPreview.map((seg, i) => (
                <span
                  key={`${i}-${seg.negrito ? "b" : "r"}-${seg.texto.length}`}
                  style={{ fontWeight: seg.negrito ? 700 : 400 }}
                >
                  {seg.texto}
                </span>
              ))}
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
            onChange={(e) => {
              const next = e.target.value;
              // Ajusta ranges de negrito quando o texto encolhe.
              if (next.length < texto.length) {
                setNegrito((prev) =>
                  prev
                    .map(([a, b]) => [a, Math.min(b, next.length)] as [number, number])
                    .filter(([a, b]) => b > a && a < next.length),
                );
              }
              setTexto(next);
              atualizarSelecao();
            }}
            onSelect={atualizarSelecao}
            onKeyUp={atualizarSelecao}
            onMouseUp={atualizarSelecao}
            onFocus={(e) => {
              if (!modoExtra) e.currentTarget.select();
              atualizarSelecao();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onCancelar();
              } else if (teclaAplica(e)) {
                e.preventDefault();
                aplicar();
              } else if (permiteNegrito && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
                e.preventDefault();
                aplicarNegritoSelecao();
              }
            }}
            style={{
              ...tipografiaStyle,
              color: segsPreview ? "transparent" : undefined,
              caretColor: "#171717",
            }}
            className={cn(
              "relative block w-full resize-none overflow-x-auto overflow-y-hidden whitespace-pre rounded-md border border-sagra-border px-2.5 py-2 leading-snug outline-none focus:border-secondary-blue focus:ring-1 focus:ring-secondary-blue/30",
              segsPreview ? "bg-transparent text-transparent" : "text-xs text-neutral-800",
            )}
          />
        </div>
      )}
      <p className="mt-1.5 text-[10px] leading-snug text-neutral-500">
        {modoRedeExtra
          ? "Esc cancela · Aplicar confirma redes, logo e tipografia."
          : `Enter quebra a linha · Shift+Enter aplica${permiteNegrito ? " · Ctrl+B negrito" : ""} · Esc cancela.`}
      </p>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {onRestaurar ? (
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 hover:text-amber-900"
            onClick={onRestaurar}
          >
            <RotateCcw className="size-3" aria-hidden />
            {modoExtra ? "Remover campo extra" : "Restaurar original"}
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md border border-sagra-border bg-white px-2.5 text-[11px] font-semibold text-neutral-600 hover:bg-slate-50"
            onClick={onCancelar}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md bg-secondary-blue px-2.5 text-[11px] font-semibold text-white hover:bg-secondary-blue/90"
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
