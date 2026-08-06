import { describe, expect, it } from "vitest";

import { canAccessRoute, getVisibleNavItems } from "@/components/layout/nav-config";
import { parsePermissionsFromApi } from "@/features/auth/permissions";

describe("Credenciais DEPOL nav", () => {
  it("esconde sem sb_credenciais_depol", () => {
    const perms = parsePermissionsFromApi({ sb_inicio: true });
    const items = getVisibleNavItems(perms, true);
    expect(items.some((i) => i.to === "/credenciais-depol")).toBe(false);
    expect(canAccessRoute(perms, "/credenciais-depol")).toBe(false);
  });

  it("mostra com sb_credenciais_depol", () => {
    const perms = parsePermissionsFromApi({
      sb_inicio: true,
      sb_credenciais_depol: true,
    });
    const items = getVisibleNavItems(perms, true);
    expect(items.some((i) => i.to === "/credenciais-depol")).toBe(true);
    expect(canAccessRoute(perms, "/credenciais-depol")).toBe(true);
  });
});
