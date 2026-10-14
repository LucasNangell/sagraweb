import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { GravacaoExternaDetail } from "@/api/gravacaoExterna";
import { queryKeys } from "@/api/query-keys";
import { useGravacaoExternaUiStore } from "@/features/gravacao-externa/gravacaoExternaUiStore";

import {
  extractGravacaoOsFromWs,
  handleGravacaoExternaMensagemWs,
  refreshGravacaoExternaDetail,
} from "./gravacaoExternaNotificationHandlers";

describe("gravacaoExternaNotificationHandlers", () => {
  it("extracts os from gravacao_externa_message payload", () => {
    expect(
      extractGravacaoOsFromWs({
        type: "gravacao_externa_message",
        os_ano: 2026,
        os_nro: 1209,
      }),
    ).toEqual({ ano: 2026, nrOs: 1209 });
  });

  it("merges gravacao_externa_message into detail cache", async () => {
    const qc = new QueryClient();
    const detail: GravacaoExternaDetail = {
      id: 1,
      os_ano: 2026,
      os_nro: 1209,
      cod_status: "x",
      lancado_por_ponto: "918713",
      status: "iniciada",
      arquivos: [],
      mensagens: [],
    };
    qc.setQueryData(queryKeys.gravacaoExterna.detail(2026, 1209), detail);

    await handleGravacaoExternaMensagemWs(
      qc,
      {
        type: "gravacao_externa_message",
        os_ano: 2026,
        os_nro: 1209,
        message: {
          id: 9,
          autor_ponto: "900001",
          autor_papel: "operador",
          mensagem: "Nova msg",
        },
      },
      { ano: 2026, nrOs: 1209 },
    );

    const updated = qc.getQueryData<GravacaoExternaDetail>(
      queryKeys.gravacaoExterna.detail(2026, 1209),
    );
    expect(updated?.mensagens).toHaveLength(1);
    expect(updated?.mensagens[0]?.mensagem).toBe("Nova msg");
  });

  it("refetches when cache miss on gravacao_externa_message", async () => {
    const qc = new QueryClient();
    const refetchSpy = vi.spyOn(qc, "refetchQueries").mockResolvedValue([] as never);

    await refreshGravacaoExternaDetail(qc, 2026, 1209, {
      id: 1,
      autor_ponto: "900001",
      autor_papel: "operador",
      mensagem: "Oi",
    });

    expect(refetchSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.gravacaoExterna.detail(2026, 1209),
      type: "all",
    });
  });

  it("também atualiza o detalhe sem id (chat da OS) quando a mensagem é de um envio", async () => {
    const qc = new QueryClient();
    const refetchSpy = vi.spyOn(qc, "refetchQueries").mockResolvedValue([] as never);

    await refreshGravacaoExternaDetail(
      qc,
      2026,
      1209,
      { id: 1, autor_ponto: "900001", autor_papel: "operador", mensagem: "Oi" },
      84,
    );

    expect(refetchSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.gravacaoExterna.detail(2026, 1209, null),
      exact: true,
      type: "active",
    });
    expect(refetchSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.gravacaoExterna.detail(2026, 1209, 84),
      type: "all",
    });
  });

  it("skips refetch on notification_new without message when conversation is open", async () => {
    const qc = new QueryClient();
    useGravacaoExternaUiStore.getState().setViewingOs(2026, 1209);
    const refetchSpy = vi.spyOn(qc, "refetchQueries").mockResolvedValue([] as never);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined as never);

    await handleGravacaoExternaMensagemWs(qc, {
      type: "notification_new",
      action: "gravacao_externa_mensagem",
      ano: 2026,
      id: 1209,
      gravacao_message_id: 3,
    });

    expect(refetchSpy).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    useGravacaoExternaUiStore.getState().setViewingOs(null, null);
  });

  it("updates cache when notification arrives with conversation open", async () => {
    const qc = new QueryClient();
    useGravacaoExternaUiStore.getState().setViewingOs(2026, 1209);
    const detail: GravacaoExternaDetail = {
      id: 1,
      os_ano: 2026,
      os_nro: 1209,
      cod_status: "x",
      lancado_por_ponto: "918713",
      status: "iniciada",
      arquivos: [],
      mensagens: [],
    };
    qc.setQueryData(queryKeys.gravacaoExterna.detail(2026, 1209), detail);

    await handleGravacaoExternaMensagemWs(qc, {
      type: "notification_new",
      action: "gravacao_externa_mensagem",
      ano: 2026,
      id: 1209,
      gravacao_message_id: 3,
      message: {
        id: 3,
        autor_ponto: "900001",
        autor_papel: "operador",
        mensagem: "Via notificação",
      },
    });

    const updated = qc.getQueryData<GravacaoExternaDetail>(
      queryKeys.gravacaoExterna.detail(2026, 1209),
    );
    expect(updated?.mensagens).toHaveLength(1);
    useGravacaoExternaUiStore.getState().setViewingOs(null, null);
  });
});
