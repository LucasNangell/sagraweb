import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { BoxModelConfig } from "@/api/boxModels";

import {
  createBoxScene,
  type BoxSceneHandle,
} from "@/features/prova-web/box-engine";
import { boxMockupFromConfig } from "@/features/prova-web/box-engine/boxMockupFromConfig";

/** Vista inicial: quase de cima (faca plana). */
const DEFAULT_ORBIT = { x: 68, y: 0 };

/**
 * Slider: 0 = Aberto (plano), 100 = Fechado (ângulos-alvo).
 * Scene open01: 1 = plano, 0 = dobrado.
 */
function foldPctToOpen01(foldPct: number): number {
  return 1 - Math.max(0, Math.min(100, foldPct)) / 100;
}

export function BoxModelPreview3D({ config }: { config: BoxModelConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [foldPct, setFoldPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<BoxSceneHandle | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let handle: BoxSceneHandle | null = null;
    setError(null);
    setFoldPct(0);
    void (async () => {
      try {
        const mockup = boxMockupFromConfig(config);
        handle = await createBoxScene(canvas, mockup, null);
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        handle.setOrbit(DEFAULT_ORBIT.x, DEFAULT_ORBIT.y);
        handle.setOpen01(foldPctToOpen01(0));
        handle.setZoom(1);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Falha no preview 3D.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      handle?.dispose();
      handleRef.current = null;
    };
  }, [config]);

  useEffect(() => {
    handleRef.current?.setOpen01(foldPctToOpen01(foldPct));
  }, [foldPct]);

  const resetView = () => {
    setFoldPct(0);
    handleRef.current?.setOrbit(DEFAULT_ORBIT.x, DEFAULT_ORBIT.y);
    handleRef.current?.setOpen01(foldPctToOpen01(0));
    handleRef.current?.setZoom(1);
    handleRef.current?.fitView();
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-700">Preview 3D</p>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100"
          onClick={resetView}
          title="Vista de cima, aberto"
        >
          <RotateCcw className="size-3" aria-hidden />
          Resetar vista
        </button>
      </div>
      <div className="relative h-56 cursor-grab overflow-hidden rounded bg-white active:cursor-grabbing">
        <canvas ref={canvasRef} className="size-full" />
        {error ? (
          <p className="absolute inset-0 flex items-center justify-center p-2 text-center text-[11px] text-red-600">
            {error}
          </p>
        ) : (
          <p className="pointer-events-none absolute bottom-1 left-0 right-0 text-center text-[10px] text-slate-400">
            Arraste para girar · confira as dobras de outros ângulos
          </p>
        )}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-slate-600">
        <span className="shrink-0">Aberto</span>
        <input
          type="range"
          min={0}
          max={100}
          value={foldPct}
          onChange={(e) => setFoldPct(Number(e.target.value))}
          className="flex-1"
          aria-label="Aberto (plano) até Fechado (dobrado)"
        />
        <span className="shrink-0">Fechado</span>
        <span className="w-8 tabular-nums text-slate-500">{foldPct}%</span>
      </label>
      <p className="text-[10px] text-slate-500">
        Aberto = faca plana (sem dobra). Arraste o slider para fechar na sequência.
      </p>
    </div>
  );
}
