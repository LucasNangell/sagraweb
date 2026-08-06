import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  emptyCropSides,
  type CropSidesMm,
  type ProvaWebCapaCrop,
  type ProvaWebCropJson,
  type ProvaWebEspiralCrop,
} from "@/api/provaWeb";
import { defaultCapaCrop } from "./ProvaWebCoverWizard";
import { ProvaWebCropPanel } from "./ProvaWebCropPanel";
import {
  clampHoleCount,
  clampHoleDiameterMm,
  clampMarginFromEdgeMm,
  clampSpiralParams,
  maxMarginForFormat,
  suggestHoleCount,
  type SpiralEdge,
} from "./spiralBinding";

export function defaultEspiralCrop(
  sourceKind: "unico" | "capa_miolo" = "unico",
): ProvaWebEspiralCrop {
  return {
    sourceKind,
    edge: "left",
    holeCount: 14,
    holeDiameterMm: 5,
    marginFromEdgeMm: 8,
    crop: emptyCropSides("trimbox"),
    ...(sourceKind === "capa_miolo"
      ? { capa: { ...defaultCapaCrop("spread"), lombadaMm: 0 } }
      : {}),
  };
}

export interface ProvaWebSpiralWizardProps {
  ano: number;
  osId: number;
  sourceKind: "unico" | "capa_miolo";
  arquivoUnico: string | null;
  arquivoCapa: string | null;
  arquivoMiolo: string | null;
  saving?: boolean;
  onBack: () => void;
  onConfirm: (cropJson: ProvaWebCropJson) => void;
  formato?: string | null;
  formatoAlturaMm?: number | null;
  formatoLarguraMm?: number | null;
  initialCropJson?: ProvaWebCropJson | null;
}

