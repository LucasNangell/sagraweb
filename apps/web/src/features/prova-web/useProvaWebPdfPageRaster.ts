import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useState } from "react";

import { provaWebSourcePdfUrl, type CropSidesMm } from "@/api/provaWeb";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type ProvaWebPdfPageRaster = {
  /** Data URL da área útil (após crop). */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
};

/**
 * Rasteriza uma página do PDF da OS, recortada à área útil (crop em mm).
 * Usado pela prévia didática de vincos — independente do CropPanel.
 */
export async function renderProvaWebUsablePage(args: {
  ano: number;
  osId: number;
  relativePath: string;
  pageIndex: number;
  crop: CropSidesMm;
  pageWidthMm: number;
  pageHeightMm: number;
  maxEdgePx?: number;
}): Promise<ProvaWebPdfPageRaster> {
  const {
    ano,
    osId,
    relativePath,
    pageIndex,
    crop,
    pageWidthMm,
    pageHeightMm,
    maxEdgePx = 900,
  } = args;

  const url = provaWebSourcePdfUrl(ano, osId, relativePath);
  const pdf = await pdfjs.getDocument({ url, withCredentials: true }).promise;
  const safe = Math.min(Math.max(0, pageIndex), pdf.numPages - 1);
  const page = await pdf.getPage(safe + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxEdgePx / base.width, maxEdgePx / base.height, 2);
  const viewport = page.getViewport({ scale });

  const full = document.createElement("canvas");
  full.width = Math.max(1, Math.floor(viewport.width));
  full.height = Math.max(1, Math.floor(viewport.height));
  const fullCtx = full.getContext("2d");
  if (!fullCtx) throw new Error("Canvas 2D indisponível.");
  await page.render({ canvasContext: fullCtx, viewport, canvas: full }).promise;

  const sx = full.width / Math.max(1e-6, pageWidthMm);
  const sy = full.height / Math.max(1e-6, pageHeightMm);
  const x0 = Math.max(0, Math.floor(crop.left * sx));
  const y0 = Math.max(0, Math.floor(crop.top * sy));
  const x1 = Math.min(full.width, Math.ceil(full.width - crop.right * sx));
  const y1 = Math.min(full.height, Math.ceil(full.height - crop.bottom * sy));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);

  const cropped = document.createElement("canvas");
  cropped.width = w;
  cropped.height = h;
  const ctx = cropped.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível.");
  ctx.drawImage(full, x0, y0, w, h, 0, 0, w, h);

  return {
    dataUrl: cropped.toDataURL("image/jpeg", 0.85),
    widthPx: w,
    heightPx: h,
  };
}

export function useProvaWebPdfPageRaster(args: {
  ano: number;
  osId: number;
  relativePath: string;
  pageIndex: number | null;
  crop: CropSidesMm;
  pageWidthMm: number;
  pageHeightMm: number;
  enabled?: boolean;
}): {
  raster: ProvaWebPdfPageRaster | null;
  loading: boolean;
  error: string | null;
} {
  const {
    ano,
    osId,
    relativePath,
    pageIndex,
    crop,
    pageWidthMm,
    pageHeightMm,
    enabled = true,
  } = args;

  const [raster, setRaster] = useState<ProvaWebPdfPageRaster | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cropKey = `${crop.top},${crop.right},${crop.bottom},${crop.left}`;

  useEffect(() => {
    if (!enabled || pageIndex == null || pageWidthMm <= 0 || pageHeightMm <= 0) {
      setRaster(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void renderProvaWebUsablePage({
      ano,
      osId,
      relativePath,
      pageIndex,
      crop,
      pageWidthMm,
      pageHeightMm,
    })
      .then((r) => {
        if (cancelled) return;
        setRaster(r);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRaster(null);
        setError(err instanceof Error ? err.message : "Falha ao rasterizar PDF.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    ano,
    osId,
    relativePath,
    pageIndex,
    cropKey,
    pageWidthMm,
    pageHeightMm,
    enabled,
    crop.top,
    crop.right,
    crop.bottom,
    crop.left,
  ]);

  return { raster, loading, error };
}
