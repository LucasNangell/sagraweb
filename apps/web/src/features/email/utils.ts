import { normalizeAno } from "@/features/os/osAnoUtils";

export function normalizeText(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

export function extractEmailsSimple(text: string | null | undefined): string[] {
  if (!text) return [];
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return (text.match(emailRegex) ?? []).map((e) => e.trim());
}

/** Extrai pontos no padrão P_0000 ou P_000000 do texto de contato. */
export function extractPontosSimple(text: string | null | undefined): string[] {
  if (!text) return [];
  const re = /\bP_\d{4,6}\b/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.match(re) ?? []) {
    const norm = match.toUpperCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

export function parseOsAno(subject: string | null | undefined): {
  os: number | "";
  ano: number | "";
} {
  if (!subject) return { os: "", ano: "" };

  const matchPadrao = subject.match(/(\d{1,5})\s*\/\s*(\d{2,4})/);
  if (matchPadrao) {
    const os = parseInt(matchPadrao[1], 10);
    const ano = normalizeAno(parseInt(matchPadrao[2], 10));
    return { os, ano: ano ?? "" };
  }

  const matchSimples = subject.match(/OS\s*:?\s*(\d{1,5})/i);
  if (matchSimples) {
    const os = parseInt(matchSimples[1], 10);
    const currentYear = new Date().getFullYear();
    const matchAno = subject.match(/\b(20\d{2})\b/);
    const ano = normalizeAno(
      matchAno ? parseInt(matchAno[1], 10) : currentYear,
    );
    return { os, ano: ano ?? "" };
  }

  return { os: "", ano: "" };
}

export interface InboxEmailBodyParts {
  main: string;
  quoted: string | null;
}

function trimHtmlContent(html: string): string {
  let out = html.trim();
  out = out.replace(/(<br\s*\/?>\s*)+$/gi, "");
  out = out.replace(/<p[^>]*>(&nbsp;|\s)*<\/p>/gi, "");
  out = out.replace(/<div[^>]*>(&nbsp;|\s)*<\/div>/gi, "");
  return out.trim();
}

export function hasVisibleHtmlContent(html: string): boolean {
  const text = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0;
}

/** Localiza o início do bloco citado (e-mail respondido) em HTML do Outlook e similares. */
export function findQuotedEmailStart(html: string): number {
  const candidates: number[] = [];

  const pushIfValid = (index: number | undefined | null) => {
    if (index == null || index < 0) return;
    if (index >= 15 || hasVisibleHtmlContent(html.slice(0, index))) {
      candidates.push(index);
    }
  };

  const divRply = /<div\b[^>]*\bid=["']divRplyFwdMsg["'][^>]*>/i.exec(html);
  pushIfValid(divRply?.index);

  const hrThenDe =
    /<hr\b[^>]*>\s*(?:[\s\S]{0,120}?)(?:<b\b[^>]*>\s*)?(?:De|From)\s*:/i.exec(html);
  pushIfValid(hrThenDe?.index);

  const hrOnly = /<hr\b[^>]*>/gi;
  let hrMatch: RegExpExecArray | null;
  while ((hrMatch = hrOnly.exec(html)) !== null) {
    const after = html.slice(hrMatch.index, hrMatch.index + 900);
    if (
      /(?:De|From)\s*:/i.test(after) &&
      /(?:Enviada em|Enviado em|Sent)\s*:/i.test(after) &&
      /(?:Para|To)\s*:/i.test(after)
    ) {
      pushIfValid(hrMatch.index);
    }
  }

  const headerBlock =
    /(?:<b\b[^>]*>\s*)?(?:De|From)\s*:\s*(?:<\/b>)?[\s\S]{0,700}?(?:Enviada em|Enviado em|Sent)\s*:[\s\S]{0,700}?(?:Para|To)\s*:[\s\S]{0,700}?(?:Assunto|Subject)\s*:/i.exec(
      html,
    );
  pushIfValid(headerBlock?.index);

  const blockquote = /<blockquote\b[^>]*>/i.exec(html);
  pushIfValid(blockquote?.index);

  const originalMsg =
    /-----?\s*(?:Original Message|Mensagem original)\s*-----/i.exec(html);
  pushIfValid(originalMsg?.index);

  if (candidates.length === 0) {
    const lines = html.split("\n");
    const cutIndex = lines.findIndex((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith("De:") ||
        trimmed.startsWith("From:") ||
        trimmed.includes("________________")
      );
    });
    if (cutIndex > 0) {
      const charIndex = lines.slice(0, cutIndex).join("\n").length;
      pushIfValid(charIndex);
    }
  }

  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

/** Separa a resposta atual do e-mail citado (thread). */
export function splitInboxEmailThread(body: string | null | undefined): InboxEmailBodyParts {
  if (!body) return { main: "", quoted: null };

  const content = body;
  const cutAt = findQuotedEmailStart(content);

  if (cutAt < 0) {
    return { main: trimHtmlContent(content), quoted: null };
  }

  const main = trimHtmlContent(content.slice(0, cutAt));
  const quoted = trimHtmlContent(content.slice(cutAt));

  if (!quoted || !hasVisibleHtmlContent(quoted)) {
    return { main: trimHtmlContent(content), quoted: null };
  }

  return { main, quoted };
}

export function stripThread(body: string | null | undefined): string {
  const { main } = splitInboxEmailThread(body);
  let content = main;

  content = content.replace(/\n\s*\n\s*\n/g, "\n\n");
  content = content.replace(/(\r\n|\n|\r){3,}/g, "\n\n");
  content = content.replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>");

  return sanitizeEmailHtml(trimHtmlContent(content));
}

/** Normaliza Content-ID / cid: para comparação (sem prefixo cid: e sem <>). */
export function normalizeContentId(raw: string): string {
  return raw.replace(/^cid:/i, "").replace(/^<|>$/g, "").trim().toLowerCase();
}

function lookupInlineImageIndex(
  cid: string,
  inlineImages: Record<string, number>,
): number | undefined {
  const normalized = normalizeContentId(cid);
  if (!normalized) return undefined;

  if (inlineImages[normalized] != null) return inlineImages[normalized];

  for (const [key, index] of Object.entries(inlineImages)) {
    if (normalizeContentId(key) === normalized) return index;
  }

  return undefined;
}

function isUnresolvableImageSrc(src: string): boolean {
  const s = src.trim();
  if (!s) return true;
  if (/^cid:/i.test(s)) return true;
  if (/^data-src-cid:/i.test(s)) return true;
  if (/^file:/i.test(s)) return true;
  if (/^[a-z]:\\/i.test(s)) return true;
  if (/\\/.test(s) && !/^https?:\/\//i.test(s) && !/^data:/i.test(s)) return true;
  return false;
}

/** Substitui src cid: por URL de download (img e v:imagedata do Outlook). */
export function resolveInlineCidImagesInHtml(
  html: string,
  entryId: string,
  inlineImages: Record<string, number>,
  buildDownloadUrl: (entryId: string, attIndex: number) => string,
): string {
  let out = resolveInlineCidImages(html, entryId, inlineImages, buildDownloadUrl);

  out = out.replace(/<v:imagedata\b[^>]*>/gi, (tag) => {
    const srcMatch = /\bsrc=["']([^"']*)["']/i.exec(tag);
    if (!srcMatch) return tag;
    const src = srcMatch[1].trim();
    if (!/^cid:/i.test(src)) return tag;
    const index = lookupInlineImageIndex(src, inlineImages);
    if (index == null) return tag;
    const url = buildDownloadUrl(entryId, index);
    return tag.replace(/src=["']cid:[^"']*["']/i, `src="${url}"`);
  });

  return out;
}

/** Prévia Apogee: mantém imagens e resolve cid: como no e-mail enviado ao cliente. */
export function prepareApogeeEmailBody(
  body: string | null | undefined,
  opts?: PrepareInboxEmailBodyOptions,
): string {
  if (!body?.trim()) return "";

  let out = sanitizeEmailHtml(body.trim());

  if (opts?.entryId && opts.inlineImages && opts.buildDownloadUrl) {
    out = resolveInlineCidImagesInHtml(
      out,
      opts.entryId,
      opts.inlineImages,
      opts.buildDownloadUrl,
    );
  }

  return out;
}

/** Substitui src cid: por URL de download ou remove imagens irrecuperáveis. */
export function resolveInlineCidImages(
  html: string,
  entryId: string,
  inlineImages: Record<string, number>,
  buildDownloadUrl: (entryId: string, attIndex: number) => string,
): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = /\bsrc=["']([^"']*)["']/i.exec(tag);
    if (!srcMatch) return tag;

    const src = srcMatch[1].trim();
    if (!/^cid:/i.test(src)) return tag;

    const index = lookupInlineImageIndex(src, inlineImages);
    if (index == null) return "";

    const url = buildDownloadUrl(entryId, index);
    return tag.replace(/src=["']cid:[^"']*["']/i, `src="${url}"`);
  });
}

/** Remove todas as imagens inline do corpo (visualização texto-only na caixa de entrada). */
export function removeAllEmailImages(html: string): string {
  let out = html.replace(/<img\b[^>]*>/gi, "");
  out = out.replace(/<v:imagedata\b[^>]*\/?>/gi, "");
  out = out.replace(/<v:shape\b[^>]*>[\s\S]*?<\/v:shape>/gi, "");
  out = out.replace(/\sdata-src-cid=["'][^"']*["']/gi, "");
  return out;
}

/** Remove imagens irrecuperáveis e artefatos textuais do Outlook. */
export function removeBrokenEmailImages(html: string): string {
  let out = removeAllEmailImages(html);

  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = /\bsrc=["']([^"']*)["']/i.exec(tag);
    if (!srcMatch) return tag;
    return isUnresolvableImageSrc(srcMatch[1]) ? "" : tag;
  });

  // Fallback textual do Outlook quando a imagem não carrega (ex.: "Descrição: cid:…").
  out = out.replace(
    /(?:^|\s|<br\s*\/?>|\n)\s*Descrição:\s*(?:Descrição:\s*)*(?:cid:[^\s<]+|[a-z]:\\[^\s<]+|file:[^\s<]+)\s*/gi,
    " ",
  );

  return out;
}

