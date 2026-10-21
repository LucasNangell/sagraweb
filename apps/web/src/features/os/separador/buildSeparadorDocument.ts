function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SeparadorDocumentInput {
  osLabel: string;
  cadNumbers: string[];
  logoSrc: string;
  titulo: string;
  solicitante: string;
  produto: string;
}

const SEPARADOR_STYLES = `
@page {
  size: 102mm 297mm;
  margin: 0;
}
html, body {
  margin: 0;
  padding: 0;
  background: #fff;
  color: #232120;
  font-family: Calibri, "Segoe UI", Arial, Helvetica, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  color-adjust: exact;
}
.page {
  width: 102mm;
  height: 297mm;
  box-sizing: border-box;
  padding: 10mm 7mm 8mm;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
}
.page:last-child {
  page-break-after: auto;
  break-after: auto;
}
.logo {
  width: 88mm;
  height: auto;
  display: block;
}
.title {
  margin: 16mm 0 0;
  text-align: center;
  font-size: 18pt;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: 0.04em;
}
.spacer {
  flex: 0 0 42mm;
  height: 42mm;
  min-height: 42mm;
}
.mark {
  border-top: 1.2pt dotted #232120;
  margin: 0 2mm 4mm;
}
.field {
  position: relative;
  border: 1.5pt solid #232120;
  min-height: 22mm;
  margin: 5mm 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.field-os {
  min-height: 0;
  height: auto;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  padding: 3mm 2.5mm 2mm;
  box-sizing: border-box;
  gap: 1mm;
}
.field-cad {
  min-height: 28mm;
  height: 30mm;
  padding: 3mm 2.5mm 2mm;
  box-sizing: border-box;
}
.field-label {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translate(-50%, -58%);
  background: #fff;
  padding: 0 4.5mm;
  font-size: 20pt;
  font-weight: 700;
  line-height: 1;
}
.field-value {
  font-size: 22pt;
  font-weight: 700;
  padding-top: 2mm;
  letter-spacing: 0.02em;
}
.field-os .field-value,
.field-cad .field-value {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 12mm;
  padding: 0;
  overflow: hidden;
  white-space: nowrap;
  line-height: 0.9;
  font-size: 48pt;
  letter-spacing: 0;
}
.field-cad .field-value {
  min-height: 22mm;
  font-size: 72pt;
}
.os-meta {
  width: 100%;
  margin-top: 0;
  font-size: 7.5pt;
  line-height: 1.12;
  text-align: left;
}
.os-meta-row {
  display: grid;
  grid-template-columns: 20mm 1fr;
  column-gap: 1mm;
  margin-top: 0.15mm;
}
.os-meta-label {
  font-weight: 700;
}
.os-meta-value {
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  word-break: break-word;
}
.block {
  margin-top: 4.5mm;
}
.block h2 {
  margin: 0 0 1mm;
  font-size: 12pt;
  font-weight: 700;
  letter-spacing: 0.04em;
}
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
th, td {
  border: 1.1pt solid #232120;
  text-align: center;
  vertical-align: middle;
}
thead th {
  background: #bbbdbf;
  font-size: 9.5pt;
  font-weight: 700;
  padding: 1.4mm 1mm;
}
td {
  height: 9.5mm;
  font-size: 10pt;
}
td.lado {
  font-size: 18pt;
  font-weight: 700;
  width: 16mm;
}
.col-qtd {
  width: 26mm;
}
.dobra td {
  height: 11mm;
}
.obs {
  margin-top: 4.5mm;
  border: 1.4pt solid #232120;
  min-height: 26mm;
  padding: 1mm 3mm 2mm;
  box-sizing: border-box;
}
.obs-title {
  font-size: 12pt;
  font-weight: 700;
}
.obs-line {
  border-bottom: 0.8pt solid #232120;
  height: 5mm;
}
@media print {
  html, body {
    width: 102mm;
    height: auto;
    background: #fff;
  }
}
`;

