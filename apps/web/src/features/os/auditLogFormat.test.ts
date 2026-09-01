import { describe, expect, it } from "vitest";

import type { OsAuditLogRow } from "./types";
import {
  auditLaunchDescriptionRows,
  formatAuditActionLabel,
  groupAuditLogLaunches,
} from "./auditLogFormat";

function row(partial: Partial<OsAuditLogRow> & Pick<OsAuditLogRow, "id" | "acao">): OsAuditLogRow {
  return {
    entidade: "detalhes",
    ...partial,
  };
}

describe("groupAuditLogLaunches", () => {
  it("agrupa vários campos do mesmo salvamento em um lançamento", () => {
    const evento = "2026-09-01T13:00:00";
    const grouped = groupAuditLogLaunches([
      row({
        id: 1,
        acao: "UPDATE",
        evento_em: evento,
        ponto: "918713",
        usuario_nome: "Ana",
        campo: "Título",
        valor_anterior: "A",
        valor_novo: "B",
      }),
      row({
        id: 2,
        acao: "UPDATE",
        evento_em: evento,
        ponto: "918713",
        usuario_nome: "Ana",
        campo: "Tiragem",
        valor_anterior: "100",
        valor_novo: "200",
      }),
      row({
        id: 3,
        acao: "CREATE",
        evento_em: "2026-08-01T10:00:00",
        ponto: "918713",
        campo: "Título",
        valor_novo: "A",
      }),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.acao).toBe("UPDATE");
    expect(grouped[0]?.rows).toHaveLength(2);
    expect(auditLaunchDescriptionRows(grouped[0]!)).toEqual([
      { campo: "Título", valorAntigo: "A", valorAtual: "B" },
      { campo: "Tiragem", valorAntigo: "100", valorAtual: "200" },
    ]);
    expect(grouped[1]?.acao).toBe("CREATE");
    expect(grouped[1]?.rows).toHaveLength(1);
  });

  it("não agrupa ações diferentes no mesmo segundo", () => {
    const evento = "2026-09-01T13:00:01";
    const grouped = groupAuditLogLaunches([
      row({
        id: 1,
        acao: "UPDATE",
        evento_em: evento,
        ponto: "1",
        campo: "Título",
        valor_novo: "B",
      }),
      row({
        id: 2,
        acao: "VINCULO_ADD",
        evento_em: evento,
        ponto: "1",
        descricao: "Vínculo 10/2026",
      }),
    ]);
    expect(grouped).toHaveLength(2);
    expect(formatAuditActionLabel(grouped[0]!.acao)).toBe("Vínculo criado");
    expect(auditLaunchDescriptionRows(grouped[0]!)[0]?.valorAtual).toBe(
      "Vínculo 10/2026",
    );
  });
});