function cleanupInboxHtmlPart(html: string): string {
  let out = sanitizeEmailHtml(html);
  out = removeAllEmailImages(out);
  out = out.replace(
    /(?:^|\s|<br\s*\/?>|\n)\s*Descrição:\s*(?:Descrição:\s*)*(?:cid:[^\s<]+|[a-z]:\\[^\s<]+|file:[^\s<]+)\s*/gi,
    " ",
  );
  out = out.replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>");
  return trimHtmlContent(out);
}

export interface PrepareInboxEmailBodyOptions {
  entryId?: string;
  inlineImages?: Record<string, number>;
  buildDownloadUrl?: (entryId: string, attIndex: number) => string;
}

/**
 * Prepara o HTML da caixa de entrada: separa resposta/citação e exibe sem imagens.
 * A parte citada fica disponível em `quoted` para expansão via "Ver mais".
 */
export function prepareInboxEmailBodyParts(
  body: string | null | undefined,
  _opts?: PrepareInboxEmailBodyOptions,
): InboxEmailBodyParts {
  const { main, quoted } = splitInboxEmailThread(body);
  return {
    main: cleanupInboxHtmlPart(main),
    quoted: quoted ? cleanupInboxHtmlPart(quoted) : null,
  };
}

/** Retorna apenas a resposta (parte principal), sem a citação. */
export function prepareInboxEmailBody(
  body: string | null | undefined,
  opts?: PrepareInboxEmailBodyOptions,
): string {
  return prepareInboxEmailBodyParts(body, opts).main;
}

