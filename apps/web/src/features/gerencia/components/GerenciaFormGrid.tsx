import {
  GerenciaCustosSection,
  GerenciaElementosSection,
  GerenciaEntregaSection,
  GerenciaMaterialSection,
  GerenciaOrdemSection,
  GerenciaSolicitanteSection,
  GerenciaTecnicosSection,
  type GerenciaSectionProps,
} from "./GerenciaFormSections";

export type GerenciaFormGridProps = GerenciaSectionProps;

export function GerenciaFormGrid(props: GerenciaFormGridProps) {
  const sectionProps = { ...props, layout: "page" as const };

  return (
    <div className="gerencia-grid pb-28">
      <div className="grid gap-3.5 min-[1900px]:grid-cols-[7fr_5fr] min-[1900px]:grid-rows-[auto_auto] min-[1900px]:items-start">
        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,4fr)_minmax(0,3fr)_minmax(0,2.5fr)_minmax(0,3fr)] min-[1900px]:col-start-1 min-[1900px]:row-start-1">
          <GerenciaSolicitanteSection {...sectionProps} />
          <GerenciaOrdemSection {...sectionProps} />
          <div className="flex h-full min-h-0 flex-col gap-3.5">
            <div className="flex min-h-0 flex-1 flex-col">
              <GerenciaMaterialSection {...sectionProps} />
            </div>
            <div className="shrink-0">
              <GerenciaElementosSection {...sectionProps} />
            </div>
          </div>
          <GerenciaEntregaSection {...sectionProps} />
        </div>

        <GerenciaTecnicosSection {...sectionProps} />

        <div className="min-[1900px]:col-start-1 min-[1900px]:row-start-2">
          <GerenciaCustosSection {...sectionProps} />
        </div>
      </div>
    </div>
  );
}
