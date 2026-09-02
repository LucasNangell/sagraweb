import { describe, expect, it } from "vitest";

import {
  buildGravacaoPendenteObservacaoPayload,
  mergeGravacaoPendenteObservacoes,
} from "./OsHistoryPanel";

describe("mergeGravacaoPendenteObservacoes", () => {
  it("preserva a observação da home antes da observação para o Birô", () => {
    expect(
      mergeGravacaoPendenteObservacoes("Obs da home", "Obs do Birô"),
    ).toBe("Obs da home\n\nObservação para o Birô:\nObs do Birô");
  });

  it("não cria linhas vazias quando uma das observações está em branco", () => {
    expect(mergeGravacaoPendenteObservacoes("Obs da home", " ")).toBe(
      "Obs da home",
    );
    expect(mergeGravacaoPendenteObservacoes(" ", "Obs do Birô")).toBe(
      "Observação para o Birô:\nObs do Birô",
    );
  });

  it("separa a observação gravada na sessão da observação completa do andamento", () => {
    expect(
      buildGravacaoPendenteObservacaoPayload("Obs da home", "Obs do Birô"),
    ).toEqual({
      obs: "Obs da home\n\nObservação para o Birô:\nObs do Birô",
      gravacao_pendente_observacao_biro: "Obs do Birô",
    });
  });
});
