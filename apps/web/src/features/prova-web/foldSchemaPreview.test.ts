import { describe, expect, it } from "vitest";

import { sheetFromPreset } from "./fold-engine/foldPresets";
import { buildFoldTopology, resolveMovingPanels } from "./fold-engine/foldTopology";
import { DEFAULT_ARTWORK_BACK, DEFAULT_PHYSICAL } from "./fold-engine/foldTypes";
import { duplexBackBandMm } from "./fold-engine/foldDuplex";
import {
  buildFoldArrowGeoms,
  panelArtBackgroundStyle,
} from "./foldSchemaGeometry";

describe("foldSchemaGeometry", () => {
  const widthMm = 297;
  const heightMm = 210;
  const { creases, operations } = sheetFromPreset(
    "triptico_carteira_esquerda",
    widthMm,
    heightMm,
  );
  const topology = buildFoldTopology({
    widthMm,
    heightMm,
    thicknessMm: 0.3,
    creases,
    operations,
    backArtworkTransform: DEFAULT_ARTWORK_BACK,
    physical: DEFAULT_PHYSICAL,
  });

  it("carteira: 1ª seta (lado negative) aponta para a direita", () => {
    const sorted = [...operations].sort((a, b) => a.order - b.order);
    const arrows = buildFoldArrowGeoms({
      topology,
      creases,
      operations,
      selectedOpId: sorted[0]!.id,
    });
    expect(arrows).toHaveLength(2);
    const first = arrows.find((a) => a.order === 1)!;
    expect(first.x2).toBeGreaterThan(first.x1);
    expect(first.orderLabel).toBe("1ª");
  });

  it("carteira: 2ª seta (lado positive) aponta para a esquerda", () => {
    const arrows = buildFoldArrowGeoms({
      topology,
      creases,
      operations,
      selectedOpId: null,
    });
    const second = arrows.find((a) => a.order === 2)!;
    expect(second.x2).toBeLessThan(second.x1);
  });

  it("verso duplex: vinco vertical espelhado na abscissa desenhada", () => {
    const arrows = buildFoldArrowGeoms({
      topology,
      creases,
      operations,
      selectedOpId: null,
      mirrorVerticalCreases: true,
    });
    const first = arrows.find((a) => a.order === 1)!;
    expect(first.drawCreasePosMm).toBeCloseTo(
      widthMm - first.creasePosMm,
      5,
    );
  });

  it("painel esquerdo no duplex amostra faixa direita (largura preservada)", () => {
    const p0 = topology.panels.find((p) => p.id === "p0")!;
    const band = duplexBackBandMm(p0.xMm, p0.widthMm, widthMm, true);
    expect(band.bandWidthMm).toBeCloseTo(p0.widthMm, 5);
    expect(band.u0).toBeCloseTo((widthMm - p0.widthMm) / widthMm, 5);
  });

  it("panelArtBackgroundStyle gera background com arte", () => {
    const p0 = topology.panels.find((p) => p.id === "p0")!;
    const style = panelArtBackgroundStyle({
      panelXMm: p0.xMm,
      panelYMm: p0.yMm,
      panelWidthMm: p0.widthMm,
      panelHeightMm: p0.heightMm,
      usableW: widthMm,
      usableH: heightMm,
      face: "front",
      dataUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    });
    expect(style.backgroundImage).toContain("url(");
    expect(String(style.backgroundSize)).toContain("%");
  });

  it("resolveMovingPanels p0 na 1ª dobra carteira esquerda", () => {
    const o1 = operations.find((o) => o.order === 1)!;
    const moving = resolveMovingPanels(topology, o1, creases);
    expect([...moving]).toEqual(["p0"]);
  });
});
