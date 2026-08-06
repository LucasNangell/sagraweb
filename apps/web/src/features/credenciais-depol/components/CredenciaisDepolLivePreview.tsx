import {
  modeloThumbUrl,
  type CredenciaisDepolLayout,
  type CredenciaisDepolSvgBox,
} from "@/api/credenciais-depol";

const DEFAULT_BOX: CredenciaisDepolSvgBox = {
  // x/y = centro do SVG (PositionCenterX/Y no Corel), mm, origem inferior-esquerda da página
  x_mm: 42.5,
  y_mm: 101.0,
  w_mm: 39,
  h_mm: 14,
};

function numOr(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Quantidade de linhas preenchidas em sequência (1–3). Define qual TXT0N.svg usar. */
export function countLinhasPreenchidas(item: {
  linha1?: string;
  linha2?: string;
  linha3?: string;
}): number {
  if (!(item.linha1 || "").trim()) return 0;
  if (!(item.linha2 || "").trim()) return 1;
  if (!(item.linha3 || "").trim()) return 2;
  return 3;
}

export function svgFileForLinhas(n: number): string {
  const clamped = Math.min(3, Math.max(1, n || 1));
  return `TXT0${clamped}.svg`;
}

/** Split do textarea do pedido → até 3 linhas (trim por linha). */
export function textoToLinhas(texto: string): {
  linha1: string;
  linha2: string;
  linha3: string;
  extraLines: number;
} {
  const raw = (texto || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = raw.split("\n").map((l) => l.trimEnd());
  const nonEmptyCount = parts.filter((l) => l.trim().length > 0).length;
  const linha1 = (parts[0] ?? "").trim();
  const linha2 = (parts[1] ?? "").trim();
  const linha3 = (parts[2] ?? "").trim();
  const extraLines = Math.max(0, nonEmptyCount - 3);
  return { linha1, linha2, linha3, extraLines };
}

export function linhasToTexto(item: {
  linha1?: string;
  linha2?: string;
  linha3?: string;
}): string {
  const lines = [item.linha1 || "", item.linha2 || "", item.linha3 || ""];
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

export function pickSvgBox(
  layout: CredenciaisDepolLayout | null | undefined,
  numLinhas: number,
): CredenciaisDepolSvgBox {
  const key = String(Math.min(3, Math.max(1, numLinhas || 1)));
  const box = layout?.svgs?.[key];
  if (!box) return { ...DEFAULT_BOX };
  return {
    x_mm: numOr(box.x_mm, DEFAULT_BOX.x_mm),
    y_mm: numOr(box.y_mm, DEFAULT_BOX.y_mm),
    w_mm: numOr(box.w_mm, DEFAULT_BOX.w_mm),
    h_mm: numOr(box.h_mm, DEFAULT_BOX.h_mm),
  };
}

/**
 * Box em % da página.
 * x_mm/y_mm = centro do SVG (Corel CenterX/CenterY; Y sobe a partir da base da página).
 */
export function boxToCssPercent(
  box: Pick<CredenciaisDepolSvgBox, "x_mm" | "y_mm" | "w_mm" | "h_mm">,
  pageW: number,
  pageH: number,
): { left: number; top: number; width: number; height: number } {
  const w = Math.max(pageW, 1);
  const h = Math.max(pageH, 1);
  const leftMm = box.x_mm - box.w_mm / 2;
  const topMmFromBottom = box.y_mm + box.h_mm / 2;
  return {
    left: (leftMm / w) * 100,
    top: ((h - topMmFromBottom) / h) * 100,
    width: (box.w_mm / w) * 100,
    height: (box.h_mm / h) * 100,
  };
}

/** Prévia do modelo: apenas o JPG (sem overlay SVG ao vivo). */
export function CredenciaisDepolLivePreview({
  modeloArquivo,
  layout,
  forceNumLinhas,
  showPlacementGuide = false,
  className = "",
  resolveThumbUrl = modeloThumbUrl,
}: {
  modeloArquivo: string;
  layout?: CredenciaisDepolLayout | null;
  /** Qual slot de layout destacar no guia de posição (admin). */
  forceNumLinhas?: 1 | 2 | 3;
  showPlacementGuide?: boolean;
  className?: string;
  resolveThumbUrl?: (nome: string) => string;
}) {
  const numLinhas = forceNumLinhas ?? 1;
  const pageW = numOr(layout?.page_w_mm, 85);
  const pageH = numOr(layout?.page_h_mm, 120);
  const box = pickSvgBox(layout, numLinhas);
  const css = boxToCssPercent(box, pageW, pageH);
  const svgName = svgFileForLinhas(numLinhas);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-100 shadow-sm ${className}`}
      style={{ aspectRatio: `${pageW} / ${pageH}` }}
    >
      <img
        src={resolveThumbUrl(modeloArquivo)}
        alt=""
        className="absolute inset-0 h-full w-full object-fill"
        draggable={false}
      />
      {showPlacementGuide ? (
        <div
          className="pointer-events-none absolute z-[1] border border-dashed border-emerald-500/80 bg-emerald-400/10"
          style={{
            left: `${css.left}%`,
            top: `${css.top}%`,
            width: `${css.width}%`,
            height: `${css.height}%`,
          }}
          title={`${svgName}: centro x=${box.x_mm} y=${box.y_mm} mm (${box.w_mm}×${box.h_mm} mm)`}
        />
      ) : null}
    </div>
  );
}
