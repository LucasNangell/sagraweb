import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClienteProofRelevoSecoBanner } from "./ClienteProofPortalExtras";

describe("ClienteProofRelevoSecoBanner", () => {
  it("exibe o aviso centralizado com Vermelho em negrito e #A52B48", () => {
    render(<ClienteProofRelevoSecoBanner />);
    const banner = screen.getByTestId("cliente-proof-relevo-seco-banner");
    expect(banner).toHaveTextContent(
      "O contorno em Vermelho indica aplicação de Relevo Seco",
    );
    expect(banner.className).toContain("text-center");
    const vermelho = screen.getByText("Vermelho");
    expect(vermelho.tagName).toBe("STRONG");
    expect(vermelho).toHaveStyle({ color: "#A52B48" });
  });
});
