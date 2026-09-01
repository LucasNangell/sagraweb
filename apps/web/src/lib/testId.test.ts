import { describe, expect, it } from "vitest";

import { homeTestIds, sidebarNavTestId, testId } from "@/lib/testId";

describe("testId", () => {
  it("joins kebab-case ASCII parts", () => {
    expect(testId("os-filters", "nr OS")).toBe("os-filters-nr-os");
  });

  it("omits empty parts", () => {
    expect(testId("os", "", null, "row", 12)).toBe("os-row-12");
  });

  it("slugs path segments", () => {
    expect(testId("sidebar-nav", "admin/configuracoes")).toBe(
      "sidebar-nav-admin-configuracoes",
    );
  });
});

describe("sidebarNavTestId", () => {
  it("maps home and lombada", () => {
    expect(sidebarNavTestId("/")).toBe("sidebar-nav-inicio");
    expect(sidebarNavTestId(undefined, "lombada-calculator")).toBe(
      "sidebar-nav-lombada",
    );
  });

  it("distinguishes gravacao routes", () => {
    expect(sidebarNavTestId("/gravacao-externa")).toBe(
      "sidebar-nav-gravacao-externa",
    );
    expect(sidebarNavTestId("/gravacao")).toBe("sidebar-nav-gravacao");
  });
});

describe("homeTestIds", () => {
  it("builds list keys from business ids", () => {
    expect(homeTestIds.osTableRow(2026, 1234)).toBe("os-table-row-2026-1234");
    expect(homeTestIds.osContext("new")).toBe("os-context-new");
  });
});
