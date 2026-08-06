import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmailNav } from "./EmailNav";

describe("EmailNav", () => {
  it("esconde o botão de configuração quando não houver permissão", () => {
    render(
      <EmailNav
        activeTab="inbox"
        onTabChange={vi.fn()}
        showPendenciasDot={false}
        showConfigButton={false}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Config/i }),
    ).not.toBeInTheDocument();
  });

  it("mostra o botão de configuração quando houver permissão", () => {
    render(
      <EmailNav
        activeTab="inbox"
        onTabChange={vi.fn()}
        showPendenciasDot={false}
        showConfigButton
        onOpenConfig={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Config/i })).toBeInTheDocument();
  });
});
