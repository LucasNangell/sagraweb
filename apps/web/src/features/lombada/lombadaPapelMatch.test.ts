import { describe, expect, it } from "vitest";

import type { PapelLombadaItem } from "@/api/auxLookups";
import {
  extractGsm,
  isLombadaAcabamentoLabel,
  matchPapelLombada,
  normalizePapelName,
} from "./lombadaPapelMatch";

const papeis: PapelLombadaItem[] = [
  { codPapel: 1, papel: "ap 75gr AA", espessura: 80 },
  { codPapel: 23, papel: "Couché Fosco 250gr", espessura: 220 },
  { codPapel: 24, papel: "Couché Brilho 250gr", espessura: 220 },
  { codPapel: 40, papel: "Pólen Soft 80gr", espessura: 100 },
  { codPapel: 12, papel: "Offset 90gr", espessura: 95 },
];

describe("lombadaPapelMatch", () => {
  it("reconhece o acabamento Lombada", () => {
    expect(isLombadaAcabamentoLabel("Lombada")).toBe(true);
    expect(isLombadaAcabamentoLabel("lombada quadrada")).toBe(true);
    expect(isLombadaAcabamentoLabel("Laminação")).toBe(false);
    expect(isLombadaAcabamentoLabel("Cola")).toBe(false);
  });

  it("extrai gramatura", () => {
    expect(extractGsm("Couché 250g")).toBe(250);
    expect(extractGsm("ap 75gr AA")).toBe(75);
    expect(normalizePapelName("Couchê Fosco 250gr")).toBe("couche fosco 250 g");
  });

  it("casa papel da OS com o catálogo da calculadora", () => {
    expect(matchPapelLombada("Couché Fosco 250g", papeis)?.papel).toBe(
      "Couché Fosco 250gr",
    );
    expect(matchPapelLombada("CF 250g", papeis)?.papel).toBe(
      "Couché Fosco 250gr",
    );
    expect(matchPapelLombada("Pólen 80g", papeis)?.papel).toBe("Pólen Soft 80gr");
    expect(matchPapelLombada("Offset 90", papeis)?.papel).toBe("Offset 90gr");
  });

  it("não casa gramaturas diferentes", () => {
    expect(matchPapelLombada("Couché 150g", papeis)).toBeNull();
  });
});
