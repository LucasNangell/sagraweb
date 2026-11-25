import { CAMPOS_ESTILO_DADOS_KEY } from "@/features/papelaria/papelariaCamposEstilo";
import { CAMPOS_EXTRAS_DADOS_KEY } from "@/features/papelaria/papelariaCamposExtras";
import { TEXTOS_DADOS_KEY } from "@/features/papelaria/papelariaTextosEditados";

/** Digitação contínua de campos do formulário. */
export const DEBOUNCE_TYPING_MS = 250;
/** Mover/aplicar extras ou textos commitados — refetch imediato. */
export const DEBOUNCE_ACTION_MS = 0;

const CHAVES_ACAO = new Set([
  CAMPOS_EXTRAS_DADOS_KEY,
  CAMPOS_ESTILO_DADOS_KEY,
  TEXTOS_DADOS_KEY,
  "__redes",
  "__redes_estilo",
]);

/**
 * Delay do debounce da prévia: 0 quando mudou extras/textos/redes;
 * tipagem de formulário mantém debounce curto.
 */
export function delayPreviaParaChave(prevChave: string, nextChave: string): number {
  if (prevChave === nextChave) return DEBOUNCE_TYPING_MS;
  try {
    const a = JSON.parse(prevChave || "{}") as Record<string, string>;
    const b = JSON.parse(nextChave || "{}") as Record<string, string>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if ((a[k] ?? "") === (b[k] ?? "")) continue;
      if (CHAVES_ACAO.has(k)) return DEBOUNCE_ACTION_MS;
    }
  } catch {
    return DEBOUNCE_ACTION_MS;
  }
  return DEBOUNCE_TYPING_MS;
}

export type AreaFrac = [number, number, number, number];

/** Interseção de duas áreas fracionárias; null se vazia. */
export function intersecaoAreaFrac(a: AreaFrac, b: AreaFrac): AreaFrac | null {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[2], b[2]);
  const y1 = Math.min(a[3], b[3]);
  if (x1 <= x0 || y1 <= y0) return null;
  return [x0, y0, x1, y1];
}

/**
 * Recorta a fração da página do `<img>` para data-URL PNG.
 * ``mascaras`` (outras regiões da página) são pintadas de branco no recorte,
 * para o fantasma do arraste não carregar tipografia/arte de elementos atrás.
 */
export function cropRegiaoDaImagem(
  img: HTMLImageElement,
  area: AreaFrac,
  mascaras: AreaFrac[] = [],
): string | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const [x0, y0, x1, y1] = area;
  const sx = Math.max(0, x0 * nw);
  const sy = Math.max(0, y0 * nh);
  const sw = Math.max(1, (x1 - x0) * nw);
  const sh = Math.max(1, (y1 - y0) * nh);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    if (mascaras.length && sw > 0 && sh > 0) {
      ctx.fillStyle = "#ffffff";
      for (const m of mascaras) {
        const hit = intersecaoAreaFrac(area, m);
        if (!hit) continue;
        const mx = ((hit[0] - x0) / (x1 - x0)) * canvas.width;
        const my = ((hit[1] - y0) / (y1 - y0)) * canvas.height;
        const mw = ((hit[2] - hit[0]) / (x1 - x0)) * canvas.width;
        const mh = ((hit[3] - hit[1]) / (y1 - y0)) * canvas.height;
        if (mw > 0 && mh > 0) ctx.fillRect(mx, my, mw, mh);
      }
    }
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export type ConteudoOtimistaExtra = {
  texto: string;
  tamanho_pt: number;
  negrito: Array<[number, number]>;
  align_h: "esquerda" | "centro" | "direita";
  align_v: "topo" | "meio" | "base";
  fonte?: string | null;
};
