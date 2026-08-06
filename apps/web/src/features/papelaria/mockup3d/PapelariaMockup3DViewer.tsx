import { cn } from "@sagra/ui";
import { Box, ImageOff } from "lucide-react";
import { useMemo, useState } from "react";

import "./mockup3dStyles.css";
import { MOCKUP_DEMO_ARTE_URL } from "./papelariaMockupPresets";
import {
  buildFaceTransform,
  cropToBackgroundStyle,
  isRasterArteUrl,
  sceneDimensionsPx,
} from "./mockup3dUtils";
import type { MockupConfig, MockupFaceConfig } from "./types";

export type PapelariaMockup3DViewerProps = {
  arteUrl?: string | null;
  config: MockupConfig;
  className?: string;
  showControls?: boolean;
  initialFoldOpen?: number;
  presetNome?: string;
};

function resolveArteUrl(arteUrl?: string | null): {
  url: string | null;
  usingPlaceholder: boolean;
} {
  if (arteUrl && isRasterArteUrl(arteUrl)) {
    return { url: arteUrl, usingPlaceholder: false };
  }
  if (arteUrl && !isRasterArteUrl(arteUrl)) {
    return { url: MOCKUP_DEMO_ARTE_URL, usingPlaceholder: true };
  }
  return { url: null, usingPlaceholder: true };
}

function FaceLayer({
  face,
  config,
  arteUrl,
  foldOpen,
  debug,
  productW,
  productH,
}: {
  face: MockupFaceConfig;
  config: MockupConfig;
  arteUrl: string;
  foldOpen: number;
  debug: boolean;
  productW: number;
  productH: number;
}) {
  const bg = cropToBackgroundStyle(face.crop);
  const isEdge = Boolean(face.espessuraMm);

  const widthStyle = isEdge
    ? `${((face.espessuraMm ?? 0.5) / config.larguraAbertaMm) * productW}px`
    : `${face.crop.width}%`;

  const heightStyle = isEdge ? "100%" : `${face.crop.height}%`;

  const leftStyle = isEdge
    ? `${face.crop.x}%`
    : `${face.crop.x}%`;

  return (
    <div
      className={cn(
        "pm3d-face",
        isEdge && "pm3d-face--edge",
        debug && "pm3d-face--debug",
      )}
      data-label={face.nome}
      style={{
        width: widthStyle,
        height: heightStyle,
        left: leftStyle,
        top: `${face.crop.y}%`,
        zIndex: face.zIndex ?? 1,
        backgroundImage: isEdge ? undefined : `url("${arteUrl}")`,
        backgroundSize: bg.backgroundSize,
        backgroundPosition: bg.backgroundPosition,
        transformOrigin: face.transform.origin ?? "center center",
        transform: buildFaceTransform(face, foldOpen),
        borderLeft: face.id === "capa" ? "2px solid #cfcfcf" : undefined,
      }}
    />
  );
}

export function PapelariaMockup3DViewer({
  arteUrl,
  config,
  className,
  showControls = true,
  initialFoldOpen = 0.35,
  presetNome,
}: PapelariaMockup3DViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [rotateY, setRotateY] = useState(-28);
  const [rotateX, setRotateX] = useState(6);
  const [foldOpen, setFoldOpen] = useState(initialFoldOpen);
  const [debug, setDebug] = useState(false);
  const [imgError, setImgError] = useState(false);

  const { url: resolvedUrl, usingPlaceholder } = useMemo(
    () => resolveArteUrl(arteUrl),
    [arteUrl],
  );

  const hasDobra = Boolean(
    config.dobras?.length ||
      config.faces.some((f) => f.abreComDobra),
  );

  const scenePx = useMemo(
    () => sceneDimensionsPx(config, foldOpen, 300),
    [config, foldOpen],
  );

  const effectiveArte =
    resolvedUrl && !imgError ? resolvedUrl : MOCKUP_DEMO_ARTE_URL;

  if (!resolvedUrl && !effectiveArte) {
    return (
      <div className={cn("pm3d-root", className)}>
        <div className="pm3d-placeholder">
          <ImageOff className="size-8 opacity-40" aria-hidden />
          <p>Nenhuma arte disponível para o mockup 3D.</p>
          <p className="text-[10px]">Exporte PNG/JPG da arte aberta para visualização realista.</p>
        </div>
      </div>
    );
  }

  const sceneTransform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${zoom})`;

  return (
    <div className={cn("pm3d-root", className)}>
      {presetNome && (
        <p className="text-[10px] font-medium text-neutral-500">
          Mockup 3D — {presetNome}
          {usingPlaceholder && (
            <span className="ml-1 text-amber-600">(arte demonstração)</span>
          )}
        </p>
      )}

      <div className="pm3d-viewport pm3d-perspective">
        <div
          className="pm3d-scene"
          style={{ transform: sceneTransform }}
        >
          <div
            className="pm3d-product"
            style={{
              width: scenePx.width,
              height: scenePx.height,
              transformStyle: "preserve-3d",
            }}
          >
            {config.faces
              .slice()
              .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
              .map((face) => (
                <FaceLayer
                  key={face.id}
                  face={face}
                  config={config}
                  arteUrl={effectiveArte}
                  foldOpen={foldOpen}
                  debug={debug}
                  productW={scenePx.width}
                  productH={scenePx.height}
                />
              ))}
          </div>
        </div>
      </div>

      {showControls && (
        <div className="pm3d-controls">
          <label>
            Zoom
            <input
              type="range"
              min={0.6}
              max={1.4}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <label>
            Rotação Y
            <input
              type="range"
              min={-90}
              max={90}
              step={1}
              value={rotateY}
              onChange={(e) => setRotateY(Number(e.target.value))}
            />
          </label>
          {hasDobra && (
            <label>
              Abertura
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={foldOpen}
                onChange={(e) => setFoldOpen(Number(e.target.value))}
              />
            </label>
          )}
          <button
            type="button"
            aria-pressed={debug}
            onClick={() => setDebug((v) => !v)}
          >
            Debug
          </button>
        </div>
      )}

      {/* Pré-carrega arte raster; fallback para demo em erro */}
      {resolvedUrl && isRasterArteUrl(resolvedUrl) && (
        <img
          src={resolvedUrl}
          alt=""
          className="hidden"
          onError={() => setImgError(true)}
          onLoad={() => setImgError(false)}
        />
      )}
    </div>
  );
}

export function PapelariaMockup3DPlaceholder({
  message = "Selecione um modelo e gere a arte para visualizar o mockup 3D.",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div className={cn("pm3d-placeholder min-h-[180px]", className)}>
      <Box className="size-8 opacity-30" aria-hidden />
      <p>{message}</p>
    </div>
  );
}
