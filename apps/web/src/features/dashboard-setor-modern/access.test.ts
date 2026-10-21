import { describe, expect, it } from "vitest";

import {
  canAccessRoute,
  getVisibleNavItems,
} from "@/components/layout/nav-config";
import { createDeniedPermissions } from "@/features/auth/permissions";
import { isPainelStandalonePath } from "@/lib/painel-standalone";

describe("acesso ao painel moderno", () => {
  it("preserva a restrição e acompanha o acesso por setor", () => {
    const permissions = createDeniedPermissions();
    expect(canAccessRoute(permissions, "/painel/setor-moderno")).toBe(false);
    expect(
      getVisibleNavItems(permissions, true).some(
        (item) => item.to === "/painel/setor-moderno",
      ),
    ).toBe(false);
    permissions.painelSetores = ["SEFOC"];
    expect(canAccessRoute(permissions, "/painel/setor-moderno")).toBe(true);
    expect(
      getVisibleNavItems(permissions, true).some(
        (item) => item.to === "/painel/setor-moderno",
      ),
    ).toBe(true);
    expect(isPainelStandalonePath("/painel/setor-moderno")).toBe(true);
  });
});
