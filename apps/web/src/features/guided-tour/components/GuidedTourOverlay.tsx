import { cn } from "@sagra/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useOsSelectionStore } from "@/features/os/osSelectionStore";
import { homeTestIds } from "@/lib/testId";

import { getTour } from "../catalog";
import { queryTourTarget } from "../tourDom";
import {
  computePopoverPosition,
  inflateHole,
  type TourArrowSide,
  type TourHole,
} from "../tourLayout";
import { useGuidedTourStore } from "../tourStore";
import type { TourStep } from "../types";

const POPOVER_WIDTH = 320;

function arrowClass(side: TourArrowSide): string {
  if (side === "none") {
    return "hidden";
  }
  const base =
    "absolute size-0 border-solid border-transparent";
  if (side === "top") {
    return cn(
      base,
      "left-1/2 top-0 -translate-x-1/2 -translate-y-full border-x-8 border-b-8 border-x-transparent border-b-white",
    );
  }
  if (side === "bottom") {
    return cn(
      base,
      "bottom-0 left-1/2 -translate-x-1/2 translate-y-full border-x-8 border-t-8 border-x-transparent border-t-white",
    );
  }
  if (side === "left") {
    return cn(
      base,
      "left-0 top-1/2 -translate-x-full -translate-y-1/2 border-y-8 border-r-8 border-y-transparent border-r-white",
    );
  }
  return cn(
    base,
    "right-0 top-1/2 -translate-y-1/2 translate-x-full border-y-8 border-l-8 border-y-transparent border-l-white",
  );
}

function SpotlightPanes({ hole }: { hole: TourHole | null }) {
  if (!hole) {
    return (
      <div className="pointer-events-auto fixed inset-0 z-[200] bg-black/60" aria-hidden />
    );
  }

  const t = hole.top;
  const l = hole.left;
  const w = hole.width;
  const h = hole.height;
  const r = l + w;
  const b = t + h;

  return (
    <>
      <div
        className="pointer-events-auto fixed z-[200] bg-black/60"
        style={{ top: 0, left: 0, right: 0, height: Math.max(0, t) }}
        aria-hidden
      />
      <div
        className="pointer-events-auto fixed z-[200] bg-black/60"
        style={{ top: t, left: 0, width: Math.max(0, l), height: h }}
        aria-hidden
      />
      <div
        className="pointer-events-auto fixed z-[200] bg-black/60"
        style={{ top: t, left: r, right: 0, height: h }}
        aria-hidden
      />
      <div
        className="pointer-events-auto fixed z-[200] bg-black/60"
        style={{ top: b, left: 0, right: 0, bottom: 0 }}
        aria-hidden
      />
      <div
        className="pointer-events-none fixed z-[201] rounded-lg ring-2 ring-white shadow-[0_0_0_4px_rgba(37,99,235,0.35)]"
        style={{ top: t, left: l, width: w, height: h }}
        aria-hidden
      />
    </>
  );
}

function shouldSkipStep(step: TourStep): boolean {
  if (step.shouldSkip?.()) {
    return true;
  }
  if (step.target && step.skipIfMissingTarget && !queryTourTarget(step.target)) {
    return true;
  }
  return false;
}

