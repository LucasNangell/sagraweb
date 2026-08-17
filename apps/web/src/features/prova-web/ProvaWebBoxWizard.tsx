import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Package } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import {
  emptyCropSides,
  fetchProvaWebCropMeta,
  type ProvaWebCaixaArtTransform,
  type ProvaWebCaixaCrop,
  type ProvaWebCropJson,
} from "@/api/provaWeb";
import {
  fetchProvaWebBoxModel,
  fetchProvaWebBoxModels,
  type BoxModelConfig,
} from "@/api/boxModels";

import { BoxModelDielineEditor } from "@/features/configuracoes/components/BoxModelDielineEditor";
import { useProvaWebPdfPageRaster } from "./useProvaWebPdfPageRaster";

const IDENTITY_TF: ProvaWebCaixaArtTransform = {
  txMm: 0,
  tyMm: 0,
  scale: 1,
  rotationDeg: 0,
};

export function defaultCaixaCrop(
  sourceKind: "combined" | "separate" | "model" = "model",
): ProvaWebCaixaCrop {
  return {
    sourceKind,
    template: sourceKind === "model" ? "graph" : "flip_top",
    dimsMm: { length: 120, width: 160, height: 40, glue: 20 },
    boxModelId: null,
    artTransform: { ...IDENTITY_TF },
    artInsideTransform: { ...IDENTITY_TF },
    facaPage: 0,
    artePage: 0,
    arteInsidePage: 1,
    artCrop: emptyCropSides("manual"),
    artRotationDeg: 0,
    ready: true,
  };
}

export interface ProvaWebBoxWizardProps {
  ano: number;
  osId: number;
  sourceKind: "combined" | "separate" | "model";
  arquivoUnico: string | null;
  arquivoCapa: string | null;
  arquivoMiolo: string | null;
  saving?: boolean;
  onBack: () => void;
  onConfirm: (cropJson: ProvaWebCropJson) => void;
  initialCropJson?: ProvaWebCropJson | null;
}

