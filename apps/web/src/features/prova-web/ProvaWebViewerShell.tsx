import { BookOpen, Box, FileText } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import {
  provaWebPageUrl,
  provaWebSourcePdfUrl,
  resolveProvaWebSpineUrl,
  type ProvaWebManifestBase,
  type ProvaWebPageMeta,
} from "@/api/provaWeb";

import { ProvaWebBookMockup3D } from "./ProvaWebBookMockup3D";
import { ProvaWebFlipbook } from "./ProvaWebFlipbook";
import { ProvaWebFoldMockup3D } from "./ProvaWebFoldMockup3D";
import { ProvaWebPdfPanel } from "./ProvaWebPdfPanel";
import { ProvaWebSpiralMockup3D } from "./ProvaWebSpiralMockup3D";
import type { ProvaWebPdfSource } from "./provaWebPdfSources";

type ViewerTab = "folhear" | "mockup" | "pdf";

export interface ProvaWebViewerShellProps {
  ano: number;
  osId: number;
  manifest: ProvaWebManifestBase;
  /** Sobrescreve URL das páginas (portal do cliente). */
  buildPageUrl?: (page: number) => string;
  /** URL explícita do spine (portal). Se omitida, resolve do bookMockup. */
  spineUrl?: string | null;
  /** Fontes do PDF original (staff path ou portal id). */
  pdfSources?: ProvaWebPdfSource[];
  /** Constrói URL do PDF; default = provaWebSourcePdfUrl com path. */
  buildPdfUrl?: (source: ProvaWebPdfSource) => string;
  /** Overlay opcional por página no flipbook (marcas técnicas). */
  renderPageOverlay?: (
    page: ProvaWebPageMeta,
    size: { width: number; height: number },
  ) => ReactNode;
  renderStageOverlay?: (ctx: {
    visiblePages: ProvaWebPageMeta[];
    pageSize: { width: number; height: number };
    slotWidth: number;
    isSpread: boolean;
    flipping: boolean;
    gutterRight: number;
  }) => ReactNode;
  stageGutterRight?: number;
  pageTarget?: { page: number; nonce: number } | null;
  onPageChange?: (page: number) => void;
}

/**
 * Abas Folhear / Mockup 3D / PDF.
 * Prioridade mockup: fold → espiral → livro (lombada).
 */
export function ProvaWebViewerShell({
  ano,
  osId,
  manifest,
  buildPageUrl,
  spineUrl: spineUrlProp,
  pdfSources = [],
  buildPdfUrl: buildPdfUrlProp,
  renderPageOverlay,
  renderStageOverlay,
  stageGutterRight,
  pageTarget,
  onPageChange,
}: ProvaWebViewerShellProps) {
  const foldMockup = manifest.foldMockup;
  const bookMockup = manifest.bookMockup;
  const spiralMockup = manifest.spiralMockup;
  const isFold = Boolean(foldMockup?.panels?.length);
  const isSpiral = !isFold && Boolean(spiralMockup?.pageWidthMm);
  const isBook =
    !isFold &&
    !isSpiral &&
    Boolean(bookMockup) &&
    (bookMockup?.lombadaMm ?? 0) > 0;
  const showMockupTab = isFold || isSpiral || isBook;
  const showPdfTab = pdfSources.length > 0;
  const showTabBar = showMockupTab || showPdfTab;

  const [tab, setTab] = useState<ViewerTab>(
    isFold || isSpiral ? "mockup" : "folhear",
  );

  const resolvedPageUrl = useCallback(
    (page: ProvaWebPageMeta) =>
      buildPageUrl
        ? buildPageUrl(page.page)
        : provaWebPageUrl(ano, osId, page.page, manifest.cacheKey),
    [ano, buildPageUrl, manifest.cacheKey, osId],
  );

  const buildPdfUrl = useCallback(
    (source: ProvaWebPdfSource) => {
      if (buildPdfUrlProp) return buildPdfUrlProp(source);
      if (!source.path) {
        return "";
      }
      return provaWebSourcePdfUrl(ano, osId, source.path);
    },
    [ano, buildPdfUrlProp, osId],
  );

  const spineUrl =
    spineUrlProp !== undefined
      ? spineUrlProp
      : resolveProvaWebSpineUrl(bookMockup, {
          ano,
          osId,
          cacheKey: manifest.cacheKey,
        });

  if (!showTabBar) {
    return (
      <ProvaWebFlipbook
        ano={ano}
        osId={osId}
        manifest={manifest}
        buildPageUrl={buildPageUrl}
        renderPageOverlay={renderPageOverlay}
        renderStageOverlay={renderStageOverlay}
        stageGutterRight={stageGutterRight}
        pageTarget={pageTarget}
        onPageChange={onPageChange}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-center gap-1 border-b border-sagra-border bg-white px-3 py-2">
        {isFold || isSpiral ? (
          <>
            <TabButton
              active={tab === "mockup"}
              onClick={() => setTab("mockup")}
              icon={<Box className="size-3.5" aria-hidden />}
              label="Mockup 3D"
            />
            <TabButton
              active={tab === "folhear"}
              onClick={() => setTab("folhear")}
              icon={<BookOpen className="size-3.5" aria-hidden />}
              label="Folhear"
            />
          </>
        ) : (
          <>
            <TabButton
              active={tab === "folhear"}
              onClick={() => setTab("folhear")}
              icon={<BookOpen className="size-3.5" aria-hidden />}
              label="Folhear"
            />
            {showMockupTab ? (
              <TabButton
                active={tab === "mockup"}
                onClick={() => setTab("mockup")}
                icon={<Box className="size-3.5" aria-hidden />}
                label="Mockup 3D"
              />
            ) : null}
          </>
        )}
        {showPdfTab ? (
          <TabButton
            active={tab === "pdf"}
            onClick={() => setTab("pdf")}
            icon={<FileText className="size-3.5" aria-hidden />}
            label="PDF"
          />
        ) : null}
      </div>

      {tab === "pdf" && showPdfTab ? (
        <ProvaWebPdfPanel
          ano={ano}
          osId={osId}
          sources={pdfSources}
          buildPdfUrl={buildPdfUrl}
        />
      ) : tab === "folhear" || !showMockupTab ? (
        <ProvaWebFlipbook
          ano={ano}
          osId={osId}
          manifest={manifest}
          buildPageUrl={buildPageUrl}
          renderPageOverlay={renderPageOverlay}
          renderStageOverlay={renderStageOverlay}
          stageGutterRight={stageGutterRight}
          pageTarget={pageTarget}
          onPageChange={onPageChange}
        />
      ) : isFold && foldMockup ? (
        <ProvaWebFoldMockup3D
          pages={manifest.pages}
          foldMockup={foldMockup}
          pageUrl={resolvedPageUrl}
        />
      ) : isSpiral && spiralMockup ? (
        <ProvaWebSpiralMockup3D
          pages={manifest.pages}
          spiralMockup={spiralMockup}
          pageUrl={resolvedPageUrl}
        />
      ) : (
        bookMockup && (
          <ProvaWebBookMockup3D
            pages={manifest.pages}
            bookMockup={bookMockup}
            pageUrl={resolvedPageUrl}
            spineUrl={spineUrl}
          />
        )
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-primary-green text-white shadow-sm"
          : "bg-slate-100 text-neutral-600 hover:bg-slate-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
