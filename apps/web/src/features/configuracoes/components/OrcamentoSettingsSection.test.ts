import { describe, expect, it } from "vitest";

import { fromDisplay, toDisplay } from "./OrcamentoSettingsSection";

describe("orçamento settings display", () => {
  it("mostra percentual operacional, não a fração gravada", () => {
    expect(toDisplay("0.07", "percent")).toBe("7");
    expect(toDisplay("0.87", "percent")).toBe("87");
    expect(fromDisplay("7", "percent")).toBe("0.07");
    expect(fromDisplay("87", "percent")).toBe("0.87");
  });

  it("não usa a chave técnica como valor", () => {
    expect(toDisplay("1", "bool")).toBe("1");
    expect(fromDisplay("0", "bool")).toBe("0");
  });
});
