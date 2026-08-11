import { describe, expect, it } from "vitest";

import {
  pageNumberToIndex,
  preferredSyncPage,
  spreadLeftPage,
} from "./analiseLabPageSync";

describe("analiseLabPageSync", () => {
  const pages = [
    { page: 1, role: "cover-front" },
    { page: 2 },
    { page: 3 },
    { page: 4 },
    { page: 5 },
  ];

  it("maps page number to index", () => {
    expect(pageNumberToIndex(pages, 4)).toBe(3);
    expect(pageNumberToIndex(pages, 99)).toBe(4);
  });

  it("resolves spread left page like the flipbook", () => {
    expect(spreadLeftPage(pages, 0)).toBe(1);
    expect(spreadLeftPage(pages, 1)).toBe(2);
    expect(spreadLeftPage(pages, 2)).toBe(2);
    expect(spreadLeftPage(pages, 3)).toBe(4);
  });

  it("keeps preferred page when it is in the visible spread", () => {
    expect(preferredSyncPage([{ page: 4 }, { page: 5 }], 5)).toBe(5);
    expect(preferredSyncPage([{ page: 4 }, { page: 5 }], 4)).toBe(4);
    expect(preferredSyncPage([{ page: 4 }, { page: 5 }], 9)).toBe(4);
    expect(preferredSyncPage([{ page: 1 }], null)).toBe(1);
    expect(preferredSyncPage([], 3)).toBeNull();
  });
});
