import { useEffect, useRef, useState } from "react";

import type { BoxModelConfig } from "@/api/boxModels";

import {
  createBoxScene,
  type BoxSceneHandle,
} from "@/features/prova-web/box-engine";
import { boxMockupFromConfig } from "@/features/prova-web/box-engine/boxMockupFromConfig";

export function BoxModelPreview3D({ config }: { config: BoxModelConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [openPct, setOpenPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<BoxSceneHandle | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let handle: BoxSceneHandle | null = null;
    setError(null);
    void (async () => {
      try {
        const mockup = boxMockupFromConfig(config);
        handle = await createBoxScene(canvas, mockup, null);
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        handle.setOrbit(25, -35);
        handle.setOpen01(0);
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
    handleRef.current?.setOpen01(openPct / 100);
  }, [openPct]);

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <p className="text-[11px] font-semibold text-slate-700">Preview 3D</p>
      <div className="relative h-48 overflow-hidden rounded bg-white">
        <canvas ref={canvasRef} className="size-full" />
        {error ? (
          <p className="absolute inset-0 flex items-center justify-center p-2 text-center text-[11px] text-red-600">
            {error}
          </p>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-slate-600">
        Abrir
        <input
          type="range"
          min={0}
          max={100}
          value={openPct}
          onChange={(e) => setOpenPct(Number(e.target.value))}
          className="flex-1"
        />
      </label>
    </div>
  );
}
