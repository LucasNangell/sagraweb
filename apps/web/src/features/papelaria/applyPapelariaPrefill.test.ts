import { describe, expect, it } from "vitest";

import {
  clienteAlteracaoIdentity,
  mergePapelariaFieldValues,
} from "./applyPapelariaPrefill";

describe("mergePapelariaFieldValues", () => {
  it("sem cliente, prefill inicial não apaga digitação do operador", () => {
    expect(
      mergePapelariaFieldValues(
        { email: "operador@x.com", partido: "PL" },
        { email: "dep.api@camara.leg.br", nome_deputado: "Nome API" },
      ),
    ).toEqual({
      email: "operador@x.com",
      partido: "PL",
      nome_deputado: "Nome API",
    });
  });

  it("sem cliente, current vazio recebe o prefill da API", () => {
    expect(
      mergePapelariaFieldValues(
        {},
        { email: "dep.api@camara.leg.br", nome_deputado: "Nome API" },
      ),
    ).toEqual({
      email: "dep.api@camara.leg.br",
      nome_deputado: "Nome API",
    });
  });

  it("cliente ganha sobre valores da API já no formulário (cache stale)", () => {
    expect(
      mergePapelariaFieldValues(
        {
          email: "dep.api@camara.leg.br",
          nome_deputado: "Nome API",
          partido: "PT",
        },
        {
          email: "dep.api@camara.leg.br",
          nome_deputado: "Nome API",
          partido: "PT",
        },
        { email: "novo@x.com", nome_deputado: "Deputado Novo" },
      ),
    ).toEqual({
      email: "novo@x.com",
      nome_deputado: "Deputado Novo",
      partido: "PT",
    });
  });

  it("cliente ganha sobre prefill mesclado do backend", () => {
    expect(
      mergePapelariaFieldValues(
        { email: "dep.api@camara.leg.br" },
        { email: "novo@x.com", partido: "PL" },
        { email: "novo@x.com" },
      ),
    ).toEqual({
      email: "novo@x.com",
      partido: "PL",
    });
  });

  it("prefill vazio sem cliente devolve o current", () => {
    expect(mergePapelariaFieldValues({ email: "a@x.com" }, undefined)).toEqual({
      email: "a@x.com",
    });
    expect(mergePapelariaFieldValues({ email: "a@x.com" }, {})).toEqual({
      email: "a@x.com",
    });
  });
});

describe("clienteAlteracaoIdentity", () => {
  it("é nula sem campos", () => {
    expect(clienteAlteracaoIdentity(null)).toBeNull();
    expect(clienteAlteracaoIdentity({ versao: "2", campos: {} })).toBeNull();
  });

  it("muda quando job, versão ou campos mudam", () => {
    const campos = { email: "novo@x.com" };
    const a = clienteAlteracaoIdentity({
      job_id: 1,
      versao: "1",
      campos,
    });
    const b = clienteAlteracaoIdentity({
      job_id: 1,
      versao: "2",
      campos,
    });
    const c = clienteAlteracaoIdentity({
      job_id: 1,
      versao: "1",
      campos: { email: "outro@x.com" },
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("é estável independente da ordem das chaves", () => {
    expect(
      clienteAlteracaoIdentity({
        job_id: 1,
        versao: "1",
        campos: { b: "2", a: "1" },
      }),
    ).toBe(
      clienteAlteracaoIdentity({
        job_id: 1,
        versao: "1",
        campos: { a: "1", b: "2" },
      }),
    );
  });
});
