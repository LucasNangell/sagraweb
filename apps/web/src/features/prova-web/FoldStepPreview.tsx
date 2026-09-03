import { useEffect, useMemo, useRef, useState } from "react";

import type {
  FoldOperation,
  ProvaWebFoldMockupMeta,
  ProvaWebFolhetoCrop,
} from "@/api/provaWeb";

import {
  createFoldScene,
  DEFAULT_ROT_X,
  DEFAULT_ROT_Y,
  type FoldSceneHandle,
} from "./fold-engine";
import type { FoldTopology } from "./fold-engine/foldTypes";
import { hasBlockingErrors, validateFoldDefinition } from "./fold-engine";
import { toSheetDefinition } from "./provaWebFoldPresets";

export type FoldStepPreviewProps = {
  folheto: Pick<
    ProvaWebFolhetoCrop,
    | "preset"
    | "creases"
    | "operations"
    | "physical"
    | "backArtworkTransform"
  >;
  topology: FoldTopology;
  usable: { w: number; h: number };
  /** Ops com order <= stepOrder ficam fechadas na prévia. */
  stepOrder: number;
  /** Data URL da área útil (frente) — mesma arte do esquema. */
  frontDataUrl?: string | null;
  /** Raster ainda carregando. */
  artLoading?: boolean;
  className?: string;
};

/** Progresso: fechado (0) até stepOrder; aberto (1) depois. */
export function progressThroughStepOrder(
  operations: FoldOperation[],
  stepOrder: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of operations) {
    out.set(o.id, o.order <= stepOrder ? 0 : 1);
  }
  return out;
}

function buildPreviewMeta(
  folheto: FoldStepPreviewProps["folheto"],
  topology: FoldTopology,
  usable: { w: number; h: number },
): ProvaWebFoldMockupMeta {
  return {
    preset: folheto.preset,
    pageWidthMm: usable.w,
    pageHeightMm: usable.h,
    panels: topology.panels.map((p) => ({
      id: p.id,
      row: p.row,
      column: p.column,
      xMm: p.xMm,
      yMm: p.yMm,
      wMm: p.widthMm,
      hMm: p.heightMm,
    })),
    creases: folheto.creases,
    operations: folheto.operations,
    // Prévia de passo: só frente. O verso entra no mockup final.
    hasVerso: false,
    backArtworkTransform: folheto.backArtworkTransform,
    physical: folheto.physical,
    ready: true,
  };
}

/**
 * Mini prévia 3D do estado após fechar as dobras 1…stepOrder,
 * com a arte da frente do PDF nos painéis (como ficará após a dobra).
 */
export function FoldStepPreview({
  folheto,
  topology,
  usable,
  stepOrder,
  frontDataUrl = null,
  artLoading = false,
  className,
}: FoldStepPreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<FoldSceneHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const def = useMemo(
    () => toSheetDefinition(folheto, usable.w, usable.h),
    [folheto, usable.w, usable.h],
  );
  const blocking = useMemo(
    () => hasBlockingErrors(validateFoldDefinition(def)),
    [def],
  );

  const metaKey = useMemo(
    () =>
      JSON.stringify({
        w: usable.w,
        h: usable.h,
        creases: folheto.creases,
        operations: folheto.operations,
        physical: folheto.physical,
        hasFront: Boolean(frontDataUrl),
        frontLen: frontDataUrl?.length ?? 0,
        frontHead: frontDataUrl?.slice(-24) ?? null,
      }),
    [
      folheto.creases,
      folheto.operations,
      folheto.physical,
      usable.w,
      usable.h,
      frontDataUrl,
    ],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || blocking) {
      setReady(false);
      setError(blocking ? "Configuração inválida" : null);
      return;
    }
    if (artLoading) {
      setReady(false);
      return;
    }

    let cancelled = false;
    setReady(false);
    setError(null);

    void (async () => {
      try {
        sceneRef.current?.dispose();
        sceneRef.current = null;
        const meta = buildPreviewMeta(folheto, topology, usable);
        const handle = await createFoldScene(
          canvas,
          meta,
          frontDataUrl,
          null,
          {
            colorMode: "faithful",
            maxPixelRatio: 1.5,
            fitPadding: 1.12,
          },
        );
        if (cancelled) {
          handle.dispose();
          return;
        }
        sceneRef.current = handle;
        handle.setOrbit(DEFAULT_ROT_X * 0.85, DEFAULT_ROT_Y * 0.9);
        handle.setProgressByOp(
          progressThroughStepOrder(folheto.operations, stepOrder),
        );
        const rect = stage.getBoundingClientRect();
        handle.resize(Math.max(1, rect.width), Math.max(1, rect.height));
        handle.fitView();
        handle.requestRender();
        handle.render();
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Falha na prévia");
          setReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- metaKey captura geometria+arte
  }, [metaKey, blocking, artLoading]);

  useEffect(() => {
    const handle = sceneRef.current;
    if (!handle || !ready) return;
    handle.setProgressByOp(
      progressThroughStepOrder(folheto.operations, stepOrder),
    );
    handle.requestRender();
    handle.render();
  }, [stepOrder, folheto.operations, ready]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => {
      const handle = sceneRef.current;
      if (!handle) return;
      const rect = stage.getBoundingClientRect();
      handle.resize(Math.max(1, rect.width), Math.max(1, rect.height));
      handle.requestRender();
      handle.render();
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [ready]);

  if (blocking) {
    return (
      <p className="rounded-lg border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        Prévia indisponível até corrigir erros da dobra.
      </p>
    );
  }

  const waitingArt = artLoading && !frontDataUrl;

  return (
    <div
      className={
        className ??
        "overflow-hidden rounded-xl border border-sagra-border bg-[#c5d0dc]"
      }
    >
      <div className="flex items-center justify-between border-b border-black/5 bg-white/70 px-2 py-1">
        <span className="text-[10px] font-medium text-neutral-600">
          Prévia após fechar até a {stepOrder}ª dobra
          {frontDataUrl ? " · arte do PDF" : ""}
        </span>
        {error && (
          <span className="text-[10px] text-sagra-danger">{error}</span>
        )}
      </div>
      <div ref={stageRef} className="relative h-[200px] w-full">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 size-full"
          aria-label={`Prévia 3D após ${stepOrder} dobra(s)`}
        />
        {(!ready || waitingArt) && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-600">
            {waitingArt ? "Carregando arte…" : "Montando prévia…"}
          </div>
        )}
      </div>
    </div>
  );
}
