import { X } from "lucide-react";
import { useEffect } from "react";

import { homeTestIds } from "@/lib/testId";

import { LombadaCalculatorPanel } from "./LombadaCalculatorForm";
import { useLombadaUiStore } from "../lombadaUiStore";

export function LombadaCalculatorModal() {
  const open = useLombadaUiStore((s) => s.open);
  const closeModal = useLombadaUiStore((s) => s.closeModal);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lombada-modal-title"
      data-testid={homeTestIds.lombadaRoot}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          closeModal();
        }
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2
            id="lombada-modal-title"
            className="text-lg font-semibold text-secondary-blue"
          >
            Cálculo de Lombada
          </h2>
          <button
            type="button"
            onClick={closeModal}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Fechar"
            data-testid={homeTestIds.lombadaClose}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <LombadaCalculatorPanel />
        </div>
      </div>
    </div>
  );
}
