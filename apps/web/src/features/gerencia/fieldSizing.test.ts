import { describe, expect, it } from "vitest";

import {
  FIELD_COL_SPAN,
  FIELD_LENGTH_STATS,
  fieldColSpan,
  fieldTier,
  textareaRows,
} from "./fieldSizing";

describe("fieldSizing from DB audit", () => {
  it("maps short codes to xs / 2 cols", () => {
    expect(fieldTier("req_sigla")).toBe("xs");
    expect(fieldTier("req_gabinete")).toBe("xs");
    expect(fieldTier("req_codigo")).toBe("xs");
    expect(fieldColSpan("req_sigla")).toBe(FIELD_COL_SPAN.xs);
  });

  it("maps typical titles/names to sm or md", () => {
    expect(fieldTier("val_titulo")).toBe("md");
    expect(fieldTier("req_solicitante")).toBe("md");
    expect(fieldTier("val_produto")).toBe("sm");
  });

  it("maps long textareas from p90", () => {
    expect(fieldTier("txt_obs")).toBe("full");
    expect(fieldTier("txt_contato")).toBe("full");
    expect(fieldColSpan("txt_obs")).toBe("col-span-12");
    expect(textareaRows("txt_obs")).toBe(3);
    expect(textareaRows("txt_contato")).toBe(3);
    expect(textareaRows("txt_acabamento")).toBe(2);
  });

  it("keeps stats snapshot for key fields", () => {
    expect(FIELD_LENGTH_STATS.val_titulo.p90).toBe(40);
    expect(FIELD_LENGTH_STATS.txt_obs.p90).toBe(146);
  });
});
