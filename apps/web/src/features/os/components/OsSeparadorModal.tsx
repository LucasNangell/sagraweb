import { Printer, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchSeparadorCadernos, fetchSeparadorPdf } from "@/api/separador";
import logoSrc from "@/assets/camara-grafica-logo.png?inline";
import {
  fetchLocalPrinters,
  printPdfLocally,
  SEPARADOR_PRINTER_STORAGE_KEY,
} from "@/lib/sagraLocalOpener";
import { homeTestIds } from "@/lib/testId";
import { buildSeparadorDocument } from "../separador/buildSeparadorDocument";
import {
  cadSequence,
  formatSeparadorMeta,
  formatSeparadorOs,
  parseCadUntil,
} from "../separador/format";
import type { OsSearchRow } from "../types";

interface OsSeparadorModalProps {
  row: OsSearchRow | null;
  open: boolean;
  onClose: () => void;
}

const PREVIEW_SCALE = 0.52;
const PAGE_WIDTH_MM = 102;
const PAGE_HEIGHT_MM = 297;

function readSavedPrinter(): string {
  try {
    return localStorage.getItem(SEPARADOR_PRINTER_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberPrinter(name: string) {
  try {
    localStorage.setItem(SEPARADOR_PRINTER_STORAGE_KEY, name);
  } catch {
    // storage cheio ou bloqueado
  }
}

function gravacaoOsKey(row: OsSearchRow): { ano: number; nrOs: number } {
  if (row.is_sub_os && row.parent_ano && row.parent_nr_os) {
    return { ano: row.parent_ano, nrOs: row.parent_nr_os };
  }
  return { ano: row.ano, nrOs: row.nr_os };
}

export function OsSeparadorModal({ row, open, onClose }: OsSeparadorModalProps) {
  const [untilInput, setUntilInput] = useState("");
  const [printing, setPrinting] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState("");
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [loadingCadernos, setLoadingCadernos] = useState(false);
  const [autoCadUntil, setAutoCadUntil] = useState<number | null>(null);
  const [openerError, setOpenerError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const cadEditedRef = useRef(false);

  useEffect(() => {
    if (!open || !row) {
      return;
    }
    cadEditedRef.current = false;
    setUntilInput("");
    setAutoCadUntil(null);
    setPrinting(false);
    setStatus(null);
    setOpenerError(null);
    setPrinters([]);
    setPrinter("");
    setLoadingPrinters(true);
    setLoadingCadernos(true);
    let cancelled = false;
    const { ano, nrOs } = gravacaoOsKey(row);
    void fetchLocalPrinters().then((result) => {
      if (cancelled) {
        return;
      }
      setLoadingPrinters(false);
      if (!result.ok) {
        setOpenerError(result.error);
        return;
      }
      if (result.printers.length === 0) {
        setOpenerError("Nenhuma impressora foi encontrada neste computador.");
        return;
      }
      setPrinters(result.printers);
      const saved = readSavedPrinter();
      const chosen = result.printers.includes(saved)
        ? saved
        : result.defaultPrinter && result.printers.includes(result.defaultPrinter)
          ? result.defaultPrinter
          : (result.printers[0] ?? "");
      setPrinter(chosen);
    });
    void fetchSeparadorCadernos(ano, nrOs).then((until) => {
      if (cancelled) {
        return;
      }
      setLoadingCadernos(false);
      setAutoCadUntil(until);
      if (until != null && !cadEditedRef.current) {
        setUntilInput(String(until));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, row]);

  const osLabel = row ? formatSeparadorOs(row.nr_os, row.ano) : "";
  const titulo = formatSeparadorMeta(row?.titulo);
  const solicitante = formatSeparadorMeta(row?.solicitante);
  const produto = formatSeparadorMeta(row?.produto);
  const parsedUntil = parseCadUntil(untilInput);

  const previewDoc = useMemo(() => {
    if (!osLabel) {
      return "";
    }
    return buildSeparadorDocument({
      osLabel,
      cadNumbers: cadSequence(1),
      logoSrc,
      titulo,
      solicitante,
      produto,
    });
  }, [osLabel, produto, solicitante, titulo]);

  const handlePrint = useCallback(async () => {
    if (!osLabel) {
      return;
    }
    if (!parsedUntil.ok) {
      window.alert(parsedUntil.message);
      return;
    }
    if (!printer) {
      window.alert(
        openerError ??
          "Selecione a impressora Windows que tem o papel 102 × 297 mm.",
      );
      return;
    }
    setPrinting(true);
    setStatus(null);
    try {
      const blob = await fetchSeparadorPdf({
        osLabel,
        until: parsedUntil.until,
        titulo,
        solicitante,
        produto,
      });
      const printed = await printPdfLocally({
        printer,
        pdf: blob,
        widthMm: PAGE_WIDTH_MM,
        heightMm: PAGE_HEIGHT_MM,
      });
      if (!printed.ok) {
        window.alert(printed.error);
        return;
      }
      rememberPrinter(printer);
      setStatus(`Enviado para ${printer} em 102 × 297 mm.`);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Falha ao gerar o PDF do separador.",
      );
    } finally {
      setPrinting(false);
    }
  }, [openerError, osLabel, parsedUntil, printer, produto, solicitante, titulo]);

  if (!open || !row) {
    return null;
  }

  const untilHint = loadingCadernos
    ? "Consultando TIFFs da gravação…"
    : parsedUntil.ok
      ? [
          parsedUntil.until === 1
            ? "Será impressa 1 página (CAD. 01)."
            : `Serão impressas ${parsedUntil.until} páginas (CAD. 01 a ${cadSequence(parsedUntil.until).at(-1)}).`,
          autoCadUntil != null
            ? "Preenchido pelos TIFFs da gravação; você pode alterar."
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : parsedUntil.message;

  const printDisabled = printing || loadingPrinters || !printer;

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="os-separador-title"
      data-testid={homeTestIds.osSeparadorRoot}
    >
      <div className="relative flex max-h-[96vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 text-neutral-500 hover:text-neutral-800"
          aria-label="Fechar"
          data-testid={homeTestIds.osSeparadorClose}
        >
          <X className="size-5" />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-6 md:flex-row">
          <form
            className="w-full shrink-0 md:w-72"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void handlePrint();
            }}
          >
            <h3
              id="os-separador-title"
              className="text-lg font-semibold text-primary-green"
            >
              Separador de cadernos
            </h3>
            <p className="mt-1 text-sm text-neutral-600">OS {osLabel}</p>

            <label className="mt-4 block text-sm font-medium text-neutral-700">
              Até o caderno
              <input
                type="number"
                min={1}
                max={99}
                inputMode="numeric"
                value={untilInput}
                onChange={(e) => {
                  cadEditedRef.current = true;
                  setUntilInput(e.target.value);
                }}
                className="mt-1 w-full rounded border border-sagra-border px-3 py-2 text-base"
                data-testid={homeTestIds.osSeparadorCad}
              />
            </label>
            <p
              className={`mt-2 text-sm ${parsedUntil.ok || loadingCadernos ? "text-neutral-600" : "text-sagra-danger"}`}
            >
              {untilHint}
            </p>

            <label className="mt-4 block text-sm font-medium text-neutral-700">
              Impressora deste computador
              <select
                value={printer}
                onChange={(e) => setPrinter(e.target.value)}
                disabled={loadingPrinters || printers.length === 0}
                className="mt-1 w-full rounded border border-sagra-border px-3 py-2 text-sm"
                data-testid={homeTestIds.osSeparadorPrinter}
              >
                {loadingPrinters ? (
                  <option value="">Carregando impressoras…</option>
                ) : printers.length === 0 ? (
                  <option value="">Nenhuma impressora</option>
                ) : (
                  printers.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <p
              className={`mt-2 text-xs ${openerError ? "text-sagra-danger" : "text-neutral-500"}`}
              data-testid={homeTestIds.osSeparadorOpenerStatus}
            >
              {openerError ??
                "O job vai para a fila do Windows em 102 × 297 mm. O diálogo do Chrome não consegue sobrepor o A4 padrão da impressora."}
            </p>
            {status ? (
              <p className="mt-2 text-sm text-primary-green">{status}</p>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={printDisabled}
                className="inline-flex items-center gap-1.5 rounded bg-secondary-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                data-testid={homeTestIds.osSeparadorPrint}
              >
                <Printer className="size-4" />
                {printing ? "Imprimindo…" : "Imprimir"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-neutral-500 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-600"
                data-testid={homeTestIds.osSeparadorCancel}
              >
                Cancelar
              </button>
            </div>
          </form>

          <div className="flex min-w-0 flex-1 justify-center overflow-auto rounded bg-neutral-200 p-3">
            <div
              style={{
                width: `calc(${PAGE_WIDTH_MM}mm * ${PREVIEW_SCALE})`,
                height: `calc(${PAGE_HEIGHT_MM}mm * ${PREVIEW_SCALE})`,
                overflow: "hidden",
              }}
            >
              <iframe
                title="Pré-visualização do separador"
                srcDoc={previewDoc}
                data-testid={homeTestIds.osSeparadorPreview}
                style={{
                  width: `${PAGE_WIDTH_MM}mm`,
                  height: `${PAGE_HEIGHT_MM}mm`,
                  border: 0,
                  background: "#fff",
                  transform: `scale(${PREVIEW_SCALE})`,
                  transformOrigin: "top left",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
