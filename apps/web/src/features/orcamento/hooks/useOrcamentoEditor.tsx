import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  calcularOrcamento,
  downloadOrcamentoPdf,
  fetchOrcamentoOs,
  gerarOrcamentoPdf,
} from "@/api/orcamento";
import type { OrcamentoEntrada, OrcamentoResponse } from "@/features/orcamento/types";

export function parseOrcamentoOsIds(
  ano?: string | number,
  id?: string | number,
): { anoN: number; idN: number; valid: boolean } {
  const anoN = Number(ano);
  const idN = Number(id);
  const valid = Number.isFinite(anoN) && Number.isFinite(idN) && anoN > 0 && idN > 0;
  return { anoN, idN, valid };
}

export interface OrcamentoEditorValue {
  enabled: boolean;
  valid: boolean;
  entrada: OrcamentoEntrada | null;
  setEntrada: (next: OrcamentoEntrada) => void;
  computed: OrcamentoResponse | null;
  query: ReturnType<typeof useQuery<OrcamentoResponse, Error>>;
  recalcPending: boolean;
  recalcError: string | null;
  pdfPending: boolean;
  pdfError: string | null;
  gerarPdf: () => void;
}

export const OrcamentoEditorContext = createContext<OrcamentoEditorValue | null>(
  null,
);

export function useOrcamentoEditor(opts: {
  ano?: string | number;
  id?: string | number;
  enabled?: boolean;
}): OrcamentoEditorValue {
  const { anoN, idN, valid } = parseOrcamentoOsIds(opts.ano, opts.id);
  const enabled = Boolean(opts.enabled ?? true) && valid;

  const query = useQuery({
    queryKey: ["orcamento", anoN, idN],
    queryFn: () => fetchOrcamentoOs(anoN, idN),
    enabled,
  });

  const [entrada, setEntrada] = useState<OrcamentoEntrada | null>(null);
  const [computed, setComputed] = useState<OrcamentoResponse | null>(null);

  useEffect(() => {
    if (query.data) {
      setEntrada(query.data.entrada);
      setComputed(query.data);
    }
  }, [query.data]);

  const recalc = useMutation({
    mutationFn: (payload: OrcamentoEntrada) => calcularOrcamento(payload),
    onSuccess: (data) => setComputed(data),
  });

  const pdfMut = useMutation({
    mutationFn: async (payload: OrcamentoEntrada) => {
      const { blob, filename } = await gerarOrcamentoPdf(payload);
      downloadOrcamentoPdf(blob, filename);
      return filename;
    },
  });

  useEffect(() => {
    if (!entrada || entrada === query.data?.entrada) return;
    const handle = window.setTimeout(() => recalc.mutate(entrada), 350);
    return () => window.clearTimeout(handle);
  }, [entrada]); // eslint-disable-line react-hooks/exhaustive-deps

  const gerarPdf = useCallback(() => {
    if (!entrada) return;
    pdfMut.mutate(entrada);
  }, [entrada, pdfMut]);

  const recalcError =
    recalc.error instanceof Error
      ? recalc.error.message
      : recalc.isError
        ? "Falha ao recalcular."
        : null;
  const pdfError =
    pdfMut.error instanceof Error
      ? pdfMut.error.message
      : pdfMut.isError
        ? "Falha ao gerar o PDF."
        : null;

  return useMemo(
    () => ({
      enabled,
      valid,
      entrada,
      setEntrada,
      computed,
      query,
      recalcPending: recalc.isPending,
      recalcError,
      pdfPending: pdfMut.isPending,
      pdfError,
      gerarPdf,
    }),
    [
      computed,
      enabled,
      entrada,
      gerarPdf,
      pdfError,
      pdfMut.isPending,
      query,
      recalc.isPending,
      recalcError,
      valid,
    ],
  );
}

export function OrcamentoEditorProvider({
  ano,
  id,
  enabled,
  children,
}: {
  ano?: string | number;
  id?: string | number;
  enabled?: boolean;
  children: ReactNode;
}) {
  const live = useOrcamentoEditor({ ano, id, enabled });
  return (
    <OrcamentoEditorContext.Provider value={live}>
      {children}
    </OrcamentoEditorContext.Provider>
  );
}

export function useOrcamentoEditorContext(): OrcamentoEditorValue | null {
  return useContext(OrcamentoEditorContext);
}
