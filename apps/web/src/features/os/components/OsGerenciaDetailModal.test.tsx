import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyGerenciaForm } from "@/features/gerencia/defaults";
import { createEmptyTechSpec } from "@/features/gerencia/techSpec";

const { allowed } = vi.hoisted(() => ({
  allowed: new Set<string>([
    "ctx_duplicar_os",
    "ctx_vincular_os",
    "ctx_nova_os",
    "ctx_imprimir_ficha",
    "ctx_editar_os",
  ]),
}));

const fetchOsVinculos = vi.fn();
const useDevFeature = vi.fn(() => false);

vi.mock("@/api/os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/os")>();
  return {
    ...actual,
    fetchOsVinculos: (...args: unknown[]) => fetchOsVinculos(...args),
  };
});

vi.mock("@/features/configuracoes/hooks/useDevFeature", () => ({
  useDevFeature: (...args: unknown[]) => useDevFeature(...args),
}));

vi.mock("@/features/auth/useAccessControl", () => ({
  useAccessControl: () => ({
    can: (key: string) => allowed.has(key),
  }),
}));

vi.mock("@/features/os/hooks/useOsEditLock", () => ({
  useOsEditLock: () => ({
    acquire: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
    acquiring: false,
  }),
}));

vi.mock("@/features/orcamento/hooks/useOrcamentoEditor", () => ({
  OrcamentoEditorProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/features/gerencia/hooks/useGerenciaOsEditor", () => ({
  useGerenciaOsEditor: () => ({
    form: createEmptyGerenciaForm(),
    update: vi.fn(),
    techSpec: createEmptyTechSpec(),
    handleTechSpecChange: vi.fn(),
    loading: false,
    saving: false,
    save: vi.fn(),
    dirty: false,
    resetToSnapshot: vi.fn(),
    deputyPhoto: null,
    photoUploading: false,
    fetchDeputadoIfNeeded: vi.fn(),
    uploadSolicitantePhoto: vi.fn(),
    loadError: null,
    ponto: "1234",
    aux: {
      categorias: [],
      produtos: [],
      maquinas: [],
      papeis: [],
      cores: [],
      formatos: [],
      formasEntrega: [],
      responsaveisGrafica: [],
      acabamentos: [],
    },
  }),
}));

vi.mock("@/features/gerencia/components/GerenciaFormSections", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/gerencia/components/GerenciaFormSections")>();
  return {
    ...actual,
    renderGerenciaSection: () => <div>seção gerência</div>,
  };
});

vi.mock("./OsVinculosEditor", () => ({
  OsVinculosEditor: () => <div data-testid="os-vinculos-editor-stub">editor</div>,
}));

vi.mock("./OsSequenciaProducaoTab", () => ({
  OsSequenciaProducaoTab: () => (
    <div data-testid="os-sequencia-producao-tab-stub">sequência</div>
  ),
}));

import {
  buildGerenciaModalNavSections,
  OsGerenciaDetailModal,
} from "./OsGerenciaDetailModal";
import type { OsSearchRow } from "../types";

const row: OsSearchRow = { nr_os: 100, ano: 2026, titulo: "Teste" };

function renderModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OsGerenciaDetailModal row={row} open onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("buildGerenciaModalNavSections", () => {
  it("inclui Vínculos da OS só quando pedido", () => {
    expect(
      buildGerenciaModalNavSections({
        showHistorico: false,
        showSequenciaProducao: false,
        showVinculos: false,
      }).map((s) => s.id),
    ).not.toContain("vinculos");
    const withVinculos = buildGerenciaModalNavSections({
      showHistorico: true,
      showSequenciaProducao: true,
      showVinculos: true,
    });
    expect(withVinculos.map((s) => s.id)).toContain("sequencia-producao");
    expect(withVinculos.map((s) => s.id)).toContain("vinculos");
    expect(withVinculos.find((s) => s.id === "vinculos")?.label).toBe(
      "Vínculos da OS",
    );
  });
});

describe("OsGerenciaDetailModal vínculos", () => {
  beforeEach(() => {
    fetchOsVinculos.mockReset();
    useDevFeature.mockReset();
    useDevFeature.mockReturnValue(false);
  });

  it("mostra o botão Vincular OS ao lado de Duplicar OS", () => {
    fetchOsVinculos.mockResolvedValue([]);
    renderModal();
    expect(screen.getByTestId("os-gerencia-duplicate")).toBeInTheDocument();
    expect(screen.getByTestId("os-gerencia-vincular")).toBeInTheDocument();
    expect(screen.queryByTestId("os-gerencia-section-vinculos")).not.toBeInTheDocument();
  });

  it("mostra a aba Vínculos da OS quando a OS tem vínculo", async () => {
    fetchOsVinculos.mockResolvedValue([{ numero: 200, ano: 2026 }]);
    renderModal();
    expect(await screen.findByTestId("os-gerencia-section-vinculos")).toHaveTextContent(
      "Vínculos da OS",
    );
  });
});

describe("OsGerenciaDetailModal sequência de produção", () => {
  beforeEach(() => {
    fetchOsVinculos.mockReset();
    fetchOsVinculos.mockResolvedValue([]);
    useDevFeature.mockReset();
  });

  it("oculta a aba quando a flag de desenvolvimento está desligada", () => {
    useDevFeature.mockReturnValue(false);
    renderModal();
    expect(
      screen.queryByTestId("os-gerencia-section-sequencia-producao"),
    ).not.toBeInTheDocument();
  });

  it("mostra a aba quando a flag de desenvolvimento está ligada", () => {
    useDevFeature.mockReturnValue(true);
    renderModal();
    expect(screen.getByTestId("os-gerencia-section-sequencia-producao")).toHaveTextContent(
      "Sequência de produção",
    );
  });
});
