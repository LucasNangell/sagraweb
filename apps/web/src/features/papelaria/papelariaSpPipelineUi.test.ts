import { describe, expect, it } from "vitest";

import {
  resolveSpImposicaoCell,
  resolveSpProvaCell,
} from "./papelariaSpPipelineUi";

describe("resolveSpProvaCell", () => {
  it("none → clock", () => {
    const cell = resolveSpProvaCell({ phase: "none", versao: null });
    expect(cell).toEqual({
      versao: null,
      icon: "clock",
      label: "Aguardando prova",
    });
  });

  it("ready_send → N + send", () => {
    const cell = resolveSpProvaCell({ phase: "ready_send", versao: 3 });
    expect(cell.icon).toBe("send");
    expect(cell.versao).toBe(3);
  });

  it("waiting_client → N + clock", () => {
    const cell = resolveSpProvaCell({ phase: "waiting_client", versao: 2 });
    expect(cell).toMatchObject({
      versao: 2,
      icon: "clock",
      label: "Aguardando aprovação do cliente (prova 2)",
    });
  });

  it("alteracao → N + clock", () => {
    const cell = resolveSpProvaCell({ phase: "alteracao", versao: 2 });
    expect(cell).toMatchObject({ versao: 2, icon: "clock" });
  });

  it("approved → N + check", () => {
    const cell = resolveSpProvaCell({ phase: "approved", versao: 5 });
    expect(cell).toMatchObject({ versao: 5, icon: "check" });
  });

  it("overlay processing prevalece", () => {
    const cell = resolveSpProvaCell(
      { phase: "approved", versao: 5 },
      { phase: "processing", jobId: 9 },
    );
    expect(cell.icon).toBe("loader");
  });
});

describe("resolveSpImposicaoCell", () => {
  it("hidden → vazio", () => {
    expect(
      resolveSpImposicaoCell({ phase: "hidden" }, null, "ready_send"),
    ).toEqual({ icon: null, label: "" });
  });

  it("approved sem imposição → clock", () => {
    const cell = resolveSpImposicaoCell({ phase: "pending" }, null, "approved");
    expect(cell.icon).toBe("clock");
  });

  it("waiting_apogee → loader", () => {
    const cell = resolveSpImposicaoCell({ phase: "waiting_apogee" });
    expect(cell.icon).toBe("loader");
  });

  it("ready → check", () => {
    expect(resolveSpImposicaoCell({ phase: "ready" }).icon).toBe("check");
  });
});
