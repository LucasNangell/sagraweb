/** Constantes e helpers de providências do Análise Lab (front). */

export const AUTORIZAR_IMPRESSAO_TEXTO =
  "Autorizar impressão desconsiderando o problema";

/** Legado — não inserir mais; filtrado se ainda existir no banco/HTML. */
export const PROVIDENCIA_TIPO_AUTORIZAR = "autorizar_impressao";
export const PROVIDENCIA_TIPO_LIVRE = "livre";

export type ProvidenciaDraft = {
  /** id temporário negativo para linhas novas no painel */
  key: string;
  id?: number;
  texto: string;
  tipo: string;
  ordem: number;
  selecionada: boolean;
  origem: string;
};

function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isAutorizarTexto(texto: string): boolean {
  return normalizeLabel(texto || "") === normalizeLabel(AUTORIZAR_IMPRESSAO_TEXTO);
}

export function isAutorizarProvidencia(row: {
  tipo?: string;
  texto?: string;
}): boolean {
  return (
    (row.tipo || "") === PROVIDENCIA_TIPO_AUTORIZAR ||
    isAutorizarTexto(row.texto || "")
  );
}

/** Remove a providência de sistema legada; reordena. Mantém linhas vazias em edição. */
export function stripAutorizarDraft(
  rows: ProvidenciaDraft[],
): ProvidenciaDraft[] {
  return (rows || [])
    .filter((r) => !isAutorizarProvidencia(r))
    .map((r, i) => ({
      ...r,
      tipo: r.tipo === PROVIDENCIA_TIPO_AUTORIZAR ? PROVIDENCIA_TIPO_LIVRE : (r.tipo || PROVIDENCIA_TIPO_LIVRE),
      ordem: i,
    }));
}

/** @deprecated use stripAutorizarDraft — mantido para callers antigos. */
export function dedupeAutorizarDraft(
  rows: ProvidenciaDraft[],
): ProvidenciaDraft[] {
  return stripAutorizarDraft(rows);
}

/** @deprecated use stripAutorizarDraft */
export function ensureAutorizarDraft(
  rows: ProvidenciaDraft[],
): ProvidenciaDraft[] {
  return stripAutorizarDraft(rows);
}

/** Extrai textos de `.action-item` (ou `<li>` após “Providências”). */
export function parseProvidenciasFromHtml(html: string): string[] {
  const raw = html || "";
  if (!raw.trim()) return [];

  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(
      `<div id="root">${raw}</div>`,
      "text/html",
    );
    const root = doc.getElementById("root") ?? doc.body;
    const fromClass = [...root.querySelectorAll(".action-item")]
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (fromClass.length) return fromClass;

    const label = [...root.querySelectorAll("*")].find((el) => {
      const t = normalizeLabel(el.textContent || "");
      return t === "providencias" || t.startsWith("providencias ");
    });
    const list =
      label?.nextElementSibling &&
      (label.nextElementSibling.tagName === "UL" ||
        label.nextElementSibling.tagName === "OL")
        ? label.nextElementSibling
        : root.querySelector(".action-list, ul, ol");
    if (list) {
      return [...list.querySelectorAll("li")]
        .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
        .filter((t) => t && normalizeLabel(t) !== "providencias");
    }
  }

  const texts: string[] = [];
  const lower = raw.toLowerCase();
  const idx = lower.indexOf("provid");
  const chunk = idx >= 0 ? raw.slice(idx) : raw;
  for (const m of chunk.matchAll(/<li[^>]*>(.*?)<\/li>/gi)) {
    const text = (m[1] || "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text && normalizeLabel(text) !== "providencias") texts.push(text);
  }
  return texts;
}

/** Seed de rascunho a partir do HTML da biblioteca (sem linha de sistema). */
export function seedProvidenciasDraft(html: string): ProvidenciaDraft[] {
  const rows: ProvidenciaDraft[] = [];
  let ordem = 0;
  for (const texto of parseProvidenciasFromHtml(html)) {
    if (isAutorizarTexto(texto)) continue;
    rows.push({
      key: `bib-${ordem}`,
      texto,
      tipo: PROVIDENCIA_TIPO_LIVRE,
      ordem,
      selecionada: true,
      origem: "biblioteca",
    });
    ordem += 1;
  }
  return rows;
}

export function draftsToProvidenciasPayload(rows: ProvidenciaDraft[]) {
  return stripAutorizarDraft(rows)
    .filter((r) => (r.texto || "").trim())
    .map((r, i) => ({
      ...(r.id != null ? { id: r.id } : {}),
      texto: r.texto.trim(),
      tipo: PROVIDENCIA_TIPO_LIVRE,
      ordem: i,
      selecionada: r.selecionada,
      origem: r.origem === "sistema" ? "manual" : r.origem,
    }));
}

function escapeHtmlText(value: string): string {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Textos livres a persistir no HTML do modelo da biblioteca. */
export function libraryProvidenciaTextsFromDrafts(
  rows: ProvidenciaDraft[],
): string[] {
  return stripAutorizarDraft(rows).map((r) => r.texto.trim());
}

/**
 * Atualiza/insere bloco `.action-list` com providências padrão no HTML do modelo.
 */
export function applyProvidenciasToHtml(
  html: string,
  texts: string[],
): string {
  const cleaned = (html || "").trim();
  const items = texts
    .map((t) => t.trim())
    .filter((t) => t && !isAutorizarTexto(t));

  let withoutProv = cleaned;
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(
      `<div id="root">${cleaned}</div>`,
      "text/html",
    );
    const root = doc.getElementById("root") ?? doc.body;
    for (const el of [
      ...root.querySelectorAll(".providencias-bar, .action-list"),
    ]) {
      el.remove();
    }
    for (const el of [...root.querySelectorAll("*")]) {
      const t = normalizeLabel(el.textContent || "");
      if (t === "providencias" || t.startsWith("providencias ")) {
        const next = el.nextElementSibling;
        if (
          next &&
          (next.tagName === "UL" ||
            next.tagName === "OL" ||
            next.classList.contains("action-list"))
        ) {
          next.remove();
        }
        el.remove();
      }
    }
    withoutProv = root.innerHTML.trim();
  } else {
    withoutProv = cleaned
      .replace(
        /<div[^>]*class="[^"]*providencias-bar[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
        "",
      )
      .replace(
        /<ul[^>]*class="[^"]*action-list[^"]*"[^>]*>[\s\S]*?<\/ul>/gi,
        "",
      )
      .trim();
  }

  if (!items.length) {
    return withoutProv;
  }

  const lis = items
    .map((t) => `<li class="action-item">${escapeHtmlText(t)}</li>`)
    .join("");
  const block = `<div class="providencias-bar">Providências</div><ul class="action-list">${lis}</ul>`;
  return withoutProv ? `${withoutProv}\n${block}` : block;
}
