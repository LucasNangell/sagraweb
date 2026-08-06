import { AlertTriangle } from "lucide-react";

import type { PdfPageCountResult } from "../pdfPageCount";

export interface VersionPageDivergence {
  versionLabel: string;
  declaredPags: number;
  folderPdfPages: number;
  pdfCount: number;
  perFile: PdfPageCountResult["perFile"];
  queryError?: string;
}

interface PageDivergenceModalProps {
  open: boolean;
  divergences: VersionPageDivergence[];
  onClose: () => void;
}

export function PageDivergenceModal({ open, divergences, onClose }: PageDivergenceModalProps) {
  if (!open || divergences.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="page-divergence-title"
    >
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-6 shrink-0 text-red-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h3
              id="page-divergence-title"
              className="text-lg font-bold uppercase tracking-wide text-red-800"
            >
              Divergência de páginas
            </h3>
            <p className="mt-2 text-sm leading-snug text-slate-700">
              O campo <strong>Pgs</strong> da OS não coincide com a contagem de páginas em PDF
              na última versão analisada.
            </p>
          </div>
        </div>

        <ul className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto text-sm text-slate-800">
          {divergences.map((entry) => (
            <li
              key={entry.versionLabel}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5"
            >
              <p className="font-semibold text-red-900">{entry.versionLabel}</p>
              {entry.queryError ? (
                <p className="mt-1 text-xs text-amber-900">{entry.queryError}</p>
              ) : (
                <>
                  <p className="mt-1 leading-snug">
                    Pgs da OS: <strong>{entry.declaredPags}</strong> — pasta:{" "}
                    <strong>{entry.folderPdfPages}</strong> página
                    {entry.folderPdfPages === 1 ? "" : "s"} em {entry.pdfCount} PDF
                    {entry.pdfCount === 1 ? "" : "s"}.
                  </p>
                  {entry.perFile.length > 0 ? (
                    <p className="mt-1 text-xs text-red-800/90">
                      {entry.perFile.map((f) => `${f.name}: ${f.pages}`).join(" · ")}
                    </p>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onClose}
            className="min-w-[120px] rounded-lg bg-primary-green px-6 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
