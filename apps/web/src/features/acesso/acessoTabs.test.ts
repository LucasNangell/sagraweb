import { describe, expect, it } from "vitest";

import { canAccessRoute, getVisibleNavItems } from "@/components/layout/nav-config";
import { PERMISSION_KEYS, type Permissions } from "@/features/auth/types";

import { getVisibleAcessoTabs, parseAcessoSearch, resolveAcessoAba } from "./acessoTabs";

function perms(granted: string[] = []): Permissions {
  const base = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, granted.includes(k)]));
  return {
    ...(base as Record<(typeof PERMISSION_KEYS)[number], boolean>),
    painelSetores: [],
    painelSetoresLegacyAll: false,
  };
}

describe("parseAcessoSearch", () => {
  it("aceita aba, ponto e terminal válidos", () => {
    expect(parseAcessoSearch({ aba: "usuarios", ponto: "918713", terminal: 7 })).toEqual({
      aba: "usuarios",
      ponto: 918713,
      terminal: 7,
    });
  });

  it("descarta valores inválidos", () => {
    expect(parseAcessoSearch({ aba: "xpto", ponto: "abc", terminal: -1 })).toEqual({});
  });
});

describe("abas por permissão", () => {
  it("sb_usuarios: Visão geral, Usuários e Clientes do portal", () => {
    const tabs = getVisibleAcessoTabs(perms(["sb_usuarios"])).map((t) => t.id);
    expect(tabs).toEqual(["visao-geral", "usuarios", "clientes"]);
  });

  it("sb_admin_ips: Visão geral e Terminais", () => {
    const tabs = getVisibleAcessoTabs(perms(["sb_admin_ips"])).map((t) => t.id);
    expect(tabs).toEqual(["visao-geral", "terminais"]);
  });

  it("aba pedida sem permissão cai na primeira visível", () => {
    const visible = getVisibleAcessoTabs(perms(["sb_admin_ips"]));
    expect(resolveAcessoAba("usuarios", visible)).toBe("visao-geral");
    expect(resolveAcessoAba("terminais", visible)).toBe("terminais");
    expect(getVisibleAcessoTabs(perms(["sb_inicio"]))).toEqual([]);
    expect(resolveAcessoAba(undefined, [])).toBeNull();
  });
});

describe("menu e rota do Controle de Acesso", () => {
  it("um único item, visível com qualquer uma das duas chaves", () => {
    for (const key of ["sb_usuarios", "sb_admin_ips"]) {
      const items = getVisibleNavItems(perms([key]), true);
      expect(items.filter((i) => i.to === "/admin/acesso")).toHaveLength(1);
      expect(items.some((i) => i.to === "/usuarios" || i.to === "/admin/ips")).toBe(false);
      expect(canAccessRoute(perms([key]), "/admin/acesso")).toBe(true);
    }
  });

  it("oculto e bloqueado sem as chaves", () => {
    const items = getVisibleNavItems(perms(["sb_inicio"]), true);
    expect(items.some((i) => i.to === "/admin/acesso")).toBe(false);
    expect(canAccessRoute(perms(["sb_inicio"]), "/admin/acesso")).toBe(false);
  });
});
