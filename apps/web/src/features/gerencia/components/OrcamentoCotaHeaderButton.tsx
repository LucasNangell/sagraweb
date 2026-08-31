import { Link } from "@tanstack/react-router";
import { FileDown, Loader2 } from "lucide-react";

import { PermissionGate } from "@/components/auth/PermissionGate";
import { useOrcamentoEditorContext } from "@/features/orcamento/hooks/useOrcamentoEditor";
import { cn } from "@sagra/ui";

export function orcamentoOsSearch(
  ano: string | number | undefined,
  osId: string | number | undefined,
): { ano: string; id: string } | null {
  const year = parseInt(String(ano ?? "").trim(), 10);
  const id = parseInt(String(osId ?? "").trim(), 10);
  if (!Number.isFinite(year) || !Number.isFinite(id) || year <= 0 || id <= 0) {
    return null;
  }
  return { ano: String(year), id: String(id) };
}

const buttonClass =
  "inline-flex items-center rounded-md border border-secondary-blue/30 bg-white px-2 py-1 text-xs font-semibold text-secondary-blue shadow-sm transition hover:border-secondary-blue/50 hover:bg-slate-50";

const pdfButtonClass =
  "inline-flex items-center gap-1.5 rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50";

export function OrcamentoCotaHeaderButton({
  ano,
  osId,
  className,
}: {
  ano?: string | number;
  osId?: string | number;
  className?: string;
}) {
  const editor = useOrcamentoEditorContext();
  const search = orcamentoOsSearch(ano, osId);
  const pdfMode = editor != null;

  return (
    <PermissionGate permission="ctx_orcamento">
      {pdfMode ? (
        <button
          type="button"
          className={cn(pdfButtonClass, className)}
          onClick={() => editor.gerarPdf()}
          disabled={!editor.entrada || editor.pdfPending}
          title={
            !editor.entrada
              ? "Carregando orçamento…"
              : "Gerar PDF do orçamento"
          }
        >
          {editor.pdfPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <FileDown className="size-3.5" aria-hidden />
          )}
          Gerar PDF
        </button>
      ) : search ? (
        <Link
          to="/orcamento"
          search={search}
          className={cn(buttonClass, className)}
        >
          Orçamento
        </Link>
      ) : (
        <span
          className={cn(buttonClass, "cursor-not-allowed opacity-40", className)}
          title="Informe o número e o ano da OS para abrir o orçamento"
        >
          Orçamento
        </span>
      )}
    </PermissionGate>
  );
}
