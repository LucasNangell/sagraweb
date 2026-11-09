import type { ComparePage, CompareResult } from "./types";

function severityLabel(page: ComparePage): string {
  if (page.status !== "compared") return "Crítica";
  if (page.changedPercent <= 0.01) return "Nenhuma";
  if (page.changedPercent < 0.5) return "Baixa";
  if (page.changedPercent < 2) return "Média";
  return "Alta";
}

function statusLabel(page: ComparePage): string {
  if (page.status === "only-previous") return "Somente na anterior";
  if (page.status === "only-current") return "Somente na atual";
  return "Comparada";
}

interface OsPdfCompareReportProps {
  result: CompareResult;
  includeUnchanged: boolean;
}

export function OsPdfCompareReport({
  result,
  includeUnchanged,
}: OsPdfCompareReportProps) {
  const pages = (result.pages || []).filter(
    (p) => includeUnchanged || p.changedPercent > 0.01 || p.status !== "compared",
  );
  const list = pages.length > 0 ? pages : result.pages || [];
  const changed = list.filter(
    (p) => p.changedPercent > 0.01 || p.status !== "compared",
  ).length;
  const maxPct = list.reduce((m, p) => Math.max(m, p.changedPercent), 0);
  const totalBoxes = list.reduce((m, p) => m + (p.boxes?.length ?? 0), 0);

  return (
    <section className="os-pdf-report">
      <header>
        <h2>Relatório</h2>
        <p>{result.summary}</p>
      </header>

      <dl className="os-pdf-report-kv">
        <div>
          <dt>Anterior</dt>
          <dd title={result.previousRelative}>{result.previousName}</dd>
        </div>
        <div>
          <dt>Atual</dt>
          <dd title={result.currentRelative}>{result.currentName}</dd>
        </div>
        <div>
          <dt>DPI / tolerância</dt>
          <dd>
            {result.dpi} / {result.threshold}
          </dd>
        </div>
        <div>
          <dt>Páginas A / B</dt>
          <dd>
            {result.pageCountA} / {result.pageCountB}
          </dd>
        </div>
        <div>
          <dt>Com alteração</dt>
          <dd>{changed}</dd>
        </div>
        <div>
          <dt>Maior % / regiões</dt>
          <dd>
            {maxPct.toFixed(3)}% / {totalBoxes}
          </dd>
        </div>
      </dl>

      <div className="os-pdf-report-table-wrap">
        <table className="os-pdf-report-table">
          <thead>
            <tr>
              <th>Pág.</th>
              <th>Status</th>
              <th>Alterado</th>
              <th>Regiões</th>
              <th>Severidade</th>
            </tr>
          </thead>
          <tbody>
            {list.map((page) => (
              <tr key={page.index}>
                <td>{page.pageNumber}</td>
                <td>{statusLabel(page)}</td>
                <td>{page.changedPercent.toFixed(3)}%</td>
                <td>{page.boxes?.length ?? 0}</td>
                <td>{severityLabel(page)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
