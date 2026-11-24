import { cn } from "@sagra/ui";
import { Box } from "lucide-react";
import { useId, useMemo, useState } from "react";

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
  resolverBolso,
  sceneDimensionsPx,
} from "../mockup";
import { encaixarCartao } from "../mockup/bolsoInterno";
import type { PapelariaMockupBolsoConfig, PapelariaMockupConfig } from "../mockup";
import "./PapelariaProofMockup3D.css";

export type PapelariaProofMockup3DProps = {
  pages: string[];
  config: PapelariaMockupConfig;
  isFallback?: boolean;
  className?: string;
  /** Referência em px para dimensionar a cena (padrão da Papelaria). */
  sceneBasePx?: number;
};

/**
 * Bolso interno sobre a face: papel um pouco mais claro que a base, sombra
 * fina projetada acima da boca, as fendas como cortes no papel e um cartão de
 * visita genérico encaixado nelas (cantos escondidos atrás das fendas).
 */
export function MockupBolso({ bolso }: { bolso: PapelariaMockupBolsoConfig }) {
  const id = useId().replace(/:/g, "");
  const boca = bolso.boca ?? bolso.contorno;
  const W = bolso.larguraMm ?? 100;
  const H = bolso.alturaMm ?? 100;
  const sx = W / 100;
  const sy = H / 100;
  const cortesMm = (bolso.cortes ?? []).map(
    ([x1, y1, x2, y2]) => [x1 * sx, y1 * sy, x2 * sx, y2 * sy] as [number, number, number, number],
  );
  const cartao = bolso.cartao
    ? encaixarCartao(cortesMm, bolso.cartao.larguraMm ?? 90, bolso.cartao.alturaMm ?? 50)
    : null;
  const textoCartao = bolso.cartao ? (bolso.cartao.texto ?? "Cartão de Visita") : "";
  // Espessura visual do corte (mm): a borda de cima faz sombra, a de baixo brilha.
  const folga = 0.45;

  return (
    <svg
      className="mockup-bolso"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      data-testid="mockup-bolso"
    >
      <defs>
        <linearGradient id={`${id}-papel`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e7e8ea" />
          <stop offset="0.12" stopColor={bolso.cor ?? "#f7f7f6"} />
          <stop offset="1" stopColor={bolso.cor ?? "#fcfcfb"} />
        </linearGradient>
        <filter id={`${id}-sombra`} x="-5%" y="-20%" width="110%" height="140%">
          <feDropShadow dx="0" dy="-1.2" stdDeviation="1.6" floodColor="#0f172a" floodOpacity="0.22" />
        </filter>
        <filter id={`${id}-sombra-cartao`} x="-10%" y="-20%" width="120%" height="150%">
          <feDropShadow dx="0.6" dy="1" stdDeviation="1" floodColor="#0f172a" floodOpacity="0.2" />
        </filter>
        {cartao ? (
          // Esconde os cantos do cartão que passam por trás das fendas.
          <mask id={`${id}-encaixe`} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
            <rect x="0" y="0" width={W} height={H} fill="#fff" />
            {cartao.fendas.map(({ a, b, canto }, i) => {
              const k = 40;
              const pts = [a, b, [b[0] + canto[0] * k, b[1] + canto[1] * k], [a[0] + canto[0] * k, a[1] + canto[1] * k]];
              return <polygon key={i} points={pts.map((p) => p.join(",")).join(" ")} fill="#000" />;
            })}
          </mask>
        ) : null}
        {cartao ? (
          // Só os cantos escondidos: marcam de leve o volume do cartão sob o papel.
          <mask id={`${id}-cantos`} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
            <rect x="0" y="0" width={W} height={H} fill="#000" />
            {cartao.fendas.map(({ a, b, canto }, i) => {
              const k = 40;
              const pts = [a, b, [b[0] + canto[0] * k, b[1] + canto[1] * k], [a[0] + canto[0] * k, a[1] + canto[1] * k]];
              return <polygon key={i} points={pts.map((p) => p.join(",")).join(" ")} fill="#fff" />;
            })}
          </mask>
        ) : null}
      </defs>

      <g transform={`scale(${sx} ${sy})`}>
        <path d={bolso.contorno} fill={`url(#${id}-papel)`} filter={`url(#${id}-sombra)`} />
        <path d={boca} fill="none" stroke="#c9cbcf" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </g>

      {cartao ? (
        <g mask={`url(#${id}-cantos)`}>
          <rect
            x={-cartao.largura / 2}
            y={-cartao.altura / 2}
            width={cartao.largura}
            height={cartao.altura}
            transform={`translate(${cartao.cx} ${cartao.cy}) rotate(${cartao.rotacaoGraus})`}
            fill="#0f172a"
            fillOpacity={0.045}
          />
        </g>
      ) : null}

      {cartao ? (
        <g mask={`url(#${id}-encaixe)`} data-testid="mockup-bolso-cartao">
          <g
            transform={`translate(${cartao.cx} ${cartao.cy}) rotate(${cartao.rotacaoGraus})`}
            filter={`url(#${id}-sombra-cartao)`}
          >
            <rect
              x={-cartao.largura / 2}
              y={-cartao.altura / 2}
              width={cartao.largura}
              height={cartao.altura}
              rx={0.8}
              fill="#ffffff"
              stroke="#d4d6da"
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={0}
              y={0}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={cartao.altura * 0.16}
              fontFamily="system-ui, -apple-system, 'Segoe UI', Arial, sans-serif"
              fontWeight={600}
              fill="#475569"
            >
              {textoCartao}
            </text>
          </g>
        </g>
      ) : null}

      {/* Fendas: corte no papel — sombra na borda de cima, brilho na de baixo. */}
      {cortesMm.map(([x1, y1, x2, y2], i) => {
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const nx = -(y2 - y1) / len;
        const ny = (x2 - x1) / len;
        return (
          <g key={i} data-testid="mockup-bolso-corte">
            <line
              x1={x1 - nx * folga}
              y1={y1 - ny * folga}
              x2={x2 - nx * folga}
              y2={y2 - ny * folga}
              stroke="#0f172a"
              strokeOpacity={0.28}
              strokeWidth={1.6}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={x1 + nx * folga}
              y1={y1 + ny * folga}
              x2={x2 + nx * folga}
              y2={y2 + ny * folga}
              stroke="#ffffff"
              strokeOpacity={0.95}
              strokeWidth={1.2}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}

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
  const bolso = resolverBolso(face);

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
    >
      {bolso ? <MockupBolso bolso={bolso} /> : null}
    </div>
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
