import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/features/auth/authStore";
import { createDeniedPermissions, parsePermissionsFromApi } from "@/features/auth/permissions";
import {
  OrcamentoEditorContext,
  type OrcamentoEditorValue,
} from "@/features/orcamento/hooks/useOrcamentoEditor";
import { stubOrcamentoResponse } from "@/features/orcamento/orcamentoTestFixtures";

import { OrcamentoCotaHeaderButton, orcamentoOsSearch } from "./OrcamentoCotaHeaderButton";

function mockEditor(
  patch: Partial<OrcamentoEditorValue> = {},
): OrcamentoEditorValue {
  const data = stubOrcamentoResponse();
  return {
    enabled: true,
    valid: true,
    entrada: data.entrada,
    setEntrada: vi.fn(),
    computed: data,
    query: {
      isError: false,
      isLoading: false,
      error: null,
      data,
    } as OrcamentoEditorValue["query"],
    recalcPending: false,
    recalcError: null,
    pdfPending: false,
    pdfError: null,
    gerarPdf: vi.fn(),
    ...patch,
  };
}

describe("orcamentoOsSearch", () => {
  it("monta ano e id da OS para a rota de orçamento", () => {
    expect(orcamentoOsSearch("2026", "2465")).toEqual({
      ano: "2026",
      id: "2465",
    });
  });

  it("rejeita OS sem número válido", () => {
    expect(orcamentoOsSearch("", "")).toBeNull();
    expect(orcamentoOsSearch("2026", "0")).toBeNull();
  });
});

describe("OrcamentoCotaHeaderButton", () => {
  beforeEach(() => {
    act(() => {
      useAuthStore.setState({
        isAuthenticated: true,
        permissions: parsePermissionsFromApi({ ctx_orcamento: true }),
      });
    });
  });

  afterEach(() => {
    act(() => {
      useAuthStore.setState({
        isAuthenticated: false,
        permissions: createDeniedPermissions(),
      });
    });
  });

  it("com editor no modal, o botão gera o PDF e não é um link", () => {
    const editor = mockEditor();
    render(
      <OrcamentoEditorContext.Provider value={editor}>
        <OrcamentoCotaHeaderButton ano={2026} osId={1365} />
      </OrcamentoEditorContext.Provider>,
    );

    expect(screen.queryByRole("link", { name: "Orçamento" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gerar PDF" }));
    expect(editor.gerarPdf).toHaveBeenCalledTimes(1);
  });

  it("sem permissão ctx_orcamento não mostra o botão", () => {
    act(() => {
      useAuthStore.setState({
        isAuthenticated: true,
        permissions: createDeniedPermissions(),
      });
    });
    render(
      <OrcamentoEditorContext.Provider value={mockEditor()}>
        <OrcamentoCotaHeaderButton ano={2026} osId={1365} />
      </OrcamentoEditorContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Gerar PDF" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Orçamento" })).not.toBeInTheDocument();
  });
});
