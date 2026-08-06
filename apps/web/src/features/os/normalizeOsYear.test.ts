import { describe, expect, it } from "vitest";

import { normalizeOsYear } from "./normalizeOsYear";

describe("normalizeOsYear", () => {
  it("keeps four-digit years", () => {
    expect(normalizeOsYear(2026)).toBe(2026);
    expect(normalizeOsYear("2025")).toBe(2025);
  });

  it("expands two-digit years", () => {
    expect(normalizeOsYear(26)).toBe(2026);
    expect(normalizeOsYear("25")).toBe(2025);
  });

  it("returns null for invalid values", () => {
    expect(normalizeOsYear("")).toBeNull();
    expect(normalizeOsYear("abc")).toBeNull();
    expect(normalizeOsYear(0)).toBeNull();
  });
});
