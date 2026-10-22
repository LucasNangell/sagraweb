import { describe, expect, it } from "vitest";

import { INBOX_COLUMN_SOURCE } from "./constants";
import { normalizeDashboardColumns } from "./normalizeConfig";

describe("normalizeDashboardColumns", () => {
  it("preserva fonte inbox e descarta setor da coluna", () => {
    const columns = normalizeDashboardColumns([
      {
        id: "inbox",
        title: "Novo e-mail",
        statuses: ["Em Execução"],
        source: INBOX_COLUMN_SOURCE,
        sector: "Papelaria",
        hideWhenEmpty: true,
      },
    ]);
    expect(columns[0]).toEqual({
      id: "inbox",
      title: "Novo e-mail",
      statuses: ["Em Execução"],
      source: INBOX_COLUMN_SOURCE,
      hideWhenEmpty: true,
    });
  });

  it("não marca coluna antiga como inbox", () => {
    const columns = normalizeDashboardColumns([
      { id: "exec", title: "Execução", statuses: ["Em Execução"] },
    ]);
    expect(columns[0]?.source).toBeUndefined();
  });
});
