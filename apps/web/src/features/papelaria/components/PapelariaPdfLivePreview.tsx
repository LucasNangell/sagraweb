import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { previaPdfAoVivo, type ProvaPdfPrevia } from "@/api/papelariaProvaPdf";

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
  className,
}: {
  modeloId: number;
  values: Record<string, string>;
  className?: string;
}) {
  const chave = useMemo(() => chaveValores(values), [values]);
  const chaveDebounced = useDebounced(chave, DEBOUNCE_MS);
  const [pagina, setPagina] = useState(0);

  const query = useQuery({
    queryKey: ["papelaria", "previa-pdf", modeloId, chaveDebounced],
    queryFn: ({ signal }) =>
      previaPdfAoVivo(modeloId, JSON.parse(chaveDebounced) as Record<string, string>, signal),
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
            Gerada a partir do PDF do modelo — igual à prova final.
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
            src={paginas[atual]}
            alt={`Prévia da página ${atual + 1}`}
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
