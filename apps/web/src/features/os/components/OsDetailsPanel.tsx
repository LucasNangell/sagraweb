import { cn } from "@sagra/ui";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { useOsDetails } from "@/api/hooks/useOsDetails";
import { useOsComponentes } from "@/api/hooks/useSubOs";
import { toCheck } from "@/features/gerencia/utils";
import { formatDateForInput } from "@/lib/format";
import {
  EMPTY_TECH_FIELD,
  extractComponentTechDetails,
  findComponenteById,
} from "../componentTechDetails";
import type { OsSearchRow } from "../types";

interface OsDetailsPanelProps {
  selected: OsSearchRow | null;
  flash?: boolean;
  embedded?: boolean;
}

export function OsDetailsPanel({
  selected,
  flash,
  embedded = false,
}: OsDetailsPanelProps) {
  const isSubOs = Boolean(selected?.is_sub_os);
  const ano = isSubOs
    ? (selected?.parent_ano ?? selected?.ano ?? null)
    : (selected?.ano ?? null);
  const id = isSubOs
    ? (selected?.parent_nr_os ?? selected?.nr_os ?? null)
    : (selected?.nr_os ?? null);
  const componenteId = isSubOs ? (selected?.componente_id ?? null) : null;

  const detailsQuery = useOsDetails(ano, id);
  const componentesQuery = useOsComponentes(ano, id, {
    includeInactive: true,
    enabled: isSubOs && ano != null && id != null,
  });

  const showDetailsFields =
    selected != null &&
    detailsQuery.isSuccess &&
    detailsQuery.data != null &&
    !detailsQuery.isFetching &&
    (!isSubOs || componentesQuery.data != null);

  const data = showDetailsFields ? detailsQuery.data : undefined;

  const componentTech = useMemo(() => {
    if (!isSubOs) {
      return null;
    }
    const comp = findComponenteById(componentesQuery.data, componenteId);
    return extractComponentTechDetails(comp);
  }, [isSubOs, componentesQuery.data, componenteId]);

  const displayLabel =
    selected?.display_label ??
    (selected?.componente_nome
      ? `${selected.parent_nr_os ?? selected.nr_os} [${selected.componente_nome}]`
      : null);

  const title = isSubOs
    ? `DETALHES — ${displayLabel ?? "Sub OS"}`
    : selected
      ? `DETALHES DA OS ${selected.nr_os}/${selected.ano}`
      : "DETALHES DA OS";

  const maquina = isSubOs
    ? (componentTech?.maquina ?? EMPTY_TECH_FIELD)
    : (data?.MaquinaLink ?? "");
  const paginas = isSubOs
    ? (componentTech?.paginas ?? EMPTY_TECH_FIELD)
    : data?.Pags != null
      ? String(data.Pags)
      : "";
  const papel = isSubOs
    ? (componentTech?.papel ?? EMPTY_TECH_FIELD)
    : [data?.PapelLink, data?.PapelDescricao].filter(Boolean).join("\n");
  const cores = isSubOs
    ? (componentTech?.cores ?? EMPTY_TECH_FIELD)
    : [data?.Cores, data?.CoresDescricao].filter(Boolean).join("\n");

  const loading =
    selected &&
    (detailsQuery.isPending ||
      detailsQuery.isLoading ||
      (detailsQuery.isFetching && !detailsQuery.data) ||
      (isSubOs &&
        componentesQuery.isPending &&
        !componentesQuery.data));

  return (
    <section
      className={cn(
        "flex min-h-0 flex-1 flex-col transition-shadow",
        embedded
          ? ""
          : "rounded-lg border border-sagra-border bg-white shadow-sm",
        flash && "ring-2 ring-inset ring-primary-green/40",
      )}
    >
      <div className="shrink-0 border-b border-sagra-border bg-slate-50/80 px-3 py-1.5">
        <h3 className="text-xs font-bold tracking-wide text-secondary-blue">
          {title}
        </h3>
        {isSubOs && displayLabel ? (
          <p className="mt-0.5 inline-flex rounded bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-900">
            Detalhes técnicos exibidos para: {displayLabel}
          </p>
        ) : null}
      </div>

      {!selected && (
        <p className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-500">
          Selecione uma OS na tabela acima.
        </p>
      )}

      {selected && loading && (
        <p className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-500">
          Carregando detalhes...
        </p>
      )}

      {selected && detailsQuery.isError && !detailsQuery.isFetching && (
        <p className="flex flex-1 items-center justify-center p-4 text-sm text-sagra-danger">
          Erro ao carregar detalhes.
        </p>
      )}

      {showDetailsFields && data && (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2 text-xs md:min-h-0 md:flex-1 md:overflow-hidden">
          <div className="grid shrink-0 grid-cols-2 gap-1.5 sm:grid-cols-12">
            <Field label="Máquina" className="col-span-2 sm:col-span-4">
              <ReadonlyInput value={maquina} />
            </Field>
            <Field label="Tiragem" className="col-span-1 sm:col-span-3">
              <ReadonlyInput value={data.Tiragem} />
            </Field>
            <Field label="Páginas" className="col-span-1 sm:col-span-3">
              <ReadonlyInput value={paginas} />
            </Field>
            <div className="col-span-2 flex items-end gap-1.5 pb-1 sm:col-span-2">
              <input
                type="checkbox"
                checked={toCheck(data.FrenteVerso)}
                readOnly
                disabled
                aria-readonly="true"
                aria-label="Frente/Verso"
                className="size-3.5 accent-primary-green disabled:opacity-100"
              />
              <label className="text-neutral-600">Frente/Verso</label>
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-1.5 sm:grid-cols-12">
            <Field label="Módulos" className="col-span-2 sm:col-span-4">
              <ReadonlyInput value={data.ModelosArq} />
            </Field>
            <Field label="Formato" className="col-span-1 sm:col-span-3">
              <ReadonlyInput value={data.FormatoLink} />
            </Field>
            <Field label="Prioridade" className="col-span-1 sm:col-span-3">
              <ReadonlyInput value={data.EntregPrazoLink} />
            </Field>
            <Field label="Data" className="col-span-2 sm:col-span-2">
              <ReadonlyInput value={formatDateForInput(data.EntregData)} />
            </Field>
          </div>

          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Papel" fill className="min-h-[4.5rem] lg:min-h-0">
              <ReadonlyTextarea value={papel} fill />
            </Field>
            <Field label="Cores" fill className="min-h-[4.5rem] lg:min-h-0">
              <ReadonlyTextarea value={cores} fill />
            </Field>
            <Field label="Acabamento" fill className="min-h-[4.5rem] lg:min-h-0">
              <ReadonlyTextarea value={data.DescAcabamento} fill />
            </Field>
            <Field label="Obs" fill className="min-h-[4.5rem] lg:min-h-0">
              <ReadonlyTextarea value={data.Observ} fill />
            </Field>
            <Field label="Contato" fill className="min-h-[4.5rem] lg:min-h-0">
              <ReadonlyTextarea value={data.ContatoTrab} fill />
            </Field>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  children,
  className,
  fill,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  fill?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        fill && "flex min-h-0 flex-1 flex-col",
        className,
      )}
    >
      <label className="mb-0.5 block shrink-0 font-semibold text-neutral-600">
        {label}
      </label>
      {fill ? <div className="min-h-0 flex-1">{children}</div> : children}
    </div>
  );
}

function ReadonlyInput({ value }: { value: unknown }) {
  return (
    <input
      type="text"
      readOnly
      disabled
      value={value != null ? String(value) : ""}
      className="h-8 w-full rounded border border-sagra-border bg-slate-50 px-2 text-xs"
    />
  );
}

function ReadonlyTextarea({
  value,
  rows,
  fill,
}: {
  value: unknown;
  rows?: number;
  fill?: boolean;
}) {
  return (
    <textarea
      readOnly
      disabled
      rows={fill ? undefined : (rows ?? 2)}
      value={value != null ? String(value) : ""}
      className={cn(
        "w-full resize-none rounded border border-sagra-border bg-slate-50 px-2 py-1 text-xs",
        fill && "h-full min-h-0",
      )}
    />
  );
}
