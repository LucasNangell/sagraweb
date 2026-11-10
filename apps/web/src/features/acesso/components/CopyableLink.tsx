import { Check, Copy, X } from "lucide-react";
import { useRef, useState } from "react";

export function CopyableLink({
  link,
  label,
  hint,
  onDismiss,
}: {
  link: string;
  label: string;
  hint?: string;
  onDismiss?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = async () => {
    let ok = false;
    // navigator.clipboard só existe em contexto seguro (HTTPS/localhost); a intranet usa HTTP.
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(link);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    setCopyFailed(!ok);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">{label}</p>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="cursor-pointer rounded p-0.5 text-emerald-800 hover:bg-emerald-100"
            aria-label="Fechar link"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          readOnly
          value={link}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex shrink-0 cursor-pointer sagra-btn sagra-btn--outline sagra-btn--sm"
        >
          {copied ? (
            <Check className="size-3.5 text-primary-green" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      {hint ? <p className="mt-1 text-xs text-slate-600">{hint}</p> : null}
      {copyFailed ? (
        <p className="mt-1 text-xs text-red-700">
          Não foi possível copiar automaticamente. Selecione o link e use Ctrl+C.
        </p>
      ) : null}
    </div>
  );
}
