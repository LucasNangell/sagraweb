import { describe, expect, it } from "vitest";

import {
  canAccessRoute,
  getVisibleNavItems,
} from "@/components/layout/nav-config";
import { PAINEL_CONFIG_ADMIN_PONTO } from "@/features/auth/painelConfigAdmin";
import { parsePermissionsFromApi } from "@/features/auth/permissions";

describe("sidebar Painéis OS", () => {
  it("aparece só para o ponto 918713", () => {
    const perms = parsePermissionsFromApi({ sb_inicio: true, sb_admin_ips: true });
    expect(
      getVisibleNavItems(perms, true).some((item) => item.to === "/admin/paineis"),
    ).toBe(false);
    expect(
      getVisibleNavItems(perms, true, 111111).some(
        (item) => item.to === "/admin/paineis",
      ),
    ).toBe(false);
    expect(
      getVisibleNavItems(perms, true, PAINEL_CONFIG_ADMIN_PONTO).some(
        (item) => item.to === "/admin/paineis",
      ),
    ).toBe(true);
  });

  it("nega a rota para outros pontos mesmo com sb_admin_ips", () => {
    const perms = parsePermissionsFromApi({ sb_admin_ips: true });
    expect(canAccessRoute(perms, "/admin/paineis")).toBe(false);
    expect(canAccessRoute(perms, "/admin/paineis", 111111)).toBe(false);
    expect(
      canAccessRoute(perms, "/admin/paineis", PAINEL_CONFIG_ADMIN_PONTO),
    ).toBe(true);
  });
});
