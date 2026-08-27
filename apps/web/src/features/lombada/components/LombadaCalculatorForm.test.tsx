import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PapelLombadaItem } from "@/api/auxLookups";
import { LombadaCalculatorForm } from "./LombadaCalculatorForm";

const papeis: PapelLombadaItem[] = [
  { codPapel: 1, papel: "ap 75gr AA", espessura: 80 },
  { codPapel: 23, papel: "Couché Fosco 250gr", espessura: 220 },
];

describe("LombadaCalculatorForm", () => {
  it("preenche a partir dos componentes e calcula a lombada", () => {
    render(
      <LombadaCalculatorForm
        papeis={papeis}
        defaults={{
          pgs: 200,
          capaPapel: "Couché Fosco 250g",
          mioloPapel: "ap 75gr AA",
        }}
      />,
    );

    expect(screen.getByLabelText("Páginas do miolo")).toHaveValue(200);
    expect(screen.getByLabelText("Papel da capa")).toHaveValue("c:23");
    expect(screen.getByLabelText("Papel do miolo")).toHaveValue("c:1");
    expect(screen.getByText("9,94 mm")).toBeInTheDocument();
    expect(screen.getByText("10 mm")).toBeInTheDocument();
  });
});
