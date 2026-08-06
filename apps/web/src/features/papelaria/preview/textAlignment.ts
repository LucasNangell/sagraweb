import type {
  PapelariaPreviewTextAlign,
  PapelariaPreviewTextAnchor,
  PapelariaPreviewTextElement,
} from "./types";

/**
 * Converte caixa de texto (x,y,width,height) + align/anchor em coordenadas SVG.
 *
 * Convenção (equivalente ao Corel):
 * - `x`, `y` = canto superior esquerdo da caixa de texto.
 * - `width`, `height` = dimensões da caixa.
 * - `align` controla alinhamento horizontal dentro da caixa.
 * - `anchor` controla alinhamento vertical (start=topo, middle=centro, end=base).
 */
export function resolveSvgTextPosition(el: PapelariaPreviewTextElement): {
  x: number;
  y: number;
  textAnchor: "start" | "middle" | "end";
  dominantBaseline:
    | "hanging"
    | "middle"
    | "auto"
    | "alphabetic"
    | "text-after-edge";
} {
  const align = (el.align ?? "left") as PapelariaPreviewTextAlign;
  const anchor = (el.anchor ?? "start") as PapelariaPreviewTextAnchor;

  let svgX = el.x;
  if (align === "center") {
    svgX = el.x + el.width / 2;
  } else if (align === "right") {
    svgX = el.x + el.width;
  }

  let svgY = el.y;
  let dominantBaseline:
    | "hanging"
    | "middle"
    | "auto"
    | "alphabetic"
    | "text-after-edge" = "hanging";

  if (anchor === "middle") {
    svgY = el.y + el.height / 2;
    dominantBaseline = "middle";
  } else if (anchor === "end") {
    svgY = el.y + el.height;
    dominantBaseline = "text-after-edge";
  }

  const textAnchor =
    align === "center" ? "middle" : align === "right" ? "end" : "start";

  return { x: svgX, y: svgY, textAnchor, dominantBaseline };
}

export function splitMultilineText(text: string): string[] {
  if (!text) return [""];
  return text.split(/\r?\n/);
}
