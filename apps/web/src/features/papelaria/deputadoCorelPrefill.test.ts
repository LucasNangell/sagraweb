import { describe, expect, it } from "vitest";

import type { DeputadoLookup } from "@/api/auxLookups";

import {
  applyCamaraCorelEnrichment,
  deputadoLookupToCorelPrefill,
} from "./deputadoCorelPrefill";

function dep(partial: Partial<DeputadoLookup> = {}): DeputadoLookup {
  return {
    nome: "JONAS DONIZETTE",
    nome_eleitoral: "Jonas Donizette",
    gabinete: "Anexo IV, Gabinete 716",
    andar: "7",
    local: "Câmara dos Deputados",
    ramal: "32155716",
    foto: "",
    email: "dep.jonasdonizette@camara.leg.br",
    partido: "PSB",
    uf: "SP",
    sexo: "M",
    fones_camara: "Fones: (61) 3215-5716",
    ...partial,
  };
}

describe("deputadoLookupToCorelPrefill", () => {
  it("mapeia campos oficiais da Câmara", () => {
    expect(deputadoLookupToCorelPrefill(dep())).toEqual({
      nome_deputado: "Jonas Donizette",
      genero: "Deputado",
      partido: "PSB",
      uf: "SP",
      anexo: "IV",
      gabinete: "716",
      email: "dep.jonasdonizette@camara.leg.br",
      contato_assessor: "Fones: (61) 3215-5716",
    });
  });

  it("infere gênero feminino", () => {
    expect(
      deputadoLookupToCorelPrefill(dep({ sexo: "F", nome_eleitoral: "Maria" }))
        .genero,
    ).toBe("Deputada");
  });
});

describe("applyCamaraCorelEnrichment", () => {
  it("sobrescreve heurística local e preserva contato já preenchido", () => {
    expect(
      applyCamaraCorelEnrichment(
        {
          nome_deputado: "Jonas",
          email: "dep.jonas@camara.leg.br",
          contato_assessor: "já digitado",
          partido: "PL",
        },
        deputadoLookupToCorelPrefill(dep()),
      ),
    ).toEqual({
      nome_deputado: "Jonas Donizette",
      genero: "Deputado",
      partido: "PSB",
      uf: "SP",
      anexo: "IV",
      gabinete: "716",
      email: "dep.jonasdonizette@camara.leg.br",
      contato_assessor: "já digitado",
    });
  });

  it("cliente ganha sobre enriquecimento da Câmara", () => {
    expect(
      applyCamaraCorelEnrichment(
        { email: "dep.jonas@camara.leg.br", partido: "PL" },
        deputadoLookupToCorelPrefill(dep()),
        { email: "novo@x.com", nome_deputado: "Nome Cliente" },
      ),
    ).toMatchObject({
      email: "novo@x.com",
      nome_deputado: "Nome Cliente",
      partido: "PSB",
    });
  });
});
