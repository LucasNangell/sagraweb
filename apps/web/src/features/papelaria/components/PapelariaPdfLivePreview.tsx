import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  AlertTriangle,
  Loader2,
  Maximize2,
  Pencil,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";

import { previaPdfAoVivo, type ProvaPdfPrevia, type ProvaPdfRegiao } from "@/api/papelariaProvaPdf";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { PapelariaComposicao } from "@/features/papelaria/types";
import {
  DIRECOES_EXTRA,
  ancoraPtDeAreaFrac,
  mmParaPt,
  segmentosComNegrito,
  selecaoEstaEmNegrito,
  toggleNegritoRange,
  type CampoExtraAlignH,
  type CampoExtraAlignV,
  type CampoExtraDirecao,
  type CampoExtraTipo,
} from "@/features/papelaria/papelariaCamposExtras";
import {
  cropRegiaoDaImagem,
  delayPreviaParaChave,
  intersecaoAreaFrac,
  type AreaFrac,
  type ConteudoOtimistaExtra,
} from "@/features/papelaria/papelariaPreviaOtimista";

import { PapelariaEstiloToolbar } from "./PapelariaEstiloToolbar";
import { PapelariaTextoEditor, type ExtraEditorMeta } from "./PapelariaTextoEditor";

export type RedeCatalogoItem = { chave: string; nome: string };

export type AdicionarCampoExtraPayload = {
  tipo: CampoExtraTipo;
  ancora_chave: string;
  direcao: CampoExtraDirecao;
  texto?: string;
  rede_chave?: string;
  rede_valor?: string;
  tamanho_pt?: number | null;
  negrito?: Array<[number, number]>;
  align_h?: CampoExtraAlignH;
  align_v?: CampoExtraAlignV;
  x_pt?: number | null;
  y_pt?: number | null;
};

export type MoverCampoExtraPayload = {
  extraId: string;
  x_pt: number;
  y_pt: number;
};

const DRAG_THRESHOLD_PX = 4;
const GUIDE_TOLERANCE_PX = 3;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

type DragState = {
  chave: string;
  extraId: string;
  pagina: number;
  startX: number;
  startY: number;
  orig: AreaFrac;
  cur: AreaFrac;
  pageW: number;
  pageH: number;
  moved: boolean;
  /** Após soltar: mantém área até a prévia nova confirmar. */
  committed?: boolean;
  align_h: CampoExtraAlignH;
  align_v: CampoExtraAlignV;
  /** Recorte PNG da região (formatação fiel), sem pixels de outras regiões. */
  cropDataUrl?: string | null;
};

/**
 * Gate da prévia PDF ao vivo (pipeline Ct Visita): vale para qualquer produto
 * com ``tem_prova_pdf`` — campos dinâmicos / prévia por imagem não bloqueiam.
 */
export function deveUsarPreviaPdfAoVivo(
  temProvaPdf: boolean | undefined,
  selectedModelId: number | null,
  hasValues: boolean,
): boolean {
  return Boolean(temProvaPdf) && selectedModelId !== null && hasValues;
}

export function clampZoom(zoom: number): number {
  const stepped = Math.round(zoom / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(stepped.toFixed(2))));
}

type Caixa = { left: number; top: number; width: number; height: number };
type Size = { w: number; h: number };

/**
 * Tamanho de cada página para caber na viewport (contain) × zoom do usuário.
 * ``zoom = 1`` = maior tamanho que cabe sem scroll; >1 amplia com scroll.
 */
export function tamanhoPaginaPrevia(opts: {
  natural: Size;
  viewport: Size;
  layout: "stack" | "row";
  pageCount: number;
  zoom: number;
  pad?: number;
  gap?: number;
  titleH?: number;
}): Size | null {
  const { natural: nat, viewport, layout, pageCount, zoom } = opts;
  const pad = opts.pad ?? 16;
  const gap = opts.gap ?? 16;
  const titleH = opts.titleH ?? 22;
  if (!nat.w || !nat.h || viewport.w < 40 || viewport.h < 40) return null;

  const n = Math.max(pageCount, 1);
  let boxW = Math.max(40, viewport.w - pad);
  let boxH = Math.max(40, viewport.h - pad - titleH);
  if (layout === "row" && n > 1) {
    boxW = Math.max(40, (viewport.w - pad - gap * (n - 1)) / n);
  } else if (layout === "stack" && n > 1) {
    boxH = Math.max(
      40,
      (viewport.h - pad - gap * (n - 1) - titleH * n) / n,
    );
  }
  const fit = Math.min(boxW / nat.w, boxH / nat.h);
  if (!Number.isFinite(fit) || fit <= 0) return null;
  return {
    w: Math.max(40, nat.w * fit * zoom),
    h: Math.max(40, nat.h * fit * zoom),
  };
}

/** Chave estável dos valores (ordem das chaves não importa). */
function chaveValores(values: Record<string, string>): string {
  const ordenado: Record<string, string> = {};
  for (const k of Object.keys(values).sort()) ordenado[k] = values[k] ?? "";
  return JSON.stringify(ordenado);
}

/** Debounce dual: ação (extras/textos) imediata; digitação de form ~250ms. */
function useDebouncedChave(chave: string): string {
  const [v, setV] = useState(chave);
  const prevRef = useRef(chave);
  useEffect(() => {
    const delay = delayPreviaParaChave(prevRef.current, chave);
    prevRef.current = chave;
    if (delay <= 0) {
      setV(chave);
      return;
    }
    const t = window.setTimeout(() => setV(chave), delay);
    return () => window.clearTimeout(t);
  }, [chave]);
  return v;
}

