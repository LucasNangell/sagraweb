import { afterEach, describe, expect, it, vi } from "vitest";

import {
  joinOsAbsolutePath,
  optionsToPayload,
  pdfCompareAssetUrl,
  startPdfCompare,
} from "./api";

describe("os-pdf-compare api helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  it("preserva URL absoluta de asset local", () => {
    const local =
      "http://127.0.0.1:5566/pdf-compare/abc/asset/page-001-diff.jpg";
    expect(pdfCompareAssetUrl(local)).toBe(local);
  });

  it("junta root UNC com relativo", () => {
    expect(
      joinOsAbsolutePath("\\\\server\\share\\OS\\2026\\1", "Original/a.pdf"),
    ).toBe("\\\\server\\share\\OS\\2026\\1\\Original\\a.pdf");
  });

  it("usa Folder Opener local quando health tem pdf_compare", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/health")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            version: "1.3.0",
            pdf_compare: true,
          }),
        };
      }
      if (String(url).endsWith("/pdf-compare/start")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            session_id: "local-session",
            message: "Comparação local iniciada.",
          }),
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startPdfCompare(
        2026,
        1,
        {
          previous_relative: "a.pdf",
          current_relative: "b.pdf",
          dpi: 150,
          threshold: 16,
          include_unchanged: false,
        },
        {
          previous: "C:\\tmp\\a.pdf",
          current: "C:\\tmp\\b.pdf",
        },
      ),
    ).resolves.toEqual({
      session_id: "local-session",
      message: "Comparação local iniciada.",
      execution: "local",
    });
  });
});
