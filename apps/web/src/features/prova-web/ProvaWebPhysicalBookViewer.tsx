import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type WheelEvent,
} from "react";

import {
  provaWebPageUrl,
  type ProvaWebBookStructureInsertItem,
  type ProvaWebBookStructureItem,
  type ProvaWebManifestBase,
  type ProvaWebPageMeta,
} from "@/api/provaWeb";

import { BOOK_EXTRA_KIND_LABELS } from "./provaWebBookExtras";

interface ProvaWebPhysicalBookViewerProps {
  ano: number;
  osId: number;
  manifest: ProvaWebManifestBase;
  buildPageUrl?: (page: number) => string;
  renderPageOverlay?: (
    page: ProvaWebPageMeta,
    size: { width: number; height: number },
  ) => ReactNode;
  pageTarget?: { page: number; nonce: number } | null;
  onPageChange?: (page: number) => void;
}

type PhysicalSpread =
  | {
      type: "pages";
      label: string;
      pages: ProvaWebPageMeta[];
      placement: "right-cover" | "spread" | "left-cover";
    }
  | { type: "insert"; label: string; item: ProvaWebBookStructureInsertItem };

type TurnState = {
  key: number;
  direction: "forward" | "back";
  from: PhysicalSpread;
};

export function ProvaWebPhysicalBookViewer({
  ano,
  osId,
  manifest,
  buildPageUrl,
  renderPageOverlay,
  pageTarget,
  onPageChange,
}: ProvaWebPhysicalBookViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pagesByNumber = useMemo(
    () => new Map(manifest.pages.map((page) => [page.page, page])),
    [manifest.pages],
  );
  const spreads = useMemo(
    () => buildPhysicalSpreads(manifest.bookStructure?.items ?? [], pagesByNumber),
    [manifest.bookStructure?.items, pagesByNumber],
  );
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const [turn, setTurn] = useState<TurnState | null>(null);
  const wheelLockRef = useRef(0);

  const current = spreads[index] ?? spreads[0] ?? null;
  const cacheKey = manifest.cacheKey;

  const pageUrl = useCallback(
    (page: ProvaWebPageMeta) =>
      buildPageUrl ? buildPageUrl(page.page) : provaWebPageUrl(ano, osId, page.page, cacheKey),
    [ano, buildPageUrl, cacheKey, osId],
  );

  const setSpreadIndex = useCallback(
    (next: number) => {
      const safe = Math.max(0, Math.min(spreads.length - 1, next));
      if (safe === index) return;
      const from = spreads[index];
      if (from) {
        setTurn({ key: Date.now(), direction: safe > index ? "forward" : "back", from });
      }
      setIndex(safe);
      const spread = spreads[safe];
      const first =
        spread?.type === "insert"
          ? pagesByNumber.get(spread.item.pages[0])
          : spread?.pages[0];
      if (first) onPageChange?.(first.page);
    },
    [index, onPageChange, pagesByNumber, spreads],
  );

  const goPrevious = useCallback(() => setSpreadIndex(index - 1), [index, setSpreadIndex]);
  const goNext = useCallback(() => setSpreadIndex(index + 1), [index, setSpreadIndex]);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (Math.abs(event.deltaY) < 32 && Math.abs(event.deltaX) < 32) return;
      const now = Date.now();
      if (now - wheelLockRef.current < 420) return;
      event.preventDefault();
      wheelLockRef.current = now;
      if (event.deltaY > 0 || event.deltaX > 0) {
        goNext();
      } else {
        goPrevious();
      }
    },
    [goNext, goPrevious],
  );

  const handleStageClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest?.("button, a, input, textarea, select, [data-analise-lab-balloon]")
      ) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left + rect.width / 2) {
        goPrevious();
      } else {
        goNext();
      }
    },
    [goNext, goPrevious],
  );

  useEffect(() => {
    if (!pageTarget || !spreads.length) return;
    const hit = spreads.findIndex((spread) =>
      spread.type === "insert"
        ? spread.item.pages.includes(pageTarget.page)
        : spread.pages.some((page) => page.page === pageTarget.page),
    );
    if (hit >= 0 && hit !== index) {
      setIndex(hit);
    }
  }, [index, pageTarget, spreads]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goPrevious();
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        goNext();
      }
      if (event.key === "Home") {
        event.preventDefault();
        setSpreadIndex(0);
      }
      if (event.key === "End") {
        event.preventDefault();
        setSpreadIndex(spreads.length - 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrevious, setSpreadIndex, spreads.length]);

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => setCssFullscreen((v) => !v));
      return;
    }
    setCssFullscreen((v) => !v);
  };

  if (!current) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        Sem páginas renderizadas.
      </div>
    );
  }

  const fullscreenActive = Boolean(document.fullscreenElement) || cssFullscreen;

  return (
    <div
      ref={rootRef}
      className={
        cssFullscreen
          ? "prova-web-physical-fs flex min-h-0 flex-1 flex-col bg-slate-200"
          : "flex min-h-0 flex-1 flex-col bg-slate-200/70"
      }
    >
      <div
        className="prova-web-physical-stage"
        onClick={handleStageClick}
        onWheel={handleWheel}
      >
        <div
          key={`${index}-${turn?.key ?? 0}`}
          className={
            turn?.direction === "back"
              ? "prova-web-physical-turn prova-web-physical-turn--back"
              : turn?.direction === "forward"
                ? "prova-web-physical-turn prova-web-physical-turn--forward"
                : "prova-web-physical-turn"
          }
          style={{ transform: `scale(${zoom})` }}
          onAnimationEnd={() => setTurn(null)}
        >
          {current.type === "insert" ? (
            <InsertSpread
              item={current.item}
              pagesByNumber={pagesByNumber}
              pageUrl={pageUrl}
              renderPageOverlay={renderPageOverlay}
            />
          ) : (
            <PageSpread
              pages={current.pages}
              placement={current.placement}
              pageUrl={pageUrl}
              renderPageOverlay={renderPageOverlay}
            />
          )}
          {turn ? (
            <TurnLeaf
              turn={turn}
              pagesByNumber={pagesByNumber}
              pageUrl={pageUrl}
              onDone={() => setTurn(null)}
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-sagra-border bg-white px-4 py-3 shadow-sm">
        <ToolbarButton onClick={() => setSpreadIndex(0)} disabled={index <= 0} label="Início">
          <ChevronsLeft className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          onClick={goPrevious}
          disabled={index <= 0}
          label="Página anterior"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </ToolbarButton>
        <span className="min-w-44 select-none text-center text-xs font-medium tabular-nums text-neutral-600">
          {current.label}
        </span>
        <ToolbarButton
          onClick={goNext}
          disabled={index >= spreads.length - 1}
          label="Próxima página"
        >
          <ChevronRight className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setSpreadIndex(spreads.length - 1)}
          disabled={index >= spreads.length - 1}
          label="Fim"
        >
          <ChevronsRight className="size-4" aria-hidden />
        </ToolbarButton>
        <span className="mx-1 hidden h-5 w-px bg-sagra-border sm:inline" aria-hidden />
        <ToolbarButton onClick={() => setZoom((v) => Math.max(0.55, v - 0.1))} label="Reduzir">
          <ZoomOut className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton onClick={() => setZoom((v) => Math.min(1.8, v + 0.1))} label="Ampliar">
          <ZoomIn className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          onClick={toggleFullscreen}
          label={fullscreenActive ? "Sair da tela cheia" : "Tela cheia"}
        >
          {fullscreenActive ? (
            <Minimize2 className="size-4" aria-hidden />
          ) : (
            <Maximize2 className="size-4" aria-hidden />
          )}
        </ToolbarButton>
      </div>
    </div>
  );
}