function estiloAreaFrac(area: AreaFrac, caixa: Caixa) {
  const [x0, y0, x1, y1] = area;
  return {
    left: x0 * caixa.width,
    top: y0 * caixa.height,
    width: Math.max(8, (x1 - x0) * caixa.width),
    height: Math.max(8, (y1 - y0) * caixa.height),
  };
}

function fonteCssPreview(nome: string | null | undefined): string | undefined {
  const limpo = String(nome || "")
    .replace(/^[A-Z]{6}\+/, "")
    .trim();
  if (!limpo) return undefined;
  return `"${limpo.replace(/"/g, "")}", Arial, Helvetica, sans-serif`;
}

function tituloPagina(indice: number): string {
  if (indice === 0) return "Frente";
  if (indice === 1) return "Verso";
  return `Pág. ${indice + 1}`;
}

/**
 * Prévia ao vivo a partir do PDF do modelo: o servidor aplica os valores do
 * formulário com a mesma renderização da prova final (fonte, cor, negrito,
 * linhas que somem quando vazias). Substitui a prévia por imagem + posições.
 */
export type FetchPreviaPdf = (
  modeloId: number,
  dados: Record<string, string>,
  signal?: AbortSignal,
  composicao?: PapelariaComposicao | null,
) => Promise<ProvaPdfPrevia>;

