import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createPapelariaModeloFromPdf: vi.fn(),
  savePapelariaProdutoMockup: vi.fn(),
}));
vi.mock("@/api/adminSystem", () => api);

import { PapelariaNovoModeloForm } from "./PapelariaNovoModeloForm";

function renderForm(props: Partial<Parameters<typeof PapelariaNovoModeloForm>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <PapelariaNovoModeloForm onCreated={onCreated} {...props} />
    </QueryClientProvider>,
  );
  return { onCreated };
}

const pdf = () => new File(["%PDF-1.7"], "Verso Assessor.pdf", { type: "application/pdf" });

describe("PapelariaNovoModeloForm", () => {
  beforeEach(() => {
    api.createPapelariaModeloFromPdf.mockReset();
    api.savePapelariaProdutoMockup.mockReset();
    api.createPapelariaModeloFromPdf.mockResolvedValue({ id: 99, produto: "Ct Visita" });
  });

  it("novo verso em produto existente: só o PDF, sem .cdr nem mockup", async () => {
    const { onCreated } = renderForm({ lockedProduto: "Ct Visita", faceInicial: "verso" });
    expect(screen.getByRole("heading", { name: "Novo verso em Ct Visita" })).toBeInTheDocument();
    expect(screen.queryByText(/\.cdr/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mockup 3D do produto/)).not.toBeInTheDocument();

    const criar = screen.getByRole("button", { name: "Criar verso" });
    expect(criar).toBeDisabled();
    fireEvent.change(screen.getByTestId("pw-novo-pdf-input"), { target: { files: [pdf()] } });
    expect(screen.getByText("Verso Assessor.pdf")).toBeInTheDocument();
    fireEvent.click(criar);

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 99, produto: "Ct Visita" }));
    expect(api.createPapelariaModeloFromPdf).toHaveBeenCalledWith(
      expect.objectContaining({ produto: "Ct Visita", frenteVerso: "Verso", cores: "Policromia" }),
    );
    expect(api.savePapelariaProdutoMockup).not.toHaveBeenCalled();
  });

  it("recusa arquivo que não é PDF", () => {
    renderForm({ lockedProduto: "Ct Visita" });
    fireEvent.change(screen.getByTestId("pw-novo-pdf-input"), {
      target: { files: [new File(["x"], "modelo.cdr")] },
    });
    expect(screen.getByText(/Envie o PDF do modelo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar frente" })).toBeDisabled();
  });

  it("produto novo grava o mockup inicial no produto", async () => {
    renderForm({ produtosExistentes: ["Ct Visita"] });
    fireEvent.change(screen.getByLabelText("Produto"), { target: { value: "Envelope" } });
    fireEvent.change(screen.getByTestId("pw-novo-pdf-input"), { target: { files: [pdf()] } });
    fireEvent.click(screen.getByRole("button", { name: "Criar frente" }));
    await vi.waitFor(() =>
      expect(api.savePapelariaProdutoMockup).toHaveBeenCalledWith("Envelope", "frente", expect.any(String)),
    );
  });
});
