import { apiUrl } from "@/lib/api";

import type { AnaliseSelectedItem } from "./types";

/** Converte o campo Pags da OS para número inteiro (vazio → null). */
export function parsePgsField(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Prepara HTML de problemas técnicos para exibição isolada em Shadow DOM:
 * preserva <style> do documento (head/body) sem vazar para o app.
 */
export interface AnaliseShadowContent {
  /** CSS extraído do snapshot (vazio se não houver). */
  embeddedStyles: string;
  /** HTML do corpo, sem scripts/links perigosos. */
  bodyHtml: string;
}

function extractStyleBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const css = match[1]?.trim();
    if (css) blocks.push(css);
  }
  return blocks;
}

/** Remove comentários HTML inválidos dentro de <style> (export Word/Outlook). */
function cleanWordStyleCss(css: string): string {
  let out = css;
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<!--[\s\S]*$/g, "");
  out = out.replace(/^\s*-->\s*/gm, "");
  out = out.replace(/@import\b[^;]*;?/gi, "");
  out = out.replace(/@page\s*\{[^}]*\}/gi, "");
  out = out.replace(/expression\s*\(/gi, "");
  out = out.replace(/javascript\s*:/gi, "");
  out = out.replace(/behavior\s*:\s*url\s*\(/gi, "");
  return out;
}

/** CSS para Shadow DOM (escopo .analise-root). */
function normalizeEmbeddedStyles(css: string): string {
  return scopeDocumentSelectors(cleanWordStyleCss(css));
}

/** Escopo: body/html passam a apontar ao container da pré-visualização. */
function scopeDocumentSelectors(css: string): string {
  return css
    .replace(/(^|[,{\s])html\b/g, "$1.analise-root")
    .replace(/(^|[,{\s])body\b/g, "$1.analise-root");
}

const INDICATION_BLOCK_RE =
  /<h3>\s*Indicação do problema no arquivo\s*<\/h3>[\s\S]*$/i;

const INDICATION_SECTION_RE =
  /<h3>\s*Indicação do problema no arquivo\s*<\/h3>\s*<img\b[^>]*>\s*(?:<br\s*\/?>)?/i;

/** Bloco de indicação anexado após </body> (formato legado) — precisa entrar no corpo exibido. */
function splitTrailingIndication(html: string): { main: string; trailing: string } {
  const m = html.match(INDICATION_BLOCK_RE);
  if (!m || m.index === undefined) {
    return { main: html, trailing: "" };
  }
  return { main: html.slice(0, m.index), trailing: m[0] };
}

function extractBodyFragment(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) return bodyMatch[1];
  return html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<\/?body[^>]*>/gi, "");
}

const ANALISE_API_IMG_SRC_RE =
  /(<img\b[^>]*\ssrc=["'])(\/(?:sagra\/)?api\/[^"']+)(["'])/gi;

/** Converte caminho relativo da API (/api/... ou /sagra/api/...) em URL absoluta correta. */
export function toAbsoluteAnaliseApiUrl(relativePath: string): string {
  if (!relativePath || typeof window === "undefined") return relativePath;
  const trimmed = relativePath.trim();
  const apiPath = trimmed.replace(/^\/sagra\/api/, "").replace(/^\/api/, "");
  return `${window.location.origin}${apiUrl(apiPath.startsWith("/") ? apiPath : `/${apiPath}`)}`;
}

/**
 * Garante URLs absolutas em imagens da API (carregam com cookie de sessão no mesmo host).
 */
export function resolveAnaliseMediaUrls(html: string): string {
  if (!html || typeof window === "undefined") return html;
  return html.replace(ANALISE_API_IMG_SRC_RE, (_m, pre: string, path: string, post: string) =>
    `${pre}${toAbsoluteAnaliseApiUrl(path)}${post}`,
  );
}

/** Remove origin do host dev/prod antes de persistir no banco. */
export function normalizeAnaliseMediaUrlsForStorage(html: string): string {
  if (!html || typeof window === "undefined") return html;
  let out = html;
  const origin = window.location.origin;
  const apiPrefix = apiUrl("").replace(/\/$/, "");
  if (out.includes(`${origin}${apiPrefix}/`)) {
    out = out.split(`${origin}${apiPrefix}/`).join(`${apiPrefix}/`);
  }
  if (out.includes(`${origin}/api/`)) {
    out = out.split(`${origin}/api/`).join("/api/");
  }
  return out;
}

/** Reinsere <img> do HTML original se o contentEditable as removeu na serialização. */
function preserveImagesFromOriginal(originalBody: string, editedBody: string): string {
  const imgRe = /<img\b[^>]*\/?>/gi;
  const originalImgs = [...originalBody.matchAll(imgRe)].map((m) => m[0]);
  if (!originalImgs.length) return editedBody;

  let result = editedBody;
  for (const tag of originalImgs) {
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    if (result.includes(src)) continue;
    result += tag;
  }
  return result;
}

const MANUAL_TECNICO_LABELS = new Set(["manual tecnico", "manual técnico"]);

function normalizePtLabelText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isManualTecnicoLabel(htmlFragment: string): boolean {
  return MANUAL_TECNICO_LABELS.has(normalizePtLabelText(htmlFragment));
}

/** Remove apenas blocos cujo texto é exatamente Manual Técnico. */
export function stripRedundantPtItemLabels(html: string, _itemTitulo?: string): string {
  if (!html.trim()) return html;

  const labelBlockRe =
    /<(p|h1|h2|h3|h4|h5|h6|span|strong|b)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let body = html;
  let prev = "";
  while (body !== prev) {
    prev = body;
    body = body.replace(labelBlockRe, (full, _tag, _attrs, inner) =>
      isManualTecnicoLabel(String(inner)) ? "" : full,
    );
  }

  const leadingBlockRe =
    /^\s*<(p|h1|h2|h3|h4|h5|h6|span|strong|b)(\s[^>]*)?>([\s\S]*?)<\/\1>\s*/i;
  while (true) {
    const match = leadingBlockRe.exec(body);
    if (!match || !isManualTecnicoLabel(match[3])) break;
    body = body.slice(match[0].length);
  }

  return body.trim();
}

/** Remove apenas o que vaza para fora do shadow; mantém marcação do corpo. */
function sanitizeAnaliseBodyHtml(html: string): string {
  let out = html;
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<link\b[^>]*\bstylesheet\b[^>]*>/gi, "");
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<base\b[^>]*>/gi, "");
  out = out.replace(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, "");
  return out;
}

