import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { DashboardOsItem } from "@/board/types";
import { formatQueueDisplayLabel } from "@/board/utils";

import { fetchOsDetails, type OsDetails } from "./api";

interface OsSummaryProps {
  item: DashboardOsItem;
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="os-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function OsSummary({ item }: OsSummaryProps) {
  const [details, setDetails] = useState<OsDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchOsDetails(item.ano, item.nr_os)
      .then((d) => {
        if (!cancelled) setDetails(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.ano, item.nr_os]);

  return (
    <div className="os-summary">
      <h2>{formatQueueDisplayLabel(item)}</h2>
      <p className="os-summary-situacao">{item.displaySituacao}</p>

      {loading ? (
        <div className="board-loading">
          <Loader2 className="spin" size={24} />
        </div>
      ) : error ? (
        <div className="alert-error">{error}</div>
      ) : (
        <dl className="os-fields">
          <Field label="Título" value={details?.Titulo ?? item.titulo} />
          <Field label="Produto" value={details?.Produto ?? item.produto} />
          <Field label="Formato" value={details?.Formato ?? item.formato} />
          <Field label="Tiragem" value={details?.Tiragem ?? item.tiragem} />
          <Field label="Páginas" value={details?.Paginas ?? item.pags} />
          <Field label="Solicitante" value={details?.Solicitante} />
          <Field label="Setor" value={details?.Setor ?? item.setor} />
          <Field label="Prioridade" value={details?.Prioridade ?? item.prioridade} />
          <Field
            label="Entrega"
            value={details?.DataEntrega ?? item.data_entrega}
          />
          <Field
            label="Observação"
            value={details?.Observacao ?? item.observacao}
          />
        </dl>
      )}
    </div>
  );
}
