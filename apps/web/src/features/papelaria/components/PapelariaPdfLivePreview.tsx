import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { AlertTriangle, Loader2, Pencil } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { previaPdfAoVivo, type ProvaPdfPrevia, type ProvaPdfRegiao } from "@/api/papelariaProvaPdf";
import type { PapelariaComposicao } from "@/features/papelaria/types";

import { PapelariaTextoEditor } from "./PapelariaTextoEditor";

const DEBOUNCE_MS = 450;

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

/**
 * Prévia ao vivo a partir do PDF do modelo: o servidor aplica os valores do
 * formulário com a mesma renderização da prova final (fonte, cor, negrito,
 * linhas que somem quando vazias). Substitui a prévia por imagem + posições.
 */
export function PapelariaPdfLivePreview({
  modeloId,
  values,
  composicao = null,
  className,
  onEditarTexto,
  onRestaurarTexto,
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
}) {
  const chave = useMemo(() => chaveValores(values), [values]);
  const chaveDebounced = useDebounced(chave, DEBOUNCE_MS);
  const [pagina, setPagina] = useState(0);
  const chaveComposicao = composicao
    ? `${composicao.frente.modelo_id}:${composicao.frente.pagina}|${composicao.verso.modelo_id}:${composicao.verso.pagina}`
    : "";

  const query = useQuery({
    queryKey: ["papelaria", "previa-pdf", modeloId, chaveComposicao, chaveDebounced],
    queryFn: ({ signal }) =>
      previaPdfAoVivo(
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
    setPagina(0);
  }, [modeloId]);
  const exibida = query.data ?? ultima;

  const paginas = exibida?.paginas ?? [];
  const atual = Math.min(pagina, Math.max(0, paginas.length - 1));
  const atualizando = query.isFetching || chave !== chaveDebounced;

  const editavel = Boolean(onEditarTexto);
  const regioes = useMemo(
    () => (editavel ? (exibida?.regioes ?? []).filter((r) => r.pagina_saida === atual) : []),
    [editavel, exibida?.regioes, atual],
  );
  const [editando, setEditando] = useState<string | null>(null);
  const regiaoEditada = regioes.find((r) => r.chave === editando) ?? null;
  useEffect(() => {
    setEditando(null);
  }, [modeloId, atual]);

  // Caixa da imagem dentro da área rolável: as regiões são frações da página.
  const imgRef = useRef<HTMLImageElement>(null);
  const [caixa, setCaixa] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const medir = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setCaixa({
      left: img.offsetLeft + img.clientLeft,
      top: img.offsetTop + img.clientTop,
      width: img.clientWidth,
      height: img.clientHeight,
    });
  }, []);
  const temImagem = paginas.length > 0;
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(img);
    if (img.parentElement) ro.observe(img.parentElement);
    return () => ro.disconnect();
  }, [medir, temImagem]);

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
            {regioes.length ? (
              <span className="inline-flex items-center gap-1">
                <Pencil className="size-2.5" aria-hidden />
                Clique num texto da prévia para editá-lo.
              </span>
            ) : (
              "Gerada a partir do PDF do modelo — igual à prova final."
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {paginas.length > 1 ? (
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="Página">
              {paginas.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === atual}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] font-semibold",
                    i === atual ? "bg-white text-secondary-blue shadow-sm" : "text-slate-500 hover:text-slate-800",
                  )}
                  onClick={() => setPagina(i)}
                >
                  {i === 0 ? "Frente" : i === 1 ? "Verso" : `Pág. ${i + 1}`}
                </button>
              ))}
            </div>
          ) : null}
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

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-50 p-3">
        {paginas.length ? (
          <img
            ref={imgRef}
            src={paginas[atual]}
            alt={`Prévia da página ${atual + 1}`}
            onLoad={medir}
            className={cn(
              "max-h-full max-w-full rounded border border-slate-200 bg-white object-contain shadow-sm transition-opacity",
              atualizando && "opacity-80",
            )}
          />
        ) : query.isError ? null : (
          <span className="inline-flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Gerando prévia…
          </span>
        )}
        {temImagem
          ? regioes.map((r) => {
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
                    left: caixa.left + x0 * caixa.width,
                    top: caixa.top + y0 * caixa.height,
                    width: Math.max(8, (x1 - x0) * caixa.width),
                    height: Math.max(8, (y1 - y0) * caixa.height),
                  }}
                  onClick={() => setEditando(r.chave)}
                />
              );
            })
          : null}
        {temImagem && regiaoEditada && onEditarTexto ? (
          <PapelariaTextoEditor
            key={regiaoEditada.chave}
            regiao={regiaoEditada}
            posicao={{
              left: caixa.left + regiaoEditada.area[0] * caixa.width,
              top: caixa.top + regiaoEditada.area[1] * caixa.height,
              bottom: caixa.top + regiaoEditada.area[3] * caixa.height,
            }}
            onAplicar={(texto) => {
              setEditando(null);
              if (texto !== regiaoEditada.texto) onEditarTexto(regiaoEditada, texto);
            }}
            onRestaurar={
              regiaoEditada.editado && onRestaurarTexto
                ? () => {
                    setEditando(null);
                    onRestaurarTexto(regiaoEditada);
                  }
                : undefined
            }
            onCancelar={() => setEditando(null)}
          />
        ) : null}
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
