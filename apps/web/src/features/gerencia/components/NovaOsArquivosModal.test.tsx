import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { NovaOsArquivosModal } from "./NovaOsArquivosModal";

vi.mock("@/api/osArquivos", () => ({
  fetchGerenciaSettings: vi.fn(async () => ({
    os_arquivos_client_email_enabled: true,
  })),
  finalizeOsArquivosInterno: vi.fn(),
  sendOsArquivosClientEmail: vi.fn(),
}));

function renderModal(props: Partial<ComponentProps<typeof NovaOsArquivosModal>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NovaOsArquivosModal
        open
        ano={2026}
        osId={3100}
        ponto="123"
        onDone={vi.fn()}
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("NovaOsArquivosModal", () => {
  it("mostra o botão Repetição de OS na escolha inicial", async () => {
    renderModal();
    expect(await screen.findByRole("button", { name: "Repetição de OS" })).toBeInTheDocument();
  });

  it("abre o formulário de origem ao clicar em Repetição de OS", async () => {
    renderModal({ origemId: 2282, origemAno: 2025 });
    fireEvent.click(await screen.findByRole("button", { name: "Repetição de OS" }));
    expect(await screen.findByText(/Repetição de OS — 3100\/2026/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("Nº OS origem")).toHaveValue(2282);
    });
    expect(screen.getByLabelText("Ano origem")).toHaveValue(2025);
  });
});
