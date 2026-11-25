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
  type CampoExtraDirecao,
  type CampoExtraTipo,
} from "@/features/papelaria/papelariaCamposExtras";

import { PapelariaTextoEditor } from "./PapelariaTextoEditor";

export type RedeCatalogoItem = { chave: string; nome: string };

export type AdicionarCampoExtraPayload = {
  tipo: CampoExtraTipo;
  ancora_chave: string;
  direcao: CampoExtraDirecao;
  rede_chave?: string;
  rede_valor?: string;
};

const DEBOUNCE_MS = 450;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

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

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
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
}: {
  modeloId: number;
  values: Record<string, string>;
  /** Frente e verso independentes: junta a frente e o verso escolhidos. */
  composicao?: PapelariaComposicao | null;
  className?: string;
  /** Texto digitado direto na prévia (com as regras do campo do PDF). */
  onEditarTexto?: (regiao: ProvaPdfRegiao, texto: string) => void;
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
}) {
  const chave = useMemo(() => chaveValores(values), [values]);
  const chaveDebounced = useDebounced(chave, DEBOUNCE_MS);
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
  useEffect(() => {
    setEditando(null);
    setRedeDialog(null);
  }, [modeloId]);

  const menuExtrasAtivo =
    permitirCamposExtras && Boolean(onAdicionarCampoExtra) && editavel;

  const confirmarRedeExtra = useCallback(() => {
    if (!redeDialog || !onAdicionarCampoExtra || !redeChave) return;
    onAdicionarCampoExtra({
      tipo: "rede",
      ancora_chave: redeDialog.ancora_chave,
      direcao: redeDialog.direcao,
      rede_chave: redeChave,
      rede_valor: redeValor.trim(),
    });
    setRedeDialog(null);
    setRedeChave("");
    setRedeValor("");
  }, [redeDialog, onAdicionarCampoExtra, redeChave, redeValor]);

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
                    {regioesPagina.map((r) => {
                      const [x0, y0, x1, y1] = r.area;
                      const bloqueada = Boolean(r.bloquear_edicao);
                      const ativa = !bloqueada && r.chave === editando;
                      const estiloArea = {
                        left: x0 * caixa.width,
                        top: y0 * caixa.height,
                        width: Math.max(8, (x1 - x0) * caixa.width),
                        height: Math.max(8, (y1 - y0) * caixa.height),
                      };
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
                          ? "Clique para editar · botão direito para campos extras"
                          : r.editado
                            ? "Texto editado — clique para alterar"
                            : "Clique para editar",
                        "data-testid": "papelaria-previa-regiao",
                        "data-editado": r.editado ? ("true" as const) : undefined,
                        className: cn(
                          "absolute cursor-text rounded-[2px] outline-1 outline-offset-1 transition-colors focus-visible:outline-2 focus-visible:outline-secondary-blue",
                          ativa
                            ? "bg-secondary-blue/10 outline outline-secondary-blue"
                            : r.editado
                              ? "outline-dashed outline-amber-400/80 hover:bg-amber-100/30"
                              : "outline-dashed outline-transparent hover:bg-secondary-blue/5 hover:outline-secondary-blue/70",
                        ),
                        style: estiloArea,
                        onClick: () => setEditando(r.chave),
                      };
                      if (!menuExtrasAtivo) {
                        return <button key={r.chave} {...botaoProps} />;
                      }
                      const isExtra =
                        r.tipo === "campo_extra" || r.tipo === "rede_extra";
                      const extraId = r.extra_id ?? (r.chave.startsWith("extra:") ? r.chave.slice(6) : null);
                      return (
                        <ContextMenu key={r.chave}>
                          <ContextMenuTrigger asChild>
                            <button {...botaoProps} />
                          </ContextMenuTrigger>
                          <ContextMenuContent
                            className="w-56"
                            data-testid="papelaria-previa-extras-menu"
                          >
                            <ContextMenuLabel>Adicionar texto</ContextMenuLabel>
                            {DIRECOES_EXTRA.map((d) => (
                              <ContextMenuItem
                                key={`t-${d.id}`}
                                data-testid={`papelaria-extra-texto-${d.id}`}
                                onSelect={() =>
                                  onAdicionarCampoExtra?.({
                                    tipo: "texto",
                                    ancora_chave: r.chave,
                                    direcao: d.id,
                                  })
                                }
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
                                  setRedeChave(redesCatalogo[0]?.chave ?? "");
                                  setRedeValor("");
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
                        ancora={() => {
                          // Campo na janela: caixa da imagem (sem a borda) × área da região.
                          const img = imgRefs.current[i];
                          if (!img) return null;
                          const r = img.getBoundingClientRect();
                          const x = r.left + img.clientLeft;
                          const y = r.top + img.clientTop;
                          const h = img.clientHeight || caixaEditada.height;
                          const w = img.clientWidth || caixaEditada.width;
                          return {
                            left: x + regiaoEditada.area[0] * w,
                            top: y + regiaoEditada.area[1] * h,
                            bottom: y + regiaoEditada.area[3] * h,
                          };
                        }}
                        onAplicar={(texto) => {
                          setEditando(null);
                          if (texto !== regiaoEditada.texto) onEditarTexto(regiaoEditada, texto);
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
              Escolha a rede e o perfil. A tipografia segue o campo âncora.
            </p>
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
    </article>
  );
}
