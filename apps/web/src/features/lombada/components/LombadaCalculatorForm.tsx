import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchPapeisLombada, type PapelLombadaItem } from "@/api/auxLookups";
import { queryKeys } from "@/api/query-keys";
import { homeTestIds } from "@/lib/testId";
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
import {
  matchPapelLombada,
  papelLombadaKey,
} from "../lombadaPapelMatch";

export interface LombadaCalculatorDefaults {
  pgs?: number | null;
  capaPapel?: string | null;
  mioloPapel?: string | null;
}

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

export function suggestedLombadaObs(
  lombadaMm: number | null,
  sugeridaMm: number | null,
): string | null {
  if (sugeridaMm != null) return `${sugeridaMm} mm`;
  if (lombadaMm != null) return `${formatMm(lombadaMm)} mm`;
  return null;
}

export function LombadaCalculatorPanel({
  defaults,
  compact = false,
  onUseInObs,
}: {
  defaults?: LombadaCalculatorDefaults;
  compact?: boolean;
  onUseInObs?: (obs: string) => void;
}) {
  const papeisQuery = useQuery({
    queryKey: queryKeys.aux.papeisLombada,
    queryFn: fetchPapeisLombada,
    staleTime: 120_000,
  });

  return (
    <LombadaCalculatorForm
      papeis={papeisQuery.data ?? []}
      loading={papeisQuery.isLoading}
      error={
        papeisQuery.isError
          ? papeisQuery.error instanceof Error
            ? papeisQuery.error.message
            : "Não foi possível carregar os papéis."
          : null
      }
      defaults={defaults}
      compact={compact}
      onUseInObs={onUseInObs}
    />
  );
}

