import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { NovaOsSetorModal } from "./NovaOsSetorModal";

vi.mock("@/api/hooks/useAuxLookups", () => ({
  useSetoresLookup: () => ({
    data: ["SEFOC", "SEIMP", "SEGRA"],
    isLoading: false,
  }),
}));

function renderModal(
  props: Partial<ComponentProps<typeof NovaOsSetorModal>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = props.onClose ?? vi.fn();
  const onConfirm = props.onConfirm ?? vi.fn();
  return {
    onClose,
    onConfirm,
    ...render(
      <QueryClientProvider client={client}>
        <NovaOsSetorModal
          open
          onClose={onClose}
          onConfirm={onConfirm}
          {...props}
        />
      </QueryClientProvider>,
    ),
  };
}

describe("NovaOsSetorModal", () => {
  it("usa SEFOC quando o usuário não tem setor", () => {
    renderModal();
    expect(screen.getByTestId("os-nova-setor-select")).toHaveValue("SEFOC");
    expect(screen.getByTestId("os-nova-setor-root")).toHaveTextContent(
      "Entrada Inicial",
    );
    expect(screen.getByTestId("os-nova-setor-root")).toHaveTextContent("SEFOC");
  });

  it("pré-seleciona o setor do usuário e inclui-o na lista", () => {
    renderModal({ defaultSetor: "SEDIR" });
    const select = screen.getByTestId("os-nova-setor-select");
    expect(select).toHaveValue("SEDIR");
    expect(screen.getByRole("option", { name: "SEDIR" })).toBeInTheDocument();
  });

  it("confirma o setor alterado", () => {
    const { onConfirm } = renderModal({ defaultSetor: "SEFOC" });
    fireEvent.change(screen.getByTestId("os-nova-setor-select"), {
      target: { value: "SEGRA" },
    });
    fireEvent.click(screen.getByTestId("os-nova-setor-confirm"));
    expect(onConfirm).toHaveBeenCalledWith("SEGRA");
  });

  it("cancela sem confirmar", () => {
    const { onClose, onConfirm } = renderModal();
    fireEvent.click(screen.getByTestId("os-nova-setor-cancel"));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
