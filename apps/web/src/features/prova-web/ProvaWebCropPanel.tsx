import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Loader2, ScanSearch } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  emptyCropSides,
  provaWebSourcePdfUrl,
  type CropSidesMm,
  type FoldEixo,
} from "@/api/provaWeb";
import { FOLD_LINE_COLORS } from "./provaWebFoldPresets";
import {
  centeredCropMm,
  formatOsLabel,
  remainsMatchTarget,
  resolveSeedCrop,
} from "./provaWebCenteredCrop";
import type { SpiralHoleGuide } from "./spiralBinding";
import type { ProvaWebCropSource } from "./provaWebCropSource";
import { useProvaWebCropMeta } from "./useProvaWebCropMeta";

/** Guia de vinco no preview de crop (posição na área útil). */
export type FoldLineGuide = {
  id: string;
  eixo: FoldEixo;
  posicaoMm: number;
  ordem?: number;
};

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const MIN_REMAIN_MM = 5;

export interface CoverCropGuides {
  lombadaMm: number;
  orelhaEsquerdaMm: number;
  orelhaDireitaMm: number;
}

export interface ProvaWebCropPanelProps {
  ano: number;
  osId: number;
  /** Caminho relativo do PDF na pasta da OS. */
  relativePath: string;
  title?: string;
  crop: CropSidesMm;
  onChange: (crop: CropSidesMm) => void;
  /** Página 0-based só para conferência visual. */
  pageIndex?: number;
  onPageIndexChange?: (index: number) => void;
  showPageSelector?: boolean;
  /** Guias de lombada/orelhas (capa aberta). */
  coverGuides?: CoverCropGuides;
  /** Linhas de dobra na área útil (folheto). */
  foldLines?: FoldLineGuide[];
  onFoldPosicaoChange?: (id: string, posicaoMm: number) => void;
  /** Preview de furos de espiral (modo espiral). */
  spiralGuides?: SpiralHoleGuide | null;
  /** Se false, não aplica TrimBox sugerido automaticamente. */
  autoSeedCrop?: boolean;
  /** Formato da OS (largura × altura mm da face / página). */
  formatoLabel?: string | null;
  formatoLarguraMm?: number | null;
  formatoAlturaMm?: number | null;
  /**
   * Sobrescreve o alvo do center-fill (ex.: spread com lombada+orelhas).
   * Se omitido, usa formatoLarguraMm × formatoAlturaMm.
   */
  seedTargetWidthMm?: number | null;
  seedTargetHeightMm?: number | null;
  /** Fonte alternativa de PDF/meta (ex.: Análise Lab). */
  cropSource?: ProvaWebCropSource;
}

