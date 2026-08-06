import { Loader2 } from "lucide-react";
import { useEffect } from "react";

interface ClienteProofDecisionModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "approve" | "reject";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ClienteProofDecisionModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  variant = "approve",
  loading = false,
  onConfirm,
  onCancel,
}: ClienteProofDecisionModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proof-decision-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-sagra-border bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="proof-decision-title" className="text-lg font-bold text-secondary-blue">
          {title}
        </h2>
        <p className="mt-2 text-sm text-neutral-600">{description}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex min-h-11 items-center rounded-xl border border-sagra-border px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={
              variant === "approve"
                ? "inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-green px-4 py-2 text-sm font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
                : "inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
            }
          >
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
