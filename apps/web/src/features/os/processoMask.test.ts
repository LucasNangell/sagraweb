import { describe, expect, it } from "vitest";

import { formatProcessoMask, digitsOnly } from "./processoMask";

describe("processoMask", () => {
  it("formata progressivamente", () => {
    expect(formatProcessoMask("1")).toBe("1");
    expect(formatProcessoMask("12")).toBe("12");
    expect(formatProcessoMask("12345")).toBe("12.345");
    expect(formatProcessoMask("12345678")).toBe("12.345.678");
    expect(formatProcessoMask("123456789012")).toBe("12.345.678/9012");
  });

  it("limita a 12 dígitos", () => {
    expect(digitsOnly(formatProcessoMask("123456789012999"))).toHaveLength(12);
  });
});