/**
 * Separa estilos embutidos e corpo para renderização no Shadow DOM.
 */
export function prepareAnaliseShadowContent(
  html: string,
  itemTitulo?: string,
): AnaliseShadowContent {
  const trimmed = stripRedundantPtItemLabels(html.trim(), itemTitulo);
  if (!trimmed) {
    return { embeddedStyles: "", bodyHtml: "" };
  }

  const styleBlocks = extractStyleBlocks(trimmed).map(normalizeEmbeddedStyles).filter(Boolean);

  const { main, trailing } = splitTrailingIndication(trimmed);
  const bodyRaw = extractBodyFragment(main);
  let bodyHtml = sanitizeAnaliseBodyHtml(bodyRaw);
  if (trailing) {
    bodyHtml += sanitizeAnaliseBodyHtml(trailing);
  }

  return {
    embeddedStyles: styleBlocks.join("\n\n"),
    bodyHtml,
  };
}

/** Corpo pronto para injetar no Shadow DOM (URLs de API absolutas para o browser carregar). */
export function prepareAnaliseShadowDisplay(
  html: string,
  itemTitulo?: string,
): AnaliseShadowContent {
  const prepared = prepareAnaliseShadowContent(html, itemTitulo);
  return {
    embeddedStyles: prepared.embeddedStyles,
    bodyHtml: resolveAnaliseMediaUrls(prepared.bodyHtml),
  };
}

/** Estilos + corpo sem escopo Shadow (documento HTML completo em iframe). */
export function prepareAnaliseDocument(
  html: string,
  itemTitulo?: string,
): { styles: string; bodyHtml: string } {
  const trimmed = stripRedundantPtItemLabels(html.trim(), itemTitulo);
  if (!trimmed) {
    return { styles: "", bodyHtml: "" };
  }
  const styleBlocks = extractStyleBlocks(trimmed).map(cleanWordStyleCss).filter(Boolean);
  const { main, trailing } = splitTrailingIndication(trimmed);
  const bodyRaw = extractBodyFragment(main);
  let bodyHtml = sanitizeAnaliseBodyHtml(bodyRaw);
  if (trailing) {
    bodyHtml += sanitizeAnaliseBodyHtml(trailing);
  }
  return {
    styles: styleBlocks.join("\n\n"),
    bodyHtml: resolveAnaliseMediaUrls(bodyHtml),
  };
}

const IFRAME_BASE_CSS = `
  body { margin: 0; padding: 8px; box-sizing: border-box; }
  img { max-width: 100%; height: auto; display: block; }
  table { max-width: 100%; }
`;

/**
 * Monta documento HTML para iframe (portal do cliente e preview somente leitura).
 * Preserva CSS do Word sem reescrita para Shadow DOM.
 */
