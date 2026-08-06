import { cn } from "@sagra/ui";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Crop, Loader2, MousePointer2, Pencil, Square, Trash2, Type, Circle, ArrowUpRight, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { analiseFileServeUrl } from "@/api/analise";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const TEXT_FONT = "24px Arial";
const TEXT_SIZE = 24;
const HIT_PADDING = 6;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

type DrawTool = "select" | "free" | "rect" | "circle" | "arrow" | "text" | "crop";

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface StrokeRect {
  id: number;
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

interface StrokeFree {
  id: number;
  kind: "free";
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

interface StrokeCircle {
  id: number;
  kind: "circle";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

interface StrokeArrow {
  id: number;
  kind: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

interface StrokeText {
  id: number;
  kind: "text";
  x: number;
  y: number;
  text: string;
  color: string;
}

type Stroke = StrokeRect | StrokeCircle | StrokeArrow | StrokeFree | StrokeText;

interface TextDraft {
  x: number;
  y: number;
  value: string;
}

interface AnaliseAnnotationModalProps {
  open: boolean;
  filePath: string;
  pageNum: number;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}

let strokeIdSeq = 0;
function nextStrokeId(): number {
  strokeIdSeq += 1;
  return strokeIdSeq;
}

function drawArrowShape(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth: number,
): void {
  const headLen = Math.max(12, lineWidth * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function strokeBounds(
  stroke: Stroke,
  ctx: CanvasRenderingContext2D,
): { x: number; y: number; w: number; h: number } {
  if (stroke.kind === "rect" || stroke.kind === "circle") {
    return {
      x: Math.min(stroke.x, stroke.x + stroke.w),
      y: Math.min(stroke.y, stroke.y + stroke.h),
      w: Math.abs(stroke.w),
      h: Math.abs(stroke.h),
    };
  }
  if (stroke.kind === "arrow") {
    return {
      x: Math.min(stroke.x1, stroke.x2),
      y: Math.min(stroke.y1, stroke.y2),
      w: Math.abs(stroke.x2 - stroke.x1),
      h: Math.abs(stroke.y2 - stroke.y1),
    };
  }
  if (stroke.kind === "text") {
    ctx.font = TEXT_FONT;
    const w = ctx.measureText(stroke.text).width;
    return { x: stroke.x, y: stroke.y - TEXT_SIZE, w, h: TEXT_SIZE };
  }
  const xs = stroke.points.map((p) => p.x);
  const ys = stroke.points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function hitTestStroke(x: number, y: number, stroke: Stroke, ctx: CanvasRenderingContext2D): boolean {
  if (stroke.kind === "free") {
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const a = stroke.points[i];
      const b = stroke.points[i + 1];
      if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= HIT_PADDING + stroke.width / 2) {
        return true;
      }
    }
    return false;
  }

  if (stroke.kind === "arrow") {
    return (
      distToSegment(x, y, stroke.x1, stroke.y1, stroke.x2, stroke.y2) <=
      HIT_PADDING + stroke.width / 2
    );
  }

  if (stroke.kind === "circle") {
    const left = Math.min(stroke.x, stroke.x + stroke.w);
    const top = Math.min(stroke.y, stroke.y + stroke.h);
    const rx = Math.abs(stroke.w) / 2;
    const ry = Math.abs(stroke.h) / 2;
    if (rx < 1 || ry < 1) return false;
    const cx = left + rx;
    const cy = top + ry;
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const dist = nx * nx + ny * ny;
    return Math.abs(dist - 1) <= (HIT_PADDING * 2) / Math.min(rx, ry);
  }

  const b = strokeBounds(stroke, ctx);
  return (
    x >= b.x - HIT_PADDING &&
    x <= b.x + b.w + HIT_PADDING &&
    y >= b.y - HIT_PADDING &&
    y <= b.y + b.h + HIT_PADDING
  );
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function normalizeCropRect(rect: CropRect): CropRect {
  let { x, y, w, h } = rect;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  return { x, y, w, h };
}

export function AnaliseAnnotationModal({
  open,
  filePath,
  pageNum,
  onClose,
  onSave,
}: AnaliseAnnotationModalProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const displayZoomRef = useRef(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayZoom, setDisplayZoom] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<DrawTool>("free");
  const [color, setColor] = useState("#ff0000");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [textOverlay, setTextOverlay] = useState<{ left: number; top: number } | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const cropDrawingRef = useRef<{ startX: number; startY: number } | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const drawingRef = useRef<{ startX: number; startY: number } | null>(null);
  const freePointsRef = useRef<{ x: number; y: number }[]>([]);

  selectedIdRef.current = selectedId;
  displayZoomRef.current = displayZoom;

  const fitCanvasToViewport = useCallback((naturalW: number, naturalH: number) => {
    const container = scrollContainerRef.current;
    if (!container || naturalW <= 0 || naturalH <= 0) {
      setCanvasSize({ w: naturalW, h: naturalH });
      setDisplayZoom(1);
      return;
    }
    const availW = container.clientWidth || Math.max(window.innerWidth - 16, 320);
    const availH = container.clientHeight || Math.max(window.innerHeight - 72, 240);
    const fit = Math.min(availW / naturalW, availH / naturalH);
    setCanvasSize({ w: naturalW, h: naturalH });
    setDisplayZoom(Math.max(MIN_ZOOM, Math.min(fit, MAX_ZOOM)));
  }, []);

  const adjustDisplayZoom = useCallback((factor: number) => {
    setDisplayZoom((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor)));
  }, []);

  const handleWheelZoom = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (loading || error || canvasSize.w <= 0) return;
      e.preventDefault();
      const container = scrollContainerRef.current;
      if (!container) return;

      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const prev = displayZoomRef.current;
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor));
      if (next === prev) return;

      const rect = container.getBoundingClientRect();
      const offsetX = e.clientX - rect.left + container.scrollLeft;
      const offsetY = e.clientY - rect.top + container.scrollTop;
      const ratio = next / prev;

      setDisplayZoom(next);
      requestAnimationFrame(() => {
        container.scrollLeft = offsetX * ratio - (e.clientX - rect.left);
        container.scrollTop = offsetY * ratio - (e.clientY - rect.top);
      });
    },
    [canvasSize.w, error, loading],
  );

  const redraw = useCallback(() => {
    const canvas = drawRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const activeId = selectedIdRef.current;

    for (const s of strokesRef.current) {
      if (s.kind === "rect") {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 3;
        ctx.strokeRect(s.x, s.y, s.w, s.h);
      } else if (s.kind === "circle") {
        const left = Math.min(s.x, s.x + s.w);
        const top = Math.min(s.y, s.y + s.h);
        const rx = Math.abs(s.w) / 2;
        const ry = Math.abs(s.h) / 2;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(left + rx, top + ry, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.kind === "arrow") {
        drawArrowShape(ctx, s.x1, s.y1, s.x2, s.y2, s.color, s.width);
      } else if (s.kind === "free" && s.points.length > 1) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i].x, s.points[i].y);
        }
        ctx.stroke();
      } else if (s.kind === "text") {
        ctx.fillStyle = s.color;
        ctx.font = TEXT_FONT;
        ctx.fillText(s.text, s.x, s.y);
      }

      if (s.id === activeId) {
        const b = strokeBounds(s, ctx);
        ctx.save();
        ctx.strokeStyle = "#0095d4";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(
          b.x - HIT_PADDING,
          b.y - HIT_PADDING,
          b.w + HIT_PADDING * 2,
          b.h + HIT_PADDING * 2,
        );
        ctx.restore();
      }
    }
  }, []);

  const drawCropOverlay = useCallback((ctx: CanvasRenderingContext2D, rect: CropRect) => {
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }, []);

  useEffect(() => {
    if (!open || !filePath) return;
    let cancelled = false;
    strokesRef.current = [];
    cropDrawingRef.current = null;
    setCropRect(null);
    setSelectedId(null);
    setTextDraft(null);
    setTextOverlay(null);
    setError(null);
    setLoading(true);
    setDisplayZoom(1);
    setCanvasSize({ w: 0, h: 0 });

    void (async () => {
      try {
        const servePath = analiseFileServeUrl(filePath);
        const pdfUrl = new URL(servePath, window.location.origin).href;
        const pdf = await pdfjs.getDocument({
          url: pdfUrl,
          withCredentials: true,
          rangeChunkSize: 65536,
          disableAutoFetch: false,
          disableStream: false,
        }).promise;
        if (cancelled) return;

        const safePage = Math.min(Math.max(1, pageNum), pdf.numPages);
        const page = await pdf.getPage(safePage);
        const baseViewport = page.getViewport({ scale: 1 });
        const pad = 16;
        const headerHeight = 56;
        const availW = Math.max(window.innerWidth - pad, 320);
        const availH = Math.max(window.innerHeight - headerHeight - pad, 240);
        const scale = Math.max(0.5, Math.min(availW / baseViewport.width, availH / baseViewport.height));
        const viewport = page.getViewport({ scale });

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        const tempCtx = tempCanvas.getContext("2d");
        if (!tempCtx) throw new Error("Canvas não suportado neste navegador.");
        await page.render({
          canvasContext: tempCtx,
          viewport,
          canvas: tempCanvas,
          intent: "display",
        }).promise;
        if (cancelled) return;

        const applyToDom = () => {
          if (cancelled) return;
          const bg = bgRef.current;
          const draw = drawRef.current;
          if (!bg || !draw) {
            requestAnimationFrame(applyToDom);
            return;
          }

          bg.width = viewport.width;
          bg.height = viewport.height;
          draw.width = viewport.width;
          draw.height = viewport.height;
          const ctx = bg.getContext("2d");
          if (!ctx) throw new Error("Canvas não suportado neste navegador.");
          ctx.drawImage(tempCanvas, 0, 0);
          redraw();
          requestAnimationFrame(() => {
            fitCanvasToViewport(viewport.width, viewport.height);
            setLoading(false);
          });
        };

        applyToDom();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar PDF");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      setLoading(false);
    };
  }, [open, filePath, pageNum, fitCanvasToViewport, redraw]);

  useEffect(() => {
    redraw();
    if (!cropRect) return;
    const canvas = drawRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    drawCropOverlay(ctx, cropRect);
  }, [selectedId, cropRect, redraw, drawCropOverlay]);

  const applyCrop = useCallback(() => {
    if (!cropRect) return;
    const bg = bgRef.current;
    const draw = drawRef.current;
    if (!bg || !draw) return;

    const { x, y, w, h } = normalizeCropRect(cropRect);
    if (w < 4 || h < 4) return;

    const full = document.createElement("canvas");
    full.width = bg.width;
    full.height = bg.height;
    const fctx = full.getContext("2d");
    if (!fctx) return;
    fctx.drawImage(bg, 0, 0);
    fctx.drawImage(draw, 0, 0);

    const cropped = document.createElement("canvas");
    cropped.width = w;
    cropped.height = h;
    const cctx = cropped.getContext("2d");
    if (!cctx) return;
    cctx.drawImage(full, x, y, w, h, 0, 0, w, h);

    bg.width = w;
    bg.height = h;
    draw.width = w;
    draw.height = h;
    const bgCtx = bg.getContext("2d");
    const drawCtx = draw.getContext("2d");
    if (!bgCtx || !drawCtx) return;
    bgCtx.drawImage(cropped, 0, 0);
    drawCtx.clearRect(0, 0, w, h);
    strokesRef.current = [];
    setSelectedId(null);
    setCropRect(null);
    cropDrawingRef.current = null;
    redraw();
    fitCanvasToViewport(w, h);
  }, [cropRect, redraw, fitCanvasToViewport]);

  useEffect(() => {
    if (!textDraft) {
      setTextOverlay(null);
      return;
    }
    const canvas = drawRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const canvasRect = canvas.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    setTextOverlay({
      left: canvasRect.left - wrapperRect.left + (textDraft.x / canvas.width) * canvasRect.width,
      top: canvasRect.top - wrapperRect.top + (textDraft.y / canvas.height) * canvasRect.height - TEXT_SIZE,
    });
    requestAnimationFrame(() => textInputRef.current?.focus());
  }, [textDraft]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Enter" && tool === "crop" && cropRect) {
        e.preventDefault();
        applyCrop();
        return;
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedId == null) return;

      e.preventDefault();
      strokesRef.current = strokesRef.current.filter((s) => s.id !== selectedId);
      setSelectedId(null);
      redraw();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, selectedId, tool, cropRect, redraw, applyCrop]);

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const findStrokeAt = (x: number, y: number): number | null => {
    const ctx = drawRef.current?.getContext("2d");
    if (!ctx) return null;
    for (let i = strokesRef.current.length - 1; i >= 0; i--) {
      if (hitTestStroke(x, y, strokesRef.current[i], ctx)) {
        return strokesRef.current[i].id;
      }
    }
    return null;
  };

  const commitTextDraft = () => {
    if (!textDraft) return;
    const value = textDraft.value.trim();
    if (value) {
      strokesRef.current.push({
        id: nextStrokeId(),
        kind: "text",
        x: textDraft.x,
        y: textDraft.y,
        text: value,
        color,
      });
      redraw();
    }
    setTextDraft(null);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (loading || error) return;
    e.preventDefault();
    const p = pointerPos(e);

    if (tool === "select") {
      const id = findStrokeAt(p.x, p.y);
      setSelectedId(id);
      if (id != null) {
        const stroke = strokesRef.current.find((s) => s.id === id);
        if (stroke) setColor(stroke.color);
      }
      return;
    }

    if (tool === "text") {
      if (textDraft) commitTextDraft();
      setSelectedId(null);
      setTextDraft({ x: p.x, y: p.y, value: "" });
      return;
    }

    if (tool === "crop") {
      setTextDraft(null);
      setSelectedId(null);
      cropDrawingRef.current = { startX: p.x, startY: p.y };
      setCropRect({ x: p.x, y: p.y, w: 0, h: 0 });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    setSelectedId(null);
    drawingRef.current = { startX: p.x, startY: p.y };
    if (tool === "free") {
      freePointsRef.current = [p];
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const applyColorToSelection = (nextColor: string) => {
    setColor(nextColor);
    if (selectedId == null) return;
    const stroke = strokesRef.current.find((s) => s.id === selectedId);
    if (!stroke) return;
    stroke.color = nextColor;
    redraw();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "crop" && cropDrawingRef.current) {
      const p = pointerPos(e);
      const { startX, startY } = cropDrawingRef.current;
      setCropRect({ x: startX, y: startY, w: p.x - startX, h: p.y - startY });
      return;
    }

    if (!drawingRef.current) return;
    const p = pointerPos(e);
    if (tool === "free") {
      freePointsRef.current.push(p);
      const canvas = drawRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx || !canvas) return;
      redraw();
      const pts = freePointsRef.current;
      if (pts.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    } else if (tool === "rect") {
      redraw();
      const ctx = drawRef.current?.getContext("2d");
      if (!ctx || !drawingRef.current) return;
      const { startX, startY } = drawingRef.current;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(startX, startY, p.x - startX, p.y - startY);
    } else if (tool === "circle") {
      redraw();
      const ctx = drawRef.current?.getContext("2d");
      if (!ctx || !drawingRef.current) return;
      const { startX, startY } = drawingRef.current;
      const w = p.x - startX;
      const h = p.y - startY;
      const left = Math.min(startX, startX + w);
      const top = Math.min(startY, startY + h);
      const rx = Math.abs(w) / 2;
      const ry = Math.abs(h) / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(left + rx, top + ry, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tool === "arrow") {
      redraw();
      const ctx = drawRef.current?.getContext("2d");
      if (!ctx || !drawingRef.current) return;
      const { startX, startY } = drawingRef.current;
      drawArrowShape(ctx, startX, startY, p.x, p.y, color, 3);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "crop" && cropDrawingRef.current) {
      cropDrawingRef.current = null;
      return;
    }

    if (!drawingRef.current) return;
    const p = pointerPos(e);
    const { startX, startY } = drawingRef.current;
    if (tool === "free" && freePointsRef.current.length > 1) {
      strokesRef.current.push({
        id: nextStrokeId(),
        kind: "free",
        points: [...freePointsRef.current],
        color,
        width: 3,
      });
    } else if (tool === "rect") {
      strokesRef.current.push({
        id: nextStrokeId(),
        kind: "rect",
        x: startX,
        y: startY,
        w: p.x - startX,
        h: p.y - startY,
        color,
      });
    } else if (tool === "circle") {
      strokesRef.current.push({
        id: nextStrokeId(),
        kind: "circle",
        x: startX,
        y: startY,
        w: p.x - startX,
        h: p.y - startY,
        color,
      });
    } else if (tool === "arrow") {
      strokesRef.current.push({
        id: nextStrokeId(),
        kind: "arrow",
        x1: startX,
        y1: startY,
        x2: p.x,
        y2: p.y,
        color,
        width: 3,
      });
    }
    drawingRef.current = null;
    freePointsRef.current = [];
    redraw();
  };

  const handleSave = () => {
    commitTextDraft();
    const bg = bgRef.current;
    const draw = drawRef.current;
    if (!bg || !draw) return;
    const merged = document.createElement("canvas");
    merged.width = bg.width;
    merged.height = bg.height;
    const ctx = merged.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(bg, 0, 0);
    ctx.drawImage(draw, 0, 0);
    onSave(merged.toDataURL("image/jpeg", 0.92));
    onClose();
  };

  const cursorClass =
    tool === "select"
      ? "cursor-default"
      : tool === "text"
        ? "cursor-text"
        : "cursor-crosshair";

  if (!open) return null;

  const canvasDisplayStyle =
    canvasSize.w > 0
      ? {
          width: `${canvasSize.w * displayZoom}px`,
          height: `${canvasSize.h * displayZoom}px`,
        }
      : undefined;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/85">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-900 px-4 py-2 text-white">
        <span className="mr-4 text-sm font-semibold">Editor de anotação</span>
        <ToolBtn
          active={tool === "select"}
          onClick={() => {
            setTool("select");
            setTextDraft(null);
          }}
          title="Selecionar (Delete para remover)"
        >
          <MousePointer2 className="size-4" />
        </ToolBtn>
        <ToolBtn
          active={tool === "free"}
          onClick={() => {
            setTool("free");
            setTextDraft(null);
          }}
          title="Desenho livre"
        >
          <Pencil className="size-4" />
        </ToolBtn>
        <ToolBtn
          active={tool === "rect"}
          onClick={() => {
            setTool("rect");
            setTextDraft(null);
          }}
          title="Retângulo"
        >
          <Square className="size-4" />
        </ToolBtn>
        <ToolBtn
          active={tool === "circle"}
          onClick={() => {
            setTool("circle");
            setTextDraft(null);
          }}
          title="Círculo / elipse"
        >
          <Circle className="size-4" />
        </ToolBtn>
        <ToolBtn
          active={tool === "arrow"}
          onClick={() => {
            setTool("arrow");
            setTextDraft(null);
          }}
          title="Seta"
        >
          <ArrowUpRight className="size-4" />
        </ToolBtn>
        <ToolBtn
          active={tool === "text"}
          onClick={() => {
            setTool("text");
            setSelectedId(null);
            setCropRect(null);
          }}
          title="Texto — clique no PDF para posicionar"
        >
          <Type className="size-4" />
        </ToolBtn>
        <ToolBtn
          active={tool === "crop"}
          onClick={() => {
            setTool("crop");
            setTextDraft(null);
            setSelectedId(null);
            setCropRect(null);
          }}
          title="Corte — selecione a área e pressione Enter"
        >
          <Crop className="size-4" />
        </ToolBtn>
        <label className="ml-2 flex items-center gap-1 text-xs">
          Cor
          <input
            type="color"
            value={color}
            onChange={(e) => applyColorToSelection(e.target.value)}
            className="size-8 cursor-pointer rounded border-0 bg-transparent"
            title={selectedId != null ? "Alterar cor do objeto selecionado" : "Cor para novos desenhos"}
          />
        </label>
        <span className="hidden text-[10px] text-slate-400 sm:inline">
          Scroll: zoom · Corte: Enter · Objetos: Delete
        </span>
        <div className="ml-2 flex items-center gap-1 rounded border border-slate-600 px-1">
          <button
            type="button"
            title="Diminuir zoom"
            onClick={() => adjustDisplayZoom(1 / 1.15)}
            disabled={loading || Boolean(error)}
            className="inline-flex size-7 items-center justify-center rounded text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          >
            <ZoomOut className="size-4" />
          </button>
          <span className="min-w-[3rem] text-center text-[10px] text-slate-300">
            {Math.round(displayZoom * 100)}%
          </span>
          <button
            type="button"
            title="Aumentar zoom"
            onClick={() => adjustDisplayZoom(1.15)}
            disabled={loading || Boolean(error)}
            className="inline-flex size-7 items-center justify-center rounded text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          >
            <ZoomIn className="size-4" />
          </button>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            strokesRef.current = [];
            setSelectedId(null);
            setTextDraft(null);
            setCropRect(null);
            cropDrawingRef.current = null;
            redraw();
          }}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-300 hover:bg-slate-800"
        >
          <Trash2 className="size-3.5" /> Limpar desenhos
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading || Boolean(error)}
          className="rounded bg-primary-green px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          Salvar anotação
        </button>
      </header>
      <div
        ref={scrollContainerRef}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-black/40"
        onWheel={handleWheelZoom}
      >
        <div className="inline-block min-w-min p-1">
          <div ref={wrapperRef} className="relative shadow-2xl">
            <canvas ref={bgRef} className="block bg-white" style={canvasDisplayStyle} />
            <canvas
              ref={drawRef}
              className={cn(
                "absolute left-0 top-0",
                loading || error ? "pointer-events-none" : cursorClass,
              )}
              style={canvasDisplayStyle}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
          {textDraft && textOverlay ? (
            <input
              ref={textInputRef}
              type="text"
              value={textDraft.value}
              onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTextDraft();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setTextDraft(null);
                }
              }}
              onBlur={commitTextDraft}
              placeholder="Digite o texto…"
              className="absolute z-10 min-w-[140px] rounded border-2 border-sky-400 bg-white px-2 py-1 text-base shadow-lg outline-none"
              style={{
                left: textOverlay.left,
                top: textOverlay.top,
                color,
                font: TEXT_FONT,
              }}
            />
          ) : null}
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <div className="flex items-center gap-2 rounded bg-slate-900/90 px-4 py-3 text-sm text-white">
                <Loader2 className="size-5 animate-spin" />
                Carregando PDF…
              </div>
            </div>
          ) : null}
          </div>
        </div>
        {error ? (
          <p className="pointer-events-none absolute left-1/2 top-8 z-10 -translate-x-1/2 rounded bg-red-900/90 px-4 py-3 text-sm text-red-100">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ToolBtn({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded",
        active ? "bg-slate-600 text-white" : "text-slate-300 hover:bg-slate-700",
      )}
    >
      {children}
    </button>
  );
}
