import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { aplicarBolsoPadrao, type PapelariaMockupConfig } from "../mockup";
import { PapelariaProofMockup3D } from "./PapelariaProofMockup3D";

const PASTA: PapelariaMockupConfig = {
  id: "pasta",
  nome: "Pasta",
  modo: "cartao_dobrado",
  larguraAbertaMm: 220,
  alturaAbertaMm: 310,
  orientacao: "retrato",
  faces: [
    { id: "interior", nome: "Interior", pageIndex: 1, className: "mockup-face--back", style3d: {}, zIndex: 1 },
    { id: "capa", nome: "Capa", pageIndex: 0, style3d: {}, zIndex: 2, abreComDobra: true },
  ],
};

describe("PapelariaProofMockup3D — bolso interno", () => {
  it("desenha o bolso com as fendas na face interna da pasta c/ bolso", () => {
    render(
      <PapelariaProofMockup3D
        pages={["data:image/png;base64,AAA"]}
        config={aplicarBolsoPadrao(PASTA, "Pasta Avulso c/ Bolso")}
      />,
    );
    const bolso = screen.getByTestId("mockup-bolso");
    expect(bolso.closest("[title='Interior']")).not.toBeNull();
    expect(bolso.querySelectorAll("line")).toHaveLength(2);
  });

  it("pasta s/ bolso não desenha bolso", () => {
    render(
      <PapelariaProofMockup3D
        pages={["data:image/png;base64,AAA"]}
        config={aplicarBolsoPadrao(PASTA, "Pasta Avulso s/ Bolso")}
      />,
    );
    expect(screen.queryByTestId("mockup-bolso")).not.toBeInTheDocument();
  });
});
