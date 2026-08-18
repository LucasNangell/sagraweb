import { cn } from "@sagra/ui";
import { Box } from "lucide-react";
import { useMemo, useState } from "react";

import {
  buildFaceTransform,
  buildSceneTransform,
  configUsesFold,
  cropToBackgroundStyle,
  faceLayoutStyle,
  normalizeCrop,
  paginasUsadas,
  PAPELARIA_MOCKUP_SCENE_BASE_PX,
  resolvePageUrl,
  sceneDimensionsPx,
} from "../mockup";
import type { PapelariaMockupConfig } from "../mockup";
import "./PapelariaProofMockup3D.css";

export type PapelariaProofMockup3DProps = {
  pages: string[];
  config: PapelariaMockupConfig;
  isFallback?: boolean;
  className?: string;
  /** Referência em px para dimensionar a cena (padrão da Papelaria). */
  sceneBasePx?: number;
};

function MockupFace({
  face,
  config,
  pageUrl,
  productW,
  productH,
  isHover,
  foldOpen,
}: {
  face: PapelariaMockupConfig["faces"][number];
  config: PapelariaMockupConfig;
  pageUrl: string | null;
  productW: number;
  productH: number;
  isHover: boolean;
  foldOpen: number;
}) {
  const crop = normalizeCrop(face.crop);
  const bg = cropToBackgroundStyle(crop);
  const layout = faceLayoutStyle(face, config, productW, productH);
  const isFullBleed =
    !face.crop && !face.style3d.widthMm && !face.espessuraMm;

  return (
    <div
      className={cn(
        "mockup-face",
        isFullBleed && "mockup-face--full",
        face.sombra && "mockup-face--shadow",
        face.lombada && "mockup-face--spine-edge",
        face.className,
      )}
      style={{
        ...layout,
        zIndex: face.zIndex ?? 1,
        transformOrigin: face.style3d.transformOrigin ?? "center center",
        transform: buildFaceTransform(face, foldOpen, isHover),
        backgroundImage: pageUrl ? `url("${pageUrl}")` : undefined,
        backgroundSize: bg.backgroundSize,
        backgroundPosition: bg.backgroundPosition,
      }}
      title={face.nome}
    />
  );
}

export function PapelariaProofMockup3D({
  pages,
  config,
  isFallback = false,
  className,
  sceneBasePx = PAPELARIA_MOCKUP_SCENE_BASE_PX,
}: PapelariaProofMockup3DProps) {
  const [isHover, setIsHover] = useState(false);
  const imagePages = pages.filter(Boolean);
  const foldOpen = config.aberturaInicial ?? 0.35;
  const hasFold = configUsesFold(config);

  const scenePx = useMemo(
    () => sceneDimensionsPx(config, hasFold ? foldOpen : 0, sceneBasePx),
    [config, foldOpen, hasFold, sceneBasePx],
  );

  const usedPages = paginasUsadas(config);
  const truncatedNotice =
    imagePages.length > Math.max(...usedPages, 0) + 1
      ? "Visualização do produto em 3D."
      : null;

  if (imagePages.length === 0) {
    return (
      <div className={cn("proof-mockup-placeholder", className)}>
        <Box className="size-8 opacity-35" aria-hidden />
        <p>O mockup será gerado quando o PDF da prova estiver pronto.</p>
      </div>
    );
  }

  const sortedFaces = config.faces
    .slice()
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  return (
    <div className={cn("proof-mockup-root", className)}>
      <div
        className="proof-mockup-perspective"
        style={{
          perspective: config.cena?.perspective ?? 1200,
          perspectiveOrigin: config.cena?.perspectiveOrigin ?? "50% 42%",
        }}
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
      >
        <div
          className={cn(
            "proof-mockup-card",
            hasFold && "proof-mockup-card--fold",
            config.vinco && `proof-mockup-card--vinco-${config.vinco.lado}`,
          )}
          style={{
            width: scenePx.width,
            height: scenePx.height,
            transform: buildSceneTransform(config, isHover),
          }}
        >
          {sortedFaces.map((face) => (
            <MockupFace
              key={face.id}
              face={face}
              config={config}
              pageUrl={resolvePageUrl(imagePages, face.pageIndex)}
              productW={scenePx.width}
              productH={scenePx.height}
              isHover={isHover}
              foldOpen={foldOpen}
            />
          ))}
        </div>
      </div>

      {isFallback && (
        <p className="proof-mockup-note proof-mockup-note--warn">
          Mockup genérico aplicado. Configure um mockup específico para este
          modelo.
        </p>
      )}
      {truncatedNotice && (
        <p className="proof-mockup-note">{truncatedNotice}</p>
      )}
    </div>
  );
}
