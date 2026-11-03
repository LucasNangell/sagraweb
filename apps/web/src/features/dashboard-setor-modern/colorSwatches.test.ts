import { describe, expect, it } from "vitest";

import {
  animationSwatches,
  colorsFromSwatches,
  mergeSwatchValues,
  modelSwatches,
} from "./colorSwatches";

describe("colorSwatches", () => {
  it("lista as cores originais do modelo, incluindo extras", () => {
    const lab = modelSwatches("lab-vidro-fosco");
    expect(lab.map((item) => item.key)).toEqual(["bg", "border", "accent", "extra"]);
    expect(lab.find((item) => item.key === "extra")?.value).toBe("#ff657a");
    const aurora = modelSwatches("mod-aurora");
    expect(aurora.map((item) => item.key)).toEqual([
      "bg",
      "border",
      "accent",
      "extra",
    ]);
    expect(aurora.find((item) => item.key === "extra")?.value).toBe("#23d5ab");
    const kinetic = modelSwatches("mod-kinetic-grad");
    expect(kinetic.map((item) => item.key)).toEqual([
      "bg",
      "border",
      "accent",
      "extra",
      "extra2",
    ]);
  });

  it("lista as cores originais da animação", () => {
    const tesla = animationSwatches("fx-tesla");
    expect(tesla.map((item) => item.key)).toEqual(["bg", "border", "accent"]);
    expect(animationSwatches("fx-iris")).toEqual([]);
    expect(animationSwatches("none")).toEqual([]);
  });

  it("reaproveita valores já configurados na paleta", () => {
    const merged = mergeSwatchValues(modelSwatches("v79"), {
      bg: "#111111",
      text: "#abcdef",
    });
    expect(merged.find((item) => item.key === "bg")?.value).toBe("#111111");
    expect(merged.find((item) => item.key === "text")?.value).toBe("#abcdef");
    expect(colorsFromSwatches(merged)?.text).toBe("#abcdef");
  });
});
