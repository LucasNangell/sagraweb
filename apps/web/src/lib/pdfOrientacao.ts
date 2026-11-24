import { useQuery } from "@tanstack/react-query";

export type PdfOrientacao = "retrato" | "paisagem";

/** Retrato quando a página é mais alta que larga (quadrada conta como retrato). */
export function orientacaoPorTamanho(largura: number, altura: number): PdfOrientacao | null {
  if (!(largura > 0) || !(altura > 0)) return null;
  return altura >= largura ? "retrato" : "paisagem";
}

/**
 * Orientação da página 1 do PDF (já com a rotação da página), lida com o
 * pdf.js — carregado só quando necessário.
 */
export async function lerOrientacaoPdf(url: string): Promise<PdfOrientacao | null> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const tarefa = pdfjs.getDocument({ url, withCredentials: true });
  try {
    const doc = await tarefa.promise;
    const pagina = await doc.getPage(1);
    const { width, height } = pagina.getViewport({ scale: 1 });
    return orientacaoPorTamanho(width, height);
  } finally {
    void tarefa.destroy();
  }
}

/** URL sem o fragmento (`#view=…`): o mesmo PDF tem uma leitura só. */
function semFragmento(url: string): string {
  return url.split("#", 1)[0] ?? url;
}

/**
 * Orientação do PDF para escolher o ajuste do visualizador. `pronta` fica
 * true quando a leitura terminou (com ou sem sucesso) — antes disso o
 * visualizador pode esperar para não abrir com o ajuste errado.
 */
export function usePdfOrientacao(url: string | null | undefined): {
  orientacao: PdfOrientacao | null;
  pronta: boolean;
} {
  const alvo = url ? semFragmento(url) : "";
  const query = useQuery({
    queryKey: ["pdf-orientacao", alvo],
    queryFn: () => lerOrientacaoPdf(alvo),
    enabled: Boolean(alvo),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
  return {
    orientacao: query.data ?? null,
    pronta: !alvo || !query.isPending,
  };
}
