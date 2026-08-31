import { describe, expect, it, vi } from "vitest";

import { loadSolicitantePhoto, solicitantePhotoSearchKey } from "./solicitantePhoto";

const deputado = {
  nome: "MARIA SILVA",
  gabinete: "Anexo IV, Gabinete 1",
  andar: "2",
  local: "Câmara dos Deputados",
  ramal: "32155000",
  foto: "https://camara.leg.br/foto.jpg",
};

describe("solicitantePhotoSearchKey", () => {
  it("normaliza categoria e nome para comparar buscas", () => {
    expect(solicitantePhotoSearchKey("Deputado", " Maria Silva ")).toBe(
      "Deputado|maria silva",
    );
  });
});

describe("loadSolicitantePhoto", () => {
  it("usa a foto local e não busca na API da Câmara", async () => {
    const fetchDeputado = vi.fn();
    const result = await loadSolicitantePhoto({
      nome: "Maria Silva",
      categoria: "Deputado",
      fetchStatus: async () => ({ exists: true }),
      fotoUrl: (nome) => `/foto/${nome}`,
      fetchDeputado,
    });
    expect(result).toEqual({
      photo: "/foto/Maria Silva",
      usedLocal: true,
    });
    expect(fetchDeputado).not.toHaveBeenCalled();
  });

  it("busca na Câmara quando não há foto local e a categoria é Deputado", async () => {
    const fetchDeputado = vi.fn().mockResolvedValue(deputado);
    const result = await loadSolicitantePhoto({
      nome: "Maria Silva",
      categoria: "Deputado",
      fetchStatus: async () => ({ exists: false }),
      fotoUrl: () => "/nao-deve",
      fetchDeputado,
    });
    expect(result.usedLocal).toBe(false);
    expect(result.photo).toBe(deputado.foto);
    expect(result.deputado).toEqual(deputado);
    expect(fetchDeputado).toHaveBeenCalledWith("Maria Silva");
  });

  it("não busca na Câmara para outras categorias sem foto local", async () => {
    const fetchDeputado = vi.fn();
    const result = await loadSolicitantePhoto({
      nome: "Secretaria X",
      categoria: "Orgao",
      fetchStatus: async () => ({ exists: false }),
      fotoUrl: () => "/nao-deve",
      fetchDeputado,
    });
    expect(result).toEqual({ photo: null, usedLocal: false });
    expect(fetchDeputado).not.toHaveBeenCalled();
  });
});