export function buildPhysicalSpreads(
  items: ProvaWebBookStructureItem[],
  pagesByNumber: Map<number, ProvaWebPageMeta>,
): PhysicalSpread[] {
  const out: PhysicalSpread[] = [];
  let pending: ProvaWebPageMeta[] = [];

  const flush = () => {
    if (!pending.length) return;
    for (let i = 0; i < pending.length; i += 2) {
      const pages = pending.slice(i, i + 2);
      const first = pages[0];
      const last = pages[pages.length - 1];
      const placement =
        pages.length === 1 && first.role === "cover-front"
          ? "right-cover"
          : pages.length === 1 && first.role === "cover-back"
            ? "left-cover"
            : "spread";
      out.push({
        type: "pages",
        pages,
        placement,
        label:
          first.role === "cover-front"
            ? "Capa"
            : first.role === "cover-back"
              ? "Contracapa"
              : pages.length === 2
            ? `Páginas ${first.page}-${last.page}`
            : `Página ${first.page}`,
      });
    }
    pending = [];
  };

  items.forEach((item, itemIndex) => {
    if (item.type === "insert") {
      flush();
      out.push({
        type: "insert",
        item,
        label: `${item.insert.label} · páginas ${item.pages.join(", ")}`,
      });
      return;
    }
    const page = pagesByNumber.get(item.page);
    if (!page) return;
    if (itemIndex === 0 && page.role === "cover-front") {
      flush();
      out.push({
        type: "pages",
        pages: [page],
        placement: "right-cover",
        label: "Capa",
      });
      return;
    }
    if (itemIndex === items.length - 1 && page.role === "cover-back") {
      flush();
      out.push({
        type: "pages",
        pages: [page],
        placement: "left-cover",
        label: "Contracapa",
      });
      return;
    }
    pending.push(page);
  });
  flush();
  return out;
}