export function PapelariaPdfLivePreview({
  modeloId,
  values,
  composicao = null,
  className,
  onEditarTexto,
  onRestaurarTexto,
  fetchPrevia = previaPdfAoVivo,
  queryKeyPrefix = "papelaria",
  /** `stack` = frente acima do verso; `row` = frente à esquerda, verso à direita. */
  layout = "stack",
  /** Menu de contexto para campos extras (operador). Portal passa `false`. */
  permitirCamposExtras = true,
  redesCatalogo = [],
  onAdicionarCampoExtra,
  onRemoverCampoExtra,
  onMoverCampoExtra,
  extrasMeta,
}: {
  modeloId: number;
  values: Record<string, string>;
  /** Frente e verso independentes: junta a frente e o verso escolhidos. */
  composicao?: PapelariaComposicao | null;
  className?: string;
  /** Texto digitado direto na prévia (com as regras do campo do PDF). */
  onEditarTexto?: (regiao: ProvaPdfRegiao, texto: string, meta?: ExtraEditorMeta) => void;
  /** Volta o campo ao texto do template. */
  onRestaurarTexto?: (regiao: ProvaPdfRegiao) => void;
  /** Por padrão chama a API autenticada; o portal passa a variante com token. */
  fetchPrevia?: FetchPreviaPdf;
  /** Prefixo da queryKey (ex.: portal) para não misturar caches. */
  queryKeyPrefix?: string;
  layout?: "stack" | "row";
  permitirCamposExtras?: boolean;
  redesCatalogo?: RedeCatalogoItem[];
  onAdicionarCampoExtra?: (payload: AdicionarCampoExtraPayload) => void;
  onRemoverCampoExtra?: (extraId: string) => void;
  onMoverCampoExtra?: (payload: MoverCampoExtraPayload) => void;
  /** Metadados locais dos extras (align/tamanho/posição) para o editor. */
  extrasMeta?: Record<string, ExtraEditorMeta>;
}) {
  const chave = useMemo(() => chaveValores(values), [values]);
  const chaveDebounced = useDebouncedChave(chave);
  const chaveComposicao = composicao
    ? `${composicao.frente.modelo_id}:${composicao.frente.pagina}|${composicao.verso.modelo_id}:${composicao.verso.pagina}`
    : "";

  const query = useQuery({
    queryKey: [queryKeyPrefix, "previa-pdf", modeloId, chaveComposicao, chaveDebounced],
    queryFn: ({ signal }) =>
      fetchPrevia(
        modeloId,
        JSON.parse(chaveDebounced) as Record<string, string>,
        signal,
        composicao,
      ),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Mantém a última prévia boa quando uma atualização falha (ex.: caractere
  // que a fonte não tem) — o erro aparece sem apagar a imagem.
  const [ultima, setUltima] = useState<ProvaPdfPrevia | null>(null);
  useEffect(() => {
    if (query.data && !query.isPlaceholderData) setUltima(query.data);
  }, [query.data, query.isPlaceholderData]);
  useEffect(() => {
    setUltima(null);
  }, [modeloId]);
  const exibida = query.data ?? ultima;

  const paginas = exibida?.paginas ?? [];
  const atualizando = query.isFetching || chave !== chaveDebounced;

  const editavel = Boolean(onEditarTexto);
  const todasRegioes = useMemo(
    () => (editavel ? (exibida?.regioes ?? []) : []),
    [editavel, exibida?.regioes],
  );
  const [editando, setEditando] = useState<string | null>(null);
  const regiaoEditada = todasRegioes.find((r) => r.chave === editando) ?? null;
  const [redeDialog, setRedeDialog] = useState<{
    ancora_chave: string;
    direcao: CampoExtraDirecao;
  } | null>(null);
  const [redeChave, setRedeChave] = useState("");
  const [redeValor, setRedeValor] = useState("");
  const [textoDialog, setTextoDialog] = useState<{
    ancora_chave: string;
    direcao: CampoExtraDirecao;
  } | null>(null);
  const [textoNovo, setTextoNovo] = useState("");
  const [textoTamanhoPt, setTextoTamanhoPt] = useState(11);
  const [textoNegrito, setTextoNegrito] = useState<Array<[number, number]>>([]);
  const [textoAlignH, setTextoAlignH] = useState<CampoExtraAlignH>("esquerda");
  const [textoAlignV, setTextoAlignV] = useState<CampoExtraAlignV>("topo");
  const [textoXMm, setTextoXMm] = useState(0);
  const [textoYMm, setTextoYMm] = useState(0);
  const [textoTemPos, setTextoTemPos] = useState(false);
  const [textoSel, setTextoSel] = useState({ start: 0, end: 0 });
  const textoCampoRef = useRef<HTMLTextAreaElement>(null);
  const [redeTamanhoPt, setRedeTamanhoPt] = useState(11);
  const [redeAlignH, setRedeAlignH] = useState<CampoExtraAlignH>("esquerda");
  const [redeAlignV, setRedeAlignV] = useState<CampoExtraAlignV>("topo");
  const [redeXMm, setRedeXMm] = useState(0);
  const [redeYMm, setRedeYMm] = useState(0);
  const [redeTemPos, setRedeTemPos] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [conteudosOtimistas, setConteudosOtimistas] = useState<
    Record<string, ConteudoOtimistaExtra>
  >({});

  useEffect(() => {
    setEditando(null);
    setRedeDialog(null);
    setTextoDialog(null);
    setDrag(null);
    setConteudosOtimistas({});
  }, [modeloId]);

  // Mantém posição otimista até a prévia confirmar (evita snap-back).
  useEffect(() => {
    if (drag?.committed && !atualizando) setDrag(null);
  }, [drag?.committed, atualizando]);

  useEffect(() => {
    if (!atualizando) setConteudosOtimistas({});
  }, [atualizando]);

  const menuExtrasAtivo =
    permitirCamposExtras && Boolean(onAdicionarCampoExtra) && editavel;

  /** Limpa só o conteúdo digitável; a tipografia vem da âncora. */
  const limparConteudoCriacao = useCallback(() => {
    setTextoNovo("");
    setTextoNegrito([]);
    setTextoSel({ start: 0, end: 0 });
    setTextoXMm(0);
    setTextoYMm(0);
    setTextoTemPos(false);
    setRedeChave("");
    setRedeValor("");
    setRedeXMm(0);
    setRedeYMm(0);
    setRedeTemPos(false);
  }, []);

  /**
   * Herda tipografia/alinhamento do campo em que o usuário abriu o menu
   * (região + extrasMeta), para o modal já nascer no mesmo padrão.
   */
  const aplicarEstiloDaAncora = useCallback(
    (regiao: ProvaPdfRegiao) => {
      const eid =
        regiao.extra_id ??
        (regiao.chave.startsWith("extra:") ? regiao.chave.slice(6) : null);
      const meta =
        (eid ? extrasMeta?.[eid] : undefined) ?? extrasMeta?.[regiao.chave];
      const tamanho = Math.max(
        4,
        Math.min(72, Number(meta?.tamanho_pt ?? regiao.tamanho_pt ?? 11) || 11),
      );
      const align_h = meta?.align_h ?? regiao.align_h ?? "esquerda";
      const align_v = meta?.align_v ?? regiao.align_v ?? "topo";
      setTextoTamanhoPt(tamanho);
      setTextoAlignH(align_h);
      setTextoAlignV(align_v);
      setRedeTamanhoPt(tamanho);
      setRedeAlignH(align_h);
      setRedeAlignV(align_v);
    },
    [extrasMeta],
  );

  const confirmarRedeExtra = useCallback(() => {
    if (!redeDialog || !onAdicionarCampoExtra || !redeChave) return;
    onAdicionarCampoExtra({
      tipo: "rede",
      ancora_chave: redeDialog.ancora_chave,
      direcao: redeDialog.direcao,
      rede_chave: redeChave,
      rede_valor: redeValor.trim(),
      tamanho_pt: redeTamanhoPt,
      align_h: redeAlignH,
      align_v: redeAlignV,
      x_pt: redeTemPos ? mmParaPt(redeXMm) : null,
      y_pt: redeTemPos ? mmParaPt(redeYMm) : null,
      negrito: [],
    });
    setRedeDialog(null);
    limparConteudoCriacao();
  }, [
    redeDialog,
    onAdicionarCampoExtra,
    redeChave,
    redeValor,
    redeTamanhoPt,
    redeAlignH,
    redeAlignV,
    redeTemPos,
    redeXMm,
    redeYMm,
    limparConteudoCriacao,
  ]);

  const confirmarTextoExtra = useCallback(() => {
    if (!textoDialog || !onAdicionarCampoExtra) return;
    onAdicionarCampoExtra({
      tipo: "texto",
      ancora_chave: textoDialog.ancora_chave,
      direcao: textoDialog.direcao,
      texto: textoNovo,
      tamanho_pt: textoTamanhoPt,
      negrito: textoNegrito,
      align_h: textoAlignH,
      align_v: textoAlignV,
      x_pt: textoTemPos ? mmParaPt(textoXMm) : null,
      y_pt: textoTemPos ? mmParaPt(textoYMm) : null,
    });
    setTextoDialog(null);
    limparConteudoCriacao();
  }, [
    textoDialog,
    onAdicionarCampoExtra,
    textoNovo,
    textoTamanhoPt,
    textoNegrito,
    textoAlignH,
    textoAlignV,
    textoTemPos,
    textoXMm,
    textoYMm,
    limparConteudoCriacao,
  ]);

  const aplicarNegritoCriacao = useCallback(() => {
    const campo = textoCampoRef.current;
    if (!campo) return;
    let start = campo.selectionStart;
    let end = campo.selectionEnd;
    if (start === end) {
      const left = textoNovo.slice(0, start).search(/\S+$/);
      const rightMatch = textoNovo.slice(end).match(/^\S+/);
      start = left >= 0 ? left : start;
      end = end + (rightMatch ? rightMatch[0].length : 0);
    }
    if (end <= start) return;
    setTextoNegrito(toggleNegritoRange(textoNegrito, start, end, textoNovo.length));
    requestAnimationFrame(() => {
      campo.focus();
      campo.setSelectionRange(start, end);
      setTextoSel({ start, end });
    });
  }, [textoNovo, textoNegrito]);

  const calcGuides = useCallback(
    (pagina: number, area: [number, number, number, number], selfChave: string, caixa: Caixa) => {
      const others = todasRegioes.filter(
        (r) => r.pagina_saida === pagina && r.chave !== selfChave,
      );
      const edges = (a: [number, number, number, number]) => ({
        l: a[0],
        c: (a[0] + a[2]) / 2,
        r: a[2],
        t: a[1],
        m: (a[1] + a[3]) / 2,
        b: a[3],
      });
      const me = edges(area);
      const tol = GUIDE_TOLERANCE_PX / Math.max(caixa.width, 1);
      const v: number[] = [];
      const h: number[] = [];
      for (const o of others) {
        const e = edges(o.area);
        for (const [a, b] of [
          [me.l, e.l],
          [me.l, e.r],
          [me.r, e.l],
          [me.r, e.r],
          [me.c, e.c],
        ] as const) {
          if (Math.abs(a - b) <= tol) v.push(b);
        }
        for (const [a, b] of [
          [me.t, e.t],
          [me.t, e.b],
          [me.b, e.t],
          [me.b, e.b],
          [me.m, e.m],
        ] as const) {
          if (Math.abs(a - b) <= tol) h.push(b);
        }
      }
      setGuides({ v: [...new Set(v)], h: [...new Set(h)] });
    },
    [todasRegioes],
  );

  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ w: 0, h: 0 });
  const [naturais, setNaturais] = useState<Size[]>([]);

  useEffect(() => {
    setZoom(1);
    setNaturais([]);
  }, [modeloId, chaveComposicao, layout]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setViewport({ w: Math.max(0, width), h: Math.max(0, height) });
    });
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const registrarNatural = useCallback((indice: number, img: HTMLImageElement) => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return;
    setNaturais((prev) => {
      const next = prev.slice();
      while (next.length <= indice) next.push({ w: 0, h: 0 });
      if (next[indice]?.w === w && next[indice]?.h === h) return prev;
      next[indice] = { w, h };
      return next;
    });
  }, []);

  const tamanhosExibicao = useMemo(() => {
    return paginas.map((_, i) => {
      const nat = naturais[i];
      if (!nat?.w || !nat?.h) {
        return { w: undefined as number | undefined, h: undefined as number | undefined };
      }
      const size = tamanhoPaginaPrevia({
        natural: nat,
        viewport,
        layout,
        pageCount: paginas.length,
        zoom,
      });
      return size
        ? { w: size.w, h: size.h }
        : { w: undefined as number | undefined, h: undefined as number | undefined };
    });
  }, [paginas, naturais, viewport, layout, zoom]);

  // Caixa de cada imagem (frações da página → pixels).
  const imgRefs = useRef<Array<HTMLImageElement | null>>([]);
  const [caixas, setCaixas] = useState<Caixa[]>([]);
  const medir = useCallback(() => {
    setCaixas(
      imgRefs.current.map((img) => {
        if (!img) return { left: 0, top: 0, width: 0, height: 0 };
        return {
          left: img.offsetLeft + img.clientLeft,
          top: img.offsetTop + img.clientTop,
          width: img.clientWidth,
          height: img.clientHeight,
        };
      }),
    );
  }, []);
  const temImagem = paginas.length > 0;
  useLayoutEffect(() => {
    if (!temImagem || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    for (const img of imgRefs.current) {
      if (!img) continue;
      ro.observe(img);
      if (img.parentElement) ro.observe(img.parentElement);
    }
    medir();
    return () => ro.disconnect();
  }, [medir, temImagem, paginas.length, zoom, tamanhosExibicao]);

  const onWheelZoom = useCallback((e: WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((z) => clampZoom(z + delta));
  }, []);

  const caixaVazia: Caixa = { left: 0, top: 0, width: 0, height: 0 };
  const caixaEditada =
    regiaoEditada != null
      ? (caixas[regiaoEditada.pagina_saida] ?? caixaVazia)
      : null;

  const zoomLabel = `${Math.round(zoom * 100)}%`;

  return (
    <article
      className={cn(
        "flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm",
        className,
      )}
      data-testid="papelaria-pdf-live-preview"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sagra-border px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-neutral-600">
            Prévia em tempo real
          </h3>
          <p className="text-[10px] text-neutral-500">
            {todasRegioes.length ? (
              <span className="inline-flex items-center gap-1">
                <Pencil className="size-2.5" aria-hidden />
                Clique num texto da prévia para editá-lo. Ctrl+scroll para zoom.
              </span>
            ) : (
              "Gerada a partir do PDF do modelo — igual à prova final. Ctrl+scroll para zoom."
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="inline-flex items-center gap-0.5 rounded border border-sagra-border bg-neutral-50 p-0.5"
            data-testid="papelaria-previa-zoom"
          >
            <button
              type="button"
              className="rounded p-1 text-neutral-600 hover:bg-white hover:text-secondary-blue disabled:opacity-40"
              aria-label="Diminuir zoom"
              disabled={zoom <= ZOOM_MIN}
              onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
            >
              <ZoomOut className="size-3.5" aria-hidden />
            </button>
            <span className="min-w-[2.75rem] text-center text-[10px] font-semibold tabular-nums text-neutral-700">
              {zoomLabel}
            </span>
            <button
              type="button"
              className="rounded p-1 text-neutral-600 hover:bg-white hover:text-secondary-blue disabled:opacity-40"
              aria-label="Aumentar zoom"
              disabled={zoom >= ZOOM_MAX}
              onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
            >
              <ZoomIn className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              className="ml-0.5 inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-neutral-600 hover:bg-white hover:text-secondary-blue"
              aria-label="Ajustar à área"
              title="Ajustar à área"
              onClick={() => setZoom(1)}
            >
              <Maximize2 className="size-3" aria-hidden />
              Ajustar
            </button>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[10px] text-neutral-500 transition-opacity",
              atualizando ? "opacity-100" : "opacity-0",
            )}
            aria-live="polite"
          >
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Atualizando
          </span>
        </div>
      </header>

      <div
        ref={viewportRef}
        className="relative flex min-h-0 flex-1 flex-col items-center overflow-auto bg-slate-50 p-2"
        onWheel={onWheelZoom}
        data-testid="papelaria-previa-viewport"
      >
        {paginas.length ? (
          <div
            className={cn(
              "flex w-full items-start gap-4",
              layout === "row"
                ? "flex-row flex-wrap justify-center"
                : "flex-col items-center",
              zoom > 1 ? "min-w-max" : "max-w-full",
            )}
            data-layout={layout}
          >
            {paginas.map((src, i) => {
              const titulo = tituloPagina(i);
              const regioesPagina = todasRegioes.filter((r) => r.pagina_saida === i);
              const caixa = caixas[i] ?? { left: 0, top: 0, width: 0, height: 0 };
              const size = tamanhosExibicao[i];
              return (
                <section
                  key={i}
                  className={cn(
                    "relative flex flex-col items-center gap-1",
                    layout === "row" && zoom <= 1 ? "min-w-0" : undefined,
                  )}
                  data-testid={`papelaria-previa-pagina-${i}`}
                >
                  <h4 className="w-full text-center text-[11px] font-semibold text-slate-600">
                    {titulo}
                  </h4>
                  <div className="relative inline-block">
                    <img
                      ref={(el) => {
                        imgRefs.current[i] = el;
                        if (el?.complete && el.naturalWidth) registrarNatural(i, el);
                      }}
                      src={src}
                      alt={`Prévia da página ${i + 1}`}
                      onLoad={(e) => {
                        registrarNatural(i, e.currentTarget);
                        medir();
                      }}
                      width={size?.w}
                      height={size?.h}
                      style={
                        size?.w && size?.h
                          ? { width: size.w, height: size.h }
                          : undefined
                      }
                      className={cn(
                        "rounded border border-slate-200 bg-white object-contain shadow-sm transition-opacity",
                        !size?.w &&
                          (layout === "row"
                            ? "max-h-full max-w-full w-auto"
                            : "max-h-full max-w-full"),
                        atualizando && "opacity-80",
                      )}
                    />
                    {drag && drag.pagina === i && !drag.committed
                      ? [
                          ...guides.v.map((xf, gi) => (
                            <div
                              key={`gv-${gi}`}
                              data-testid="papelaria-extra-guide-v"
                              className="pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-sky-500"
                              style={{ left: xf * caixa.width }}
                            />
                          )),
                          ...guides.h.map((yf, gi) => (
                            <div
                              key={`gh-${gi}`}
                              data-testid="papelaria-extra-guide-h"
                              className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-sky-500"
                              style={{ top: yf * caixa.height }}
                            />
                          )),
                        ]
                      : null}
                    {drag &&
                    drag.pagina === i &&
                    drag.moved &&
                    drag.cropDataUrl ? (
                      <>
                        <div
                          aria-hidden
                          data-testid="papelaria-extra-tapa-origem"
                          className="pointer-events-none absolute z-[5] bg-white"
                          style={estiloAreaFrac(drag.orig, caixa)}
                        />
                        <img
                          aria-hidden
                          data-testid="papelaria-extra-clone"
                          src={drag.cropDataUrl}
                          alt=""
                          className="pointer-events-none absolute z-[25] object-fill"
                          style={estiloAreaFrac(drag.cur, caixa)}
                        />
                      </>
                    ) : null}
                    {regioesPagina.map((r) => {
                      const isExtra =
                        r.tipo === "campo_extra" || r.tipo === "rede_extra";
                      const extraId =
                        r.extra_id ?? (r.chave.startsWith("extra:") ? r.chave.slice(6) : null);
                      const area =
                        drag && drag.chave === r.chave ? drag.cur : r.area;
                      const bloqueada = Boolean(r.bloquear_edicao);
                      const ativa = !bloqueada && r.chave === editando;
                      const arrastandoEsta = Boolean(drag && drag.chave === r.chave);
                      const outroArrasteAtivo = Boolean(drag && drag.chave !== r.chave);
                      const estiloArea = estiloAreaFrac(area, caixa);
                      const otimista =
                        extraId && conteudosOtimistas[extraId]
                          ? conteudosOtimistas[extraId]
                          : null;
                      if (bloqueada) {
                        return (
                          <div
                            key={r.chave}
                            aria-hidden
                            title="Edição bloqueada nas configurações do modelo"
                            data-testid="papelaria-previa-regiao-bloqueada"
                            className="pointer-events-none absolute rounded-[2px]"
                            style={estiloArea}
                          />
                        );
                      }
                      const botaoProps = {
                        type: "button" as const,
                        "aria-label": `Editar texto: ${r.texto || r.marcador}`,
                        title: menuExtrasAtivo
                          ? isExtra
                            ? "Arraste para mover · clique para editar · botão direito para opções"
                            : "Clique para editar · botão direito para campos extras"
                          : r.editado
                            ? "Texto editado — clique para alterar"
                            : "Clique para editar",
                        "data-testid": "papelaria-previa-regiao",
                        "data-editado": r.editado ? ("true" as const) : undefined,
                        className: cn(
                          "absolute rounded-[2px] outline-1 outline-offset-1 transition-colors focus-visible:outline-2 focus-visible:outline-secondary-blue",
                          isExtra && menuExtrasAtivo ? "cursor-grab active:cursor-grabbing" : "cursor-text",
                          arrastandoEsta && "z-20 cursor-grabbing",
                          outroArrasteAtivo && "pointer-events-none",
                          ativa
                            ? "bg-secondary-blue/10 outline outline-secondary-blue"
                            : r.editado || isExtra
                              ? "outline-dashed outline-amber-400/80 hover:bg-amber-100/30"
                              : "outline-dashed outline-transparent hover:bg-secondary-blue/5 hover:outline-secondary-blue/70",
                          arrastandoEsta && drag?.moved && "opacity-0",
                        ),
                        style: estiloArea,
                        onClick: (e: ReactMouseEvent) => {
                          if (drag?.moved) {
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                          }
                          setEditando(r.chave);
                        },
                        onPointerDown:
                          isExtra && menuExtrasAtivo && extraId && onMoverCampoExtra
                            ? (e: ReactPointerEvent<HTMLButtonElement>) => {
                                if (e.button !== 0) return;
                                e.preventDefault();
                                e.stopPropagation();
                                // Arraste e edição não convivem.
                                setEditando(null);
                                try {
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                } catch {
                                  /* jsdom / captura indisponível */
                                }
                                const orig = [...r.area] as AreaFrac;
                                const align_h = r.align_h ?? "esquerda";
                                const align_v = r.align_v ?? "topo";
                                const metaExtra = extrasMeta?.[extraId];
                                setDrag({
                                  chave: r.chave,
                                  extraId,
                                  pagina: i,
                                  startX: e.clientX,
                                  startY: e.clientY,
                                  orig,
                                  cur: orig,
                                  pageW: r.page_w || 595,
                                  pageH: r.page_h || 842,
                                  moved: false,
                                  committed: false,
                                  align_h: metaExtra?.align_h ?? align_h,
                                  align_v: metaExtra?.align_v ?? align_v,
                                  cropDataUrl: null,
                                });
                              }
                            : undefined,
                        onPointerMove:
                          isExtra && menuExtrasAtivo
                            ? (e: ReactPointerEvent<HTMLButtonElement>) => {
                                setDrag((prev) => {
                                  if (!prev || prev.chave !== r.chave || prev.committed) {
                                    return prev;
                                  }
                                  const dxPx = e.clientX - prev.startX;
                                  const dyPx = e.clientY - prev.startY;
                                  const moved =
                                    prev.moved ||
                                    Math.hypot(dxPx, dyPx) >= DRAG_THRESHOLD_PX;
                                  if (!moved) return prev;
                                  e.stopPropagation();
                                  const dx = dxPx / caixa.width;
                                  const dy = dyPx / caixa.height;
                                  const [a0, a1, a2, a3] = prev.orig;
                                  const w = a2 - a0;
                                  const h = a3 - a1;
                                  let nx0 = a0 + dx;
                                  let ny0 = a1 + dy;
                                  nx0 = Math.max(0, Math.min(1 - w, nx0));
                                  ny0 = Math.max(0, Math.min(1 - h, ny0));
                                  const cur: AreaFrac = [nx0, ny0, nx0 + w, ny0 + h];
                                  calcGuides(i, cur, r.chave, caixa);
                                  let cropDataUrl = prev.cropDataUrl;
                                  if (!cropDataUrl) {
                                    const img = imgRefs.current[i];
                                    if (img) {
                                      const mascaras = regioesPagina
                                        .filter((o) => o.chave !== r.chave)
                                        .map((o) => o.area as AreaFrac)
                                        .filter((a) => intersecaoAreaFrac(prev.orig, a));
                                      cropDataUrl = cropRegiaoDaImagem(
                                        img,
                                        prev.orig,
                                        mascaras,
                                      );
                                    }
                                  }
                                  return { ...prev, cur, moved: true, cropDataUrl };
                                });
                              }
                            : undefined,
                        onPointerUp:
                          isExtra && menuExtrasAtivo
                            ? (e: ReactPointerEvent<HTMLButtonElement>) => {
                                try {
                                  e.currentTarget.releasePointerCapture(e.pointerId);
                                } catch {
                                  /* ignore */
                                }
                                e.stopPropagation();
                                setDrag((prev) => {
                                  if (!prev || prev.chave !== r.chave) return prev;
                                  setGuides({ v: [], h: [] });
                                  if (!prev.moved) return null;
                                  if (onMoverCampoExtra) {
                                    const ancora = ancoraPtDeAreaFrac(
                                      prev.cur,
                                      prev.pageW,
                                      prev.pageH,
                                      prev.align_h,
                                      prev.align_v,
                                    );
                                    onMoverCampoExtra({
                                      extraId: prev.extraId,
                                      x_pt: ancora.x_pt,
                                      y_pt: ancora.y_pt,
                                    });
                                  }
                                  // Mantém cur até !atualizando (sem snap-back).
                                  return { ...prev, moved: true, committed: true };
                                });
                              }
                            : undefined,
                      };
                      const overlayOtimista =
                        otimista &&
                        r.tipo === "campo_extra" &&
                        !(drag && drag.chave === r.chave && drag.moved) ? (
                          <>
                            <div
                              aria-hidden
                              className="pointer-events-none absolute bg-white"
                              style={estiloArea}
                              data-testid="papelaria-extra-tapa-conteudo"
                            />
                            <div
                              aria-hidden
                              data-testid="papelaria-extra-conteudo-otimista"
                              className="pointer-events-none absolute overflow-hidden whitespace-pre leading-none text-neutral-900"
                              style={{
                                ...estiloArea,
                                fontSize: `${Math.max(4, Math.min(72, otimista.tamanho_pt))}pt`,
                                fontFamily: fonteCssPreview(otimista.fonte ?? r.fonte),
                                textAlign:
                                  otimista.align_h === "centro"
                                    ? "center"
                                    : otimista.align_h === "direita"
                                      ? "right"
                                      : "left",
                              }}
                            >
                              {segmentosComNegrito(otimista.texto || " ", otimista.negrito).map(
                                (seg, si) => (
                                  <span
                                    key={si}
                                    style={{ fontWeight: seg.negrito ? 700 : 400 }}
                                  >
                                    {seg.texto}
                                  </span>
                                ),
                              )}
                            </div>
                          </>
                        ) : null;
                      if (!menuExtrasAtivo) {
                        return (
                          <div key={r.chave} className="contents">
                            {overlayOtimista}
                            <button {...botaoProps} />
                          </div>
                        );
                      }
                      return (
                        <div key={r.chave} className="contents">
                          {overlayOtimista}
                          <ContextMenu
                            onOpenChange={(open) => {
                              if (open) {
                                // Editor (z-200) cobre o menu (z-50); fecha antes de abrir.
                                setEditando(null);
                              }
                            }}
                          >
                          <ContextMenuTrigger asChild>
                            <button
                              {...botaoProps}
                              onContextMenu={() => setEditando(null)}
                            />
                          </ContextMenuTrigger>
                          <ContextMenuContent
                            className="z-[220] w-56"
                            data-testid="papelaria-previa-extras-menu"
                          >
                            <ContextMenuLabel>Adicionar texto</ContextMenuLabel>
                            {DIRECOES_EXTRA.map((d) => (
                              <ContextMenuItem
                                key={`t-${d.id}`}
                                data-testid={`papelaria-extra-texto-${d.id}`}
                                onSelect={() => {
                                  limparConteudoCriacao();
                                  aplicarEstiloDaAncora(r);
                                  setTextoDialog({
                                    ancora_chave: r.chave,
                                    direcao: d.id,
                                  });
                                }}
                              >
                                {d.label}
                              </ContextMenuItem>
                            ))}
                            <ContextMenuSeparator />
                            <ContextMenuLabel>Adicionar rede social</ContextMenuLabel>
                            {DIRECOES_EXTRA.map((d) => (
                              <ContextMenuItem
                                key={`r-${d.id}`}
                                data-testid={`papelaria-extra-rede-${d.id}`}
                                onSelect={() => {
                                  limparConteudoCriacao();
                                  aplicarEstiloDaAncora(r);
                                  setRedeChave(redesCatalogo[0]?.chave ?? "instagram");
                                  setRedeDialog({
                                    ancora_chave: r.chave,
                                    direcao: d.id,
                                  });
                                }}
                              >
                                {d.label}
                              </ContextMenuItem>
                            ))}
                            {isExtra && extraId && onRemoverCampoExtra ? (
                              <>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  data-testid="papelaria-extra-remover"
                                  onSelect={() => onRemoverCampoExtra(extraId)}
                                >
                                  Remover campo extra
                                </ContextMenuItem>
                              </>
                            ) : null}
                          </ContextMenuContent>
                        </ContextMenu>
                        </div>
                      );
                    })}
                    {regiaoEditada &&
                    !regiaoEditada.bloquear_edicao &&
                    regiaoEditada.pagina_saida === i &&
                    onEditarTexto &&
                    caixaEditada ? (
                      <PapelariaTextoEditor
                        key={regiaoEditada.chave}
                        regiao={regiaoEditada}
                        extraMeta={
                          (regiaoEditada.extra_id
                            ? extrasMeta?.[regiaoEditada.extra_id]
                            : undefined) ?? extrasMeta?.[regiaoEditada.chave]
                        }
                        ancora={() => {
                          const img = imgRefs.current[i];
                          if (!img) return null;
                          const r = img.getBoundingClientRect();
                          const x = r.left + img.clientLeft;
                          const y = r.top + img.clientTop;
                          const h = img.clientHeight || caixaEditada.height;
                          const w = img.clientWidth || caixaEditada.width;
                          const area =
                            drag && drag.chave === regiaoEditada.chave
                              ? drag.cur
                              : regiaoEditada.area;
                          return {
                            left: x + area[0] * w,
                            top: y + area[1] * h,
                            bottom: y + area[3] * h,
                          };
                        }}
                        onAplicar={(texto, meta) => {
                          const eid =
                            regiaoEditada.extra_id ??
                            (regiaoEditada.chave.startsWith("extra:")
                              ? regiaoEditada.chave.slice(6)
                              : null);
                          if (eid && regiaoEditada.tipo === "campo_extra" && meta) {
                            setConteudosOtimistas((prev) => ({
                              ...prev,
                              [eid]: {
                                texto,
                                tamanho_pt: meta.tamanho_pt ?? regiaoEditada.tamanho_pt ?? 11,
                                negrito: meta.negrito ?? [],
                                align_h: meta.align_h ?? "esquerda",
                                align_v: meta.align_v ?? "topo",
                                fonte: regiaoEditada.fonte,
                              },
                            }));
                          }
                          setEditando(null);
                          onEditarTexto(regiaoEditada, texto, meta);
                        }}
                        onRestaurar={
                          (regiaoEditada.editado ||
                            regiaoEditada.tipo === "rede" ||
                            regiaoEditada.tipo === "campo_extra" ||
                            regiaoEditada.tipo === "rede_extra") &&
                          onRestaurarTexto
                            ? () => {
                                setEditando(null);
                                onRestaurarTexto(regiaoEditada);
                              }
                            : undefined
                        }
                        onCancelar={() => setEditando(null)}
                      />
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        ) : query.isError ? null : (
          <span className="m-auto inline-flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Gerando prévia…
          </span>
        )}
        {query.isError && !paginas.length ? (
          <p className="m-auto flex max-w-sm items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            {(query.error as Error)?.message || "Não foi possível gerar a prévia."}
          </p>
        ) : null}
      </div>

      {query.isError && paginas.length ? (
        <p className="flex items-start gap-1.5 border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
          <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
          {(query.error as Error)?.message || "Não foi possível atualizar a prévia."} Mostrando a última versão.
        </p>
      ) : null}
      {(query.isError ? [] : (exibida?.avisos ?? [])).map((aviso, i) => (
        <p key={i} className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
          {aviso}
        </p>
      ))}

      {redeDialog ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Adicionar rede social"
          data-testid="papelaria-extra-rede-dialog"
          onClick={() => setRedeDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-sagra-border bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-neutral-800">Rede social extra</h3>
            <p className="mt-1 text-xs text-neutral-500">
              Escolha a rede, o perfil e a tipografia neste mesmo passo.
            </p>
            <PapelariaEstiloToolbar
              className="mt-3 border-b-0 pb-0"
              tamanhoPt={redeTamanhoPt}
              onTamanhoPt={setRedeTamanhoPt}
              align_h={redeAlignH}
              align_v={redeAlignV}
              onAlign={({ align_h, align_v }) => {
                setRedeAlignH(align_h);
                setRedeAlignV(align_v);
              }}
              mostrarMm
              xMm={redeXMm}
              yMm={redeYMm}
              onXMm={(v) => {
                setRedeTemPos(true);
                setRedeXMm(v);
              }}
              onYMm={(v) => {
                setRedeTemPos(true);
                setRedeYMm(v);
              }}
            />
            <label className="mt-3 block text-[11px] font-medium text-neutral-700">
              Rede
              <select
                className="mt-0.5 w-full rounded border border-sagra-border px-2 py-1.5 text-sm"
                value={redeChave}
                onChange={(e) => setRedeChave(e.target.value)}
              >
                {(redesCatalogo.length
                  ? redesCatalogo
                  : [
                      { chave: "instagram", nome: "Instagram" },
                      { chave: "facebook", nome: "Facebook" },
                      { chave: "x", nome: "X" },
                      { chave: "linkedin", nome: "LinkedIn" },
                      { chave: "youtube", nome: "YouTube" },
                      { chave: "tiktok", nome: "TikTok" },
                      { chave: "threads", nome: "Threads" },
                      { chave: "whatsapp", nome: "WhatsApp" },
                    ]
                ).map((r) => (
                  <option key={r.chave} value={r.chave}>
                    {r.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-2 block text-[11px] font-medium text-neutral-700">
              Perfil / handle
              <input
                className="mt-0.5 w-full rounded border border-sagra-border px-2 py-1.5 text-sm"
                value={redeValor}
                onChange={(e) => setRedeValor(e.target.value)}
                placeholder="@usuario"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmarRedeExtra();
                  if (e.key === "Escape") setRedeDialog(null);
                }}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-3 py-1.5 text-xs text-neutral-600 hover:bg-slate-100"
                onClick={() => setRedeDialog(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded bg-secondary-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                onClick={confirmarRedeExtra}
                disabled={!redeChave}
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {textoDialog ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Adicionar texto"
          data-testid="papelaria-extra-texto-dialog"
          onClick={() => setTextoDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-sagra-border bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-neutral-800">Texto extra</h3>
            <p className="mt-1 text-xs text-neutral-500">
              Digite o texto e configure tipografia/alinhamento neste mesmo passo.
            </p>
            <PapelariaEstiloToolbar
              className="mt-3 border-b-0 pb-0"
              tamanhoPt={textoTamanhoPt}
              onTamanhoPt={setTextoTamanhoPt}
              align_h={textoAlignH}
              align_v={textoAlignV}
              onAlign={({ align_h, align_v }) => {
                setTextoAlignH(align_h);
                setTextoAlignV(align_v);
              }}
              mostrarNegrito
              negritoAtivo={selecaoEstaEmNegrito(
                textoNegrito,
                textoSel.start,
                textoSel.end,
                textoNovo.length,
              )}
              onNegrito={aplicarNegritoCriacao}
              mostrarMm
              xMm={textoXMm}
              yMm={textoYMm}
              onXMm={(v) => {
                setTextoTemPos(true);
                setTextoXMm(v);
              }}
              onYMm={(v) => {
                setTextoTemPos(true);
                setTextoYMm(v);
              }}
            />
            <label className="mt-3 block text-[11px] font-medium text-neutral-700">
              Texto
              <textarea
                ref={textoCampoRef}
                className="mt-0.5 w-full rounded border border-sagra-border px-2 py-1.5 text-sm"
                rows={3}
                value={textoNovo}
                onChange={(e) => setTextoNovo(e.target.value)}
                onSelect={(e) =>
                  setTextoSel({
                    start: e.currentTarget.selectionStart,
                    end: e.currentTarget.selectionEnd,
                  })
                }
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    confirmarTextoExtra();
                  }
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
                    e.preventDefault();
                    aplicarNegritoCriacao();
                  }
                  if (e.key === "Escape") setTextoDialog(null);
                }}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-3 py-1.5 text-xs text-neutral-600 hover:bg-slate-100"
                onClick={() => setTextoDialog(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded bg-secondary-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                onClick={confirmarTextoExtra}
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
