import { describe, expect, it } from "vitest";

import { resolveSvgTextPosition } from "./textAlignment";
import type { PapelariaPreviewTextElement } from "./types";

function el(
  partial: Partial<PapelariaPreviewTextElement> &
    Pick<PapelariaPreviewTextElement, "x" | "y" | "width" | "height" | "fontSize">,
): PapelariaPreviewTextElement {
  return {
    id: "t",
    tipo: "texto",
    template: "{x}",
    ...partial,
  };
}

describe("resolveSvgTextPosition", () => {
  it("centraliza horizontalmente na caixa", () => {
    const pos = resolveSvgTextPosition(
      el({ x: 100, y: 50, width: 200, height: 40, fontSize: 20, align: "center" }),
    );
    expect(pos.x).toBe(200);
    expect(pos.textAnchor).toBe("middle");
  });

  it("alinha à esquerda com borda esquerda fixa", () => {
    const pos = resolveSvgTextPosition(
      el({ x: 120, y: 50, width: 300, height: 40, fontSize: 20, align: "left" }),
    );
    expect(pos.x).toBe(120);
    expect(pos.textAnchor).toBe("start");
  });

  it("alinha à direita com borda direita fixa", () => {
    const pos = resolveSvgTextPosition(
      el({ x: 720, y: 690, width: 360, height: 40, fontSize: 24, align: "right" }),
    );
    expect(pos.x).toBe(1080);
    expect(pos.textAnchor).toBe("end");
  });

  it("ancora verticalmente no meio da caixa", () => {
    const pos = resolveSvgTextPosition(
      el({
        x: 100,
        y: 200,
        width: 400,
        height: 80,
        fontSize: 44,
        align: "center",
        anchor: "middle",
      }),
    );
    expect(pos.y).toBe(240);
    expect(pos.dominantBaseline).toBe("middle");
  });
});