function PageSpread({
  pages,
  placement,
  pageUrl,
  renderPageOverlay,
}: {
  pages: ProvaWebPageMeta[];
  placement: "right-cover" | "spread" | "left-cover";
  pageUrl: (page: ProvaWebPageMeta) => string;
  renderPageOverlay?: ProvaWebPhysicalBookViewerProps["renderPageOverlay"];
}) {
  const firstSize = pages[0] ? physicalPageSize(pages[0]) : null;
  const coverSlotWidth = placement === "spread" || !firstSize ? undefined : firstSize.width * 2;
  return (
    <div
      className={`prova-web-physical-spread prova-web-physical-spread--${placement}`}
      style={{ width: coverSlotWidth }}
    >
      {pages.map((page) => (
        <PhysicalPage
          key={page.page}
          page={page}
          pageUrl={pageUrl}
          renderPageOverlay={renderPageOverlay}
        />
      ))}
    </div>
  );
}

function InsertSpread({
  item,
  pagesByNumber,
  pageUrl,
  renderPageOverlay,
}: {
  item: ProvaWebBookStructureInsertItem;
  pagesByNumber: Map<number, ProvaWebPageMeta>;
  pageUrl: (page: ProvaWebPageMeta) => string;
  renderPageOverlay?: ProvaWebPhysicalBookViewerProps["renderPageOverlay"];
}) {
  const pages = item.pages.flatMap((pageNo) => {
    const page = pagesByNumber.get(pageNo);
    return page ? [page] : [];
  });
  const insert = item.insert;
  const ratio = insert.heightMm > 0 ? insert.widthMm / insert.heightMm : 1;
  const width = Math.min(760, Math.max(220, 440 * ratio));
  const height = Math.min(680, Math.max(220, width / ratio));

  return (
    <div className="prova-web-physical-insert-wrap">
      <div
        className="prova-web-physical-insert"
        style={{ width, height }}
        data-kind={insert.kind}
      >
        <div className="prova-web-physical-insert__badge">
          {BOOK_EXTRA_KIND_LABELS[insert.kind]} · {insert.widthMm.toFixed(1)}×
          {insert.heightMm.toFixed(1)} mm
        </div>
        {pages.map((page, idx) => (
          <div
            key={page.page}
            className="prova-web-physical-insert__page"
            style={{
              left: `${(idx / Math.max(1, pages.length)) * 100}%`,
              width: `${100 / Math.max(1, pages.length)}%`,
            }}
          >
            <img src={pageUrl(page)} alt={`Página ${page.page}`} draggable={false} />
            {renderPageOverlay
              ? renderPageOverlay(page, { width: page.width, height: page.height })
              : null}
          </div>
        ))}
        {insert.foldLines?.map((line, idx) => (
          <span
            key={`${line.axis}-${idx}-${line.positionMm}`}
            className={
              line.axis === "vertical"
                ? "prova-web-physical-fold-line prova-web-physical-fold-line--v"
                : "prova-web-physical-fold-line prova-web-physical-fold-line--h"
            }
            style={
              line.axis === "vertical"
                ? { left: `${(line.positionMm / insert.widthMm) * 100}%` }
                : { top: `${(line.positionMm / insert.heightMm) * 100}%` }
            }
          />
        ))}
      </div>
    </div>
  );
}

function PhysicalPage({
  page,
  pageUrl,
  renderPageOverlay,
}: {
  page: ProvaWebPageMeta;
  pageUrl: (page: ProvaWebPageMeta) => string;
  renderPageOverlay?: ProvaWebPhysicalBookViewerProps["renderPageOverlay"];
}) {
  const { width, height } = physicalPageSize(page);
  return (
    <div className="prova-web-physical-page" style={{ width, height }}>
      <img src={pageUrl(page)} alt={`Página ${page.page}`} draggable={false} />
      {renderPageOverlay ? renderPageOverlay(page, { width, height }) : null}
    </div>
  );
}

function TurnLeaf({
  turn,
  pagesByNumber,
  pageUrl,
  onDone,
}: {
  turn: TurnState;
  pagesByNumber: Map<number, ProvaWebPageMeta>;
  pageUrl: (page: ProvaWebPageMeta) => string;
  onDone: () => void;
}) {
  const page =
    turn.from.type === "pages"
      ? turn.direction === "forward"
        ? turn.from.pages[turn.from.pages.length - 1]
        : turn.from.pages[0]
      : pagesByNumber.get(turn.from.item.pages[0]);
  if (!page) return null;
  const { width, height } = physicalPageSize(page);
  return (
    <div
      className={
        turn.direction === "forward"
          ? "prova-web-physical-leaf prova-web-physical-leaf--forward"
          : "prova-web-physical-leaf prova-web-physical-leaf--back"
      }
      style={{ width, height }}
      onAnimationEnd={onDone}
      aria-hidden
    >
      <img src={pageUrl(page)} alt="" draggable={false} />
    </div>
  );
}

function physicalPageSize(page: ProvaWebPageMeta) {
  const ratio = page.height > 0 ? page.width / page.height : 0.7;
  const height = 520;
  const width = height * ratio;
  return { width, height };
}

function ToolbarButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-lg border border-sagra-border bg-white p-2 text-neutral-700 shadow-sm transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}
