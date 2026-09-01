import { FileText, Printer, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  DEFAULT_PROVA_FICHA_COR,
  type ProvaFichaCorOptions,
  type ProvaFichaCorTipo,
  type RequisicaoPrintMode,
} from "../utils/requisicaoReportUrl";
import { homeTestIds } from "@/lib/testId";

interface OsPrintModeModalProps {
  open: boolean;
  osLabel?: string;
  onSelect: (mode: RequisicaoPrintMode, provaCor?: ProvaFichaCorOptions) => void;
  onClose: () => void;
}

function CorOptionRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ProvaFichaCorTipo;
  onChange: (next: ProvaFichaCorTipo) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-neutral-700">
      <span className="font-medium">{label}:</span>
      <label className="inline-flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          className="size-4 accent-[#d35400]"
          checked={value === "policromia"}
          onChange={() => onChange("policromia")}
        />
        policromia
      </label>
      <label className="inline-flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          className="size-4 accent-[#d35400]"
          checked={value === "pb"}
          onChange={() => onChange("pb")}
        />
        PB
      </label>
    </div>
  );
}

export function OsPrintModeModal({
  open,
  osLabel,
  onSelect,
  onClose,
}: OsPrintModeModalProps) {
  const [provaFichaOpen, setProvaFichaOpen] = useState(false);
  const [provaCor, setProvaCor] = useState<ProvaFichaCorOptions>(
    DEFAULT_PROVA_FICHA_COR,
  );

  useEffect(() => {
    if (!open) {
      setProvaFichaOpen(false);
      setProvaCor(DEFAULT_PROVA_FICHA_COR);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleProvaFichaOk = () => {
    onSelect("prova_ficha", provaCor);
  };

  return (
    <div
      className="fixed inset-0 z-[10005] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Selecionar tipo de impressão"
      data-testid={homeTestIds.osPrintRoot}
    >
      <div className="relative w-full max-w-md rounded-lg border-t-4 border-primary-green bg-white p-6 text-center shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 text-neutral-500 hover:text-neutral-800"
          aria-label="Fechar"
          data-testid={homeTestIds.osPrintClose}
        >
          <X className="size-5" />
        </button>

        <h3 className="text-lg font-semibold text-primary-green">Imprimir Ficha</h3>
        {osLabel ? (
          <p className="mt-1 text-sm text-neutral-600">OS {osLabel}</p>
        ) : null}
        <p className="mt-3 text-sm text-neutral-600">
          Selecione o tipo de impressão desejado:
        </p>

        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => onSelect("normal")}
            className="inline-flex items-center justify-center gap-2 rounded bg-secondary-blue px-4 py-3 text-base font-semibold text-white hover:opacity-95"
            data-testid={homeTestIds.osPrintConfirm}
          >
            <FileText className="size-5" />
            Ficha OS (Normal)
          </button>
          <button
            type="button"
            onClick={() => onSelect("prova")}
            className="inline-flex items-center justify-center gap-2 rounded bg-[#e67e22] px-4 py-3 text-base font-semibold text-white hover:opacity-95"
          >
            <Printer className="size-5" />
            Ficha de Prévia
          </button>
          <button
            type="button"
            onClick={() => setProvaFichaOpen((prev) => !prev)}
            className="inline-flex items-center justify-center gap-2 rounded bg-[#d35400] px-4 py-3 text-base font-semibold text-white hover:opacity-95"
            aria-expanded={provaFichaOpen}
          >
            <Printer className="size-5" />
            Ficha de Prova
          </button>

          {provaFichaOpen ? (
            <div className="rounded-lg border border-[#d35400]/30 bg-[#fff8f3] px-3 py-3 text-left">
              <CorOptionRow
                label="Capa"
                value={provaCor.capa}
                onChange={(capa) =>
                  setProvaCor((prev) => ({ ...prev, capa }))
                }
              />
              <div className="mt-2">
                <CorOptionRow
                  label="Miolo"
                  value={provaCor.miolo}
                  onChange={(miolo) =>
                    setProvaCor((prev) => ({ ...prev, miolo }))
                  }
                />
              </div>
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={handleProvaFichaOk}
                  className="rounded bg-[#d35400] px-5 py-2 text-sm font-semibold text-white hover:opacity-95"
                >
                  OK
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-neutral-500 px-5 py-2 text-sm font-semibold text-white hover:bg-neutral-600"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
