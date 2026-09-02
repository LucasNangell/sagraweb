import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnaliseLabSourcePicker } from "./AnaliseLabSourcePicker";

const fetchOsVersions = vi.fn();
const fetchAnaliseLabFiles = vi.fn();

vi.mock("@/api/analise", () => ({
  fetchOsVersions: (...args: unknown[]) => fetchOsVersions(...args),
}));

vi.mock("@/api/analiseLab", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/analiseLab")>();
  return {
    ...actual,
    fetchAnaliseLabFiles: (...args: unknown[]) => fetchAnaliseLabFiles(...args),
  };
});

function renderPicker(onGenerate = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AnaliseLabSourcePicker ano={2026} osId={86} onGenerate={onGenerate} />
    </QueryClientProvider>,
  );
  return { onGenerate };
}

describe("AnaliseLabSourcePicker", () => {
  it("pré-seleciona folhas para arquivo único, mas permite gerar como flipbook", async () => {
    fetchOsVersions.mockResolvedValue({
      versions: [{ version: 1, label: "v1", path: "Original/v1" }],
    });
    fetchAnaliseLabFiles.mockResolvedValue({
      files: [
        {
          path: "Original/v1/arquivo.pdf",
          name: "arquivo.pdf",
          dir: "Original/v1",
          size: 1024,
          modifiedAt: "2026-09-02T12:00:00Z",
        },
      ],
      truncated: false,
    });
    const { onGenerate } = renderPicker();

    expect(await screen.findByLabelText("Folhas separadas")).toBeChecked();
    expect(screen.getByLabelText("Flipbook")).not.toBeChecked();

    fireEvent.click(screen.getByLabelText("Flipbook"));
    fireEvent.click(await screen.findByRole("button", { name: "Usar" }));
    fireEvent.click(screen.getByRole("button", { name: /Gerar visualização/i }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        modo: "unico",
        arquivo_unico: "Original/v1/arquivo.pdf",
        folhear_modo: "flipbook",
      }),
    );
  });
});
