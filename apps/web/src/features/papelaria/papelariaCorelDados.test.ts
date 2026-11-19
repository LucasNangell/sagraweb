import { describe, expect, it, vi } from "vitest";

import { COMPARAR_COREL_TIMEOUT_MS, compararDadosCorel } from "./papelariaCorelDados";

const params = { ano: 2026, nro: 6592, modeloId: 12, dados: { email: "a@b" } };
const diferenca = {
  campo: "NomeDep",
  rotulo: "Nome",
  original: ["Everton Rocha"],
  novo: ["Sargento Gonçalves"],
};

describe("compararDadosCorel", () => {
  it("sem Corel na pasta não pergunta nada", async () => {
    const resultado = vi.fn();
    const res = await compararDadosCorel(params, {
      iniciar: vi.fn(async () => ({ status: "sem_corel" as const })),
      resultado,
    });
    expect(res.status).toBe("sem_corel");
    expect(resultado).not.toHaveBeenCalled();
  });

  it("espera o worker e devolve as diferenças", async () => {
    const resultado = vi
      .fn()
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "processing" })
      .mockResolvedValueOnce({ status: "completed", diferencas: [diferenca] });
    const sleep = vi.fn(async () => undefined);
    const res = await compararDadosCorel(params, {
      iniciar: vi.fn(async () => ({
        status: "pending" as const,
        inspect_id: "abc",
        arquivo: "x_Base.cdr",
      })),
      resultado,
      sleep,
    });
    expect(res).toMatchObject({ status: "completed", arquivo: "x_Base.cdr" });
    expect(res.diferencas).toEqual([diferenca]);
    expect(resultado).toHaveBeenCalledWith(2026, 6592, "abc", {
      modelo_id: 12,
      dados: { email: "a@b" },
    });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("tempo esgotado e erro de rede viram falha (usuário decide)", async () => {
    let t = 0;
    const lento = await compararDadosCorel(params, {
      iniciar: vi.fn(async () => ({ status: "pending" as const, inspect_id: "abc" })),
      resultado: vi.fn(async () => ({ status: "pending" as const })),
      sleep: vi.fn(async () => {
        t += COMPARAR_COREL_TIMEOUT_MS;
      }),
      now: () => t,
    });
    expect(lento.status).toBe("failed");

    const rede = await compararDadosCorel(params, {
      iniciar: vi.fn(async () => {
        throw new Error("HTTP 500");
      }),
    });
    expect(rede).toMatchObject({ status: "failed", erro: "HTTP 500" });
  });
});
