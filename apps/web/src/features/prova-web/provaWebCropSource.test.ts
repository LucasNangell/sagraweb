import { describe, expect, it } from "vitest";

import type { ProvaWebCropSource } from "./provaWebCropSource";

describe("ProvaWebCropSource contract", () => {
  it("keeps optional cropSource shape for lab injection", () => {
    const source: ProvaWebCropSource = {
      keyPrefix: "analise-lab-crop-meta",
      pdfUrl: (path) => `/lab-pdf?path=${encodeURIComponent(path)}`,
      fetchMeta: async () =>
        ({
          ano: 2026,
          os: 1,
          path: "x.pdf",
          pageCount: 1,
          pages: [],
          suggestedCrop: { top: 0, right: 0, bottom: 0, left: 0 },
          suggestionSource: "manual",
          likelySpread: false,
          widthMm: 210,
          heightMm: 297,
        }) as never,
    };
    expect(source.keyPrefix).toBe("analise-lab-crop-meta");
    expect(source.pdfUrl("a.pdf")).toContain("a.pdf");
  });
});
