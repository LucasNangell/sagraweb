import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@sagra/ui";

import type { ProofPreviewPagesData } from "@/api/proof-portal";
import { proofPreviewPageUrls } from "@/api/proof-portal";
import { PapelariaProofMockup3D } from "@/features/papelaria/components/PapelariaProofMockup3D";
import {
  capPortalMockupSceneBasePx,
  configUsesFold,
  getPapelariaMockupConfig,
  PAPELARIA_MOCKUP_SCENE_BASE_PX,
  resolveSceneBasePx,
} from "@/features/papelaria/mockup";
import { useMatchMedia } from "@/hooks/useMatchMedia";

/** Padding interno de .proof-mockup-root (1.25rem 1rem 1.75rem). */
const MOCKUP_ROOT_PAD_X = 32;
const MOCKUP_ROOT_PAD_Y = 48;

interface ClienteProofMockupPanelProps {
  previewData: ProofPreviewPagesData | undefined;
  isLoading: boolean;
  isError: boolean;
  produtoFallback?: string;
  fillHeight?: boolean;
  className?: string;
}

type ReadyProps = {
  previewData: ProofPreviewPagesData;
  produtoFallback?: string;
  fillHeight: boolean;
  className?: string;
};

function ClienteProofMockupPanelReady({
  previewData,
  produtoFallback,
  fillHeight,
  className,
}: ReadyProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const isNarrowViewport = useMatchMedia("(max-width: 767px)");
  const [sceneBasePx, setSceneBasePx] = useState(PAPELARIA_MOCKUP_SCENE_BASE_PX);

  const pageUrls = proofPreviewPageUrls(previewData);
  const mockupResolved = getPapelariaMockupConfig({
    produto: previewData.produto || produtoFallback,
    arquivoModelo: previewData.arquivoModelo,
    frenteVerso: previewData.frenteVerso,
    pageCount: pageUrls.length,
    mockupConfigJson: previewData.mockupConfigJson,
  });

  const foldOpen = mockupResolved.config.aberturaInicial ?? 0.35;
  const hasFold = configUsesFold(mockupResolved.config);

  useEffect(() => {
    if (!fillHeight) {
      setSceneBasePx(capPortalMockupSceneBasePx(PAPELARIA_MOCKUP_SCENE_BASE_PX, isNarrowViewport));
      return;
    }

    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const updateSize = () => {
      const rect = stage.getBoundingClientRect();
      const fitted = resolveSceneBasePx(
        mockupResolved.config,
        hasFold ? foldOpen : 0,
        rect.width - MOCKUP_ROOT_PAD_X,
        rect.height - MOCKUP_ROOT_PAD_Y,
        0.82,
      );
      setSceneBasePx(capPortalMockupSceneBasePx(fitted, isNarrowViewport));
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fillHeight, mockupResolved.config, hasFold, foldOpen, isNarrowViewport]);

  return (
    <MockupPanelShell fillHeight={fillHeight} className={className} stageRef={stageRef}>
      <PapelariaProofMockup3D
        pages={pageUrls}
        config={mockupResolved.config}
        isFallback={mockupResolved.isFallback}
        sceneBasePx={sceneBasePx}
        className={cn("h-full", fillHeight && "proof-mockup-root--portal-fit")}
      />
      {mockupResolved.isInvalid && (
        <p className="absolute bottom-3 left-3 right-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">
          Visualização genérica — configuração do produto indisponível.
        </p>
      )}
    </MockupPanelShell>
  );
}

function MockupPanelShell({
  fillHeight,
  className,
  stageRef,
  children,
}: {
  fillHeight: boolean;
  className?: string;
  stageRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-col rounded-2xl border border-sagra-border bg-white shadow-sm",
        fillHeight ? "z-20 flex-1 overflow-hidden" : "overflow-hidden",
        className,
      )}
    >
      <div className="relative z-0 shrink-0 border-b border-sagra-border/70 bg-slate-50 px-3 py-2">
        <p className="text-xs font-semibold text-neutral-600">Visualização do produto</p>
      </div>
      <div
        ref={stageRef}
        className={cn(
          "relative z-10 min-h-0 flex-1 overflow-hidden",
          fillHeight ? "min-h-[200px]" : "min-h-[280px]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function ClienteProofMockupPanel({
  previewData,
  isLoading,
  isError,
  produtoFallback,
  fillHeight = false,
  className,
}: ClienteProofMockupPanelProps) {
  if (isLoading) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-2xl border border-sagra-border bg-white p-8 text-sm text-neutral-500",
          fillHeight ? "min-h-0 flex-1" : "min-h-[280px]",
          className,
        )}
      >
        <Loader2 className="size-8 animate-spin text-neutral-400" aria-hidden />
        <p>Preparando visualização do produto…</p>
      </div>
    );
  }

  if (isError || !previewData?.isPapelaria) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900",
          fillHeight ? "min-h-0 flex-1" : "",
          className,
        )}
      >
        Não foi possível carregar a visualização 3D. Você ainda pode conferir a prova pelo
        PDF.
      </div>
    );
  }

  return (
    <ClienteProofMockupPanelReady
      previewData={previewData}
      produtoFallback={produtoFallback}
      fillHeight={fillHeight}
      className={className}
    />
  );
}
