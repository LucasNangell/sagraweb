import { ArrowLeft, Loader2, Package } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  emptyCropSides,
  fetchProvaWebDielineMeta,
  type CropSidesMm,
  type ProvaWebCaixaCrop,
  type ProvaWebCropJson,
  type ProvaWebDielineMetaResponse,
} from "@/api/provaWeb";

export function defaultCaixaCrop(
  sourceKind: "combined" | "separate" = "combined",
): ProvaWebCaixaCrop {
  return {
    sourceKind,
    template: "tuck_end_reverse",
    dimsMm: { length: 120, width: 160, height: 40, glue: 20 },
    facaPage: 0,
    artePage: 1,
    artCrop: emptyCropSides("manual"),
    artRotationDeg: 0,
    ready: true,
  };
}

export interface ProvaWebBoxWizardProps {
  ano: number;
  osId: number;
  sourceKind: "combined" | "separate";
  arquivoUnico: string | null;
  arquivoCapa: string | null;
  arquivoMiolo: string | null;
  saving?: boolean;
  onBack: () => void;
  onConfirm: (cropJson: ProvaWebCropJson) => void;
  initialCropJson?: ProvaWebCropJson | null;
}

function num(v: string, fallback: number): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export function ProvaWebBoxWizard({
  ano,
  osId,
  sourceKind,
  arquivoUnico,
  arquivoCapa,
  arquivoMiolo,
  saving = false,
  onBack,
  onConfirm,
  initialCropJson = null,
}: ProvaWebBoxWizardProps) {
  const initial = initialCropJson?.caixa;
  const facaPath =
    sourceKind === "separate" ? arquivoCapa : arquivoUnico;

  const [length, setLength] = useState(initial?.dimsMm.length ?? 120);
  const [width, setWidth] = useState(initial?.dimsMm.width ?? 160);
  const [height, setHeight] = useState(initial?.dimsMm.height ?? 40);
  const [glue, setGlue] = useState(initial?.dimsMm.glue ?? 20);
  const [facaPage, setFacaPage] = useState(initial?.facaPage ?? 0);
  const [artePage, setArtePage] = useState(initial?.artePage ?? 1);
  const [artCrop, setArtCrop] = useState<CropSidesMm>(
    initial?.artCrop ?? emptyCropSides("manual"),
  );
  const [confidence, setConfidence] = useState<number | null>(
    initial?.suggestedConfidence ?? null,
  );
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [meta, setMeta] = useState<ProvaWebDielineMetaResponse | null>(null);

  useEffect(() => {
    if (!facaPath) return;
    let cancelled = false;
    setLoadingMeta(true);
    setMetaError(null);
    void fetchProvaWebDielineMeta(ano, osId, facaPath, {
      page: sourceKind === "combined" ? facaPage : 0,
    })
      .then((res) => {
        if (cancelled) return;
        setMeta(res);
        const sug = res.suggestion;
        if (!initial?.dimsMm?.length && sug.dimsMm) {
          if (sug.dimsMm.length != null) setLength(Number(sug.dimsMm.length));
          if (sug.dimsMm.width != null) setWidth(Number(sug.dimsMm.width));
          if (sug.dimsMm.height != null) setHeight(Number(sug.dimsMm.height));
          if (sug.dimsMm.glue != null) setGlue(Number(sug.dimsMm.glue));
        }
        if (
          sourceKind === "combined" &&
          sug.artCrop &&
          !initial?.artCrop
        ) {
          setArtCrop(sug.artCrop);
        }
        if (sug.facaPage != null && sourceKind === "combined" && !initial) {
          setFacaPage(sug.facaPage);
        }
        if (sug.artePage != null && sourceKind === "combined" && !initial) {
          setArtePage(sug.artePage);
        }
        if (sug.confidence != null) setConfidence(sug.confidence);
      })
      .catch((err) => {
        if (cancelled) return;
        setMetaError(
          err instanceof Error
            ? err.message
            : "Não foi possível ler a faca do PDF.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false);
      });
    return () => {
      cancelled = true;
    };
    // Só na montagem / troca de arquivo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, osId, facaPath, sourceKind]);

  const creasePreview = useMemo(() => {
    const segs = meta?.parsed.foldSegmentsMm ?? [];
    const cut = meta?.parsed.cutBboxMm;
    if (!cut || !segs.length) return null;
    const x0 = Number(cut.x0Mm ?? 0);
    const y0 = Number(cut.y0Mm ?? 0);
    const w = Number(cut.widthMm ?? 1);
    const h = Number(cut.heightMm ?? 1);
    return { segs, x0, y0, w, h };
  }, [meta]);

  const handleConfirm = () => {
    const caixa: ProvaWebCaixaCrop = {
      sourceKind,
      template: "tuck_end_reverse",
      dimsMm: {
        length: Math.max(10, length),
        width: Math.max(10, width),
        height: Math.max(10, height),
        glue: Math.max(5, glue),
      },
      facaPage,
      artePage,
      artCrop,
      artRotationDeg: 0,
      suggestedConfidence: confidence,
      ready: true,
      net: {
        verticalCreasesMm: meta?.parsed.verticalCreasesMm ?? [],
        horizontalCreasesMm: meta?.parsed.horizontalCreasesMm ?? [],
        cutBboxMm: meta?.parsed.cutBboxMm ?? null,
      },
    };
    onConfirm({ caixa });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
      <div className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={onBack}
              className="mt-0.5 rounded-lg border border-sagra-border p-1.5 text-neutral-500 hover:bg-neutral-100"
              aria-label="Voltar"
            >
              <ArrowLeft className="size-4" aria-hidden />
            </button>
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
                <Package className="size-4 text-primary-green" aria-hidden />
                Caixa tuck-end — medidas
              </h2>
              <p className="mt-1 text-xs text-neutral-500">
                Confirme L×W×H detectados da faca (corte contínuo / dobra
                pontilhada). A arte será mapeada sobre a net paramétrica.
              </p>
            </div>
          </div>
        </div>

        {loadingMeta ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Lendo a faca…
          </div>
        ) : null}
        {metaError ? (
          <p className="mt-3 text-sm text-sagra-danger">{metaError}</p>
        ) : null}

        {confidence != null ? (
          <p className="mt-3 text-[11px] text-neutral-500">
            Confiança da detecção: {(confidence * 100).toFixed(0)}%
            {confidence < 0.55
              ? " — revise as medidas antes de gerar."
              : " — ajuste se necessário."}
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-neutral-600">
            Comprimento L (mm)
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-sagra-border px-2.5 py-1.5 text-sm"
              value={length}
              onChange={(e) => setLength(num(e.target.value, length))}
            />
          </label>
          <label className="text-xs text-neutral-600">
            Largura W (mm)
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-sagra-border px-2.5 py-1.5 text-sm"
              value={width}
              onChange={(e) => setWidth(num(e.target.value, width))}
            />
          </label>
          <label className="text-xs text-neutral-600">
            Altura H (mm)
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-sagra-border px-2.5 py-1.5 text-sm"
              value={height}
              onChange={(e) => setHeight(num(e.target.value, height))}
            />
          </label>
          <label className="text-xs text-neutral-600">
            Aba de cola (mm)
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-sagra-border px-2.5 py-1.5 text-sm"
              value={glue}
              onChange={(e) => setGlue(num(e.target.value, glue))}
            />
          </label>
        </div>

        {sourceKind === "combined" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-neutral-600">
              Página da faca (0-based)
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded-lg border border-sagra-border px-2.5 py-1.5 text-sm"
                value={facaPage}
                onChange={(e) => setFacaPage(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label className="text-xs text-neutral-600">
              Página da arte (0-based)
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded-lg border border-sagra-border px-2.5 py-1.5 text-sm"
                value={artePage}
                onChange={(e) => setArtePage(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-neutral-500">
            Faca: {arquivoCapa || "—"} · Arte: {arquivoMiolo || "—"}
          </p>
        )}

        {creasePreview ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-sagra-border bg-slate-50 p-3">
            <p className="mb-2 text-[11px] font-medium text-neutral-600">
              Prévia dos vincos (pontilhado) na área de corte
            </p>
            <svg
              viewBox={`0 0 ${creasePreview.w} ${creasePreview.h}`}
              className="mx-auto max-h-56 w-full"
              role="img"
              aria-label="Diagrama da faca"
            >
              <rect
                x={0}
                y={0}
                width={creasePreview.w}
                height={creasePreview.h}
                fill="#fff"
                stroke="#94a3b8"
                strokeWidth={0.4}
              />
              {creasePreview.segs.map((s, i) => (
                <line
                  key={i}
                  x1={s.x1 - creasePreview.x0}
                  y1={s.y1 - creasePreview.y0}
                  x2={s.x2 - creasePreview.x0}
                  y2={s.y2 - creasePreview.y0}
                  stroke="#0f766e"
                  strokeWidth={0.6}
                  strokeDasharray="2 2"
                />
              ))}
            </svg>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-sagra-border px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
          >
            Voltar
          </button>
          <button
            type="button"
            disabled={saving || !facaPath}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-green px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            Gerar Prova WEB
          </button>
        </div>
      </div>
    </div>
  );
}
