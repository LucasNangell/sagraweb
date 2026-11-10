import { describe, expect, it } from "vitest";

import type { PermissionsResponse } from "@/features/auth/types";

import { USER_MATRIX_PERMISSION_KEYS } from "./permissionCatalog";
import { filterUsuarios } from "./components/UsuariosTab";
import {
  buildUserPermissionsPayload,
  hasInternetAccount,
  isAccountActive,
  isUserPermissionsCustomized,
  parseIpsText,
  permissionsStateFromResponse,
  resolvePainelSetoresSelection,
} from "./userAccess";

describe("userAccess", () => {
  it("parseIpsText aceita linha, vírgula e ponto e vírgula; remove vazios e duplicados", () => {
    expect(parseIpsText(" 10.1.1.1\n10.1.1.2, 10.1.1.1;;\n\n10.1.1.3 ")).toEqual([
      "10.1.1.1",
      "10.1.1.2",
      "10.1.1.3",
    ]);
    expect(parseIpsText("")).toEqual([]);
  });

  it("conta internet e conta ativa", () => {
    expect(hasInternetAccount({ Email: "a@b.c", ContaInternet: 0 })).toBe(true);
    expect(hasInternetAccount({ Email: null, ContaInternet: 1 })).toBe(true);
    expect(hasInternetAccount({ Email: "  ", ContaInternet: 0 })).toBe(false);
    expect(isAccountActive({ AuthAtivo: null })).toBe(true);
    expect(isAccountActive({ AuthAtivo: 0 })).toBe(false);
    expect(isAccountActive({ AuthAtivo: 1 })).toBe(true);
  });

  it("legado sb_dashboard_setor sem lista vira 'todos os setores'", () => {
    const state = permissionsStateFromResponse({
      ip: "user:1",
      sb_dashboard_setor: true,
      painel_setores: [],
    } as PermissionsResponse);
    expect(state.legacyAll).toBe(true);
    expect(resolvePainelSetoresSelection(state, ["A", "B"])).toEqual(["A", "B"]);

    const explicit = permissionsStateFromResponse({
      ip: "user:1",
      sb_dashboard_setor: true,
      painel_setores: [" A "],
    } as PermissionsResponse);
    expect(explicit.legacyAll).toBe(false);
    expect(resolvePainelSetoresSelection(explicit, ["A", "B"])).toEqual(["A"]);
  });

  it("customização espelha o backend (qualquer flag ou setor)", () => {
    const none = { painelGlobal: false, painelTablet: false, painelSetores: [] };
    expect(isUserPermissionsCustomized({}, none)).toBe(false);
    expect(isUserPermissionsCustomized({ sb_inicio: true }, none)).toBe(true);
    expect(isUserPermissionsCustomized({}, { ...none, painelSetores: ["X"] })).toBe(true);
    expect(isUserPermissionsCustomized({}, { ...none, painelTablet: true })).toBe(true);
  });

  it("payload de permissões envia todas as chaves da matriz e os painéis, sem auth_ativo", () => {
    const payload = buildUserPermissionsPayload(
      { sb_inicio: true },
      { painelGlobal: true, painelTablet: false, painelSetores: ["SEFOC"] },
    );
    for (const key of USER_MATRIX_PERMISSION_KEYS) {
      expect(typeof payload[key]).toBe("boolean");
    }
    expect(payload.sb_inicio).toBe(true);
    expect(payload.sb_gerencia).toBe(false);
    expect(payload.sb_dashboard_global).toBe(true);
    expect(payload.sb_dashboard_tablet).toBe(false);
    expect(payload.sb_dashboard_setor).toBe(true);
    expect(payload.painel_setores).toEqual(["SEFOC"]);
    expect(payload).not.toHaveProperty("auth_ativo");
  });
});

describe("filterUsuarios", () => {
  const rows = [
    { Ponto: 1, Nome: "Álvaro", Setor: "SEFOC", Email: "a@x", UltimoAcesso: null, isOnline: true, Fornecedor: 0 },
    { Ponto: 2, Nome: "Bia", Setor: "CGRAF", Email: null, UltimoAcesso: null, isOnline: false, Fornecedor: 1, IpsCadastrados: ["10.9.9.9"] },
  ];
  const base = { text: "", setor: "", online: "todos", fornecedor: "todos", internet: "todos" } as const;

  it("busca sem acento e por IP", () => {
    expect(filterUsuarios(rows, { ...base, text: "alvaro" }).map((u) => u.Ponto)).toEqual([1]);
    expect(filterUsuarios(rows, { ...base, text: "10.9.9" }).map((u) => u.Ponto)).toEqual([2]);
  });

  it("filtros de setor, online, fornecedor e conta internet", () => {
    expect(filterUsuarios(rows, { ...base, setor: "CGRAF" }).map((u) => u.Ponto)).toEqual([2]);
    expect(filterUsuarios(rows, { ...base, online: "sim" }).map((u) => u.Ponto)).toEqual([1]);
    expect(filterUsuarios(rows, { ...base, fornecedor: "sim" }).map((u) => u.Ponto)).toEqual([2]);
    expect(filterUsuarios(rows, { ...base, internet: "nao" }).map((u) => u.Ponto)).toEqual([2]);
  });
});