export function buildAnaliseSrcDoc(html: string, itemTitulo?: string): string {
  if (typeof window === "undefined") return "";
  const { styles, bodyHtml } = prepareAnaliseDocument(html, itemTitulo);
  const origin = window.location.origin;
  const docStyles = [IFRAME_BASE_CSS, styles].filter(Boolean).join("\n");
  const body = bodyHtml || "<p></p>";
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<base href="${origin}/">` +
    `<style>${docStyles}</style></head><body>${body}</body></html>`
  );
}

/**
 * Sanitiza HTML para persistência (sem tags perigosas; mantém <style> no fragmento).
 */
export function sanitizeAnaliseHtml(html: string): string {
  const { embeddedStyles, bodyHtml } = prepareAnaliseShadowContent(html);
  if (!embeddedStyles) return bodyHtml;
  return `<style>${embeddedStyles}</style>${bodyHtml}`;
}

/** Extrai tags <style> originais sem reescrever o CSS (evita escopo .analise-root no banco). */
function extractRawStyleTags(html: string): string {
  const tags: string[] = [];
  const re = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    tags.push(match[0]);
  }
  return tags.join("");
}

/** Atualiza só o corpo quando o usuário edita no contentEditable. */
export function mergeAnaliseEditableBody(originalHtml: string, newBodyHtml: string): string {
  const trimmed = originalHtml.trim();
  const { bodyHtml: originalBody } = prepareAnaliseShadowContent(trimmed);
  const safeBody = normalizeAnaliseMediaUrlsForStorage(
    preserveImagesFromOriginal(
      originalBody,
      sanitizeAnaliseBodyHtml(newBodyHtml),
    ),
  );

  if (/<body[\s>]/i.test(trimmed)) {
    return normalizeAnaliseMediaUrlsForStorage(
      trimmed.replace(/<body[^>]*>[\s\S]*<\/body>/i, `<body>${safeBody}</body>`),
    );
  }

  const stylePrefix = extractRawStyleTags(trimmed);
  if (stylePrefix) {
    return normalizeAnaliseMediaUrlsForStorage(`${stylePrefix}${safeBody}`);
  }
  return safeBody;
}

function isAllowedIndicationImageSrc(src: string): boolean {
  const s = src.trim();
  if (s.startsWith("data:image/")) return true;
  if (s.startsWith("http://") || s.startsWith("https://")) return true;
  return /^\/?(?:sagra\/)?api\/analise\/item\/\d+\/indication\/[^"'\s]+$/i.test(s);
}

/** Fragmento HTML da captura de indicação (base64 ou URL servida pela API). */
export function buildIndicationImageHtml(imageSrc: string): string {
  const src = imageSrc.trim();
  if (!isAllowedIndicationImageSrc(src)) {
    return "";
  }
  const escaped = src.replace(/"/g, "&quot;");
  return (
    '<h3>Indicação do problema no arquivo</h3>' +
    `<img src="${escaped}" alt="Indicação no arquivo" ` +
    'style="max-width:100%; height:auto; border:1px solid #ccc; margin-top:10px; display:block;">' +
    "<br>"
  );
}

/** Remove bloco de indicação anterior (substituição ao salvar nova captura). */
function stripExistingIndicationBlock(html: string): string {
  return html.replace(INDICATION_BLOCK_RE, "").trim();
}

/** Anexa indicação dentro do documento (antes de </body>) para o preview/editor enxergarem. */
export function appendIndicationToAnaliseHtml(currentHtml: string, imageSrc: string): string {
  const injection = buildIndicationImageHtml(imageSrc);
  if (!injection) {
    return currentHtml;
  }
  const base = stripExistingIndicationBlock(currentHtml);
  if (!base) {
    return injection;
  }
  if (/<\/body>/i.test(base)) {
    return base.replace(/<\/body>/i, `${injection}</body>`);
  }
  return `${base}${injection}`;
}

/** Verifica se o HTML do item contém bloco de indicação no arquivo. */
export function hasIndicationInAnaliseHtml(html: string): boolean {
  const trimmed = (html || "").trim();
  if (!trimmed) return false;
  return INDICATION_SECTION_RE.test(trimmed) || INDICATION_BLOCK_RE.test(trimmed);
}

/** Remove bloco de indicação no arquivo do HTML do item. */
export function removeIndicationFromAnaliseHtml(html: string): string {
  let out = (html || "").replace(INDICATION_SECTION_RE, "");
  out = out.replace(INDICATION_BLOCK_RE, "");
  return out.trim();
}

/** Rótulo PTVx a partir da versão analisada (ex.: Original V3 → PTV3). */
export function formatPtvLabel(versionLabel: string): string {
  const verClean = versionLabel
    .toLowerCase()
    .replace(/original/g, "")
    .replace(/v/g, "")
    .replace(/[()]/g, "")
    .trim();
  return `PTV${verClean || "?"}`;
}

/** Texto das correções internas SEFOC para observação de andamento. */
export function buildCorrecoesSefocText(items: AnaliseSelectedItem[]): string {
  const corrected = items.filter((i) => i.corrigidoSefoc);
  if (!corrected.length) return "";
  const lines = corrected.map((item) => {
    const note = item.obsCorrecaoSefoc?.trim();
    return note ? `- ${item.titulo}\n ${note}` : `- ${item.titulo}`;
  });
  return `Problemas corrigidos pela SEFOC:\n${lines.join("\n")}`;
}

export function buildPtMovementObsWithCorrecoes(
  items: AnaliseSelectedItem[],
  versionLabel: string,
): string {
  const correcoes = buildCorrecoesSefocText(items);
  const ptv = formatPtvLabel(versionLabel);
  return `${correcoes}\n\nEnviar ${ptv}`;
}

export function buildExecutionObsWithCorrecoes(items: AnaliseSelectedItem[]): string {
  return `${buildCorrecoesSefocText(items)}\n\nDar prosseguimento:`;
}
