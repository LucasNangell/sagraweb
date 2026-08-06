import { describe, expect, it } from "vitest";

import {
  formatOsJuntadaLabel,
  formatOsListLabel,
} from "./formatOsJuntadaLabel";

describe("formatOsJuntadaLabel", () => {
  it("formata OS única", () => {
    expect(formatOsListLabel(12345, 2026)).toBe("12345/26");
    expect(formatOsJuntadaLabel([{ nr_os: 12345, ano: 2026 }])).toBe("12345/26");
  });

  it("junta duas OSs com e", () => {
    expect(
      formatOsJuntadaLabel([
        { nr_os: 65432, ano: 2026 },
        { nr_os: 12345, ano: 2026 },
      ]),
    ).toBe("12345/26 e 65432/26");
  });

  it("usa vírgulas e e para três ou mais", () => {
    expect(
      formatOsJuntadaLabel([
        { nr_os: 3, ano: 2026 },
        { nr_os: 1, ano: 2026 },
        { nr_os: 2, ano: 2026 },
      ]),
    ).toBe("00001/26, 00002/26 e 00003/26");
  });

  it("usa fallback quando membros vazios", () => {
    expect(formatOsJuntadaLabel([], { nr_os: 100, ano: 2026 })).toBe("00100/26");
  });
});