/**
 * Remove tags que vazam CSS/JS para o documento (ex.: <style> do Outlook
 * redefinindo todos os links da aplicação como sublinhados/roxo).
 */
const RESPONSIVE_EMAIL_EDIT_CSS =
  "img{max-width:100%!important;height:auto!important;display:block}" +
  "table{max-width:100%!important;height:auto!important}" +
  "td,th{word-break:break-word;overflow-wrap:anywhere}" +
  "body{overflow-x:auto;max-width:100%;margin:0;padding:8px;outline:none;cursor:text}";

/** Monta documento HTML editável em iframe (preserva estilos do modelo de e-mail). */
export function buildEmailEditSrcDoc(html: string): string {
  const trimmed = (html || "").trim();
  if (!trimmed) {
    return (
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
      '<body contenteditable="true"></body></html>'
    );
  }

  const ensureDoctype = (doc: string) =>
    /<!DOCTYPE/i.test(doc) ? doc : `<!DOCTYPE html>${doc}`;

  if (/<html[\s>]/i.test(trimmed)) {
    let out = trimmed;
    if (!/<meta\s+charset/i.test(out)) {
      out = /<head[\s>]/i.test(out)
        ? out.replace(/<head(\s[^>]*)?>/i, '<head$1><meta charset="utf-8">')
        : out.replace(/<html(\s[^>]*)?>/i, '<html$1><head><meta charset="utf-8"></head>');
    }
    if (/<body\b/i.test(out)) {
      out = out.replace(/<body(\s[^>]*)?>/i, (_match, attrs = "") => {
        const existing = String(attrs || "");
        if (/contenteditable/i.test(existing)) return `<body${existing}>`;
        const styleMatch = /style=["']([^"']*)["']/i.exec(existing);
        const baseStyle = "outline:none;cursor:text;";
        if (styleMatch) {
          const merged = `${styleMatch[1]};${baseStyle}`;
          const withoutStyle = existing.replace(/style=["'][^"']*["']/i, "");
          return `<body${withoutStyle} style="${merged}" contenteditable="true">`;
        }
        return `<body${existing} contenteditable="true" style="${baseStyle}">`;
      });
    }
    if (/<\/head>/i.test(out)) {
      out = out.replace(
        /<\/head>/i,
        `<style>${RESPONSIVE_EMAIL_EDIT_CSS}</style></head>`,
      );
    }
    return ensureDoctype(out);
  }

  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    `<style>${RESPONSIVE_EMAIL_EDIT_CSS}</style></head>` +
    `<body contenteditable="true">${trimmed}</body></html>`
  );
}

