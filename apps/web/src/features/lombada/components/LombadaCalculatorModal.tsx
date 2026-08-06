import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchPapeisLombada } from "@/api/auxLookups";
import { queryKeys } from "@/api/query-keys";
import { cn } from "@sagra/ui";

import {
  ajustarFcad,
  ajustarFcola,
  calcularLombadaMm,
  DIF_LOMBADA_DEFAULT,
  labelTipoAcabamento,
  LOMBADA_MAXIMA_MM,
  LOMBADA_MINIMA_MM,
  lombadaSugeridaMm,
  tipoAcabamento,
  type TipoAcabamentoLombada,
} from "../lombadaCalc";
import { useLombadaUiStore } from "../lombadaUiStore";

function parsePositiveNumber(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function formatMm(value: number, digits = 2): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function papelKey(p: { codPapel: number | null; papel: string }): string {
  return p.codPapel != null ? `c:${p.codPapel}` : `n:${p.papel}`;
}

const ACABAMENTO_STYLES: Record<
  TipoAcabamentoLombada,
  { active: string; idle: string }
> = {
  grampo_canoa: {
    active: "bg-primary-green text-white",
    idle: "bg-slate-100 text-slate-600",
  },
  lombada_quadrada: {
    active: "bg-secondary-blue text-white",
    idle: "bg-slate-100 text-slate-600",
  },
  espiral: {
    active: "bg-sagra-danger text-white",
    idle: "bg-slate-100 text-slate-600",
  },
};

export function LombadaCalculatorModal() {
  const open = useLombadaUiStore((s) => s.open);
  const closeModal = useLombadaUiStore((s) => s.closeModal);

  const [pgsRaw, setPgsRaw] = useState("");
  const [capaCod, setCapaCod] = useState("");
  const [mioloCod, setMioloCod] = useState("");
  const [difRaw, setDifRaw] = useState(String(DIF_LOMBADA_DEFAULT).replace(".", ","));
  const [fcola, setFcola] = useState(0.5);
  const [fcad, setFcad] = useState(0);

  const papeisQuery = useQuery({
    queryKey: queryKeys.aux.papeisLombada,
    queryFn: fetchPapeisLombada,
    staleTime: 120_000,
    enabled: open,
  });

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

  useEffect(() => {
    if (!open) {
      setPgsRaw("");
      setCapaCod("");
      setMioloCod("");
      setDifRaw(String(DIF_LOMBADA_DEFAULT).replace(".", ","));
      setFcola(0.5);
      setFcad(0);
    }
  }, [open]);

  const papeis = papeisQuery.data ?? [];

  const capaPapel = useMemo(
    () => papeis.find((p) => papelKey(p) === capaCod) ?? null,
    [papeis, capaCod],
  );
  const mioloPapel = useMemo(
    () => papeis.find((p) => papelKey(p) === mioloCod) ?? null,
    [papeis, mioloCod],
  );

  const pgs = parsePositiveNumber(pgsRaw);
  const dif = (() => {
    const normalized = difRaw.trim().replace(",", ".");
    if (!normalized) return null;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  })();

  useEffect(() => {
    if (dif == null) return;
    const nextFcad = ajustarFcad(dif);
    if (nextFcad != null) {
      setFcad(nextFcad);
    }
  }, [dif]);

  useEffect(() => {
    if (pgs == null || dif == null) return;
    const nextFcola = ajustarFcola(pgs, dif);
    if (nextFcola != null) {
      setFcola(nextFcola);
    }
  }, [pgs, dif]);

  const canCalc =
    pgs != null &&
    capaPapel != null &&
    mioloPapel != null &&
    dif != null &&
    difRaw.trim() !== "";

  const lombadaMm = canCalc
    ? calcularLombadaMm({
        pgs,
        mioloEspUm: mioloPapel.espessura,
        capaEspUm: capaPapel.espessura,
        fcola,
        fcad,
      })
    : null;

  const sugeridaMm =
    lombadaMm != null && tipoAcabamento(lombadaMm) === "lombada_quadrada"
      ? lombadaSugeridaMm(lombadaMm)
      : null;

  const tipo = lombadaMm != null ? tipoAcabamento(lombadaMm) : null;

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lombada-modal-title"
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
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {papeisQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-600">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Carregando papéis…
            </div>
          ) : papeisQuery.isError ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {papeisQuery.error instanceof Error
                ? papeisQuery.error.message
                : "Não foi possível carregar os papéis."}
            </p>
          ) : papeis.length === 0 ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Nenhum papel com espessura cadastrada em tabPapel. Atualize as
              medidas (µm) no MySQL a partir do CalcularLombada2010.mdb.
            </p>
          ) : (
            <div className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  Páginas do miolo
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={pgsRaw}
                  onChange={(e) => setPgsRaw(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Ex.: 200"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  Papel da capa
                </span>
                <select
                  value={capaCod}
                  onChange={(e) => setCapaCod(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Selecione…</option>
                  {papeis.map((p) => (
                    <option key={`capa-${papelKey(p)}`} value={papelKey(p)}>
                      {p.papel}
                    </option>
                  ))}
                </select>
                {capaPapel ? (
                  <span className="mt-1 block text-xs text-slate-500">
                    Espessura: {capaPapel.espessura.toLocaleString("pt-BR")}{" "}
                    mícrons
                  </span>
                ) : null}
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  Papel do miolo
                </span>
                <select
                  value={mioloCod}
                  onChange={(e) => setMioloCod(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Selecione…</option>
                  {papeis.map((p) => (
                    <option key={`miolo-${papelKey(p)}`} value={papelKey(p)}>
                      {p.papel}
                    </option>
                  ))}
                </select>
                {mioloPapel ? (
                  <span className="mt-1 block text-xs text-slate-500">
                    Espessura: {mioloPapel.espessura.toLocaleString("pt-BR")}{" "}
                    mícrons
                  </span>
                ) : null}
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  (L) Esp. Lomb − (C) Alt. Livro
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={difRaw}
                    onChange={(e) => setDifRaw(e.target.value)}
                    className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <span className="text-sm text-slate-500">mm</span>
                </div>
                <span className="mt-1 block text-xs text-slate-500">
                  Dif. peq.: 0 a 1,4 · Dif. gde.: maior que 1,5
                </span>
              </label>

              <div className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <div>
                  <div className="text-xs font-medium text-slate-500">
                    F Cola (mm)
                  </div>
                  <div className="mt-0.5 font-semibold text-slate-800">
                    {formatMm(fcola)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500">
                    F Cad (mm)
                  </div>
                  <div className="mt-0.5 font-semibold text-slate-800">
                    {formatMm(fcad)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-slate-200 px-3 py-3">
                  <div className="text-xs font-medium text-slate-500">
                    Lombada calculada
                  </div>
                  <div className="mt-1 text-xl font-semibold text-secondary-blue">
                    {lombadaMm != null ? `${formatMm(lombadaMm)} mm` : "—"}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 px-3 py-3">
                  <div className="text-xs font-medium text-slate-500">
                    Lombada sugerida
                  </div>
                  <div className="mt-1 text-xl font-semibold text-primary-green">
                    {sugeridaMm != null ? `${sugeridaMm} mm` : "—"}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
                  {(
                    [
                      "grampo_canoa",
                      "lombada_quadrada",
                      "espiral",
                    ] as TipoAcabamentoLombada[]
                  ).map((t) => (
                    <div
                      key={t}
                      className={cn(
                        "rounded-md px-2 py-2",
                        tipo === t
                          ? ACABAMENTO_STYLES[t].active
                          : ACABAMENTO_STYLES[t].idle,
                      )}
                    >
                      {labelTipoAcabamento(t)}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-500">
                  <span>Até {LOMBADA_MINIMA_MM} mm</span>
                  <span>
                    De {LOMBADA_MINIMA_MM} mm a {LOMBADA_MAXIMA_MM} mm
                  </span>
                  <span>A partir de {LOMBADA_MAXIMA_MM} mm</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