export function GuidedTourOverlay() {
  const tourId = useGuidedTourStore((s) => s.tourId);
  const stepIndex = useGuidedTourStore((s) => s.stepIndex);
  const next = useGuidedTourStore((s) => s.next);
  const stop = useGuidedTourStore((s) => s.stop);
  const complete = useGuidedTourStore((s) => s.complete);
  const selectedOs = useOsSelectionStore((s) => s.selected);

  const tour = tourId ? getTour(tourId) : undefined;
  const step = tour?.steps[stepIndex];
  const isLast = Boolean(tour && stepIndex === tour.steps.length - 1);

  const popoverRef = useRef<HTMLDivElement>(null);
  const advancingRef = useRef(false);
  const skippedRef = useRef<string | null>(null);
  const [hole, setHole] = useState<TourHole | null>(null);
  const [popoverBox, setPopoverBox] = useState({
    top: 80,
    left: 24,
    arrowSide: "none" as TourArrowSide,
  });

  const measure = useCallback(() => {
    if (!step) {
      setHole(null);
      return;
    }
    const placement = step.placement ?? "bottom";
    const popoverEl = popoverRef.current;
    const popoverSize = {
      width: popoverEl?.offsetWidth || POPOVER_WIDTH,
      height: popoverEl?.offsetHeight || 180,
    };
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    if (!step.target || placement === "center") {
      setHole(null);
      setPopoverBox(
        computePopoverPosition(null, popoverSize, "center", viewport),
      );
      return;
    }

    const el = queryTourTarget(step.target);
    if (!el) {
      setHole(null);
      setPopoverBox(
        computePopoverPosition(null, popoverSize, "center", viewport),
      );
      return;
    }
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const nextHole = inflateHole(el.getBoundingClientRect());
    setHole(nextHole);
    setPopoverBox(
      computePopoverPosition(nextHole, popoverSize, placement, viewport),
    );
  }, [step]);

  useLayoutEffect(() => {
    measure();
  }, [measure, stepIndex, selectedOs]);

  useEffect(() => {
    if (!step) {
      return;
    }
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const interval = window.setInterval(measure, 250);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.clearInterval(interval);
    };
  }, [measure, step]);

  useEffect(() => {
    advancingRef.current = false;
    skippedRef.current = null;
  }, [stepIndex, tourId]);

  useEffect(() => {
    if (!step) {
      return;
    }
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled || skippedRef.current === step.id) {
          return;
        }
        if (shouldSkipStep(step)) {
          skippedRef.current = step.id;
          next();
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [step, next]);

  useEffect(() => {
    if (!step || (!step.waitUntil && !step.completeWhen)) {
      return;
    }
    const tick = () => {
      if (advancingRef.current) {
        return;
      }
      if (step.completeWhen?.()) {
        advancingRef.current = true;
        complete();
        return;
      }
      const ctx = { selectedOs: useOsSelectionStore.getState().selected };
      if (step.waitUntil?.(ctx)) {
        advancingRef.current = true;
        next();
      }
    };
    tick();
    const id = window.setInterval(tick, 200);
    const unsub = useOsSelectionStore.subscribe(tick);
    return () => {
      window.clearInterval(id);
      unsub();
    };
  }, [step, next, complete]);

  useEffect(() => {
    if (!step) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, stop]);

  if (typeof document === "undefined" || !tour || !step) {
    return null;
  }

  const ctx = { selectedOs };
  const body = step.waitingBody?.(ctx) ?? step.body;
  const showNext = step.advance === "next";
  const titleId = `guided-tour-title-${step.id}`;
  const bodyId = `guided-tour-body-${step.id}`;

  return createPortal(
    <div className="pointer-events-none">
      <SpotlightPanes hole={hole} />
      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="pointer-events-auto fixed z-[202] w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
        style={{ top: popoverBox.top, left: popoverBox.left }}
      >
        <span className={arrowClass(popoverBox.arrowSide)} aria-hidden />
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-secondary-blue">
          {tour.title} · {stepIndex + 1}/{tour.steps.length}
        </p>
        <h2 id={titleId} className="mt-1 text-sm font-bold text-neutral-900">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-2 text-sm leading-snug text-neutral-700">
          {body}
        </p>
        {step.advance === "wait" ? (
          <p className="mt-2 text-xs font-medium text-secondary-blue">
            Faça esta ação para continuar.
          </p>
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={stop}
            className="rounded px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-slate-50"
            data-testid={homeTestIds.guidedTourExit}
          >
            Sair
          </button>
          {showNext ? (
            <button
              type="button"
              onClick={isLast ? complete : next}
              className="rounded bg-primary-green px-3 py-1.5 text-xs font-semibold text-white"
              data-testid={homeTestIds.guidedTourNext}
            >
              {isLast ? "Concluir" : "Próximo"}
            </button>
          ) : (
            <span />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