/** Serializa o documento editado no iframe para envio ao backend. */
export function serializeEmailDocument(doc: Document): string {
  const dt = doc.doctype;
  const doctype = dt
    ? `<!DOCTYPE ${dt.name}>`
    : "<!DOCTYPE html>";
  return `${doctype}${doc.documentElement.outerHTML}`;
}

export function sanitizeEmailHtml(html: string): string {
  let out = html;
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<link\b[^>]*\bstylesheet\b[^>]*>/gi, "");
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<base\b[^>]*>/gi, "");
  out = out.replace(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, "");
  return out;
}

/** Separa documento HTML de e-mail em envelope + corpo editável. */
export function splitEmailHtmlDocument(html: string): {
  beforeBody: string;
  bodyHtml: string;
  afterBody: string;
} {
  const match = html.match(/^([\s\S]*?<body[^>]*>)([\s\S]*)(<\/body>[\s\S]*)$/i);
  if (match) {
    return { beforeBody: match[1], bodyHtml: match[2], afterBody: match[3] };
  }
  return { beforeBody: "", bodyHtml: html, afterBody: "" };
}

export function joinEmailHtmlDocument(
  parts: { beforeBody: string; bodyHtml: string; afterBody: string },
  bodyHtml: string,
): string {
  if (!parts.beforeBody && !parts.afterBody) return bodyHtml;
  return parts.beforeBody + bodyHtml + parts.afterBody;
}

export function isApogeePendencia(item: {
  source?: "db" | "apogee";
  email_entry_id?: string;
}): boolean {
  return item.source === "apogee" || Boolean(item.email_entry_id?.trim());
}

export function pendenciaKey(item: {
  os: number;
  ano: number;
  source?: "db" | "apogee";
  email_entry_id?: string;
}): string {
  if (isApogeePendencia(item) && item.email_entry_id) {
    return `apogee-${item.email_entry_id}`;
  }
  return `db-${item.os}-${item.ano}`;
}

/** Formata data ISO/API para exibição na lista e no cabeçalho. */
export function formatEmailDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;

    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    if (sameDay) {
      return d.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);
    if (diffDays >= 0 && diffDays < 7) {
      return d.toLocaleDateString("pt-BR", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return raw;
  }
}

export function senderInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

export function attachmentIconClass(name: string | undefined): string {
  const ext = name?.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "text-red-600";
  if (["jpg", "jpeg", "png", "gif"].includes(ext)) return "text-emerald-600";
  if (["doc", "docx"].includes(ext)) return "text-blue-600";
  if (["xls", "xlsx"].includes(ext)) return "text-green-700";
  if (["zip", "rar"].includes(ext)) return "text-amber-700";
  return "text-neutral-500";
}
