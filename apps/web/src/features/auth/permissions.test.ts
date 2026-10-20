import { describe, expect, it } from "vitest";

import {
  canAccessRoute,
  getVisibleNavItems,
  resolveDefaultAppRoute,
} from "@/components/layout/nav-config";
import {
  createDeniedPermissions,
  hasPermission,
  parsePermissionsFromApi,
} from "@/features/auth/permissions";

describe("permissions / menu", () => {
  it("usuário sem permissão não vê itens restritos", () => {
    const denied = createDeniedPermissions();
    const items = getVisibleNavItems(denied, true);
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("Análise");
    expect(labels).not.toContain("E-mail");
    expect(hasPermission(denied, "sb_analise")).toBe(false);
  });

  it("usuário com permissão vê item correspondente no menu", () => {
    const perms = parsePermissionsFromApi({
      sb_inicio: true,
      sb_pcp: true,
      sb_email: false,
    });
    const items = getVisibleNavItems(perms, true);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Início");
    expect(labels).not.toContain("Lombada");
    expect(labels).toContain("PCP");
    expect(labels).not.toContain("E-mail");
  });

  it("Lombada só aparece com sb_lombada", () => {
    const without = parsePermissionsFromApi({ sb_inicio: true });
    expect(
      getVisibleNavItems(without, true).some((i) => i.action === "lombada-calculator"),
    ).toBe(false);

    const withLombada = parsePermissionsFromApi({
      sb_inicio: true,
      sb_lombada: true,
    });
    expect(
      getVisibleNavItems(withLombada, true).some((i) => i.action === "lombada-calculator"),
    ).toBe(true);
  });

  it("não autenticado não vê menu", () => {
    const perms = parsePermissionsFromApi({ sb_inicio: true });
    expect(getVisibleNavItems(perms, false)).toEqual([]);
  });

  it("falha ao parsear permissões mantém tudo negado (fail-closed)", () => {
    const perms = parsePermissionsFromApi(null);
    expect(hasPermission(perms, "sb_analise")).toBe(false);
    expect(hasPermission(perms, "sb_inicio")).toBe(false);
    expect(getVisibleNavItems(perms, true)).toEqual([]);
  });

  it("orçamento só com ctx_orcamento, sem item de sidebar", () => {
    const perms = parsePermissionsFromApi({ ctx_orcamento: true, sb_inicio: true });
    expect(canAccessRoute(perms, "/orcamento")).toBe(true);
    expect(getVisibleNavItems(perms, true).some((i) => i.to === "/orcamento")).toBe(
      false,
    );
    expect(canAccessRoute(parsePermissionsFromApi({ sb_inicio: true }), "/orcamento")).toBe(
      false,
    );
  });

  it("usuário só com gravação externa vai para /gravacao-externa", () => {
    const perms = parsePermissionsFromApi({ sb_gravacao_externa: true });
    expect(canAccessRoute(perms, "/gravacao-externa")).toBe(true);
    expect(canAccessRoute(perms, "/")).toBe(false);
    expect(resolveDefaultAppRoute(perms)).toBe("/gravacao-externa");
  });

  it("resolveDefaultAppRoute respeita redirect quando permitido", () => {
    const perms = parsePermissionsFromApi({
      sb_inicio: true,
      sb_gravacao_externa: true,
    });
    expect(resolveDefaultAppRoute(perms, "/gravacao-externa")).toBe("/gravacao-externa");
    expect(resolveDefaultAppRoute(perms, "/analise")).toBe("/");
  });

  it("preserva deep links autenticados conhecidos após o login", () => {
    const perms = parsePermissionsFromApi({
      sb_gerencia: true,
      ctx_imprimir_ficha: true,
    });

    expect(resolveDefaultAppRoute(perms, "/mensagens")).toBe("/mensagens");
    expect(resolveDefaultAppRoute(perms, "/os/2026/123/fluxo-producao")).toBe(
      "/os/2026/123/fluxo-producao",
    );
    expect(resolveDefaultAppRoute(perms, "/impressao/requisicao/2026/123")).toBe(
      "/impressao/requisicao/2026/123",
    );
    expect(
      resolveDefaultAppRoute(
        parsePermissionsFromApi({}),
        "/os/2026/123/fluxo-producao",
      ),
    ).toBe("/");
  });

  it("usuário só com sb_dashboard_tablet vai para /painel/tablet", () => {
    const perms = parsePermissionsFromApi({ sb_dashboard_tablet: true });
    expect(canAccessRoute(perms, "/painel/tablet")).toBe(true);
    expect(canAccessRoute(perms, "/painel/celular")).toBe(true);
    expect(canAccessRoute(perms, "/painel/gravacao")).toBe(true);
    expect(resolveDefaultAppRoute(perms)).toBe("/painel/tablet");
    expect(getVisibleNavItems(perms, true).some((i) => i.to === "/painel/tablet")).toBe(
      false,
    );
  });

  it("usuário com sb_inicio e sb_dashboard_tablet vai para /", () => {
    const perms = parsePermissionsFromApi({
      sb_inicio: true,
      sb_dashboard_tablet: true,
    });
    expect(resolveDefaultAppRoute(perms)).toBe("/");
    expect(resolveDefaultAppRoute(perms, "/painel/tablet")).toBe("/painel/tablet");
  });

  it("usuário com tablet e outra rota de menu (sem Início) vai para o menu", () => {
    const perms = parsePermissionsFromApi({
      sb_dashboard_tablet: true,
      sb_gravacao_externa: true,
    });
    expect(resolveDefaultAppRoute(perms)).toBe("/gravacao-externa");
  });

  it("sb_dashboard_tablet false nega /painel/tablet, /painel/celular e /painel/gravacao", () => {
    const perms = parsePermissionsFromApi({ sb_inicio: true, sb_dashboard_tablet: false });
    expect(canAccessRoute(perms, "/painel/tablet")).toBe(false);
    expect(canAccessRoute(perms, "/painel/celular")).toBe(false);
    expect(canAccessRoute(perms, "/painel/gravacao")).toBe(false);
  });

  it("parseia sb_gravacao_externa_operador", () => {
    const perms = parsePermissionsFromApi({
      sb_gravacao_externa: true,
      sb_gravacao_externa_operador: true,
    });
    expect(hasPermission(perms, "sb_gravacao_externa_operador")).toBe(true);
    expect(hasPermission(perms, "sb_gravacao_externa")).toBe(true);
  });

  it("mostra Estoque com sb_estoque ou sb_estoque_gerente", () => {
    const op = parsePermissionsFromApi({ sb_estoque: true });
    expect(getVisibleNavItems(op, true).some((i) => i.to === "/estoque")).toBe(
      true,
    );
    expect(canAccessRoute(op, "/estoque")).toBe(true);

    const ger = parsePermissionsFromApi({ sb_estoque_gerente: true });
    expect(getVisibleNavItems(ger, true).some((i) => i.to === "/estoque")).toBe(
      true,
    );
    expect(canAccessRoute(ger, "/estoque")).toBe(true);

    const none = parsePermissionsFromApi({});
    expect(
      getVisibleNavItems(none, true).some((i) => i.to === "/estoque"),
    ).toBe(false);
    expect(canAccessRoute(none, "/estoque")).toBe(false);
  });
});
