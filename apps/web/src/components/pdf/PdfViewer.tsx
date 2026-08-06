import { cn } from "@sagra/ui";
import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string;
  className?: string;
}

export function PdfViewer({ url, className }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageInfo, setPageInfo] = useState("1 / 1");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const task = pdfjs.getDocument({ url, withCredentials: true });
        const pdf = await task.promise;
        if (cancelled) {
          return;
        }
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = canvasRef.current;
        if (!canvas) {
          return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return;
        }
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: ctx, viewport }).promise;
        setPageInfo(`1 / ${pdf.numPages}`);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar PDF");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className={cn("rounded-lg border border-sagra-border bg-white p-4", className)}>
      <div className="mb-2 flex items-center justify-between text-sm text-neutral-600">
        <span>Visualização do relatório</span>
        <span>{pageInfo}</span>
      </div>
      {loading && (
        <p className="py-12 text-center text-neutral-500">Carregando PDF…</p>
      )}
      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
      <canvas
        ref={canvasRef}
        className={cn("mx-auto max-w-full", (loading || error) && "hidden")}
      />
    </div>
  );
}
