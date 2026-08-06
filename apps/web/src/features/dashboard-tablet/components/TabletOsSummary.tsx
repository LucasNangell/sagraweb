import { Loader2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { useOsDetails } from "@/api/hooks/useOsDetails";
import type { DashboardOsItem } from "@/features/dashboard-setor/types";
import { formatQueueDisplayLabel } from "@/features/dashboard-setor/utils";
import type { GerenciaOsDetails } from "@/features/gerencia/types";
import { toCheck } from "@/features/gerencia/utils";
import { formatDateBr, formatDateTimeBr } from "@/lib/format";

/** Campos extras que a API de details devolve além do tipo estreito do front. */
type TabletOsDetails = GerenciaOsDetails & {
  EntregaFormaLink?: string | null;
  ResponsavelGrafLink?: string | null;
  EntregPeriodo?: string | null;
};

interface TabletOsSummaryProps {
  item: DashboardOsItem;
}

function text(value: unknown): string {
  if (value == null) return "";
  const s = String(value).trim();
  return s;
}

function display(value: unknown, fallback = "—"): string {
  const s = text(value);
  return s || fallback;
}

function withObs(main: unknown, obs: unknown): string {
  const a = text(main);
  const b = text(obs);
  if (a && b) return `${a} · ${b}`;
  return a || b || "—";
}

function Field({
  label,
  value,
  wide,
  clamp,
}: {
  label: string;
  value: string;
  wide?: boolean;
  clamp?: 1 | 2 | 3;
}) {
  const clampClass =
    clamp === 1
      ? "tablet-summary-clamp-1"
      : clamp === 3
        ? "tablet-summary-clamp-3"
        : "tablet-summary-clamp-2";
  return (
    <div
      className={["tablet-summary-field", wide ? "is-wide" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="tablet-summary-label">{label}</span>
      <span className={`tablet-summary-value ${clampClass}`} title={value}>
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
  variant,
}: {
  title: string;
  children: ReactNode;
  variant?: "priority" | "compact";
}) {
  return (
    <section
      className={[
        "tablet-summary-section",
        variant === "priority" ? "is-priority" : "",
        variant === "compact" ? "is-compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <h3 className="tablet-summary-section-title">{title}</h3>
      <div className="tablet-summary-grid">{children}</div>
    </section>
  );
}

export function TabletOsSummary({ item }: TabletOsSummaryProps) {
  const isSubOs = item.row_kind === "sub_os";
  const ano = isSubOs ? (item.parent_ano ?? item.ano) : item.ano;
  const id = isSubOs ? (item.parent_nr_os ?? item.nr_os) : item.nr_os;

  const [showMore, setShowMore] = useState(false);
  const detailsQuery = useOsDetails(ano, id);
  const details = detailsQuery.data as TabletOsDetails | undefined;

  const osLabel = useMemo(() => formatQueueDisplayLabel(item), [item]);

  const loading =
    detailsQuery.isPending ||
    detailsQuery.isLoading ||
    (detailsQuery.isFetching && !detailsQuery.data);

  if (loading) {
    return (
      <div className="tablet-summary tablet-summary-state">
        <Loader2 className="size-7 animate-spin text-emerald-400" />
        <span>Carregando resumo…</span>
      </div>
    );
  }

  if (detailsQuery.isError && !details) {
    return (
      <div className="tablet-summary tablet-summary-state">
        <p className="tablet-summary-error">Não foi possível carregar os detalhes.</p>
        <HeaderFallback item={item} osLabel={osLabel} />
      </div>
    );
  }

  const d = details ?? {};
  const prioridade = display(item.prioridade ?? null);
  const titulo = display(d.Titulo ?? item.titulo);
  const produto = display(d.TipoPublicacaoLink ?? item.produto);
  const dataEntrega = display(
    formatDateBr(d.EntregData ?? item.data_entrega) ||
      text(d.EntregData ?? item.data_entrega),
  );
  const prazo = display(d.EntregPrazoLink ?? item.entreg_periodo);
  const forma = display(d.EntregaFormaLink);
  const responsavel = display(d.ResponsavelGrafLink);
  const fv = toCheck(d.FrenteVerso) ? "Sim" : "Não";

  return (
    <div className="tablet-summary" aria-label={`Resumo ${osLabel}`}>
      <Section title="Técnico" variant="priority">
        <Field label="Produto" value={produto} wide clamp={2} />
        <Field label="Título" value={titulo} wide clamp={2} />
        <Field label="Máquina" value={display(d.MaquinaLink)} clamp={2} />
        <Field
          label="Páginas"
          value={display(d.Pags ?? item.pags)}
        />
        <Field label="F/V" value={fv} />
        <Field
          label="Formato"
          value={display(d.FormatoLink ?? item.formato)}
        />
        <Field label="Modelos" value={display(d.ModelosArq)} />
        <Field
          label="Tiragem"
          value={display(d.Tiragem ?? item.tiragem)}
        />
        <Field
          label="Cor"
          value={withObs(d.Cores, d.CoresDescricao)}
          wide
          clamp={2}
        />
        <Field
          label="Papel"
          value={withObs(d.PapelLink, d.PapelDescricao)}
          wide
          clamp={2}
        />
        <Field
          label="Acabamento"
          value={display(d.DescAcabamento)}
          wide
          clamp={2}
        />
      </Section>

      <button
        type="button"
        className="tablet-summary-toggle"
        onClick={() => setShowMore((v) => !v)}
        aria-expanded={showMore}
      >
        {showMore ? "Ver menos" : "Ver mais"}
      </button>

      {showMore ? (
        <>
          <Section title="Identificação" variant="compact">
            <Field
              label="Entrada"
              value={display(
                formatDateTimeBr(d.DataEntrada) || text(d.DataEntrada),
              )}
            />
            <Field label="Processo" value={display(d.ProcessoSolicit)} />
            <Field label="CS" value={display(d.CSnro)} />
            <Field label="Prioridade" value={prioridade} />
            <Field label="Prazo" value={prazo} />
            <Field
              label="Situação"
              value={display(item.displaySituacao ?? item.situacao)}
            />
            {isSubOs ? <Field label="Tipo" value="Sub-OS" /> : null}
          </Section>

          <Section title="Solicitante" variant="compact">
            <Field label="Categoria" value={display(d.CategoriaLink)} />
            <Field
              label="Nome"
              value={display(d.NomeUsuario ?? item.nome_usuario)}
              wide
              clamp={1}
            />
            <Field label="Sigla" value={display(d.SiglaOrgao)} />
            <Field label="Ramal" value={display(d.RamalUsuario)} />
            <Field
              label="Gabinete"
              value={display(d.GabSalaUsuario)}
              clamp={1}
            />
            <Field
              label="Interessado"
              value={display(d.OrgInteressado)}
              wide
              clamp={1}
            />
            <Field
              label="Contato"
              value={display(d.ContatoTrab)}
              wide
              clamp={2}
            />
          </Section>

          <Section title="Entrega" variant="compact">
            <Field label="Prazo" value={prazo} />
            <Field label="Forma" value={forma} />
            <Field label="Data" value={dataEntrega} />
            <Field label="Responsável" value={responsavel} clamp={1} />
          </Section>
        </>
      ) : null}
    </div>
  );
}

function HeaderFallback({
  item,
  osLabel,
}: {
  item: DashboardOsItem;
  osLabel: string;
}) {
  return (
    <div className="tablet-summary-fallback">
      <p className="tablet-summary-os-id">{osLabel}</p>
      <p className="tablet-summary-fallback-line">
        {display(item.titulo)} · {display(item.produto)}
      </p>
      <p className="tablet-summary-fallback-line">
        {display(item.prioridade)} · prazo {display(item.data_entrega)}
      </p>
    </div>
  );
}
