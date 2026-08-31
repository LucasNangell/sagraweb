import { describe, expect, it } from "vitest";

import {
  buildOrcamentoParametrosPayload,
  fromDisplay,
  toDisplay,
  VISIBLE_FIELDS,
} from "./OrcamentoSettingsSection";

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

describe("mão de obra no save de parâmetros", () => {
  it("inclui pessoal_por_hora como bool 0/1 no payload", () => {
    const spec = VISIBLE_FIELDS.find((f) => f.chave === "pessoal_por_hora");
    expect(spec).toEqual(expect.objectContaining({ chave: "pessoal_por_hora", kind: "bool" }));

    const ligado = buildOrcamentoParametrosPayload({ pessoal_por_hora: "1" });
    expect(ligado.pessoal_por_hora).toBe("1");

    const desligado = buildOrcamentoParametrosPayload({ pessoal_por_hora: "0" });
    expect(desligado.pessoal_por_hora).toBe("0");

    const vazio = buildOrcamentoParametrosPayload({});
    expect(vazio.pessoal_por_hora).toBe("0");
  });
});
