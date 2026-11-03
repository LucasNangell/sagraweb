import { X } from "lucide-react";
import { useEffect } from "react";

import { GravacaoExternaChatPanel } from "./GravacaoExternaChatPanel";

interface GravacaoExternaChatModalProps {
  open: boolean;
  ano: number;
  nrOs: number;
  gravacaoExternaId: number | null;
  currentPonto: string | null;
  onClose: () => void;
}

export function GravacaoExternaChatModal({
  open,
  ano,
  nrOs,
  gravacaoExternaId,
  currentPonto,
  onClose,
}: GravacaoExternaChatModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-end justify-end bg-black/40 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Mensagens"
      onClick={onClose}
    >
      <div
        className="mb-16 flex h-[min(80vh,560px)] w-full max-w-sm flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl sm:mb-20"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
          <div>
            <h3 className="text-sm font-semibold text-neutral-800">Mensagens</h3>
            <p className="text-xs text-neutral-500">
              OS {String(nrOs).padStart(5, "0")}/{String(ano).slice(-2)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <GravacaoExternaChatPanel
            key={gravacaoExternaId ?? "none"}
            ano={ano}
            nrOs={nrOs}
            gravacaoExternaId={gravacaoExternaId}
            currentPonto={currentPonto}
            fill
            hideHeader
            realtimeOwnedExternally
          />
        </div>
      </div>
    </div>
  );
}