export function ProvaWebCropPanel({
  ano,
  osId,
  relativePath,
  title = "Crop (mm)",
  crop,
  onChange,
  pageIndex = 0,
  onPageIndexChange,
  showPageSelector = true,
  coverGuides,
  foldLines,
  onFoldPosicaoChange,
  spiralGuides = null,
  autoSeedCrop = true,
  formatoLabel,
  formatoLarguraMm = null,
  formatoAlturaMm = null,
  seedTargetWidthMm = null,
  seedTargetHeightMm = null,
  cropSource,
}: ProvaWebCropPanelProps) {
  const [detectMarks, setDetectMarks] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const seededRef = useRef<string | null>(null);

  const metaQuery = useProvaWebCropMeta(ano, osId, relativePath, {
    detectMarks,
    cropSource,
  });

  useEffect(() => {
    seededRef.current = null;
    setDetectMarks(false);
  }, [relativePath]);

  useEffect(() => {
    const data = metaQuery.data;
    if (!autoSeedCrop || !data || seededRef.current === relativePath) {
      return;
    }
    seededRef.current = relativePath;
    const mediaW = data.widthMm ?? data.pages[0]?.widthMm ?? 0;
    const mediaH = data.heightMm ?? data.pages[0]?.heightMm ?? 0;
    const targetW = seedTargetWidthMm ?? formatoLarguraMm;
    const targetH = seedTargetHeightMm ?? formatoAlturaMm;
    onChange(
      resolveSeedCrop({
        suggested: data.suggestedCrop,
        suggestionSource: data.suggestionSource,
        mediaW,
        mediaH,
        targetW,
        targetH,
      }),
    );
  }, [
    autoSeedCrop,
    metaQuery.data,
    relativePath,
    onChange,
    formatoLarguraMm,
    formatoAlturaMm,
    seedTargetWidthMm,
    seedTargetHeightMm,
  ]);

  useEffect(() => {
    if (!detectMarks || !metaQuery.isSuccess || !metaQuery.data) {
      return;
    }
    const hint = metaQuery.data.cropMarksHint;
    if (hint) {
      onChange({ ...hint, source: "marcas" });
    }
    setDetecting(false);
  }, [detectMarks, metaQuery.isSuccess, metaQuery.data, onChange]);

  const pageMeta =
    metaQuery.data?.pages.find((p) => p.pageIndex === pageIndex) ??
    metaQuery.data?.pages[0];
  const widthMm = pageMeta?.widthMm ?? metaQuery.data?.widthMm ?? 0;
  const heightMm = pageMeta?.heightMm ?? metaQuery.data?.heightMm ?? 0;
  const pageCount = metaQuery.data?.pageCount ?? 1;

  const remainW = Math.max(0, widthMm - crop.left - crop.right);
  const remainH = Math.max(0, heightMm - crop.top - crop.bottom);
  const invalid = remainW < MIN_REMAIN_MM || remainH < MIN_REMAIN_MM;

  const setSide = (side: keyof CropSidesMm, value: number) => {
    if (side === "source") return;
    const next = Math.max(0, Math.round(value * 10) / 10);
    onChange({ ...crop, [side]: next, source: "manual" });
  };

  const equalizeSides = () => {
    const avg =
      Math.round(((crop.left + crop.right) / 2) * 10) / 10;
    onChange({
      ...crop,
      left: avg,
      right: avg,
      source: "manual",
    });
  };

  const equalizeAll = () => {
    const avg =
      Math.round(
        ((crop.top + crop.right + crop.bottom + crop.left) / 4) * 10,
      ) / 10;
    onChange({
      top: avg,
      right: avg,
      bottom: avg,
      left: avg,
      source: "manual",
    });
  };

  const handleDetectMarks = () => {
    setDetecting(true);
    setDetectMarks(true);
    void metaQuery.refetch();
  };

  const targetW = seedTargetWidthMm ?? formatoLarguraMm;
  const targetH = seedTargetHeightMm ?? formatoAlturaMm;
  const centeredPreview =
    widthMm > 0 && heightMm > 0 && targetW && targetH
      ? centeredCropMm(widthMm, heightMm, targetW, targetH, "formato")
      : null;
  const canCenterOnFormat = Boolean(centeredPreview);

  const centerOnFormat = () => {
    if (!centeredPreview) return;
    onChange(centeredPreview);
  };

  const sourceLabel =
    crop.source === "trimbox"
      ? "TrimBox"
      : crop.source === "bleedbox"
        ? "BleedBox"
        : crop.source === "marcas"
          ? "Marcas de corte"
          : crop.source === "formato"
            ? "Formato OS (centralizado)"
            : "Manual";

  const matchOs = remainsMatchTarget(remainW, remainH, targetW, targetH);
  const osFormatText = formatOsLabel(
    formatoLabel,
    formatoLarguraMm,
    formatoAlturaMm,
  );
  const centerTargetLabel =
    targetW && targetH
      ? seedTargetWidthMm != null && seedTargetHeightMm != null
        ? `Alvo capa aberta ${targetW.toFixed(0)}×${targetH.toFixed(0)} mm`
        : `Formato ${targetW.toFixed(0)}×${targetH.toFixed(0)} mm`
      : "Informe o formato da OS";
  const centerDisabledTitle = !targetW || !targetH
    ? "Formato da OS indisponível"
    : !widthMm || !heightMm
      ? "Aguardando metadados do PDF"
      : !canCenterOnFormat
        ? "O formato não cabe no MediaBox deste PDF"
        : centerTargetLabel;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-xl border border-sagra-border bg-slate-100 p-3">
        <PdfCropPreview
          ano={ano}
          osId={osId}
          relativePath={relativePath}
          pageIndex={pageIndex}
          crop={crop}
          widthMm={widthMm}
          heightMm={heightMm}
          coverGuides={coverGuides}
          foldLines={foldLines}
          onFoldPosicaoChange={onFoldPosicaoChange}
          spiralGuides={spiralGuides}
          cropSource={cropSource}
        />
        {coverGuides && (
          <div className="mt-2 flex flex-wrap justify-center gap-3 text-[10px] text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-sm bg-primary-green" />{" "}
              Crop
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-sm bg-amber-400" />{" "}
              Lombada
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-sm bg-sky-400" />{" "}
              Orelha
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-sm bg-white ring-1 ring-neutral-400" />{" "}
              Face
            </span>
          </div>
        )}
        {spiralGuides && (
          <div className="mt-2 flex flex-wrap justify-center gap-3 text-[10px] text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-slate-600 ring-1 ring-slate-300" />{" "}
              Furos espiral ({spiralGuides.holeCount}) ·{" "}
              {spiralGuides.edge === "left" ? "borda esquerda" : "borda superior"}
            </span>
          </div>
        )}
        {foldLines && foldLines.length > 0 && (
          <div className="mt-2 flex flex-wrap justify-center gap-3 text-[10px] text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-sm bg-primary-green" />{" "}
              Crop
            </span>
            {foldLines.map((d, i) => (
              <span key={d.id} className="inline-flex items-center gap-1">
                <span
                  className="inline-block size-2 rounded-sm"
                  style={{ background: FOLD_LINE_COLORS[i % FOLD_LINE_COLORS.length] }}
                />{" "}
                Dobra {d.ordem ?? i + 1} ({d.eixo === "vertical" ? "V" : "H"})
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            O crop vale para todas as páginas na geração. Ajuste em milímetros
            (passo 0,1).
          </p>
        </div>

        {metaQuery.isLoading && (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Lendo TrimBox / BleedBox…
          </div>
        )}

        {metaQuery.isError && (
          <p className="text-xs text-sagra-danger">
            {metaQuery.error instanceof Error
              ? metaQuery.error.message
              : "Falha ao ler metadados do PDF."}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["top", "Superior"],
              ["right", "Direita"],
              ["bottom", "Inferior"],
              ["left", "Esquerda"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-neutral-600">{label}</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={crop[key]}
                onChange={(e) => setSide(key, Number(e.target.value) || 0)}
                className="rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-sm tabular-nums text-neutral-800"
              />
            </label>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={centerOnFormat}
            disabled={!canCenterOnFormat}
            title={centerDisabledTitle}
            className="rounded-lg border border-primary-green/40 bg-primary-green/10 px-2.5 py-1.5 text-xs font-medium text-primary-green hover:bg-primary-green/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Centralizar no formato
          </button>
          <button
            type="button"
            onClick={equalizeSides}
            className="rounded-lg border border-sagra-border bg-white px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
          >
            Igualar laterais
          </button>
          <button
            type="button"
            onClick={equalizeAll}
            className="rounded-lg border border-sagra-border bg-white px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
          >
            Igualar todas
          </button>
          <button
            type="button"
            onClick={handleDetectMarks}
            disabled={detecting || metaQuery.isFetching}
            className="inline-flex items-center gap-1 rounded-lg border border-sagra-border bg-white px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            {detecting || (detectMarks && metaQuery.isFetching) ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <ScanSearch className="size-3" aria-hidden />
            )}
            Detectar marcas
          </button>
          <button
            type="button"
            onClick={() => onChange(emptyCropSides("manual"))}
            className="rounded-lg border border-sagra-border bg-white px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
          >
            Zerar
          </button>
        </div>
        {targetW && targetH ? (
          <p className="text-[11px] text-neutral-500">{centerTargetLabel}</p>
        ) : null}

        <dl className="space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-neutral-600">
          <div className="flex justify-between gap-2">
            <dt>Formato OS</dt>
            <dd className="text-right">{osFormatText}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>MediaBox</dt>
            <dd className="tabular-nums">
              {widthMm ? `${widthMm.toFixed(1)} × ${heightMm.toFixed(1)} mm` : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Após crop (formato final)</dt>
            <dd
              className={`tabular-nums ${
                invalid
                  ? "text-sagra-danger"
                  : matchOs === true
                    ? "text-green-700"
                    : matchOs === false
                      ? "text-amber-700"
                      : ""
              }`}
            >
              {widthMm
                ? `${remainW.toFixed(1)} × ${remainH.toFixed(1)} mm`
                : "—"}
              {matchOs === true ? " · ok" : matchOs === false ? " · ≠ OS" : ""}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Sugestão</dt>
            <dd>{sourceLabel}</dd>
          </div>
        </dl>

        {invalid && (
          <p className="text-xs text-sagra-danger">
            Crop excessivo: a área útil precisa ter pelo menos {MIN_REMAIN_MM} mm
            em cada dimensão.
          </p>
        )}

        {showPageSelector && pageCount > 1 && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-neutral-600">
              Página de conferência
            </span>
            <select
              value={pageIndex}
              onChange={(e) =>
                onPageIndexChange?.(Number(e.target.value) || 0)
              }
              className="rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-sm"
            >
              {Array.from({ length: Math.min(pageCount, 40) }, (_, i) => (
                <option key={i} value={i}>
                  Página {i + 1}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

function PdfCropPreview({
  ano,
  osId,
  relativePath,
  pageIndex,
  crop,
  widthMm,
  heightMm,
  coverGuides,
  foldLines,
  onFoldPosicaoChange,
  spiralGuides,
  cropSource,
}: {
  ano: number;
  osId: number;
  relativePath: string;
  pageIndex: number;
  crop: CropSidesMm;
  widthMm: number;
  heightMm: number;
  coverGuides?: CoverCropGuides;
  foldLines?: FoldLineGuide[];
  onFoldPosicaoChange?: (id: string, posicaoMm: number) => void;
  spiralGuides?: SpiralHoleGuide | null;
  cropSource?: ProvaWebCropSource;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = cropSource
      ? cropSource.pdfUrl(relativePath)
      : provaWebSourcePdfUrl(ano, osId, relativePath);
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const pdf = await pdfjs.getDocument({
          url,
          withCredentials: true,
        }).promise;
        if (cancelled) return;
        const safe = Math.min(Math.max(0, pageIndex), pdf.numPages - 1);
        const page = await pdf.getPage(safe + 1);
        const base = page.getViewport({ scale: 1 });
        const maxW = 720;
        const maxH = 520;
        const scale = Math.min(maxW / base.width, maxH / base.height, 1.6);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas não suportado.");
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (cancelled) return;
        setSize({ w: viewport.width, h: viewport.height });
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar PDF.");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ano, osId, relativePath, pageIndex, cropSource]);

  const insetStyle =
    widthMm > 0 && heightMm > 0 && size.w > 0
      ? {
          top: `${(crop.top / heightMm) * 100}%`,
          right: `${(crop.right / widthMm) * 100}%`,
          bottom: `${(crop.bottom / heightMm) * 100}%`,
          left: `${(crop.left / widthMm) * 100}%`,
        }
      : { top: "0%", right: "0%", bottom: "0%", left: "0%" };

  const usableW = Math.max(0, widthMm - crop.left - crop.right);
  const midPct =
    widthMm > 0 ? ((crop.left + usableW / 2) / widthMm) * 100 : 50;
  const lombadaHalfPct =
    widthMm > 0 && coverGuides
      ? ((coverGuides.lombadaMm / 2) / widthMm) * 100
      : 0;
  const earLPct =
    widthMm > 0 && coverGuides
      ? (coverGuides.orelhaEsquerdaMm / widthMm) * 100
      : 0;
  const earRPct =
    widthMm > 0 && coverGuides
      ? (coverGuides.orelhaDireitaMm / widthMm) * 100
      : 0;
  const cropLeftPct = widthMm > 0 ? (crop.left / widthMm) * 100 : 0;
  const cropRightPct = widthMm > 0 ? (crop.right / widthMm) * 100 : 0;

  const dragFold = (
    event: React.PointerEvent<HTMLDivElement>,
    dobra: FoldLineGuide,
  ) => {
    if (!onFoldPosicaoChange || widthMm <= 0 || heightMm <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const host = event.currentTarget.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      if (dobra.eixo === "vertical") {
        const xPct = (ev.clientX - rect.left) / rect.width;
        const xMm = xPct * widthMm;
        const pos = Math.round((xMm - crop.left) * 10) / 10;
        onFoldPosicaoChange(dobra.id, pos);
      } else {
        const yPct = (ev.clientY - rect.top) / rect.height;
        const yMm = yPct * heightMm;
        const pos = Math.round((yMm - crop.top) * 10) / 10;
        onFoldPosicaoChange(dobra.id, pos);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="relative mx-auto flex min-h-[240px] items-center justify-center">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100/80">
          <Loader2 className="size-6 animate-spin text-primary-green" aria-hidden />
        </div>
      )}
      {error && (
        <p className="p-4 text-center text-sm text-sagra-danger">{error}</p>
      )}
      <div className="relative inline-block max-w-full shadow-sm ring-1 ring-black/10">
        <canvas ref={canvasRef} className="block max-h-[520px] max-w-full" />
        {size.w > 0 && (
          <>
            <div
              className="pointer-events-none absolute inset-0 bg-black/35"
              style={{
                clipPath: `polygon(
                  0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                  ${insetStyle.left} ${insetStyle.top},
                  ${insetStyle.left} calc(100% - ${insetStyle.bottom}),
                  calc(100% - ${insetStyle.right}) calc(100% - ${insetStyle.bottom}),
                  calc(100% - ${insetStyle.right}) ${insetStyle.top},
                  ${insetStyle.left} ${insetStyle.top}
                )`,
              }}
            />
            <div
              className="pointer-events-none absolute border-2 border-primary-green"
              style={insetStyle}
            />
            {coverGuides && lombadaHalfPct > 0 && (
              <div
                className="pointer-events-none absolute border-x border-amber-400/90 bg-amber-400/25"
                style={{
                  top: insetStyle.top,
                  bottom: insetStyle.bottom,
                  left: `calc(${midPct}% - ${lombadaHalfPct}%)`,
                  width: `${lombadaHalfPct * 2}%`,
                }}
              />
            )}
            {coverGuides && earLPct > 0 && (
              <div
                className="pointer-events-none absolute border border-dashed border-sky-500 bg-sky-400/20"
                style={{
                  top: insetStyle.top,
                  bottom: insetStyle.bottom,
                  left: `${cropLeftPct}%`,
                  width: `${earLPct}%`,
                }}
              />
            )}
            {coverGuides && earRPct > 0 && (
              <div
                className="pointer-events-none absolute border border-dashed border-sky-500 bg-sky-400/20"
                style={{
                  top: insetStyle.top,
                  bottom: insetStyle.bottom,
                  right: `${cropRightPct}%`,
                  width: `${earRPct}%`,
                }}
              />
            )}
            {foldLines?.map((dobra, i) => {
              const color = FOLD_LINE_COLORS[i % FOLD_LINE_COLORS.length];
              const interactive = Boolean(onFoldPosicaoChange);
              if (dobra.eixo === "vertical") {
                const leftPct =
                  widthMm > 0
                    ? ((crop.left + dobra.posicaoMm) / widthMm) * 100
                    : 50;
                return (
                  <div
                    key={dobra.id}
                    role={interactive ? "slider" : undefined}
                    aria-label={`Dobra ${dobra.ordem}`}
                    aria-valuenow={dobra.posicaoMm}
                    onPointerDown={
                      interactive ? (e) => dragFold(e, dobra) : undefined
                    }
                    className={`absolute ${interactive ? "cursor-ew-resize pointer-events-auto" : "pointer-events-none"}`}
                    style={{
                      top: insetStyle.top,
                      bottom: insetStyle.bottom,
                      left: `${leftPct}%`,
                      width: 0,
                      borderLeft: `2px dashed ${color}`,
                      transform: "translateX(-1px)",
                      zIndex: 5,
                    }}
                    title={`Dobra ${dobra.ordem ?? i + 1}: ${dobra.posicaoMm.toFixed(1)} mm`}
                  >
                    <span
                      className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-1 text-[9px] font-semibold text-white"
                      style={{ background: color }}
                    >
                      {dobra.posicaoMm.toFixed(1)}
                    </span>
                  </div>
                );
              }
              const topPct =
                heightMm > 0
                  ? ((crop.top + dobra.posicaoMm) / heightMm) * 100
                  : 50;
              return (
                <div
                  key={dobra.id}
                  role={interactive ? "slider" : undefined}
                  aria-label={`Dobra ${dobra.ordem}`}
                  aria-valuenow={dobra.posicaoMm}
                  onPointerDown={
                    interactive ? (e) => dragFold(e, dobra) : undefined
                  }
                  className={`absolute ${interactive ? "cursor-ns-resize pointer-events-auto" : "pointer-events-none"}`}
                  style={{
                    left: insetStyle.left,
                    right: insetStyle.right,
                    top: `${topPct}%`,
                    height: 0,
                    borderTop: `2px dashed ${color}`,
                    transform: "translateY(-1px)",
                    zIndex: 5,
                  }}
                  title={`Dobra ${dobra.ordem ?? i + 1}: ${dobra.posicaoMm.toFixed(1)} mm`}
                >
                  <span
                    className="absolute -left-1 top-1/2 -translate-y-1/2 -translate-x-full whitespace-nowrap rounded px-1 text-[9px] font-semibold text-white"
                    style={{ background: color }}
                  >
                    {dobra.posicaoMm.toFixed(1)}
                  </span>
                </div>
              );
            })}
            {spiralGuides &&
              widthMm > 0 &&
              heightMm > 0 &&
              Array.from({ length: spiralGuides.holeCount }, (_, i) => {
                const usableW = Math.max(
                  1,
                  widthMm - crop.left - crop.right,
                );
                const usableH = Math.max(
                  1,
                  heightMm - crop.top - crop.bottom,
                );
                const t = (i + 1) / (spiralGuides.holeCount + 1);
                const dPctW = (spiralGuides.holeDiameterMm / widthMm) * 100;
                const dPctH = (spiralGuides.holeDiameterMm / heightMm) * 100;
                let cxPct: number;
                let cyPct: number;
                if (spiralGuides.edge === "left") {
                  cxPct =
                    ((crop.left + spiralGuides.marginFromEdgeMm) / widthMm) *
                    100;
                  cyPct = ((crop.top + t * usableH) / heightMm) * 100;
                } else {
                  cxPct = ((crop.left + t * usableW) / widthMm) * 100;
                  cyPct =
                    ((crop.top + spiralGuides.marginFromEdgeMm) / heightMm) *
                    100;
                }
                return (
                  <div
                    key={`spiral-hole-${i}`}
                    className="pointer-events-none absolute rounded-full bg-slate-800/80 ring-1 ring-white/70"
                    style={{
                      width: `${dPctW}%`,
                      height: `${dPctH}%`,
                      left: `${cxPct}%`,
                      top: `${cyPct}%`,
                      transform: "translate(-50%, -50%)",
                      zIndex: 6,
                    }}
                    title={`Furo ${i + 1}`}
                  />
                );
              })}
          </>
        )}
      </div>
    </div>
  );
}
