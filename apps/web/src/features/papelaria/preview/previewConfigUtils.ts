import type { PapelariaPreviewConfig } from "./types";

export type ParsePreviewConfigResult =
  | { ok: true; config: PapelariaPreviewConfig }
  | { ok: false; error: string };

const VALID_ALIGN = new Set(["left", "center", "right"]);
const VALID_ANCHOR = new Set(["start", "middle", "end"]);

function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

export function validatePreviewConfigObject(data: unknown): string | null {
  if (!data || typeof data !== "object") return "Configuração deve ser um objeto JSON.";
  const cfg = data as PapelariaPreviewConfig;
  if (!cfg.canvas || !isNumber(cfg.canvas.width) || cfg.canvas.width <= 0) {
    return "canvas.width inválido.";
  }
  if (!isNumber(cfg.canvas.height) || cfg.canvas.height <= 0) {
    return "canvas.height inválido.";
  }
  if (!Array.isArray(cfg.faces) || cfg.faces.length === 0) {
    return "faces deve ser uma lista não vazia.";
  }
  for (const face of cfg.faces) {
    if (!face?.id || !face.baseImage) return "Cada face precisa de id e baseImage.";
    if (!Array.isArray(face.elementos)) return `Face ${face.id}: elementos inválido.`;
    for (const el of face.elementos) {
      if (!el?.id || !el.template) return "Elemento sem id ou template.";
      if (!isNumber(el.x) || !isNumber(el.y) || !isNumber(el.width) || !isNumber(el.height)) {
        return `Elemento ${el.id}: x/y/width/height obrigatórios.`;
      }
      if (!isNumber(el.fontSize) || el.fontSize <= 0) {
        return `Elemento ${el.id}: fontSize inválido.`;
      }
      if (el.align && !VALID_ALIGN.has(el.align)) {
        return `Elemento ${el.id}: align inválido.`;
      }
      if (el.anchor && !VALID_ANCHOR.has(el.anchor)) {
        return `Elemento ${el.id}: anchor inválido.`;
      }
    }
  }
  return null;
}

export function parsePreviewConfigJson(raw: string): ParsePreviewConfigResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: "JSON vazio." };
  try {
    const parsed = JSON.parse(text) as unknown;
    const err = validatePreviewConfigObject(parsed);
    if (err) return { ok: false, error: err };
    return { ok: true, config: parsed as PapelariaPreviewConfig };
  } catch {
    return { ok: false, error: "JSON inválido." };
  }
}

export function formatPreviewConfigJson(raw: string): string {
  const parsed = JSON.parse(raw) as unknown;
  const err = validatePreviewConfigObject(parsed);
  if (err) throw new Error(err);
  return JSON.stringify(parsed, null, 2);
}
