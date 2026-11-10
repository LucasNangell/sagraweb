import { describe, expect, it } from "vitest";

import type { IpPermissionRecord } from "@/features/acesso/types";

import { IP_PERMISSION_KEYS } from "./permissionCatalog";
import {
  buildTerminalUpdatePayload,
  countActivePermissions,
  draftFromRecord,
  filterTerminals,
  findTerminalByIp,
  groupTerminals,
  isValidIpPattern,
} from "./terminalAccess";

function record(partial: Partial<IpPermissionRecord> & { id: number; ip: string }): IpPermissionRecord {
  const base = Object.fromEntries(IP_PERMISSION_KEYS.map((k) => [k, 0]));
  return { descricao: null, grupo: null, ativo: 1, ...base, ...partial } as IpPermissionRecord;
}

describe("terminalAccess", () => {
  it("valida IP com curinga", () => {
    expect(isValidIpPattern("10.120.1.%")).toBe(true);
    expect(isValidIpPattern("192.168.0.10")).toBe(true);
    expect(isValidIpPattern("10.1.1.1 ")).toBe(true);
    expect(isValidIpPattern("10.1.1.1; DROP")).toBe(false);
    expect(isValidIpPattern("%")).toBe(false);
    expect(isValidIpPattern("")).toBe(false);
  });

  it("detecta IP duplicado ignorando o próprio registro", () => {
    const list = [record({ id: 1, ip: "10.0.0.1" }), record({ id: 2, ip: "10.0.0.%" })];
    expect(findTerminalByIp(list, " 10.0.0.1 ")?.id).toBe(1);
    expect(findTerminalByIp(list, "10.0.0.1", 1)).toBeUndefined();
    expect(findTerminalByIp(list, "10.0.0.2")).toBeUndefined();
  });

  it("filtra e agrupa (Sem Grupo para vazio)", () => {
    const list = [
      record({ id: 1, ip: "10.0.0.1", grupo: "Gerência", descricao: "Recepção" }),
      record({ id: 2, ip: "10.0.0.2", grupo: "", ativo: 0 }),
    ];
    expect(filterTerminals(list, { text: "recepcao", grupo: "", status: "todos" })).toHaveLength(1);
    expect(filterTerminals(list, { text: "", grupo: "Sem Grupo", status: "todos" })[0]?.id).toBe(2);
    expect(filterTerminals(list, { text: "", grupo: "", status: "inativos" })[0]?.id).toBe(2);
    expect(groupTerminals(list).map(([g]) => g)).toEqual(["Gerência", "Sem Grupo"]);
  });

  it("payload de atualização tem todas as chaves do terminal, sem ativo", () => {
    const r = record({ id: 7, ip: "10.0.0.7", sb_inicio: 1, ctx_nova_os: true });
    expect(countActivePermissions(r)).toBe(2);
    const draft = draftFromRecord(r);
    const payload = buildTerminalUpdatePayload(7, { ...draft, grupo: "  " });
    expect(payload.id).toBe(7);
    expect(payload.grupo).toBe("Sem Grupo");
    expect(payload).not.toHaveProperty("ativo");
    for (const key of IP_PERMISSION_KEYS) expect(typeof payload[key]).toBe("boolean");
    expect(payload["sb_inicio"]).toBe(true);
    expect(payload["ctx_prova_web"]).toBe(false);
  });
});
