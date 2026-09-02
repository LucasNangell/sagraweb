import { cn } from "@sagra/ui";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { useOsDetails } from "@/api/hooks/useOsDetails";
import { useOsComponentes } from "@/api/hooks/useSubOs";
import { toCheck } from "@/features/gerencia/utils";
import { formatDateBr } from "@/lib/format";
import { homeTestIds } from "@/lib/testId";
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
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-1.5 overflow-y-auto p-2 text-xs sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
            <div className="grid grid-cols-2 items-end gap-1.5 sm:grid-cols-[minmax(0,2.2fr)_minmax(3.25rem,0.55fr)_minmax(3.25rem,0.55fr)_minmax(3.25rem,0.55fr)_auto]">
              <Field label="Máquina" className="col-span-2 sm:col-span-1">
                <ReadonlyInput value={maquina} testId={homeTestIds.osDetails("maquina")} />
              </Field>
              <Field label="Tiragem">
                <ReadonlyInput value={data.Tiragem} testId={homeTestIds.osDetails("tiragem")} />
              </Field>
              <Field label="Páginas">
                <ReadonlyInput value={paginas} testId={homeTestIds.osDetails("paginas")} />
              </Field>
              <Field label="Modelos">
                <ReadonlyInput value={data.ModelosArq} testId={homeTestIds.osDetails("modelos")} />
              </Field>
              <div className="flex items-end gap-1.5 pb-1">
                <input
                  type="checkbox"
                  checked={toCheck(data.FrenteVerso)}
                  readOnly
                  tabIndex={-1}
                  aria-readonly="true"
                  aria-label="Frente/Verso"
                  data-testid={homeTestIds.osDetails("frente-verso")}
                  onChange={() => {}}
                  className="pointer-events-none size-3.5 shrink-0 accent-primary-green"
                />
                <label className="whitespace-nowrap leading-tight text-neutral-600">
                  Frente/Verso
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <Field label="Formato">
                <ReadonlyInput value={data.FormatoLink} testId={homeTestIds.osDetails("formato")} />
              </Field>
              <Field label="Prioridade">
                <ReadonlyInput value={data.EntregPrazoLink} testId={homeTestIds.osDetails("prioridade")} />
              </Field>
              <Field label="Data de entrega">
                <ReadonlyInput
                  value={formatDateBr(data.EntregData)}
                  testId={homeTestIds.osDetails("data")}
                />
              </Field>
              <Field label="Turno">
                <ReadonlyInput
                  value={data.EntregPeriodo}
                  testId={homeTestIds.osDetails("turno")}
                />
              </Field>
            </div>
          </div>

          <Field
            label="Contato"
            fill
            className="min-h-[5.5rem] h-full sm:col-span-2 lg:col-span-1"
          >
            <ReadonlyTextarea value={data.ContatoTrab} fill testId={homeTestIds.osDetails("contato")} />
          </Field>

          <Field label="Papel" fill className="min-h-[4.5rem] h-full lg:min-h-0">
            <ReadonlyTextarea value={papel} fill testId={homeTestIds.osDetails("papel")} />
          </Field>
          <Field label="Cores" fill className="min-h-[4.5rem] h-full lg:min-h-0">
            <ReadonlyTextarea value={cores} fill testId={homeTestIds.osDetails("cores")} />
          </Field>
          <Field
            label="Acabamento"
            fill
            className="min-h-[4.5rem] h-full lg:min-h-0"
          >
            <ReadonlyTextarea value={data.DescAcabamento} fill testId={homeTestIds.osDetails("acabamento")} />
          </Field>
          <Field label="Obs" fill className="min-h-[4.5rem] h-full lg:min-h-0">
            <ReadonlyTextarea value={data.Observ} fill testId={homeTestIds.osDetails("obs")} />
          </Field>
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
        fill && "flex h-full min-h-0 flex-1 flex-col",
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

function ReadonlyInput({
  value,
  testId,
}: {
  value: unknown;
  testId?: string;
}) {
  return (
    <input
      type="text"
      readOnly
      disabled
      value={value != null ? String(value) : ""}
      className="h-8 w-full rounded border border-sagra-border bg-slate-50 px-2 text-xs"
      data-testid={testId}
    />
  );
}

function ReadonlyTextarea({
  value,
  rows,
  fill,
  testId,
}: {
  value: unknown;
  rows?: number;
  fill?: boolean;
  testId?: string;
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
      data-testid={testId}
    />
  );
}