export function ProvaWebSpiralWizard({
  ano,
  osId,
  sourceKind,
  arquivoUnico,
  arquivoCapa,
  arquivoMiolo,
  saving = false,
  onBack,
  onConfirm,
  formato = null,
  formatoAlturaMm = null,
  formatoLarguraMm = null,
  initialCropJson = null,
}: ProvaWebSpiralWizardProps) {
  const initial = initialCropJson?.espiral;
  const [edge, setEdge] = useState<SpiralEdge>(
    initial?.edge === "top" ? "top" : "left",
  );
  const [holeCount, setHoleCount] = useState(
    clampHoleCount(initial?.holeCount ?? 14),
  );
  const [holeDiameterMm, setHoleDiameterMm] = useState(
    clampHoleDiameterMm(initial?.holeDiameterMm ?? 5),
  );
  const [marginFromEdgeMm, setMarginFromEdgeMm] = useState(
    clampMarginFromEdgeMm(initial?.marginFromEdgeMm ?? 8),
  );
  const [crop, setCrop] = useState<CropSidesMm>(() =>
    initial?.crop
      ? { ...emptyCropSides(), ...initial.crop }
      : initialCropJson?.unico
        ? { ...emptyCropSides(), ...initialCropJson.unico }
        : initialCropJson?.miolo
          ? { ...emptyCropSides(), ...initialCropJson.miolo }
          : emptyCropSides("trimbox"),
  );
  const [capaCrop, setCapaCrop] = useState<CropSidesMm>(() => {
    const c = initial?.capa?.crop ?? initialCropJson?.capa?.crop;
    return c ? { ...emptyCropSides(), ...c } : emptyCropSides("trimbox");
  });
  const [pageIndex, setPageIndex] = useState(0);
  const [suggestedApplied, setSuggestedApplied] = useState(false);

  const usableW = Math.max(
    20,
    (formatoLarguraMm ?? 210) - crop.left - crop.right,
  );
  const usableH = Math.max(
    20,
    (formatoAlturaMm ?? 297) - crop.top - crop.bottom,
  );
  const bindSpan = edge === "left" ? usableH : usableW;
  const suggested = suggestHoleCount(bindSpan, holeDiameterMm);
  const marginMax = maxMarginForFormat(usableW, usableH, edge);

  // Re-clampa margem quando formato/borda mudam
  useEffect(() => {
    setMarginFromEdgeMm((m) =>
      clampMarginFromEdgeMm(Math.min(m, marginMax)),
    );
  }, [marginMax]);

  // Uma vez: se usuário não tinha holeCount salvo e há formato, sugerir
  useEffect(() => {
    if (suggestedApplied || initial?.holeCount != null) return;
    if (formatoLarguraMm == null && formatoAlturaMm == null) return;
    setHoleCount(suggested);
    setSuggestedApplied(true);
  }, [
    suggestedApplied,
    initial?.holeCount,
    formatoLarguraMm,
    formatoAlturaMm,
    suggested,
  ]);

  const spiralGuides = useMemo(
    () =>
      clampSpiralParams(
        { edge, holeCount, holeDiameterMm, marginFromEdgeMm },
        { w: usableW, h: usableH },
      ),
    [edge, holeCount, holeDiameterMm, marginFromEdgeMm, usableW, usableH],
  );

  const stableCrop = useCallback((c: CropSidesMm) => setCrop(c), []);
  const stableCapaCrop = useCallback((c: CropSidesMm) => setCapaCrop(c), []);

  const pdfPath =
    sourceKind === "capa_miolo" ? arquivoMiolo : arquivoUnico;
  const capaPath = sourceKind === "capa_miolo" ? arquivoCapa : null;

  const handleGenerate = () => {
    const params = clampSpiralParams(
      { edge, holeCount, holeDiameterMm, marginFromEdgeMm },
      { w: usableW, h: usableH },
    );
    const capa: ProvaWebCapaCrop | undefined =
      sourceKind === "capa_miolo"
        ? {
            ...(initial?.capa ?? defaultCapaCrop("spread")),
            lombadaMm: 0,
            crop: capaCrop,
          }
        : undefined;
    const espiral: ProvaWebEspiralCrop = {
      sourceKind,
      ...params,
      crop,
      ...(capa ? { capa } : {}),
    };
    onConfirm({
      espiral,
      ...(sourceKind === "unico" ? { unico: crop } : {}),
      ...(sourceKind === "capa_miolo" ? { miolo: crop, capa } : {}),
    });
  };

  if (!pdfPath) {
    return (
      <div className="p-4 text-sm text-sagra-danger">
        Selecione o arquivo PDF do produto com espiral.
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sagra-border bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
        >
          <ArrowLeft className="size-3.5" />
          Voltar
        </button>
        <div>
          <h2 className="text-base font-semibold text-neutral-800">
            Espiral — crop e furos
          </h2>
          <p className="text-xs text-neutral-500">
            {sourceKind === "capa_miolo"
              ? "Capa + miolo com wire-o / espiral (sem lombada de cola)."
              : "Arquivo único com wire-o / espiral. Os furos aparecem no preview do crop."}
          </p>
        </div>
      </div>

      <section className="space-y-3 rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-neutral-800">
              Binding (espiral)
            </h3>
            <p className="text-[11px] text-neutral-500">
              Ajuste a borda e a quantidade de furos. Sugestão pelo formato:{" "}
              <span className="font-medium tabular-nums text-neutral-700">
                {suggested} furos
              </span>{" "}
              (~{bindSpan.toFixed(0)} mm no lado {edge === "left" ? "alto" : "largo"}).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setHoleCount(suggested)}
            className="rounded-lg border border-sagra-border bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Usar sugestão
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-700">
            Borda dos furos
            <select
              value={edge}
              onChange={(e) =>
                setEdge(e.target.value === "top" ? "top" : "left")
              }
              className="rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-sm"
            >
              <option value="left">Esquerda (retrato)</option>
              <option value="top">Superior (paisagem / calendário)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-700">
            Nº de furos
            <input
              type="number"
              min={4}
              max={40}
              value={holeCount}
              onChange={(e) =>
                setHoleCount(clampHoleCount(Number(e.target.value) || 14))
              }
              className="w-24 rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-700">
            Ø furo (mm)
            <input
              type="number"
              min={2}
              max={12}
              step={0.5}
              value={holeDiameterMm}
              onChange={(e) =>
                setHoleDiameterMm(
                  clampHoleDiameterMm(Number(e.target.value) || 5),
                )
              }
              className="w-24 rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-700">
            Margem da borda (mm)
            <input
              type="number"
              min={3}
              max={marginMax}
              step={0.5}
              value={marginFromEdgeMm}
              onChange={(e) =>
                setMarginFromEdgeMm(
                  clampMarginFromEdgeMm(
                    Math.min(Number(e.target.value) || 8, marginMax),
                  ),
                )
              }
              className="w-28 rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-sm tabular-nums"
            />
            <span className="text-[10px] text-neutral-400">
              Máx. {marginMax.toFixed(1)} mm neste formato
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-neutral-800">
          {sourceKind === "capa_miolo" ? "Crop do miolo" : "Crop da folha"}
        </h3>
        <ProvaWebCropPanel
          ano={ano}
          osId={osId}
          relativePath={pdfPath}
          title="Crop (mm)"
          crop={crop}
          onChange={stableCrop}
          pageIndex={pageIndex}
          onPageIndexChange={setPageIndex}
          showPageSelector
          spiralGuides={spiralGuides}
          formatoLabel={formato}
          formatoLarguraMm={formatoLarguraMm}
          formatoAlturaMm={formatoAlturaMm}
        />
      </section>

      {sourceKind === "capa_miolo" && capaPath && (
        <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-neutral-800">
            Crop da capa
          </h3>
          <p className="mb-2 text-[11px] text-neutral-500">
            Sem lombada de cola — só faces. Os furos seguem o miolo.
          </p>
          <ProvaWebCropPanel
            ano={ano}
            osId={osId}
            relativePath={capaPath}
            title="Crop da capa (mm)"
            crop={capaCrop}
            onChange={stableCapaCrop}
            pageIndex={0}
            showPageSelector={false}
            formatoLabel={formato}
            formatoLarguraMm={formatoLarguraMm}
            formatoAlturaMm={formatoAlturaMm}
          />
        </section>
      )}

      <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 border-t border-sagra-border bg-slate-50/95 py-3 backdrop-blur">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="rounded-lg border border-sagra-border bg-white px-4 py-2 text-sm disabled:opacity-40"
        >
          Voltar
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Gerando…
            </>
          ) : (
            "Gerar prova"
          )}
        </button>
      </div>
    </div>
  );
}
