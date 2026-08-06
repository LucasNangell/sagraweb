import { describe, expect, it } from "vitest";

import { pickLatestHistoryRow } from "./osHistoryUtils";
import type { OsHistoryRow } from "./types";

describe("pickLatestHistoryRow", () => {
  it("escolhe o andamento com Data mais recente, não o primeiro por CodStatus", () => {
    const rows: OsHistoryRow[] = [
      {
        CodStatus: "A001",
        SituacaoLink: "Antiga",
        Data: "2026-01-01T10:00:00",
      },
      {
        CodStatus: "Z999",
        SituacaoLink: "Atual",
        Data: "2026-06-08T15:30:00",
      },
    ];
    expect(pickLatestHistoryRow(rows)?.SituacaoLink).toBe("Atual");
  });
});
