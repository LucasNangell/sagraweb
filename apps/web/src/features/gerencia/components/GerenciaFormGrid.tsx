import {
  GerenciaCustosSection,
  GerenciaElementosSection,
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
        <div className="grid gap-3.5 lg:grid-cols-[4fr_3fr] min-[1900px]:col-start-1 min-[1900px]:row-start-1">
          <GerenciaSolicitanteSection {...sectionProps} />
          <GerenciaOrdemSection {...sectionProps} />
        </div>

        <GerenciaTecnicosSection {...sectionProps} />

        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3 min-[1900px]:col-start-1 min-[1900px]:row-start-2">
          <GerenciaMaterialSection {...sectionProps} />
          <GerenciaElementosSection {...sectionProps} />
          <GerenciaCustosSection {...sectionProps} />
        </div>
      </div>
    </div>
  );
}
