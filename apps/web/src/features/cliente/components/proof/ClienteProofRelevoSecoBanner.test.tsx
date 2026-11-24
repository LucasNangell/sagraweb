import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClienteProofRelevoSecoBanner } from "./ClienteProofPortalExtras";

describe("ClienteProofRelevoSecoBanner", () => {
  it("exibe o aviso com Vermelho em negrito e #A52B48", () => {
    render(<ClienteProofRelevoSecoBanner />);
    expect(screen.getByTestId("cliente-proof-relevo-seco-banner")).toHaveTextContent(
      "O contorno em Vermelho indica aplicação de Relevo Seco",
    );
    const vermelho = screen.getByText("Vermelho");
    expect(vermelho.tagName).toBe("STRONG");
    expect(vermelho).toHaveStyle({ color: "#A52B48" });
  });
});
