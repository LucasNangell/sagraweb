import { describe, expect, it } from "vitest";

import type { DashboardOsItem } from "@/features/dashboard-setor/types";

import { resolveOsCardLabel } from "./osCardLabel";

function makeItem(partial: Partial<DashboardOsItem>): DashboardOsItem {
  return { nr_os: 51, ano: 26, ...partial } as DashboardOsItem;
}

describe("resolveOsCardLabel", () => {
  it("--os-chars acompanha o rótulo renderizado", () => {
    for (const item of [
      makeItem({ nr_os: 51, ano: 26 }),
      makeItem({ nr_os: 2370, ano: 25 }),
      makeItem({ nr_os: 427, ano: 26 }),
    ]) {
      const { label, style } = resolveOsCardLabel(item);
      expect(style).toHaveProperty("--os-chars", label.length);
    }
  });

  it("usa o número da OS pai em sub-OS", () => {
    const { label, style } = resolveOsCardLabel(
      makeItem({
        row_kind: "sub_os",
        nr_os: 9,
        ano: 26,
        parent_nr_os: 2370,
        parent_ano: 25,
      }),
    );
    expect(label).toContain("2370");
    expect(style).toHaveProperty("--os-chars", label.length);
  });
});
