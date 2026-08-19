import { cn } from "@sagra/ui";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";



import { apiUrl } from "@/api/client";



import {

  applyPreviewTemplateRuns,

  getGroupedElementIds,

  nearestPreviewPositionSlot,

  resolveSvgTextPosition,

  type PapelariaPreviewConfig,

  type PapelariaPreviewFace,

  type PreviewPositionSlotId,

} from "../preview";

import "./PapelariaLivePreview.css";



export type PapelariaLivePreviewProps = {

  previewConfig: PapelariaPreviewConfig;

  values: Record<string, string>;

  modeloId: number;

  faceId?: string;

  className?: string;

  mode?: "form" | "admin" | "mockup-texture";

  showDisclaimer?: boolean;

  /** Exibe borda do canvas e caixas dos campos (padrão: admin). */

  showGuides?: boolean;

  /** Força recarregar a imagem base após upload (cache bust). */
  baseImageVersion?: number;
  /** Arrastar campos na grade 3×3 (admin). */
  editablePositions?: boolean;
  /** Slots permitidos por elemento (restrição do template). */
  allowedSlotsByElement?: Record<string, PreviewPositionSlotId[]>;
  onElementSlotChange?: (
    faceId: string,
    elementIds: string[],
    slotId: PreviewPositionSlotId,
  ) => void;
  /** URL customizada da imagem base (ex.: portal com token). */
  resolvePreviewBaseUrl?: (faceId: string) => string;
};



function previewBaseUrl(

  modeloId: number,

  faceId: string,

  baseImageVersion?: number,

): string {

  const base = apiUrl(`/papelaria/modelos/${modeloId}/preview-base/${faceId}`);

  if (!baseImageVersion) return base;

  return `${base}?v=${baseImageVersion}`;

}



type FaceCanvasProps = {

  face: PapelariaPreviewFace;

  values: Record<string, string>;

  modeloId: number;

  canvasW: number;

  canvasH: number;

  showGuides: boolean;
  baseImageVersion?: number;
  editablePositions?: boolean;
  allowedSlotsByElement?: Record<string, PreviewPositionSlotId[]>;
  previewConfig?: PapelariaPreviewConfig;
  onElementSlotChange?: (
    faceId: string,
    elementIds: string[],
    slotId: PreviewPositionSlotId,
  ) => void;
  resolvePreviewBaseUrl?: (faceId: string) => string;
};



