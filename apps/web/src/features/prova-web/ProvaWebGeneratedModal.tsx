import { Check, Copy, Loader2, Mail } from "lucide-react";
import { useState } from "react";

import { addOsHistory } from "@/api/os";
import { useAuthStore } from "@/features/auth/authStore";

interface ProvaWebGeneratedModalProps {
  open: boolean;
  ano: number;
  osId: number;
  portalUrl: string;
  /** Número da versão (Prova N) para o andamento. */
  versao?: number;
  onDone: () => void;
}

/**
 * Após aprovar a Prova WEB: exibe o link do cliente e pergunta se deseja
 * lançar a pendência de e-mail (Encam. de Docum. / SEFOC / Enviar Prova N).
 */
export function ProvaWebGeneratedModal({
  open,
  ano,
  osId,
  portalUrl,
  versao,
  onDone,
}: ProvaWebGeneratedModalProps) {
  const user = useAuthStore((s) => s.user);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versaoLabel = versao != null && versao > 0 ? `Prova ${versao}` : "Prova";

  if (!open) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Não foi possível copiar o link.");
    }
  };

  const handleEmailYes = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await addOsHistory(ano, osId, {
        situacao: "Encam. de Docum.",
        setor: "SEFOC",
        obs: `Enviar ${versaoLabel}`,
        usuario: String(user?.ponto ?? ""),
        confirm_main_os_target: true,
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao lançar o andamento de envio de prova.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prova-web-generated-title"
    >
      <div className="w-full max-w-lg rounded-lg border-t-4 border-[#24344D] bg-white shadow-xl">
        <div className="border-b border-sagra-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Mail className="size-5 text-primary-green" aria-hidden />
            <h3
              id="prova-web-generated-title"
              className="text-lg font-semibold text-secondary-blue"
            >
              {versaoLabel} aprovada
            </h3>
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            O link do cliente foi gerado e registrado no histórico da OS. Deseja
            lançar o andamento de envio de e-mail ({versaoLabel})?
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              Link do cliente
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-sagra-border bg-slate-50 p-2">
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 break-all text-sm text-sagra-accent underline"
              >
                {portalUrl}
              </a>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="shrink-0 rounded-md border border-sagra-border bg-white p-1.5 text-neutral-600 hover:bg-neutral-100"
                title="Copiar link"
                aria-label="Copiar link"
              >
                {copied ? (
                  <Check className="size-4 text-primary-green" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-sagra-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-sagra-border px-5 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onDone}
            className="rounded-lg border border-sagra-border bg-white px-4 py-2 text-sm text-neutral-700 shadow-sm hover:bg-neutral-100 disabled:opacity-50"
          >
            Não
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleEmailYes()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-110 disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Sim, enviar e-mail
          </button>
        </div>
      </div>
    </div>
  );
}
