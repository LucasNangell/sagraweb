import { describe, expect, it } from "vitest";

import {
  isSpStatusInFlight,
  resolveSpImposicaoCell,
  resolveSpProvaCell,
} from "./papelariaSpPipelineUi";

describe("resolveSpProvaCell — cronologia da prova", () => {
  it("sem prova → só o triângulo de pendente", () => {
    const cell = resolveSpProvaCell({ phase: "none", versao: null });
    expect(cell).toMatchObject({ versao: null, icon: "alert" });
  });

  it("fila / geração → loading (de qualquer usuário)", () => {
    const fila = resolveSpProvaCell({ phase: "queued", versao: 2, por: "918713" });
    expect(fila).toMatchObject({ versao: null, icon: "loader", muted: true });
    expect(fila.label).toContain("918713");

    const gerando = resolveSpProvaCell({
      phase: "processing",
      versao: null,
      atividade: "Enviando prova ao cliente",
    });
    expect(gerando.icon).toBe("loader");
    expect(gerando.label).toContain("Enviando prova ao cliente");
  });

  it("gerada aguardando OK → número + pendente", () => {
    expect(resolveSpProvaCell({ phase: "review", versao: 2 })).toMatchObject({
      versao: 2,
      icon: "alert",
    });
  });

  it("Encam. de Docum. → número + envio", () => {
    expect(resolveSpProvaCell({ phase: "ready_send", versao: 3 })).toMatchObject({
      versao: 3,
      icon: "send",
    });
  });

  it("enviada → número + relógio", () => {
    expect(
      resolveSpProvaCell({ phase: "waiting_client", versao: 2 }),
    ).toMatchObject({ versao: 2, icon: "clock" });
  });

  it("alteração pedida → número + pendente", () => {
    expect(resolveSpProvaCell({ phase: "alteracao", versao: 2 })).toMatchObject({
      versao: 2,
      icon: "alert",
    });
  });

  it("aprovada pelo cliente → número + check", () => {
    expect(resolveSpProvaCell({ phase: "approved", versao: 5 })).toMatchObject({
      versao: 5,
      icon: "check",
    });
  });

  it("falha da última geração aparece no texto", () => {
    expect(
      resolveSpProvaCell({ phase: "none", versao: null, falhou: true }).label,
    ).toContain("falhou");
  });
});

describe("resolveSpImposicaoCell", () => {
  it("oculta antes da aprovação", () => {
    expect(resolveSpImposicaoCell({ phase: "hidden" })).toEqual({
      icon: null,
      label: "",
    });
  });

  it("aprovada sem imposição → pendente", () => {
    expect(resolveSpImposicaoCell({ phase: "pending" }).icon).toBe("alert");
  });

  it("Aguard. Juntada → relógio", () => {
    expect(resolveSpImposicaoCell({ phase: "waiting_juntada" }).icon).toBe(
      "clock",
    );
  });

  it("fila / processando / Apogee → loading", () => {
    expect(resolveSpImposicaoCell({ phase: "queued" }).icon).toBe("loader");
    expect(resolveSpImposicaoCell({ phase: "processing" }).icon).toBe("loader");
    expect(
      resolveSpImposicaoCell({
        phase: "waiting_apogee",
        ancora: { ano: 2026, nro: 6000 },
      }).label,
    ).toContain("6000");
  });

  it("imposição feita → check", () => {
    expect(resolveSpImposicaoCell({ phase: "ready" }).icon).toBe("check");
  });
});

describe("isSpStatusInFlight", () => {
  it("detecta processamento em qualquer coluna", () => {
    const base = { ano: 2026, nro: 1 };
    expect(
      isSpStatusInFlight({
        ...base,
        prova: { phase: "approved", versao: 1 },
        imposicao: { phase: "waiting_apogee" },
      }),
    ).toBe(true);
    expect(
      isSpStatusInFlight({
        ...base,
        prova: { phase: "processing", versao: null },
        imposicao: { phase: "hidden" },
      }),
    ).toBe(true);
    expect(
      isSpStatusInFlight({
        ...base,
        prova: { phase: "approved", versao: 1 },
        imposicao: { phase: "ready" },
      }),
    ).toBe(false);
  });
});
