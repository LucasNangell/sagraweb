import { pdfCompareAssetUrl } from "./api";
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
  onIncludeUnchangedChange: (value: boolean) => void;
  onExport: () => void;
  exportDisabled?: boolean;
  onClose: () => void;
}

export function OsPdfCompareReport({
  result,
  includeUnchanged,
  onIncludeUnchangedChange,
  onExport,
  exportDisabled = false,
  onClose,
}: OsPdfCompareReportProps) {
  const pages = (result.pages || []).filter(
    (p) => includeUnchanged || p.changedPercent > 0.01 || p.status !== "compared",
  );
  const list = pages.length > 0 ? pages : result.pages || [];
  const changed = list.filter(
    (p) => p.changedPercent > 0.01 || p.status !== "compared",
  ).length;
  const identical = list.length - changed;
  const maxPct = list.reduce((m, p) => Math.max(m, p.changedPercent), 0);
  const totalBoxes = list.reduce((m, p) => m + (p.boxes?.length ?? 0), 0);

  return (
    <div className="os-pdf-report-overlay" role="dialog" aria-modal="true" aria-label="Relatório">
      <button
        type="button"
        className="os-pdf-report-backdrop"
        aria-label="Fechar relatório"
        onClick={onClose}
      />
      <section className="os-pdf-report-sheet">
        <header className="os-pdf-report-sheet-header">
          <div>
            <h2>Relatório de comparação de versões</h2>
            <p>SAGRA Web — Comparador de versões PDF</p>
          </div>
          <button
            type="button"
            className="os-pdf-report-close"
            onClick={onClose}
            aria-label="Ocultar relatório"
          >
            Ocultar
          </button>
        </header>

        <div className="os-pdf-report-sheet-body">
          <p className="os-pdf-report-summary">{result.summary}</p>

          <dl className="os-pdf-report-kv">
            <div>
              <dt>Versão anterior</dt>
              <dd title={result.previousRelative}>
                {result.previousName || "—"}
              </dd>
            </div>
            <div>
              <dt>Caminho anterior</dt>
              <dd title={result.previousRelative}>
                {result.previousRelative || "—"}
              </dd>
            </div>
            <div>
              <dt>Versão atual</dt>
              <dd title={result.currentRelative}>
                {result.currentName || "—"}
              </dd>
            </div>
            <div>
              <dt>Caminho atual</dt>
              <dd title={result.currentRelative}>
                {result.currentRelative || "—"}
              </dd>
            </div>
            <div>
              <dt>Resolução</dt>
              <dd>{result.dpi} DPI</dd>
            </div>
            <div>
              <dt>Tolerância</dt>
              <dd>{result.threshold}</dd>
            </div>
            <div>
              <dt>Páginas anterior</dt>
              <dd>{result.pageCountA}</dd>
            </div>
            <div>
              <dt>Páginas atual</dt>
              <dd>{result.pageCountB}</dd>
            </div>
            <div>
              <dt>Medida real A (pág. 1)</dt>
              <dd>
                {result.pages[0]?.widthA && result.pages[0]?.heightA
                  ? `${result.pages[0].widthA} × ${result.pages[0].heightA} px`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Medida real B (pág. 1)</dt>
              <dd>
                {result.pages[0]?.widthB && result.pages[0]?.heightB
                  ? `${result.pages[0].widthB} × ${result.pages[0].heightB} px`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Páginas no relatório</dt>
              <dd>{list.length}</dd>
            </div>
            <div>
              <dt>Com alteração</dt>
              <dd>{changed}</dd>
            </div>
            <div>
              <dt>Sem alteração</dt>
              <dd>{identical}</dd>
            </div>
            <div>
              <dt>Maior % alterado</dt>
              <dd>{maxPct.toFixed(3)}%</dd>
            </div>
            <div>
              <dt>Regiões detectadas</dt>
              <dd>{totalBoxes}</dd>
            </div>
            <div>
              <dt>Conclusão</dt>
              <dd>{result.summary}</dd>
            </div>
          </dl>

          <label className="os-pdf-report-include check">
            <input
              type="checkbox"
              checked={includeUnchanged}
              onChange={(e) => onIncludeUnchangedChange(e.target.checked)}
            />
            Incluir páginas sem mudança no relatório
          </label>

          <h3 className="os-pdf-report-section-title">Inventário por página</h3>
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

          {list.map((page) => {
            const images = [
              { label: "Diferença", url: pdfCompareAssetUrl(page.urls.diff) },
              { label: "Anterior", url: pdfCompareAssetUrl(page.urls.a) },
              { label: "Atual", url: pdfCompareAssetUrl(page.urls.b) },
              { label: "Sobreposição", url: pdfCompareAssetUrl(page.urls.blend) },
            ].filter((item) => item.url);

            return (
              <article key={`detail-${page.index}`} className="os-pdf-report-page">
                <h3>Página {page.pageNumber}</h3>
                <p>
                  Status: {statusLabel(page)} | Alterado:{" "}
                  {page.changedPercent.toFixed(3)}% | Pixels:{" "}
                  {page.changedPixels}/{page.totalPixels} | Regiões:{" "}
                  {page.boxes?.length ?? 0} | Severidade: {severityLabel(page)}
                </p>
                <div className="os-pdf-report-page-images">
                  {images.map((item) => (
                    <figure key={item.label}>
                      <figcaption>{item.label}</figcaption>
                      <img src={item.url!} alt={`${item.label} página ${page.pageNumber}`} />
                    </figure>
                  ))}
                </div>
              </article>
            );
          })}

          <div className="os-pdf-report-footer">
            <button
              type="button"
              className="primary"
              disabled={exportDisabled}
              onClick={onExport}
            >
              Exportar relatório PDF
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
