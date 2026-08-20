import { describe, expect, it } from "vitest";

import {
  centeredCropMm,
  coverSpreadTargetMm,
  isAutoFillableCrop,
  remainsMatchTarget,
} from "./provaWebCenteredCrop";

describe("centeredCropMm", () => {
  it("centraliza o formato no MediaBox de forma simétrica", () => {
    const crop = centeredCropMm(230, 317, 210, 297, "formato");
    expect(crop).not.toBeNull();
    expect(crop!.source).toBe("formato");
    expect(crop!.left).toBeCloseTo(10, 1);
    expect(crop!.right).toBeCloseTo(10, 1);
    expect(crop!.top).toBeCloseTo(10, 1);
    expect(crop!.bottom).toBeCloseTo(10, 1);
    expect(230 - crop!.left - crop!.right).toBeCloseTo(210, 1);
    expect(317 - crop!.top - crop!.bottom).toBeCloseTo(297, 1);
  });

  it("tenta orientação invertida quando a original não cabe", () => {
    // MediaBox paisagem; formato retrato 210×297 não cabe, mas 297×210 cabe.
    const crop = centeredCropMm(310, 220, 210, 297, "formato");
    expect(crop).not.toBeNull();
    expect(310 - crop!.left - crop!.right).toBeCloseTo(297, 1);
    expect(220 - crop!.top - crop!.bottom).toBeCloseTo(210, 1);
  });

  it("retorna null se o formato não couber em nenhuma orientação", () => {
    expect(centeredCropMm(100, 100, 210, 297)).toBeNull();
  });
});

describe("coverSpreadTargetMm", () => {
  it("soma duas faces + lombada + orelhas", () => {
    const target = coverSpreadTargetMm({
      faceWidthMm: 210,
      faceHeightMm: 297,
      lombadaMm: 10,
      orelhaEsquerdaMm: 0,
      orelhaDireitaMm: 0,
    });
    expect(target).toEqual({ w: 430, h: 297 });
  });

  it("inclui orelhas assimétricas no alvo", () => {
    const target = coverSpreadTargetMm({
      faceWidthMm: 210,
      faceHeightMm: 297,
      lombadaMm: 8,
      orelhaEsquerdaMm: 5,
      orelhaDireitaMm: 7,
    });
    expect(target.w).toBe(210 + 210 + 8 + 5 + 7);
    expect(target.h).toBe(297);
  });
});

describe("centered crop for open cover + lombada", () => {
  it("preenche lados para MediaBox 450×310 e alvo 430×297", () => {
    const target = coverSpreadTargetMm({
      faceWidthMm: 210,
      faceHeightMm: 297,
      lombadaMm: 10,
      orelhaEsquerdaMm: 0,
      orelhaDireitaMm: 0,
    });
    expect(target).toEqual({ w: 430, h: 297 });

    const crop = centeredCropMm(450, 310, target.w, target.h, "formato");
    expect(crop).not.toBeNull();
    expect(crop!.left).toBeCloseTo(10, 1);
    expect(crop!.right).toBeCloseTo(10, 1);
    expect(crop!.top).toBeCloseTo(6.5, 1);
    expect(crop!.bottom).toBeCloseTo(6.5, 1);
    expect(remainsMatchTarget(430, 297, target.w, target.h)).toBe(true);
  });
});

describe("isAutoFillableCrop", () => {
  it("permite recalc para source formato ou zeros", () => {
    expect(isAutoFillableCrop(null)).toBe(true);
    expect(
      isAutoFillableCrop({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        source: "manual",
      }),
    ).toBe(true);
    expect(
      isAutoFillableCrop({
        top: 5,
        right: 5,
        bottom: 5,
        left: 5,
        source: "formato",
      }),
    ).toBe(true);
    expect(
      isAutoFillableCrop({
        top: 5,
        right: 5,
        bottom: 5,
        left: 5,
        source: "trimbox",
      }),
    ).toBe(false);
  });
});
