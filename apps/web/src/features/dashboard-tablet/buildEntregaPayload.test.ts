import { describe, expect, it } from "vitest";

import {
  buildTabletEntregueHistoryPayload,
  buildTabletProtocoloEntrega,
  todayIsoDate,
} from "./buildEntregaPayload";

describe("buildTabletProtocoloEntrega", () => {
  const fixed = new Date(2026, 6, 31);

  it("mapeia entregador da câmera e receptor do teclado", () => {
    const payload = buildTabletProtocoloEntrega({
      entregadorPonto: 918713,
      receptorPontoDigits: "123.456",
      receptorNome: "Maria Silva",
      panelSector: "Expedição",
      now: fixed,
    });
    expect(payload.entregue_por).toBe("918713");
    expect(payload.nr_ponto).toBe("123456");
    expect(payload.entregue_para).toBe("Maria Silva");
    expect(payload.setor).toBe("Expedição");
    expect(payload.data).toBe(todayIsoDate(fixed));
    expect(payload.data_entrega).toBe(todayIsoDate(fixed));
    expect(payload.armazenado_em).toBe("");
    expect(payload.recado_com).toBe("");
  });

  it("aceita receptor sem nome cadastrado", () => {
    const payload = buildTabletProtocoloEntrega({
      entregadorPonto: "42",
      receptorPontoDigits: "99",
      receptorNome: null,
      panelSector: "SEPAC",
      now: fixed,
    });
    expect(payload.entregue_por).toBe("42");
    expect(payload.nr_ponto).toBe("99");
    expect(payload.entregue_para).toBe("");
  });
});

describe("buildTabletEntregueHistoryPayload", () => {
  it("monta HistoryPayload com protocolo_entrega e face_token", () => {
    const history = buildTabletEntregueHistoryPayload({
      entregadorPonto: 918713,
      receptorPontoDigits: "555",
      receptorNome: "João",
      panelSector: "Expedição",
      obs: "  ok  ",
      faceToken: "tok-abc",
      now: new Date(2026, 0, 15),
    });
    expect(history.situacao).toBe("Entregue");
    expect(history.usuario).toBe("918713");
    expect(history.obs).toBe("ok");
    expect(history.face_token).toBe("tok-abc");
    expect(history.from_tablet).toBe(true);
    expect(history.confirm_main_os_target).toBe(true);
    expect(history.protocolo_entrega?.entregue_por).toBe("918713");
    expect(history.protocolo_entrega?.nr_ponto).toBe("555");
    expect(history.protocolo_entrega?.entregue_para).toBe("João");
  });
});
