import { describe, expect, it } from "vitest";

import type { OsHistoryRow } from "./types";
import {
  applyOsHistoryDraftOrder,
  resolveReorderedCodStatus,
} from "./osHistoryUtils";

function row(cod: string, situacao = cod): OsHistoryRow {
  return {
    CodStatus: cod,
    SituacaoLink: situacao,
    SetorLink: "SEFOC",
    Data: "2026-01-01T00:00:00",
  } as OsHistoryRow;
}

describe("applyOsHistoryDraftOrder", () => {
  it("returns CodStatus order when draft is null", () => {
    const rows = [row("c"), row("a"), row("b")];
    expect(applyOsHistoryDraftOrder(rows, null).map((r) => r.CodStatus)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("applies draft order and appends missing codes", () => {
    const rows = [row("a"), row("b"), row("c")];
    expect(
      applyOsHistoryDraftOrder(rows, ["c", "a"]).map((r) => r.CodStatus),
    ).toEqual(["c", "a", "b"]);
  });
});

describe("resolveReorderedCodStatus", () => {
  it("returns mapped code when present", () => {
    expect(
      resolveReorderedCodStatus("a-02", { "a-02": "a-04", "a-04": "a-02" }),
    ).toBe("a-04");
  });

  it("falls back to original when mapping missing", () => {
    expect(resolveReorderedCodStatus("a-02", {})).toBe("a-02");
    expect(resolveReorderedCodStatus("a-02", null)).toBe("a-02");
  });
});