function PapelariaLivePreviewFaceCanvas({

  face,

  values,

  modeloId,

  canvasW,

  canvasH,

  showGuides,

  baseImageVersion,
  editablePositions,
  allowedSlotsByElement,
  previewConfig,
  onElementSlotChange,
  resolvePreviewBaseUrl,
}: FaceCanvasProps) {
  const [baseImageError, setBaseImageError] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [dragElementId, setDragElementId] = useState<string | null>(null);
  const usesTokenFetch = Boolean(resolvePreviewBaseUrl);
  const [fetchingBase, setFetchingBase] = useState(usesTokenFetch);
  const directBaseUrl = usesTokenFetch
    ? null
    : previewBaseUrl(modeloId, face.id, baseImageVersion);
  const tokenBaseUrl = usesTokenFetch ? resolvePreviewBaseUrl!(face.id) : null;

  const canvasAspect = canvasW / canvasH;

  const previewVars = {

    "--preview-aspect": `${canvasW} / ${canvasH}`,

    "--preview-ar": String(canvasAspect),

  } as CSSProperties;



  useEffect(() => {
    if (!usesTokenFetch || !tokenBaseUrl) {
      setBlobUrl(null);
      setFetchingBase(false);
      setBaseImageError(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setBaseImageError(false);
    setBlobUrl(null);
    setFetchingBase(true);

    void fetch(tokenBaseUrl, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        return res.blob();
      })
      .then((blob) => {
        const imageBlob = blob.type.startsWith("image/")
          ? blob
          : new Blob([blob], { type: "image/png" });
        objectUrl = URL.createObjectURL(imageBlob);
        if (!cancelled) {
          setBlobUrl(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBaseImageError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFetchingBase(false);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [usesTokenFetch, tokenBaseUrl, face.id, baseImageVersion]);

  useEffect(() => {
    if (!usesTokenFetch) {
      setBaseImageError(false);
    }
  }, [usesTokenFetch, directBaseUrl]);



  const imgSrc = usesTokenFetch ? blobUrl : directBaseUrl;
  const showMissing = baseImageError || (usesTokenFetch && !fetchingBase && !imgSrc);
  const showLoading = usesTokenFetch && fetchingBase && !imgSrc && !baseImageError;

  const handleElementPointerUp = (
    elementId: string,
    clientX: number,
    clientY: number,
    svgEl: SVGSVGElement,
  ) => {
    if (!editablePositions || !onElementSlotChange || !previewConfig) return;
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return;
    const svgPt = pt.matrixTransform(ctm.inverse());
    const slotId = nearestPreviewPositionSlot(
      svgPt.x,
      svgPt.y,
      canvasW,
      canvasH,
      allowedSlotsByElement?.[elementId],
    );
    const grouped = getGroupedElementIds(previewConfig, elementId);
    onElementSlotChange(face.id, grouped, slotId);
    setDragElementId(null);
  };

  return (

    <div className="papelaria-live-preview__face-stage" style={previewVars}>

      <div className="papelaria-live-preview__canvas">

        {showLoading ? (
          <div className="papelaria-live-preview__base papelaria-live-preview__base--loading">
            <Loader2 className="size-6 animate-spin text-neutral-400" aria-hidden />
          </div>
        ) : showMissing ? (

          <div

            className="papelaria-live-preview__base papelaria-live-preview__base--missing"

            role="img"

            aria-label={`Imagem base indisponível (${face.nome ?? face.id})`}

          >

            <span>

              Imagem base indisponível

              <br />

              <span className="text-[10px] opacity-80">

                {usesTokenFetch
                  ? "A equipe gráfica configurará o fundo na nova prova."
                  : "Envie PNG/JPG (somente gráficos fixos) em Configurações"}

              </span>

            </span>

          </div>

        ) : imgSrc ? (

          <img

            src={imgSrc}

            alt={face.nome ?? face.id}

            className="papelaria-live-preview__base"

            draggable={false}

            onError={() => setBaseImageError(true)}

          />

        ) : null}

        <svg

          className="papelaria-live-preview__svg"

          viewBox={`0 0 ${canvasW} ${canvasH}`}

          preserveAspectRatio="xMidYMid meet"

          aria-hidden
          onPointerUp={(e) => {
            if (dragElementId) {
              handleElementPointerUp(
                dragElementId,
                e.clientX,
                e.clientY,
                e.currentTarget,
              );
            }
          }}

        >

          {showGuides ? (

            <rect

              x={0.5}

              y={0.5}

              width={canvasW - 1}

              height={canvasH - 1}

              fill="none"

              stroke="#94a3b8"

              strokeWidth={1}

              vectorEffect="non-scaling-stroke"

            />

          ) : null}

          {showGuides

            ? (face.elementos ?? []).map((el) => {

                if (el.tipo !== "texto") return null;

                const isDragging = dragElementId === el.id;

                return (

                  <rect

                    key={`guide-${el.id}`}

                    x={el.x}

                    y={el.y}

                    width={el.width}

                    height={el.height}

                    fill={isDragging ? "rgba(96,165,250,0.15)" : "none"}

                    stroke={isDragging ? "#2563eb" : "#60a5fa"}

                    strokeWidth={1}

                    strokeDasharray="4 3"

                    opacity={0.85}

                    vectorEffect="non-scaling-stroke"
                    style={editablePositions && (el.dinamico || allowedSlotsByElement?.[el.id]) ? { cursor: "grab" } : undefined}
                    onPointerDown={
                      editablePositions && (el.dinamico || allowedSlotsByElement?.[el.id])
                        ? (e) => {
                            e.preventDefault();
                            setDragElementId(el.id);
                            e.currentTarget.setPointerCapture(e.pointerId);
                          }
                        : undefined
                    }

                  />

                );

              })

            : null}

          {(face.elementos ?? []).map((el) => {

            if (el.tipo !== "texto") return null;

            const lineRuns = applyPreviewTemplateRuns(el.template ?? "", values);

            const pos = resolveSvgTextPosition(el);

            const lineHeight = (el.lineHeight ?? 1.15) * el.fontSize;

            const letterSpacing =

              el.letterSpacing !== undefined ? `${el.letterSpacing}px` : undefined;

            const baseWeight = el.fontWeight ?? 400;


            return (

              <text

                key={el.id}

                x={pos.x}

                y={pos.y}

                fill={el.color ?? "#111827"}

                fontFamily={el.fontFamily ?? "Arial, sans-serif"}

                fontSize={el.fontSize}

                fontWeight={baseWeight}

                fontStyle={el.fontStyle ?? "normal"}

                textAnchor={pos.textAnchor}

                dominantBaseline={pos.dominantBaseline}

                letterSpacing={letterSpacing}

              >

                {lineRuns.map((runs, idx) => (

                  <tspan key={idx} x={pos.x} dy={idx === 0 ? 0 : lineHeight}>

                    {runs.map((run, ridx) => (

                      <tspan

                        key={ridx}

                        fontWeight={run.bold ? 700 : baseWeight}

                      >

                        {run.text || (runs.length === 1 ? "\u00A0" : "")}

                      </tspan>

                    ))}

                  </tspan>

                ))}

              </text>

            );

          })}

        </svg>

      </div>

    </div>

  );

}



export function PapelariaLivePreview({

  previewConfig,

  values,

  modeloId,

  faceId,

  className,

  mode = "form",

  showDisclaimer = mode !== "mockup-texture",

  showGuides = mode === "admin",

  baseImageVersion,
  editablePositions,
  allowedSlotsByElement,
  onElementSlotChange,
  resolvePreviewBaseUrl,
}: PapelariaLivePreviewProps) {

  const faces = useMemo(() => {

    const all = previewConfig.faces ?? [];

    if (faceId) {

      const selected = all.find((f) => f.id === faceId) ?? all[0];

      return selected ? [selected] : [];

    }

    return all;

  }, [previewConfig.faces, faceId]);



  const canvasW = previewConfig.canvas.width;

  const canvasH = previewConfig.canvas.height;

  const showSideBySide = !faceId && faces.length > 1;



  if (faces.length === 0) {

    return (

      <p className="p-4 text-center text-xs text-neutral-500">

        Nenhuma face configurada na prévia.

      </p>

    );

  }



  return (

    <div

      className={cn(

        "papelaria-live-preview",

        mode === "admin" && "papelaria-live-preview--admin",

        showSideBySide && "papelaria-live-preview--side-by-side",

        className,

      )}

    >

      <div

        className={cn(

          "papelaria-live-preview__stage",

          showSideBySide && "papelaria-live-preview__stage--multi",

        )}

      >

        {faces.map((face) => (

          <div key={face.id} className="papelaria-live-preview__face-column">

            {showSideBySide ? (

              <p className="papelaria-live-preview__face-label">

                {face.nome ?? face.id}

              </p>

            ) : null}

            <PapelariaLivePreviewFaceCanvas

              face={face}

              values={values}

              modeloId={modeloId}

              canvasW={canvasW}

              canvasH={canvasH}

              showGuides={showGuides || Boolean(editablePositions)}

              baseImageVersion={baseImageVersion}
              editablePositions={editablePositions}
              allowedSlotsByElement={allowedSlotsByElement}
              previewConfig={previewConfig}
              onElementSlotChange={onElementSlotChange}

              resolvePreviewBaseUrl={resolvePreviewBaseUrl}

            />

          </div>

        ))}

      </div>

      {showDisclaimer ? (

        <p className="papelaria-live-preview__disclaimer">

          Prévia aproximada. A prova final será gerada pelo CorelDRAW.

        </p>

      ) : null}

    </div>

  );

}

