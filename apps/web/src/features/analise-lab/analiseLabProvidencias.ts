/** Constantes e helpers de providências do Análise Lab (front). */

export const AUTORIZAR_IMPRESSAO_TEXTO =
  "Autorizar impressão desconsiderando o problema";

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

export function resolucaoObrigatoriaFromProvidencias(
  rows: Array<{ tipo: string; selecionada: boolean }>,
): boolean {
  const autorizar = rows.find((r) => r.tipo === PROVIDENCIA_TIPO_AUTORIZAR);
  if (!autorizar) return true;
  return !autorizar.selecionada;
}

export function ensureAutorizarDraft(
  rows: ProvidenciaDraft[],
): ProvidenciaDraft[] {
  if (rows.some((r) => r.tipo === PROVIDENCIA_TIPO_AUTORIZAR)) return rows;
  return [
    ...rows,
    {
      key: "sistema-autorizar",
      texto: AUTORIZAR_IMPRESSAO_TEXTO,
      tipo: PROVIDENCIA_TIPO_AUTORIZAR,
      ordem: rows.length,
      selecionada: false,
      origem: "sistema",
    },
  ];
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

/** Seed de rascunho a partir do HTML da biblioteca + linha sistema. */
export function seedProvidenciasDraft(html: string): ProvidenciaDraft[] {
  const autorizarNorm = normalizeLabel(AUTORIZAR_IMPRESSAO_TEXTO);
  const rows: ProvidenciaDraft[] = [];
  let ordem = 0;
  for (const texto of parseProvidenciasFromHtml(html)) {
    if (normalizeLabel(texto) === autorizarNorm) continue;
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
  return ensureAutorizarDraft(rows);
}

export function draftsToProvidenciasPayload(rows: ProvidenciaDraft[]) {
  return rows.map((r, i) => ({
    ...(r.id != null ? { id: r.id } : {}),
    texto: r.texto,
    tipo: r.tipo,
    ordem: i,
    selecionada: r.selecionada,
    origem: r.origem,
  }));
}
