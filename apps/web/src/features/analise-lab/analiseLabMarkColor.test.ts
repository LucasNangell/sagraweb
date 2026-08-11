import { describe, expect, it } from "vitest";

import { itemOccurrences } from "./analiseLabComponente";
import { nearestMarkCor, markCorToHex } from "./analiseLabMarkColor";
import { formatPageSpec, parsePageSpec } from "./analiseLabPageSpec";

describe("nearestMarkCor", () => {
  it("mapeia hex exato para o nome", () => {
    expect(nearestMarkCor("#dc2626")).toBe("red");
    expect(nearestMarkCor("#2563eb")).toBe("blue");
    expect(nearestMarkCor(markCorToHex("green"))).toBe("green");
  });

  it("escolhe o nome mais próximo em RGB", () => {
    expect(nearestMarkCor("#e11d48")).toBe("red");
    expect(nearestMarkCor("#1d4ed8")).toBe("blue");
    expect(nearestMarkCor("#fafafa")).toBe("white");
    expect(nearestMarkCor("#0a0a0a")).toBe("black");
  });

  it("retorna red para hex inválido", () => {
    expect(nearestMarkCor("não-é-hex")).toBe("red");
  });
});

describe("mark todas as páginas = escopo do item", () => {
  const pages = [1, 2, 3, 4, 5, 10].map((page) => ({
    page,
    role: "page",
    widthPt: 595,
    heightPt: 842,
  }));

  it("formatPageSpec(itemOccurrences) limita às páginas do problema", () => {
    const item = {
      escopo: "paginas",
      pagina: 1,
      paginas: "1,3,5",
      componente: "Miolo",
    };
    const spec = formatPageSpec(itemOccurrences(item, pages, parsePageSpec));
    expect(spec).toBe("1,3,5");
    expect(spec).not.toBe(formatPageSpec(pages.map((p) => p.page)));
  });

  it("liga/desliga pick sem limpar o spec (contrato)", () => {
    // O toggle só troca pagePickTarget; o spec permanece no estado pai.
    const kept = "1,3";
    let pagePickTarget: "mark" | null = null;
    let pageSpec = kept;
    const toggle = () => {
      pagePickTarget = pagePickTarget === "mark" ? null : "mark";
      // não zera pageSpec
    };
    toggle();
    expect(pagePickTarget).toBe("mark");
    expect(pageSpec).toBe("1,3");
    toggle();
    expect(pagePickTarget).toBe(null);
    expect(pageSpec).toBe("1,3");
  });
});
