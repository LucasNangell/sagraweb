import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { GravacaoExternaDetail } from "@/api/gravacaoExterna";
import { queryKeys } from "@/api/query-keys";

import { applyGravacaoMensagemToCache } from "./gravacaoExternaThreadCache";

describe("gravacaoExternaThreadCache", () => {
  it("adiciona mensagem nova ao cache do detail", () => {
    const qc = new QueryClient();
    const detail: GravacaoExternaDetail = {
      id: 1,
      os_ano: 2026,
      os_nro: 100,
      cod_status: "x",
      lancado_por_ponto: "918713",
      status: "iniciada",
      arquivos: [],
      mensagens: [
        {
          id: 1,
          autor_ponto: "918713",
          autor_papel: "lancador",
          mensagem: "Olá",
        },
      ],
    };
    qc.setQueryData(queryKeys.gravacaoExterna.detail(2026, 100), detail);

    const result = applyGravacaoMensagemToCache(qc, 2026, 100, {
      id: 2,
      autor_ponto: "900001",
      autor_papel: "operador",
      mensagem: "Resposta",
    });

    expect(result).toBe("appended");
    const updated = qc.getQueryData<GravacaoExternaDetail>(
      queryKeys.gravacaoExterna.detail(2026, 100),
    );
    expect(updated?.mensagens).toHaveLength(2);
    expect(updated?.mensagens[1]?.mensagem).toBe("Resposta");
  });
});
