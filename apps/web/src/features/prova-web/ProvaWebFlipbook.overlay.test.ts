import { describe, expect, it } from "vitest";

import type { ProvaWebFlipbookPropsLike } from "./provaWebFlipbookContract";

/**
 * Garante que a API pública do flipbook permanece compatível:
 * `renderPageOverlay` é opcional — usos existentes não precisam passá-la.
 */
describe("ProvaWebFlipbook overlay contract", () => {
  it("accepts props without renderPageOverlay", () => {
    const props: ProvaWebFlipbookPropsLike = {
      ano: 2026,
      osId: 1,
      manifest: {
        mode: "unico",
        cacheKey: "x",
        pages: [],
        pageCount: 0,
        aspectRatio: null,
        totalSourcePages: 0,
        truncated: false,
      },
    };
    expect(props.renderPageOverlay).toBeUndefined();
  });

  it("accepts optional renderPageOverlay callback", () => {
    const props: ProvaWebFlipbookPropsLike = {
      ano: 2026,
      osId: 1,
      manifest: {
        mode: "unico",
        cacheKey: "x",
        pages: [],
        pageCount: 0,
        aspectRatio: null,
        totalSourcePages: 0,
        truncated: false,
      },
      renderPageOverlay: () => null,
    };
    expect(typeof props.renderPageOverlay).toBe("function");
  });
});
