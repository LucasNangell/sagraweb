import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSION_COLUMNS,
  buildDefaultNewIpPayload,
} from "@/features/admin-ips/constants";
import { PERMISSION_KEYS } from "@/features/auth/types";

import {
  buildDefaultIpPermissionValues,
  getPermissionEntry,
  groupCatalogByCategory,
  IP_PERMISSION_KEYS,
  isPermissionInScope,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  USER_MATRIX_PERMISSION_KEYS,
} from "./permissionCatalog";

/** Colunas booleanas de `ip_permissions` editadas pela tela de terminais (contrato histórico). */
const IP_TABLE_COLUMNS = [
  "ctx_nova_os",
  "ctx_duplicar_os",
  "ctx_editar_os",
  "ctx_vincular_os",
  "ctx_abrir_pasta",
  "ctx_mover_pastas",
  "ctx_imprimir_ficha",
  "ctx_imprimir_separador",
  "ctx_detalhes_os",
  "ctx_orcamento",
  "sb_inicio",
  "sb_gerencia",
  "sb_email",
  "sb_analise",
  "sb_papelaria",
  "sb_usuario",
  "sb_configuracoes",
  "sb_relatorio",
  "sb_dashboard_setor",
  "sb_admin_ips",
  "sb_pcp",
  "sb_usuarios",
  "sb_active_computers",
  "sb_gravacao",
  "sb_gravacao_externa",
  "sb_gravacao_pendente",
  "sb_gravacao_externa_operador",
  "sb_gravacao_pendente_excluir",
  "sb_gravacao_externa_entrega",
  "sb_gravacao_externa_lancar",
  "sb_cotas_graf",
  "sb_estoque",
  "sb_estoque_gerente",
  "sb_lombada",
  "sb_credenciais_depol",
  "sb_manipular_imagem",
];

describe("permissionCatalog", () => {
  it("cobre exatamente todas as PermissionKey, sem duplicatas", () => {
    const keys = PERMISSION_CATALOG.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("toda entrada tem rótulo, rótulo curto, categoria válida e escopo", () => {
    const categories = new Set(PERMISSION_CATEGORIES.map((c) => c.id));
    for (const item of PERMISSION_CATALOG) {
      expect(item.label.trim(), item.key).not.toBe("");
      expect(item.shortLabel.trim(), item.key).not.toBe("");
      expect(categories.has(item.category), item.key).toBe(true);
      expect(["ip", "user", "both"]).toContain(item.scope);
    }
  });

  it("escopo ip/both corresponde às colunas de ip_permissions", () => {
    expect([...IP_PERMISSION_KEYS].sort()).toEqual([...IP_TABLE_COLUMNS].sort());
  });

  it("chaves só de usuário ficam fora do terminal", () => {
    for (const key of [
      "ctx_prova_web",
      "ctx_comparar_versoes",
      "sb_dashboard_global",
      "sb_dashboard_tablet",
    ] as const) {
      expect(getPermissionEntry(key)?.scope).toBe("user");
      expect(isPermissionInScope(key, "ip")).toBe(false);
      expect(isPermissionInScope(key, "user")).toBe(true);
    }
  });

  it("matriz do usuário exclui painéis (geridos na seção Painéis)", () => {
    expect(USER_MATRIX_PERMISSION_KEYS).not.toContain("sb_dashboard_setor");
    expect(USER_MATRIX_PERMISSION_KEYS).not.toContain("sb_dashboard_global");
    expect(USER_MATRIX_PERMISSION_KEYS).not.toContain("sb_dashboard_tablet");
    expect(USER_MATRIX_PERMISSION_KEYS).toContain("ctx_prova_web");
    expect(USER_MATRIX_PERMISSION_KEYS).toContain("sb_admin_ips");
  });

  it("padrão de terminal novo preserva os valores históricos", () => {
    const defaults = buildDefaultIpPermissionValues();
    expect(Object.keys(defaults).sort()).toEqual([...IP_TABLE_COLUMNS].sort());
    expect(defaults.sb_admin_ips).toBe(false);
    expect(defaults.sb_usuarios).toBe(true);
    expect(defaults.ctx_imprimir_separador).toBe(false);
    expect(defaults.ctx_orcamento).toBe(false);
    expect(defaults.sb_estoque).toBe(false);
    expect(defaults.sb_dashboard_setor).toBe(true);
    expect(defaults.sb_inicio).toBe(true);

    const payload = buildDefaultNewIpPayload("10.0.0.1", "Desc", "Sala");
    expect(payload).toMatchObject({ ip: "10.0.0.1", descricao: "Desc", grupo: "Sala", ativo: true });
    expect(payload).not.toHaveProperty("ctx_prova_web");
  });

  it("colunas de Admin IPs derivam do catálogo", () => {
    expect(ALL_PERMISSION_COLUMNS.map((c) => c.key)).toEqual([...IP_PERMISSION_KEYS]);
  });

  it("agrupa por categoria sem perder chaves", () => {
    const groups = groupCatalogByCategory();
    const total = groups.reduce((sum, g) => sum + g.entries.length, 0);
    expect(total).toBe(PERMISSION_CATALOG.length);
  });
});
