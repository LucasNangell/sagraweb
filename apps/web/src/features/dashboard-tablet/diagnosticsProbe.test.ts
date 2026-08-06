import { describe, expect, it } from "vitest";

import {
  buildWsProbeCandidates,
  describeWsProbe,
  toHttpProbeUrl,
} from "./diagnosticsProbe";

describe("toHttpProbeUrl", () => {
  it("converte wss em https e ws em http", () => {
    expect(toHttpProbeUrl("wss://host/sagra/api/ws/")).toBe(
      "https://host/sagra/api/ws/",
    );
    expect(toHttpProbeUrl("ws://host/ws")).toBe("http://host/ws");
  });

  it("mantém URLs que não são de WebSocket", () => {
    expect(toHttpProbeUrl("https://host/sagra/api")).toBe(
      "https://host/sagra/api",
    );
  });
});

describe("buildWsProbeCandidates", () => {
  it("começa pela URL do app e inclui variação de barra final", () => {
    const candidates = buildWsProbeCandidates(
      "wss://cgrafsysvm.camara.leg.br/sagra/api/ws/",
    );
    expect(candidates[0]).toBe(
      "wss://cgrafsysvm.camara.leg.br/sagra/api/ws/",
    );
    expect(candidates[1]).toBe("wss://cgrafsysvm.camara.leg.br/sagra/api/ws");
    expect(candidates).toContain("wss://cgrafsysvm.camara.leg.br/api/ws/");
    expect(candidates).toContain("wss://cgrafsysvm.camara.leg.br/ws");
  });

  it("não repete candidatos", () => {
    const candidates = buildWsProbeCandidates("ws://localhost:5173/ws");
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates[0]).toBe("ws://localhost:5173/ws");
  });

  it("preserva query string", () => {
    const candidates = buildWsProbeCandidates("wss://host/sagra/api/ws/?x=1");
    expect(candidates[0]).toBe("wss://host/sagra/api/ws/?x=1");
    expect(candidates[1]).toBe("wss://host/sagra/api/ws?x=1");
  });

  it("devolve a entrada quando a URL é inválida", () => {
    expect(buildWsProbeCandidates("nao-e-url")).toEqual(["nao-e-url"]);
  });
});

describe("describeWsProbe", () => {
  it("descreve cada desfecho em pt-BR", () => {
    expect(describeWsProbe({ url: "u", outcome: "open", ms: 120 })).toContain(
      "conectou",
    );
    expect(
      describeWsProbe({ url: "u", outcome: "closed", code: 1006, ms: 90 }),
    ).toContain("code=1006");
    expect(describeWsProbe({ url: "u", outcome: "timeout", ms: 6000 })).toContain(
      "sem resposta",
    );
    expect(describeWsProbe({ url: "u", outcome: "error", ms: 30 })).toContain(
      "erro no handshake",
    );
  });
});
