import type { PapelariaMockupConfig } from "./types";

const VALID_MODOS = new Set([
  "folha_simples",
  "cartao_simples",
  "cartao_dobrado",
  "folder",
  "pasta",
  "bloco",
]);

export type MockupConfigParseResult =
  | { ok: true; config: PapelariaMockupConfig }
  | { ok: false; error: string };

export function parseMockupConfigJson(
  raw: string | null | undefined,
): MockupConfigParseResult {
  if (!raw?.trim()) {
    return { ok: false, error: "JSON vazio." };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const err = validateMockupConfigObject(parsed);
    if (err) return { ok: false, error: err };
    return { ok: true, config: parsed as PapelariaMockupConfig };
  } catch {
    return { ok: false, error: "JSON inválido." };
  }
}

export function validateMockupConfigObject(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Configuração deve ser um objeto JSON.";
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.modo !== "string" || !VALID_MODOS.has(obj.modo)) {
    return "Campo obrigatório inválido: modo.";
  }
  if (!Array.isArray(obj.faces) || obj.faces.length === 0) {
    return "Campo obrigatório inválido: faces.";
  }
  for (const face of obj.faces) {
    if (!face || typeof face !== "object") return "Cada face deve ser um objeto.";
    const f = face as Record<string, unknown>;
    if (typeof f.id !== "string" || !f.id.trim()) {
      return "Cada face precisa de id.";
    }
    if (typeof f.pageIndex !== "number") {
      return `Face '${f.id}': pageIndex numérico obrigatório.`;
    }
    if (!f.style3d || typeof f.style3d !== "object") {
      return `Face '${f.id}': style3d obrigatório.`;
    }
  }
  if (typeof obj.larguraAbertaMm !== "number" || obj.larguraAbertaMm <= 0) {
    return "larguraAbertaMm numérico positivo obrigatório.";
  }
  if (typeof obj.alturaAbertaMm !== "number" || obj.alturaAbertaMm <= 0) {
    return "alturaAbertaMm numérico positivo obrigatório.";
  }
  return null;
}

export function formatMockupConfigJson(raw: string): string {
  const parsed = JSON.parse(raw) as unknown;
  const err = validateMockupConfigObject(parsed);
  if (err) throw new Error(err);
  return JSON.stringify(parsed, null, 2);
}

export const MOCKUP_DEMO_PAGE_URLS = [
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="594"><rect width="100%" height="100%" fill="#1e3a5f"/><text x="50%" y="50%" fill="#fff" font-size="28" text-anchor="middle" font-family="Arial">CAPA</text></svg>`,
  )}`,
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="594"><rect width="100%" height="100%" fill="#f1f5f9"/><text x="50%" y="50%" fill="#334155" font-size="28" text-anchor="middle" font-family="Arial">INTERIOR</text></svg>`,
  )}`,
];
