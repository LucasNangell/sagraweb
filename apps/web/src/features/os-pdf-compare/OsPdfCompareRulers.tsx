import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export type GuideAxis = "x" | "y";
export type GuideScope = "page" | "all";

export interface GuideLine {
  id: string;
  axis: GuideAxis;
  mm: number;
  scope: GuideScope;
  /** Índice da página quando scope === "page". */
  pageIndex?: number;
}

interface OsPdfCompareRulersProps {
  pageWidthPx: number;
  pageHeightPx: number;
  displayWidth: number;
  displayHeight: number;
  dpi: number;
  pageIndex: number;
  guides: GuideLine[];
  onGuidesChange: (
    guides: GuideLine[] | ((prev: GuideLine[]) => GuideLine[]),
  ) => void;
  children: ReactNode;
}

const RULER_SIZE = 28;
const MM_PER_INCH = 25.4;

function pxToMm(px: number, dpi: number): number {
  if (!dpi) return 0;
  return (px / dpi) * MM_PER_INCH;
}

function mmToPx(mm: number, dpi: number): number {
  if (!dpi) return 0;
  return (mm / MM_PER_INCH) * dpi;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function fmtMm(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function nextId(): string {
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function isGuideVisibleOnPage(guide: GuideLine, pageIndex: number): boolean {
  return guide.scope === "all" || guide.pageIndex === pageIndex;
}

function buildTicks(maxMm: number, pxPerMm: number): {
  mm: number;
  major: boolean;
  label?: string;
}[] {
  if (maxMm <= 0 || pxPerMm <= 0) return [];
  let step = 1;
  if (pxPerMm < 1.2) step = 20;
  else if (pxPerMm < 2) step = 10;
  else if (pxPerMm < 4) step = 5;
  else if (pxPerMm < 8) step = 2;
  const majorEvery = step >= 10 ? step : step >= 5 ? 10 : 5;
  const ticks: { mm: number; major: boolean; label?: string }[] = [];
  for (let mm = 0; mm <= maxMm + 0.001; mm += step) {
    const value = Number(mm.toFixed(3));
    const major =
      value === 0 ||
      Math.abs(value % majorEvery) < 0.001 ||
      Math.abs(value - maxMm) < 0.05;
    ticks.push({
      mm: value,
      major,
      label: major ? fmtMm(value) : undefined,
    });
  }
  if (ticks.length === 0 || Math.abs(ticks[ticks.length - 1].mm - maxMm) > 0.05) {
    ticks.push({ mm: maxMm, major: true, label: fmtMm(maxMm) });
  }
  return ticks;
}

export function OsPdfCompareRulers({
  pageWidthPx,
  pageHeightPx,
  displayWidth,
  displayHeight,
  dpi,
  pageIndex,
  guides,
  onGuidesChange,
  children,
}: OsPdfCompareRulersProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftMm, setDraftMm] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** Escopo padrão das novas guias criadas na régua. */
  const [createScope, setCreateScope] = useState<GuideScope>("page");

  const pageWidthMm = pxToMm(pageWidthPx, dpi);
  const pageHeightMm = pxToMm(pageHeightPx, dpi);
  const scale = pageWidthPx > 0 ? displayWidth / pageWidthPx : 1;
  const pxPerMm = mmToPx(1, dpi) * scale;

  const visibleGuides = useMemo(
    () => guides.filter((g) => isGuideVisibleOnPage(g, pageIndex)),
    [guides, pageIndex],
  );

  const pageOnlyCount = useMemo(
    () =>
      guides.filter((g) => g.scope === "page" && g.pageIndex === pageIndex)
        .length,
    [guides, pageIndex],
  );

  const hTicks = useMemo(
    () => buildTicks(pageWidthMm, pxPerMm),
    [pageWidthMm, pxPerMm],
  );
  const vTicks = useMemo(
    () => buildTicks(pageHeightMm, pxPerMm),
    [pageHeightMm, pxPerMm],
  );

  const selected =
    visibleGuides.find((g) => g.id === selectedId) ||
    guides.find((g) => g.id === selectedId) ||
    null;

  useEffect(() => {
    if (!selectedId) return;
    const stillVisible = guides.some(
      (g) => g.id === selectedId && isGuideVisibleOnPage(g, pageIndex),
    );
    if (!stillVisible) {
      setSelectedId(null);
      setDraftMm("");
    }
  }, [guides, pageIndex, selectedId]);

  function selectGuide(guide: GuideLine) {
    setSelectedId(guide.id);
    setDraftMm(fmtMm(guide.mm));
  }

  function updateGuideMm(id: string, mm: number, axis?: GuideAxis) {
    const guideAxis =
      axis ||
      visibleGuides.find((g) => g.id === id)?.axis ||
      guides.find((g) => g.id === id)?.axis;
    if (!guideAxis) return;
    const max = guideAxis === "x" ? pageWidthMm : pageHeightMm;
    const next = clamp(mm, 0, max);
    onGuidesChange((prev) =>
      prev.map((g) => (g.id === id ? { ...g, mm: Number(next.toFixed(2)) } : g)),
    );
    if (selectedId === id) setDraftMm(fmtMm(next));
  }

  function removeGuide(id: string) {
    onGuidesChange((prev) => prev.filter((g) => g.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setDraftMm("");
    }
  }

  function setGuideScope(id: string, scope: GuideScope) {
    onGuidesChange((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        if (scope === "all") {
          return { ...g, scope: "all", pageIndex: undefined };
        }
        return { ...g, scope: "page", pageIndex };
      }),
    );
  }

  function applyPageGuidesToAll() {
    onGuidesChange((prev) =>
      prev.map((g) =>
        g.scope === "page" && g.pageIndex === pageIndex
          ? { ...g, scope: "all" as const, pageIndex: undefined }
          : g,
      ),
    );
  }

  function mmFromHorizontalClient(clientX: number, target: HTMLElement): number {
    const rect = target.getBoundingClientRect();
    return clamp((clientX - rect.left) / pxPerMm, 0, pageWidthMm);
  }

  function mmFromVerticalClient(clientY: number, target: HTMLElement): number {
    const rect = target.getBoundingClientRect();
    return clamp((rect.bottom - clientY) / pxPerMm, 0, pageHeightMm);
  }

  function createFromRuler(axis: GuideAxis, mm: number) {
    const guide: GuideLine = {
      id: nextId(),
      axis,
      mm: Number(
        clamp(mm, 0, axis === "x" ? pageWidthMm : pageHeightMm).toFixed(2),
      ),
      scope: createScope,
      pageIndex: createScope === "page" ? pageIndex : undefined,
    };
    onGuidesChange((prev) => [...prev, guide]);
    selectGuide(guide);
    setDraggingId(guide.id);
  }

  function onHRulerPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || pxPerMm <= 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    createFromRuler("x", mmFromHorizontalClient(e.clientX, e.currentTarget));
  }

  function onVRulerPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || pxPerMm <= 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    createFromRuler("y", mmFromVerticalClient(e.clientY, e.currentTarget));
  }

  function onRulerPointerMove(
    e: ReactPointerEvent<HTMLDivElement>,
    axis: GuideAxis,
  ) {
    if (!draggingId) return;
    const mm =
      axis === "x"
        ? mmFromHorizontalClient(e.clientX, e.currentTarget)
        : mmFromVerticalClient(e.clientY, e.currentTarget);
    updateGuideMm(draggingId, mm, axis);
  }

  function onRulerPointerUp() {
    setDraggingId(null);
  }

  function onGuidePointerDown(
    e: ReactPointerEvent<HTMLDivElement>,
    guide: GuideLine,
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    selectGuide(guide);
    setDraggingId(guide.id);
  }

  function onContentPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingId) return;
    const guide = visibleGuides.find((g) => g.id === draggingId);
    if (!guide) return;
    const mm =
      guide.axis === "x"
        ? mmFromHorizontalClient(e.clientX, e.currentTarget)
        : mmFromVerticalClient(e.clientY, e.currentTarget);
    updateGuideMm(draggingId, mm, guide.axis);
  }

  function applyDraft() {
    if (!selected) return;
    const parsed = Number(String(draftMm).replace(",", "."));
    if (!Number.isFinite(parsed)) {
      setDraftMm(fmtMm(selected.mm));
      return;
    }
    updateGuideMm(selected.id, parsed);
  }

  if (!displayWidth || !displayHeight || !dpi) {
    return <>{children}</>;
  }

  const frameStyle = {
    "--ruler-size": `${RULER_SIZE}px`,
    width: displayWidth + RULER_SIZE,
    height: displayHeight + RULER_SIZE,
  } as CSSProperties;

  return (
    <div className="os-pdf-ruler-shell">
      <div className="os-pdf-ruler-frame" style={frameStyle}>
        <div
          className="os-pdf-ruler-corner"
          title="Origem 0,0 no canto inferior esquerdo do arquivo"
        >
          mm
        </div>
        <div
          className="os-pdf-ruler os-pdf-ruler-h"
          onPointerDown={onHRulerPointerDown}
          onPointerMove={(e) => onRulerPointerMove(e, "x")}
          onPointerUp={onRulerPointerUp}
          onPointerCancel={onRulerPointerUp}
          title="Clique e arraste para criar guia vertical"
        >
          <span
            className="os-pdf-ruler-limit-band"
            style={{ left: 0, width: Math.max(0, pageWidthMm * pxPerMm) }}
            aria-hidden
          />
          {hTicks.map((tick) => (
            <span
              key={`h-${tick.mm}`}
              className={
                "os-pdf-ruler-tick" +
                (tick.major ? " major" : "") +
                (tick.mm === 0 || Math.abs(tick.mm - pageWidthMm) < 0.05
                  ? " limit"
                  : "")
              }
              style={{ left: tick.mm * pxPerMm }}
            >
              {tick.label ? <em>{tick.label}</em> : null}
            </span>
          ))}
        </div>
        <div
          className="os-pdf-ruler os-pdf-ruler-v"
          onPointerDown={onVRulerPointerDown}
          onPointerMove={(e) => onRulerPointerMove(e, "y")}
          onPointerUp={onRulerPointerUp}
          onPointerCancel={onRulerPointerUp}
          title="Clique e arraste para criar guia horizontal"
        >
          <span
            className="os-pdf-ruler-limit-band vertical"
            style={{ bottom: 0, height: Math.max(0, pageHeightMm * pxPerMm) }}
            aria-hidden
          />
          {vTicks.map((tick) => (
            <span
              key={`v-${tick.mm}`}
              className={
                "os-pdf-ruler-tick" +
                (tick.major ? " major" : "") +
                (tick.mm === 0 || Math.abs(tick.mm - pageHeightMm) < 0.05
                  ? " limit"
                  : "")
              }
              style={{ bottom: tick.mm * pxPerMm }}
            >
              {tick.label ? <em>{tick.label}</em> : null}
            </span>
          ))}
        </div>

        <div
          className="os-pdf-ruler-content"
          style={{ width: displayWidth, height: displayHeight }}
          onPointerMove={onContentPointerMove}
          onPointerUp={onRulerPointerUp}
          onPointerCancel={onRulerPointerUp}
        >
          {children}
          {visibleGuides.map((guide) => {
            const style: CSSProperties =
              guide.axis === "x"
                ? { left: guide.mm * pxPerMm }
                : { bottom: guide.mm * pxPerMm };
            return (
              <div
                key={guide.id}
                className={
                  "os-pdf-guide" +
                  (guide.axis === "x" ? " vertical" : " horizontal") +
                  (guide.scope === "all" ? " global" : "") +
                  (selectedId === guide.id ? " selected" : "")
                }
                style={style}
                onPointerDown={(e) => onGuidePointerDown(e, guide)}
                onPointerMove={(e) => {
                  if (!draggingId || draggingId !== guide.id) return;
                  const content = e.currentTarget.parentElement;
                  if (!content) return;
                  const mm =
                    guide.axis === "x"
                      ? mmFromHorizontalClient(e.clientX, content)
                      : mmFromVerticalClient(e.clientY, content);
                  updateGuideMm(guide.id, mm, guide.axis);
                }}
                onPointerUp={onRulerPointerUp}
                onPointerCancel={onRulerPointerUp}
                title={`${guide.axis === "x" ? "X" : "Y"} = ${fmtMm(guide.mm)} mm · ${
                  guide.scope === "all" ? "todas as páginas" : "esta página"
                }`}
              >
                <span className="os-pdf-guide-label">{fmtMm(guide.mm)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className={"os-pdf-guide-editor" + (selected ? "" : " idle")}>
        <div className="os-pdf-guide-scope" role="group" aria-label="Escopo das guias">
          <button
            type="button"
            className={createScope === "page" ? "active" : ""}
            onClick={() => setCreateScope("page")}
            title="Novas guias valem só nesta página"
          >
            Página atual
          </button>
          <button
            type="button"
            className={createScope === "all" ? "active" : ""}
            onClick={() => setCreateScope("all")}
            title="Novas guias valem em todas as páginas"
          >
            Todas as páginas
          </button>
          {pageOnlyCount > 0 ? (
            <button
              type="button"
              className="os-pdf-guide-promote"
              onClick={applyPageGuidesToAll}
              title="Converte as guias só desta página para o documento inteiro"
            >
              Aplicar guias da página a todas
            </button>
          ) : null}
        </div>

        {selected ? (
          <>
            <label>
              {selected.axis === "x" ? "Guia X" : "Guia Y"} (mm)
              <input
                type="number"
                min={0}
                max={
                  selected.axis === "x"
                    ? Number(pageWidthMm.toFixed(2))
                    : Number(pageHeightMm.toFixed(2))
                }
                step={0.1}
                value={draftMm}
                onChange={(e) => setDraftMm(e.target.value)}
                onBlur={applyDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyDraft();
                  }
                }}
              />
            </label>
            <label className="os-pdf-guide-all-check">
              <input
                type="checkbox"
                checked={selected.scope === "all"}
                onChange={(e) =>
                  setGuideScope(selected.id, e.target.checked ? "all" : "page")
                }
              />
              Em todas as páginas
            </label>
            <button type="button" onClick={applyDraft}>
              Aplicar
            </button>
            <button type="button" onClick={() => removeGuide(selected.id)}>
              Remover
            </button>
            <span className="os-pdf-guide-editor-meta">
              Limites: 0–{fmtMm(pageWidthMm)} × 0–{fmtMm(pageHeightMm)} mm
            </span>
          </>
        ) : (
          <span>
            Clique nas réguas para criar guias (
            {createScope === "all" ? "todas as páginas" : "página atual"}) ·
            origem inferior esquerda · {fmtMm(pageWidthMm)} ×{" "}
            {fmtMm(pageHeightMm)} mm
          </span>
        )}
      </div>
    </div>
  );
}