function renderPage(
  osLabel: string,
  cad: string,
  logoSrc: string,
  titulo: string,
  solicitante: string,
  produto: string,
): string {
  const os = escapeHtml(osLabel);
  const cadEsc = escapeHtml(cad);
  const src = escapeHtml(logoSrc);
  const tituloEsc = escapeHtml(titulo);
  const solicitanteEsc = escapeHtml(solicitante);
  const produtoEsc = escapeHtml(produto);
  return `
<article class="page" data-page="${cadEsc}">
  <img class="logo" src="${src}" alt="Câmara dos Deputados — Coordenação Gráfica da Câmara" />
  <h1 class="title">SEPARADOR<br>DE CADERNOS</h1>
  <div class="spacer"></div>
  <div class="mark"></div>
  <div class="field field-os">
    <div class="field-label">OS</div>
    <div class="field-value" data-os>${os}</div>
    <div class="os-meta">
      <div class="os-meta-row">
        <span class="os-meta-label">Título</span>
        <span class="os-meta-value" data-titulo>${tituloEsc}</span>
      </div>
      <div class="os-meta-row">
        <span class="os-meta-label">Solicitante</span>
        <span class="os-meta-value" data-solicitante>${solicitanteEsc}</span>
      </div>
      <div class="os-meta-row">
        <span class="os-meta-label">Produto</span>
        <span class="os-meta-value" data-produto>${produtoEsc}</span>
      </div>
    </div>
  </div>
  <div class="field field-cad">
    <div class="field-label">CAD.</div>
    <div class="field-value" data-cad="${cadEsc}">${cadEsc}</div>
  </div>
  <section class="block">
    <h2>IMPRESSÃO</h2>
    <table>
      <thead>
        <tr>
          <th class="lado">LADO</th>
          <th class="col-qtd">Qtd.Folhas</th>
          <th>IMPRESSOR</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="lado">F</td>
          <td class="col-qtd"></td>
          <td></td>
        </tr>
        <tr>
          <td class="lado">V</td>
          <td class="col-qtd"></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </section>
  <section class="block">
    <h2>DOBRA</h2>
    <table class="dobra">
      <thead>
        <tr>
          <th class="col-qtd">Qtd.Folhas</th>
          <th>DOBRADOR</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="col-qtd"></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </section>
  <section class="obs">
    <div class="obs-title">OBS:</div>
    <div class="obs-line"></div>
    <div class="obs-line"></div>
    <div class="obs-line"></div>
    <div class="obs-line"></div>
  </section>
</article>`;
}

export function buildSeparadorDocument({
  osLabel,
  cadNumbers,
  logoSrc,
  titulo,
  solicitante,
  produto,
}: SeparadorDocumentInput): string {
  const pages = cadNumbers
    .map((cad) =>
      renderPage(osLabel, cad, logoSrc, titulo, solicitante, produto),
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Separador de cadernos</title>
  <style>${SEPARADOR_STYLES}</style>
</head>
<body>
${pages}
<script>
  function fitField(el, max) {
    var min = 18;
    var size = max;
    el.style.fontSize = size + "pt";
    while (size > min && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)) {
      size -= 0.5;
      el.style.fontSize = size + "pt";
    }
  }
  function fitNumbers() {
    document.querySelectorAll("[data-os]").forEach(function (el) { fitField(el, 72); });
    document.querySelectorAll("[data-cad]").forEach(function (el) { fitField(el, 96); });
  }
  function whenImagesReady(done) {
    var imgs = Array.prototype.slice.call(document.images || []);
    Promise.all(imgs.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        img.onload = resolve;
        img.onerror = resolve;
      });
    })).then(done);
  }
  window.addEventListener("load", function () {
    fitNumbers();
  });
  fitNumbers();
  window.addEventListener("message", function (event) {
    if (event.data !== "print") return;
    whenImagesReady(function () {
      fitNumbers();
      window.print();
    });
  });
</script>
</body>
</html>`;
}
