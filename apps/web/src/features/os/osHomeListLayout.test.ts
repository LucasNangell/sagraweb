import { describe, expect, it } from "vitest";

import {
  osHomeDetailsPaneClassName,
  osHomeListPaneClassName,
} from "./osHomeListLayout";

describe("osHomeListLayout", () => {
  it("expande a lista e oculta detalhes/histórico no desktop", () => {
    expect(osHomeListPaneClassName(true, "details")).toContain("lg:flex-1");
    expect(osHomeDetailsPaneClassName(true, "details")).toContain("lg:hidden");
    expect(osHomeDetailsPaneClassName(true, "history")).toContain("lg:hidden");
    expect(osHomeDetailsPaneClassName(true, "list")).toBe("hidden");
    expect(osHomeDetailsPaneClassName(true, "details").split(/\s+/)).toContain(
      "lg:hidden",
    );
  });

  it("mantém o layout original quando a lista está recolhida", () => {
    expect(osHomeListPaneClassName(false, "details")).not.toContain("lg:flex-1");
    const collapsedDetails = osHomeDetailsPaneClassName(false, "details").split(
      /\s+/,
    );
    expect(collapsedDetails).not.toContain("lg:hidden");
    expect(osHomeDetailsPaneClassName(false, "list").split(/\s+/)).toContain(
      "lg:grid",
    );
  });
});
