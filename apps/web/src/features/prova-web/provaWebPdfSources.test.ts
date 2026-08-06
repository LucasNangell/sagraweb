import { describe, expect, it } from "vitest";

import type { ProvaWebRecord } from "@/api/provaWeb";

import { pdfSourcesFromRecord } from "./provaWebPdfSources";

describe("pdfSourcesFromRecord", () => {
  it("unico / folha_dobrada", () => {
    const unico: ProvaWebRecord = {
      modo: "unico",
      arquivoUnico: "arte/prova.pdf",
      arquivoCapa: null,
      arquivoMiolo: null,
      pontoRegistro: null,
      dataRegistro: null,
      dataAtualizacao: null,
    };
    expect(pdfSourcesFromRecord(unico)).toEqual([
      { id: "unico", label: "PDF", path: "arte/prova.pdf" },
    ]);
    expect(
      pdfSourcesFromRecord({ ...unico, modo: "folha_dobrada" })[0]?.label,
    ).toBe("Folheto");
  });

  it("capa_miolo com seletor", () => {
    const rec: ProvaWebRecord = {
      modo: "capa_miolo",
      arquivoUnico: null,
      arquivoCapa: "capa.pdf",
      arquivoMiolo: "miolo.pdf",
      pontoRegistro: null,
      dataRegistro: null,
      dataAtualizacao: null,
    };
    expect(pdfSourcesFromRecord(rec)).toEqual([
      { id: "capa", label: "Capa", path: "capa.pdf" },
      { id: "miolo", label: "Miolo", path: "miolo.pdf" },
    ]);
  });

  it("sem registro", () => {
    expect(pdfSourcesFromRecord(null)).toEqual([]);
  });
});