export function LombadaCalculatorForm({
  papeis,
  loading = false,
  error = null,
  defaults,
  compact = false,
  onUseInObs,
}: {
  papeis: PapelLombadaItem[];
  loading?: boolean;
  error?: string | null;
  defaults?: LombadaCalculatorDefaults;
  compact?: boolean;
  onUseInObs?: (obs: string) => void;
}) {
  const [pgsRaw, setPgsRaw] = useState(() =>
    defaults?.pgs && defaults.pgs > 0 ? String(defaults.pgs) : "",
  );
  const [capaCod, setCapaCod] = useState("");
  const [mioloCod, setMioloCod] = useState("");
  const [difRaw, setDifRaw] = useState(
    String(DIF_LOMBADA_DEFAULT).replace(".", ","),
  );
  const [fcola, setFcola] = useState(0.5);
  const [fcad, setFcad] = useState(0);

  useEffect(() => {
    if (!papeis.length) return;
    setCapaCod((current) => {
      if (current) return current;
      const matched = defaults?.capaPapel
        ? matchPapelLombada(defaults.capaPapel, papeis)
        : null;
      return matched ? papelLombadaKey(matched) : "";
    });
    setMioloCod((current) => {
      if (current) return current;
      const matched = defaults?.mioloPapel
        ? matchPapelLombada(defaults.mioloPapel, papeis)
        : null;
      return matched ? papelLombadaKey(matched) : "";
    });
  }, [papeis, defaults?.capaPapel, defaults?.mioloPapel]);

  const capaPapel = useMemo(
    () => papeis.find((p) => papelLombadaKey(p) === capaCod) ?? null,
    [papeis, capaCod],
  );
  const mioloPapel = useMemo(
    () => papeis.find((p) => papelLombadaKey(p) === mioloCod) ?? null,
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
  const obsText = suggestedLombadaObs(lombadaMm, sugeridaMm);
  const fieldClass = compact
    ? "w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
    : "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
  const labelClass = compact
    ? "mb-0.5 block text-[0.65rem] font-medium text-slate-700"
    : "mb-1 block font-medium text-slate-700";

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-600">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Carregando papéis…
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }

  if (papeis.length === 0) {
    return (
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Nenhum papel com espessura cadastrada em tabPapel. Atualize as medidas
        (µm) no MySQL a partir do CalcularLombada2010.mdb.
      </p>
    );
  }

  return (
    <div className={cn("space-y-3", compact ? "text-xs" : "space-y-4 text-sm")}>
      <label className="block">
        <span className={labelClass}>Páginas do miolo</span>
        <input
          type="number"
          min={1}
          step={1}
          value={pgsRaw}
          onChange={(e) => setPgsRaw(e.target.value)}
          className={fieldClass}
          placeholder="Ex.: 200"
          aria-label="Páginas do miolo"
          data-testid={homeTestIds.lombadaPages}
        />
      </label>

      <PapelSelect
        label="Papel da capa"
        value={capaCod}
        onChange={setCapaCod}
        papeis={papeis}
        selected={capaPapel}
        unmatched={
          !capaPapel && defaults?.capaPapel ? defaults.capaPapel : null
        }
        compact={compact}
        fieldClass={fieldClass}
        labelClass={labelClass}
        testId={homeTestIds.lombadaCoverPaper}
      />

      <PapelSelect
        label="Papel do miolo"
        value={mioloCod}
        onChange={setMioloCod}
        papeis={papeis}
        selected={mioloPapel}
        unmatched={
          !mioloPapel && defaults?.mioloPapel ? defaults.mioloPapel : null
        }
        compact={compact}
        fieldClass={fieldClass}
        labelClass={labelClass}
        testId={homeTestIds.lombadaBodyPaper}
      />

      <label className="block">
        <span className={labelClass}>(L) Esp. Lomb − (C) Alt. Livro</span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={difRaw}
            onChange={(e) => setDifRaw(e.target.value)}
            className={cn(fieldClass, compact ? "w-24" : "w-28")}
            aria-label="Diferença lombada"
            data-testid={homeTestIds.lombadaDiff}
          />
          <span className="text-slate-500">mm</span>
        </div>
        <span className="mt-1 block text-[0.65rem] text-slate-500">
          Dif. peq.: 0 a 1,4 · Dif. gde.: maior que 1,5
        </span>
      </label>

      <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <div className="text-[0.65rem] font-medium text-slate-500">
            F Cola (mm)
          </div>
          <div className="mt-0.5 font-semibold text-slate-800">
            {formatMm(fcola)}
          </div>
        </div>
        <div>
          <div className="text-[0.65rem] font-medium text-slate-500">
            F Cad (mm)
          </div>
          <div className="mt-0.5 font-semibold text-slate-800">
            {formatMm(fcad)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-slate-200 px-3 py-2">
          <div className="text-[0.65rem] font-medium text-slate-500">
            Lombada calculada
          </div>
          <div
            className={cn(
              "mt-1 font-semibold text-secondary-blue",
              compact ? "text-base" : "text-xl",
            )}
          >
            {lombadaMm != null ? `${formatMm(lombadaMm)} mm` : "—"}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 px-3 py-2">
          <div className="text-[0.65rem] font-medium text-slate-500">
            Lombada sugerida
          </div>
          <div
            className={cn(
              "mt-1 font-semibold text-primary-green",
              compact ? "text-base" : "text-xl",
            )}
          >
            {sugeridaMm != null ? `${sugeridaMm} mm` : "—"}
          </div>
        </div>
      </div>

      {onUseInObs && obsText ? (
        <button
          type="button"
          onClick={() => onUseInObs(obsText)}
          className="w-full rounded-md border border-secondary-blue/30 bg-white px-3 py-1.5 text-xs font-semibold text-secondary-blue hover:bg-slate-50"
          data-testid={homeTestIds.lombadaUseInObs}
        >
          Usar {obsText} na observação
        </button>
      ) : null}

      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2 text-center text-[0.65rem] font-semibold">
          {(
            ["grampo_canoa", "lombada_quadrada", "espiral"] as TipoAcabamentoLombada[]
          ).map((t) => (
            <div
              key={t}
              className={cn(
                "rounded-md px-1.5 py-1.5",
                tipo === t
                  ? ACABAMENTO_STYLES[t].active
                  : ACABAMENTO_STYLES[t].idle,
              )}
            >
              {labelTipoAcabamento(t)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[0.65rem] text-slate-500">
          <span>Até {LOMBADA_MINIMA_MM} mm</span>
          <span>
            De {LOMBADA_MINIMA_MM} mm a {LOMBADA_MAXIMA_MM} mm
          </span>
          <span>A partir de {LOMBADA_MAXIMA_MM} mm</span>
        </div>
      </div>
    </div>
  );
}

function PapelSelect({
  label,
  value,
  onChange,
  papeis,
  selected,
  unmatched,
  compact: _compact,
  fieldClass,
  labelClass,
  testId,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  papeis: PapelLombadaItem[];
  selected: PapelLombadaItem | null;
  unmatched: string | null;
  compact: boolean;
  fieldClass: string;
  labelClass: string;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass}
        aria-label={label}
        data-testid={testId}
      >
        <option value="">Selecione…</option>
        {papeis.map((p) => (
          <option key={`${label}-${papelLombadaKey(p)}`} value={papelLombadaKey(p)}>
            {p.papel}
          </option>
        ))}
      </select>
      {selected ? (
        <span className="mt-1 block text-[0.65rem] text-slate-500">
          Espessura: {selected.espessura.toLocaleString("pt-BR")} mícrons
        </span>
      ) : unmatched ? (
        <span className="mt-1 block text-[0.65rem] text-amber-700">
          Papel da OS: {unmatched} — selecione o equivalente.
        </span>
      ) : null}
    </label>
  );
}
