import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { cn } from "@sagra/ui";

import {
  fetchProofFlipbookManifest,
  proofFlipbookAssetUrl,
  proofFlipbookPageUrl,
  proofPdfUrl,
} from "@/api/proof-portal";
import { resolveProvaWebSpineUrl } from "@/api/provaWeb";
import { ProvaWebViewerShell } from "@/features/prova-web/ProvaWebViewerShell";
import type { ProvaWebPdfSource } from "@/features/prova-web/provaWebPdfSources";

interface ClienteProofFlipbookPanelProps {
  ano: number;
  osId: number;
  token: string;
  fillHeight?: boolean;
  className?: string;
}

/** Prova WEB no portal do cliente — folheamento (+ mockup 3D folheto/espiral/livro). */
export function ClienteProofFlipbookPanel({
  ano,
  osId,
  token,
  fillHeight = false,
  className,
}: ClienteProofFlipbookPanelProps) {
  const manifestQuery = useQuery({
    queryKey: ["portal", "aprovacao", "flipbook", token, osId, ano],
    queryFn: () => fetchProofFlipbookManifest(ano, osId, token),
    enabled: Boolean(token && osId && ano),
    staleTime: 60_000,
    retry: 1,
  });

  if (manifestQuery.isLoading) {
    return (
      <PanelShell fillHeight={fillHeight} className={className}>
        <div className="flex flex-col items-center justify-center gap-2 p-8 text-sm text-neutral-500">
          <Loader2 className="size-8 animate-spin text-primary-green" aria-hidden />
          <p>Preparando a visualização da prova…</p>
          <p className="text-xs text-neutral-400">
            A primeira abertura pode demorar alguns segundos.
          </p>
        </div>
      </PanelShell>
    );
  }

  if (manifestQuery.isError || !manifestQuery.data?.pages.length) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900",
          fillHeight ? "min-h-0 flex-1" : "",
          className,
        )}
      >
        Não foi possível carregar a visualização com folheamento. Você ainda pode
        conferir a prova pelo PDF.
      </div>
    );
  }

  const manifest = manifestQuery.data;
  const book = manifest.bookMockup;
  const fold = manifest.foldMockup;
  const spiral = manifest.spiralMockup;
  const box = manifest.boxMockup;
  const cacheKey = manifest.cacheKey;
  const spineUrl =
    resolveProvaWebSpineUrl(book, { cacheKey }) ??
    (book?.spineFile
      ? proofFlipbookAssetUrl(ano, osId, book.spineFile, token, cacheKey)
      : null);
  const isFold = Boolean(fold?.panels?.length);
  const isBox = !isFold && Boolean(box?.panels?.length && box.dimsMm);
  const isSpiral = !isFold && !isBox && Boolean(spiral?.pageWidthMm);
  const hasMockup =
    isFold || isBox || isSpiral || (book?.lombadaMm ?? 0) > 0;

  const pdfSources: ProvaWebPdfSource[] = (manifest.pdfSources ?? []).map(
    (s) => ({
      id: s.id as ProvaWebPdfSource["id"],
      label: s.label,
    }),
  );

  return (
    <PanelShell
      fillHeight={fillHeight}
      className={className}
      hasMockup={hasMockup}
      isFold={isFold}
      isBox={isBox}
      isSpiral={isSpiral}
    >
      <ProvaWebViewerShell
        ano={ano}
        osId={osId}
        manifest={manifest}
        buildPageUrl={(page) =>
          proofFlipbookPageUrl(ano, osId, page, token, cacheKey)
        }
        spineUrl={spineUrl}
        pdfSources={pdfSources}
        buildPdfUrl={(source) =>
          proofPdfUrl(ano, osId, token, { parte: source.id })
        }
      />
    </PanelShell>
  );
}

function PanelShell({
  fillHeight,
  className,
  children,
  hasMockup = false,
  isFold = false,
  isBox = false,
  isSpiral = false,
}: {
  fillHeight: boolean;
  className?: string;
  children: React.ReactNode;
  hasMockup?: boolean;
  isFold?: boolean;
  isBox?: boolean;
  isSpiral?: boolean;
}) {
  const title = isFold
    ? "Prova WEB — mockup 3D do folheto (ou folhear frente/verso)"
    : isBox
      ? "Prova WEB — mockup 3D flip-top da caixa (ou folhear arte/faca)"
      : isSpiral
        ? "Prova WEB — mockup 3D espiral (ou folhear as páginas)"
        : hasMockup
          ? "Prova WEB — folheie as páginas ou gire o mockup 3D"
          : "Prova WEB — folheie as páginas";

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-sagra-border bg-white shadow-sm",
        fillHeight ? "flex-1" : "min-h-[420px]",
        className,
      )}
    >
      <div className="shrink-0 border-b border-sagra-border/70 bg-slate-50 px-3 py-2">
        <p className="text-xs font-semibold text-neutral-600">{title}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
