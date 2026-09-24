import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchOsDetails } from "@/api/os";
import { OS_ANO_MAX, OS_ANO_MIN, parseOsAnoPair } from "@/features/os/osAnoUtils";
import type { OsSearchRow } from "@/features/os/types";
import {
  GravacaoPendenteLaunchModal,
  type GravacaoPendenteLaunchResult,
} from "./GravacaoPendenteLaunchModal";

interface GravacaoPendenteAdicionarOsModalProps {
  open: boolean;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (row: OsSearchRow, result: GravacaoPendenteLaunchResult) => void;
}

export function GravacaoPendenteAdicionarOsModal({
  open,
  saving = false,
  onClose,
  onConfirm,
}: GravacaoPendenteAdicionarOsModalProps) {
  const [numero, setNumero] = useState("");
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [checking, setChecking] = useState(false);
  const [row, setRow] = useState<OsSearchRow | null>(null);

  useEffect(() => {
    if (!open) {
      setNumero("");
      setAno(String(new Date().getFullYear()));
      setRow(null);
    }
  }, [open]);

  if (!open) return null;

  if (row) {
    return (
      <GravacaoPendenteLaunchModal
        row={row}
        open
        workflow="fila"
        saving={saving}
        onClose={onClose}
        onConfirm={(result) => onConfirm(row, result)}
      />
    );
  }

  const handleContinue = async () => {
    const parsed = parseOsAnoPair(numero, ano);
    if (!parsed) {
      window.alert(
        `Informe número e ano válidos (ano entre ${OS_ANO_MIN} e ${OS_ANO_MAX}).`,
      );
      return;
    }
    setChecking(true);
    try {
      await fetchOsDetails(parsed.ano, parsed.os);
      setRow({ nr_os: parsed.os, ano: parsed.ano });
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Não foi possível localizar a OS.",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Adicionar OS à Gravação Pendente"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="font-semibold text-secondary-blue">Adicionar OS</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={checking}
            aria-label="Fechar"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-600">
            Informe a OS que será incluída na lista sem registrar um andamento.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <label className="text-sm font-medium text-slate-700">
              Número da OS
              <input
                autoFocus
                type="number"
                min={1}
                value={numero}
                onChange={(event) => setNumero(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Ano
              <input
                type="number"
                min={OS_ANO_MIN}
                max={OS_ANO_MAX}
                value={ano}
                onChange={(event) => setAno(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={checking}
            className="rounded bg-neutral-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={checking}
            className="inline-flex items-center gap-2 rounded bg-primary-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {checking ? <Loader2 className="size-4 animate-spin" /> : null}
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}
