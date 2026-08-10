import { useEffect, useState } from "react";

import {
  concluirAnaliseLab,
  fetchAnaliseLabRelatorio,
} from "@/api/analiseLab";
import { AnaliseHtmlViewer } from "@/features/analise/components/AnaliseHtmlViewer";

interface AnaliseLabConcluirProps {
  ano: number;
  osId: number;
  versaoLabel?: string;
  open: boolean;
  onClose: () => void;
  hasClassicAnalise?: boolean;
}

export function AnaliseLabConcluir({
  ano,
  osId,
  versaoLabel,
  open,
  onClose,
  hasClassicAnalise = false,
}: AnaliseLabConcluirProps) {
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPortalUrl(null);
    setError(null);
    setConfirmed(false);
    void fetchAnaliseLabRelatorio(ano, osId)
      .then((r) => setHtml(r.html || ""))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Erro ao carregar relatório."),
      );
  }, [open, ano, osId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-3 rounded-lg bg-white p-4 shadow-xl">
        <h2 className="text-sm font-semibold text-neutral-800">
          Concluir e salvar análise
        </h2>
        {hasClassicAnalise ? (
          <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            Esta OS já possui análise na página clássica. Concluir aqui sobrescreve o
            relatório consolidado enviado ao portal.
          </p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto rounded border border-sagra-border">
          {html ? (
            <AnaliseHtmlViewer html={html} />
          ) : (
            <p className="p-3 text-xs text-neutral-500">Carregando preview…</p>
          )}
        </div>
        {error ? <p className="text-xs text-sagra-danger">{error}</p> : null}
        {portalUrl ? (
          <p className="text-xs text-neutral-700">
            Link do portal:{" "}
            <a
              href={portalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-secondary-blue underline"
            >
              {portalUrl}
            </a>
          </p>
        ) : null}
        {hasClassicAnalise && !portalUrl ? (
          <label className="flex items-center gap-2 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Confirmo sobrescrever o relatório existente
          </label>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-sagra-border px-3 py-1.5 text-xs"
            onClick={onClose}
          >
            Fechar
          </button>
          {!portalUrl ? (
            <button
              type="button"
              disabled={busy || (hasClassicAnalise && !confirmed) || !html}
              className="rounded bg-primary-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              onClick={() => {
                setBusy(true);
                setError(null);
                void concluirAnaliseLab(ano, osId, { versao: versaoLabel })
                  .then((r) => setPortalUrl(r.url))
                  .catch((err) =>
                    setError(
                      err instanceof Error ? err.message : "Erro ao concluir.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Concluindo…" : "Concluir"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
