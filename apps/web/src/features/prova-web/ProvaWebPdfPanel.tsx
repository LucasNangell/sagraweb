import { useMemo, useState } from "react";

import { ClienteProofViewer } from "@/features/cliente/components/proof/ClienteProofViewer";

import type { ProvaWebPdfSource } from "./provaWebPdfSources";

export interface ProvaWebPdfPanelProps {
  ano: number;
  osId: number;
  sources: ProvaWebPdfSource[];
  /** Constrói URL absoluta do PDF (staff path ou portal parte=). */
  buildPdfUrl: (source: ProvaWebPdfSource) => string;
}

export function ProvaWebPdfPanel({
  ano,
  osId,
  sources,
  buildPdfUrl,
}: ProvaWebPdfPanelProps) {
  const [activeId, setActiveId] = useState<string>(
    () => sources[0]?.id ?? "unico",
  );

  const active = useMemo(() => {
    const hit = sources.find((s) => s.id === activeId);
    return hit ?? sources[0] ?? null;
  }, [sources, activeId]);

  if (!active || sources.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-neutral-500">
        Nenhum arquivo PDF registrado nesta prova.
      </div>
    );
  }

  const pdfUrl = buildPdfUrl(active);
  const fileName =
    active.path?.split(/[/\\]/).pop() || `${active.label}.pdf`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-100/80 p-3">
      {sources.length > 1 ? (
        <div className="mb-2 flex shrink-0 justify-center gap-1">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveId(s.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                active.id === s.id
                  ? "bg-secondary-blue text-white shadow-sm"
                  : "bg-white text-neutral-600 hover:bg-slate-50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      <ClienteProofViewer
        pdfUrl={pdfUrl}
        osLabel={`${osId}/${ano}`}
        hasPdf
        arquivoNome={fileName}
        fillHeight
        pdfFit="page-fit"
      />
    </div>
  );
}