type ArtSide = "outside" | "inside";

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
  const [modelId, setModelId] = useState<number | null>(
    initial?.boxModelId ?? null,
  );
  const [transform, setTransform] = useState<ProvaWebCaixaArtTransform>(
    initial?.artTransform ?? { ...IDENTITY_TF },
  );
  const [insideTransform, setInsideTransform] =
    useState<ProvaWebCaixaArtTransform>(
      initial?.artInsideTransform ??
        initial?.artTransform ?? { ...IDENTITY_TF },
    );
  const [artSide, setArtSide] = useState<ArtSide>("outside");
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
  } | null>(null);

  const modelsQuery = useQuery({
    queryKey: ["prova-web", "box-models"],
    queryFn: () => fetchProvaWebBoxModels(),
  });

  const modelQuery = useQuery({
    queryKey: ["prova-web", "box-model", modelId],
    queryFn: () => fetchProvaWebBoxModel(modelId!),
    enabled: modelId != null,
  });

  const config: BoxModelConfig | null = modelQuery.data?.config ?? null;

  const artePath =
    sourceKind === "separate"
      ? arquivoMiolo
      : sourceKind === "combined"
        ? arquivoUnico
        : arquivoUnico;

  const cropMetaQuery = useQuery({
    queryKey: ["prova-web", "crop-meta", ano, osId, artePath],
    queryFn: () => fetchProvaWebCropMeta(ano, osId, artePath!),
    enabled: Boolean(artePath),
  });

  const pageCount = cropMetaQuery.data?.pageCount ?? 1;
  const hasInside = pageCount >= 2;
  const activeSide: ArtSide =
    artSide === "inside" && hasInside ? "inside" : "outside";
  const activeTransform =
    activeSide === "inside" ? insideTransform : transform;
  const setActiveTransform =
    activeSide === "inside" ? setInsideTransform : setTransform;
  const pageIndex = activeSide === "inside" ? 1 : 0;

  const pageW = cropMetaQuery.data?.widthMm ?? 210;
  const pageH = cropMetaQuery.data?.heightMm ?? 297;
  const artRaster = useProvaWebPdfPageRaster({
    ano,
    osId,
    relativePath: artePath ?? "",
    pageIndex,
    crop: emptyCropSides("manual"),
    pageWidthMm: pageW,
    pageHeightMm: pageH,
    enabled: Boolean(artePath && modelId),
  });

  const canConfirm = Boolean(modelId && artePath && config);
  const netStyle = useMemo(() => {
    if (!config) return null;
    const w = config.cutBboxMm.widthMm || 100;
    const h = config.cutBboxMm.heightMm || 100;
    return { aspect: w / h, w, h };
  }, [config]);

  const handleConfirm = () => {
    if (!modelId || !config) {
      setError("Selecione um modelo de caixa cadastrado.");
      return;
    }
    if (!artePath) {
      setError("Selecione o PDF da arte.");
      return;
    }
    const dimsHint = config.dimsHint as
      | { lengthMm?: number; widthMm?: number; heightMm?: number; glueMm?: number }
      | undefined;
    const caixa: ProvaWebCaixaCrop = {
      sourceKind: "model",
      template: "graph",
      boxModelId: modelId,
      dimsMm: {
        length: Number(dimsHint?.lengthMm ?? config.cutBboxMm.widthMm ?? 120),
        width: Number(dimsHint?.widthMm ?? config.cutBboxMm.heightMm ?? 160),
        height: Number(dimsHint?.heightMm ?? 40),
        glue: Number(dimsHint?.glueMm ?? 20),
      },
      artePage: 0,
      artTransform: transform,
      artCrop: emptyCropSides("manual"),
      artRotationDeg: 0,
      ready: true,
    };
    if (hasInside) {
      caixa.arteInsidePage = 1;
      caixa.artInsideTransform = insideTransform;
    }
    onConfirm({ caixa });
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
      <div className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
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
              Caixa — modelo + registro da arte
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              Escolha o modelo pré-cadastrado (faca) e alinhe a arte. Externa =
              fora da caixa · Interna = verso (dentro). Arte: {artePath || "—"}.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs font-medium text-neutral-600">
            Modelo de caixa
            <select
              className="mt-1 w-full rounded-lg border border-sagra-border px-2.5 py-1.5 text-sm"
              value={modelId ?? ""}
              onChange={(e) =>
                setModelId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Selecione…</option>
              {(modelsQuery.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                  {m.hint ? ` — ${m.hint}` : ""}
                </option>
              ))}
            </select>
          </label>
          {modelsQuery.isLoading ? (
            <p className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Carregando modelos…
            </p>
          ) : null}
          {(modelsQuery.data ?? []).length === 0 && !modelsQuery.isLoading ? (
            <p className="mt-2 text-xs text-amber-700">
              Nenhum modelo ativo. Cadastre em Admin → Configurações → Caixas
              (Prova WEB).
            </p>
          ) : null}
        </div>

        {config && netStyle ? (
          <div className="mt-4 space-y-3">
            {hasInside ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-neutral-600">
                  Lado
                </span>
                <div className="inline-flex rounded-lg border border-sagra-border p-0.5 text-xs">
                  <button
                    type="button"
                    className={`rounded-md px-2.5 py-1 font-medium ${
                      activeSide === "outside"
                        ? "bg-primary-green text-white"
                        : "text-neutral-600 hover:bg-neutral-50"
                    }`}
                    onClick={() => setArtSide("outside")}
                  >
                    Externa
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-2.5 py-1 font-medium ${
                      activeSide === "inside"
                        ? "bg-primary-green text-white"
                        : "text-neutral-600 hover:bg-neutral-50"
                    }`}
                    onClick={() => setArtSide("inside")}
                  >
                    Interna
                  </button>
                </div>
                <span className="text-[10px] text-neutral-500">
                  PDF com {pageCount} páginas — pág. {pageIndex + 1} ativa
                </span>
              </div>
            ) : (
              <p className="text-[10px] text-neutral-500">
                PDF com 1 página: só arte externa (interno = papel kraft). Para
                duplex, use um PDF com 2 páginas (frente + verso).
              </p>
            )}
            <p className="text-xs font-medium text-neutral-600">
              Registro da arte{" "}
              {activeSide === "inside" ? "interna" : "externa"} sobre a faca
              (arraste; use escala/rotação)
            </p>
            <div
              className="relative mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-sagra-border bg-slate-100"
              style={{ aspectRatio: String(netStyle.aspect) }}
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                dragRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  tx: activeTransform.txMm,
                  ty: activeTransform.tyMm,
                };
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d) return;
                const rect = (
                  e.currentTarget as HTMLDivElement
                ).getBoundingClientRect();
                const dx = ((e.clientX - d.x) / rect.width) * netStyle.w;
                const dy = ((e.clientY - d.y) / rect.height) * netStyle.h;
                setActiveTransform((t) => ({
                  ...t,
                  txMm: d.tx + dx,
                  tyMm: d.ty + dy,
                }));
              }}
              onPointerUp={() => {
                dragRef.current = null;
              }}
              onPointerCancel={() => {
                dragRef.current = null;
              }}
            >
              <div className="pointer-events-none absolute inset-0 opacity-90">
                <BoxModelDielineEditor
                  variant="registration"
                  config={config}
                  selectedPanelId={config.basePanelId}
                  selectedEdgeId={null}
                  onSelectPanel={() => {}}
                  onSelectEdge={() => {}}
                />
              </div>
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  transform: `translate(${(activeTransform.txMm / netStyle.w) * 100}%, ${(activeTransform.tyMm / netStyle.h) * 100}%) rotate(${activeTransform.rotationDeg}deg) scale(${activeTransform.scale})`,
                }}
              >
                {artRaster.raster ? (
                  <img
                    src={artRaster.raster.dataUrl}
                    alt={
                      activeSide === "inside" ? "Arte interna" : "Arte externa"
                    }
                    className="max-h-full max-w-full object-contain opacity-80"
                    draggable={false}
                  />
                ) : (
                  <div className="rounded bg-primary-green/20 px-3 py-2 text-center text-[11px] font-medium text-primary-green ring-1 ring-primary-green/40">
                    {artRaster.loading
                      ? "Carregando arte…"
                      : "Arte (arraste para alinhar)"}
                    <div className="text-[10px] font-normal text-neutral-600">
                      {artePath}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-neutral-600">
                Escala
                <input
                  type="range"
                  min={0.4}
                  max={2.5}
                  step={0.01}
                  value={activeTransform.scale}
                  onChange={(e) =>
                    setActiveTransform((t) => ({
                      ...t,
                      scale: Number(e.target.value),
                    }))
                  }
                  className="mt-1 block w-40"
                />
              </label>
              <label className="text-xs text-neutral-600">
                Rotação
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={activeTransform.rotationDeg}
                  onChange={(e) =>
                    setActiveTransform((t) => ({
                      ...t,
                      rotationDeg: Number(e.target.value),
                    }))
                  }
                  className="mt-1 block w-40"
                />
              </label>
              <button
                type="button"
                className="rounded-lg border border-sagra-border px-2.5 py-1.5 text-xs"
                onClick={() => setActiveTransform({ ...IDENTITY_TF })}
              >
                Resetar registro
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-sagra-danger">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-sagra-border px-3 py-1.5 text-xs font-medium text-neutral-600"
          >
            Voltar
          </button>
          <button
            type="button"
            disabled={saving || !canConfirm}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
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
