import { describe, expect, it } from "vitest";

import { optionsToPayload, pdfCompareAssetUrl } from "./api";

describe("os-pdf-compare api helpers", () => {
  it("monta payload de start", () => {
    expect(
      optionsToPayload("Original/a.pdf", "Original/b.pdf", {
        dpi: 300,
        threshold: 12,
        includeUnchangedInReport: true,
      }),
    ).toEqual({
      previous_relative: "Original/a.pdf",
      current_relative: "Original/b.pdf",
      dpi: 300,
      threshold: 12,
      include_unchanged: true,
    });
  });

  it("normaliza URL de asset com prefixo /api", () => {
    const url = pdfCompareAssetUrl(
      "/api/os/2026/1/pdf-compare/abc/asset/page-001-diff.jpg",
    );
    expect(url).toContain("/os/2026/1/pdf-compare/abc/asset/page-001-diff.jpg");
  });
});
