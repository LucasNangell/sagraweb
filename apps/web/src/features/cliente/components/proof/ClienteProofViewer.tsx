import { ExternalLink, FileDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@sagra/ui";

/** Ajuste do visualizador PDF embutido (Chrome/Edge PDFium). */
export type PdfViewerFit = "height" | "width" | "page-fit";

interface ClienteProofViewerProps {
  pdfUrl: string;
  osLabel: string;
  hasPdf: boolean;
  loading?: boolean;
  arquivoNome?: string;
  /** Ocupa altura disponível do container (páginas de aprovação). */
  fillHeight?: boolean;
  /** Retrato → altura; paisagem → largura. Só aplicado com fillHeight. */
  pdfFit?: PdfViewerFit;
}

async function loadPdfBlobUrl(pdfUrl: string): Promise<string> {
  const res = await fetch(pdfUrl, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Não foi possível carregar o PDF (${res.status}).`);
  }
  const blob = await res.blob();
  const pdfBlob =
    blob.type === "application/pdf"
      ? blob
      : new Blob([blob], { type: "application/pdf" });
  return URL.createObjectURL(pdfBlob);
}

/** URL do iframe — zoom nativo do visualizador PDF (Chrome/Edge). */
function pdfIframeSrc(blobUrl: string, fit: PdfViewerFit | null): string {
  if (!fit) {
    return blobUrl;
  }
  const zoom =
    fit === "height" ? "page-height" : fit === "width" ? "page-width" : "page-fit";
  return `${blobUrl}#page=1&zoom=${zoom}`;
}

export function ClienteProofViewer({
  pdfUrl,
  osLabel,
  hasPdf,
  loading,
  arquivoNome,
  fillHeight = false,
  pdfFit = "page-fit",
}: ClienteProofViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!hasPdf || !pdfUrl) {
      setBlobUrl(null);
      setFetchError(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    setFetching(true);
    setFetchError(null);
    setBlobUrl(null);

    void loadPdfBlobUrl(pdfUrl)
      .then((url) => {
        objectUrl = url;
        if (!cancelled) {
          setBlobUrl(url);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFetchError(
            err instanceof Error ? err.message : "Erro ao carregar PDF.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFetching(false);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [hasPdf, pdfUrl]);

  const showLoading = Boolean(loading) || fetching;

  if (showLoading) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl border border-sagra-border bg-white p-8",
          fillHeight ? "min-h-0 flex-1" : "min-h-[280px]",
        )}
      >
        <Loader2 className="size-8 animate-spin text-neutral-400" aria-hidden />
        <span className="sr-only">Carregando prova…</span>
      </div>
    );
  }

  if (!hasPdf) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900">
        Prova ainda não disponível. Aguarde o envio pela equipe gráfica ou atualize o painel.
      </div>
    );
  }

  if (fetchError || !blobUrl) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
        {fetchError ?? "Não foi possível exibir a prova."}
      </div>
    );
  }

  const downloadName = arquivoNome || "prova.pdf";
  const iframeFit = fillHeight ? pdfFit : null;

  return (
    <div
      className={cn(
        "overflow-hidden border-sagra-border bg-white shadow-sm",
        fillHeight
          ? "relative flex min-h-0 flex-1 flex-col rounded-2xl border"
          : "rounded-2xl border",
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-sagra-border/70 bg-slate-50 px-3 py-2">
        <p className="text-xs font-semibold text-neutral-600">
          Visualização da prova
          {arquivoNome ? (
            <span className="ml-1 font-normal text-neutral-500">— {arquivoNome}</span>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={blobUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-sagra-border bg-white px-3 py-1.5 text-xs font-medium text-secondary-blue hover:bg-slate-50"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            Abrir PDF em nova aba
          </a>
          <a
            href={blobUrl}
            download={downloadName}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-sagra-border bg-white px-3 py-1.5 text-xs font-medium text-secondary-blue hover:bg-slate-50"
          >
            <FileDown className="size-3.5" aria-hidden />
            Baixar PDF
          </a>
        </div>
      </div>
      {fillHeight ? (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <iframe
            title={`Prova ${osLabel}`}
            src={pdfIframeSrc(blobUrl, iframeFit)}
            className="absolute inset-0 h-full w-full border-0 bg-white"
          />
        </div>
      ) : (
        <iframe
          title={`Prova ${osLabel}`}
          src={pdfIframeSrc(blobUrl, null)}
          className="h-[min(70vh,640px)] w-full border-0 bg-white"
        />
      )}
    </div>
  );
}
