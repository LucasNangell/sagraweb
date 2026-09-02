import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchProofPessoaNome } from "@/api/proof-portal";

import { useProofGalNomeLookup } from "./useProofGalNomeLookup";

vi.mock("@/api/proof-portal", () => ({
  fetchProofPessoaNome: vi.fn(),
}));

const baseOpts = {
  enabled: true,
  ano: 2026,
  osId: 100,
  token: "tok",
  onNomeChange: vi.fn(),
};

describe("useProofGalNomeLookup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchProofPessoaNome).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bloqueia o nome até a busca concluir e preenche o resultado", async () => {
    vi.mocked(fetchProofPessoaNome).mockResolvedValue({ nome: "Maria Souza" });
    const onNomeChange = vi.fn();

    const { result } = renderHook(() =>
      useProofGalNomeLookup({
        ...baseOpts,
        pontoDigits: "6220",
        nomeCliente: "",
        onNomeChange,
      }),
    );

    expect(result.current.lockNome).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(fetchProofPessoaNome).toHaveBeenCalledWith(2026, 100, "tok", "6220");
    expect(onNomeChange).toHaveBeenCalledWith("Maria Souza");
    expect(result.current.lockNome).toBe(false);
    expect(result.current.pending).toBe(false);
  });

  it("libera o nome quando o GAL não devolve resultado", async () => {
    vi.mocked(fetchProofPessoaNome).mockResolvedValue({ nome: null });
    const onNomeChange = vi.fn();

    const { result } = renderHook(() =>
      useProofGalNomeLookup({
        ...baseOpts,
        pontoDigits: "6220",
        nomeCliente: "",
        onNomeChange,
      }),
    );

    expect(result.current.lockNome).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(onNomeChange).not.toHaveBeenCalled();
    expect(result.current.lockNome).toBe(false);
  });

  it("limpa o nome quando o ponto muda", async () => {
    vi.mocked(fetchProofPessoaNome).mockResolvedValue({ nome: "Maria Souza" });
    const onNomeChange = vi.fn();

    const { result, rerender } = renderHook(
      (props: { pontoDigits: string; nomeCliente: string }) =>
        useProofGalNomeLookup({
          ...baseOpts,
          onNomeChange,
          pontoDigits: props.pontoDigits,
          nomeCliente: props.nomeCliente,
        }),
      { initialProps: { pontoDigits: "6220", nomeCliente: "" } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(onNomeChange).toHaveBeenCalledWith("Maria Souza");

    onNomeChange.mockClear();
    rerender({ pontoDigits: "918713", nomeCliente: "Maria Souza" });

    expect(onNomeChange).toHaveBeenCalledWith("");
    expect(result.current.lockNome).toBe(true);
  });
});
