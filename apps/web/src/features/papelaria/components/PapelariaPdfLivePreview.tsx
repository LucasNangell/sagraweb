import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { AlertTriangle, Loader2, Pencil } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { previaPdfAoVivo, type ProvaPdfPrevia, type ProvaPdfRegiao } from "@/api/papelariaProvaPdf";
import type { PapelariaComposicao } from "@/features/papelaria/types";

import { PapelariaTextoEditor } from "./PapelariaTextoEditor";

const DEBOUNCE_MS = 450;

type Caixa = { left: number; top: number; width: number; height: number };

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
  useEffect(() => {
    setEditando(null);
  }, [modeloId]);

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
  }, [medir, temImagem, paginas.length]);

  const caixaVazia: Caixa = { left: 0, top: 0, width: 0, height: 0 };
  const caixaEditada =
    regiaoEditada != null
      ? (caixas[regiaoEditada.pagina_saida] ?? caixaVazia)
      : null;

  return (
    <article
      className={cn(
        "flex min-h-[min(45vh,400px)] flex-1 flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-sm sm:min-h-[280px]",
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
                Clique num texto da prévia para editá-lo.
              </span>
            ) : (
              "Gerada a partir do PDF do modelo — igual à prova final."
            )}
          </p>
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
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-auto bg-slate-50 p-3">
        {paginas.length ? (
          <div
            className={cn(
              "flex w-full max-w-full items-start gap-4",
              layout === "row"
                ? "flex-row flex-wrap justify-center"
                : "flex-col items-center",
            )}
            data-layout={layout}
          >
            {paginas.map((src, i) => {
              const titulo = tituloPagina(i);
              const regioesPagina = todasRegioes.filter((r) => r.pagina_saida === i);
              const caixa = caixas[i] ?? { left: 0, top: 0, width: 0, height: 0 };
              return (
                <section
                  key={i}
                  className={cn(
                    "relative flex flex-col items-center gap-1",
                    layout === "row" ? "min-w-0 flex-1 basis-[min(100%,280px)]" : "w-full max-w-full",
                  )}
                  data-testid={`papelaria-previa-pagina-${i}`}
                >
                  <h4 className="w-full text-center text-[11px] font-semibold text-slate-600">
                    {titulo}
                  </h4>
                  <div className="relative inline-block max-w-full">
                    <img
                      ref={(el) => {
                        imgRefs.current[i] = el;
                      }}
                      src={src}
                      alt={`Prévia da página ${i + 1}`}
                      onLoad={medir}
                      className={cn(
                        "max-w-full rounded border border-slate-200 bg-white object-contain shadow-sm transition-opacity",
                        layout === "row"
                          ? "max-h-[min(50vh,440px)] w-full"
                          : "max-h-[min(55vh,520px)]",
                        atualizando && "opacity-80",
                      )}
                    />
                    {regioesPagina.map((r) => {
                      const [x0, y0, x1, y1] = r.area;
                      const ativa = r.chave === editando;
                      return (
                        <button
                          key={r.chave}
                          type="button"
                          aria-label={`Editar texto: ${r.texto || r.marcador}`}
                          title={r.editado ? "Texto editado — clique para alterar" : "Clique para editar"}
                          data-testid="papelaria-previa-regiao"
                          data-editado={r.editado ? "true" : undefined}
                          className={cn(
                            "absolute cursor-text rounded-[2px] outline-1 outline-offset-1 transition-colors focus-visible:outline-2 focus-visible:outline-secondary-blue",
                            ativa
                              ? "bg-secondary-blue/10 outline outline-secondary-blue"
                              : r.editado
                                ? "outline-dashed outline-amber-400/80 hover:bg-amber-100/30"
                                : "outline-dashed outline-transparent hover:bg-secondary-blue/5 hover:outline-secondary-blue/70",
                          )}
                          style={{
                            left: x0 * caixa.width,
                            top: y0 * caixa.height,
                            width: Math.max(8, (x1 - x0) * caixa.width),
                            height: Math.max(8, (y1 - y0) * caixa.height),
                          }}
                          onClick={() => setEditando(r.chave)}
                        />
                      );
                    })}
                    {regiaoEditada && regiaoEditada.pagina_saida === i && onEditarTexto && caixaEditada ? (
                      <PapelariaTextoEditor
                        key={regiaoEditada.chave}
                        regiao={regiaoEditada}
                        posicao={{
                          left: regiaoEditada.area[0] * caixaEditada.width,
                          top: regiaoEditada.area[1] * caixaEditada.height,
                          bottom: regiaoEditada.area[3] * caixaEditada.height,
                        }}
                        onAplicar={(texto) => {
                          setEditando(null);
                          if (texto !== regiaoEditada.texto) onEditarTexto(regiaoEditada, texto);
                        }}
                        onRestaurar={
                          (regiaoEditada.editado || regiaoEditada.tipo === "rede") &&
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
          <span className="inline-flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Gerando prévia…
          </span>
        )}
        {query.isError && !paginas.length ? (
          <p className="flex max-w-sm items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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
    </article>
  );
}
