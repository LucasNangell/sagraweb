import { describe, expect, it } from "vitest";

import { canAccessRoute, getVisibleNavItems } from "@/components/layout/nav-config";
import { parsePermissionsFromApi } from "@/features/auth/permissions";

describe("Manipular Imagem nav", () => {
  it("esconde sem sb_manipular_imagem", () => {
    const perms = parsePermissionsFromApi({ sb_inicio: true });
    const items = getVisibleNavItems(perms, true);
    expect(items.some((i) => i.to === "/manipular-imagem")).toBe(false);
    expect(canAccessRoute(perms, "/manipular-imagem")).toBe(false);
  });

  it("mostra com sb_manipular_imagem", () => {
    const perms = parsePermissionsFromApi({
      sb_inicio: true,
      sb_manipular_imagem: true,
    });
    const items = getVisibleNavItems(perms, true);
    expect(items.some((i) => i.to === "/manipular-imagem")).toBe(true);
    expect(canAccessRoute(perms, "/manipular-imagem")).toBe(true);
  });
});
