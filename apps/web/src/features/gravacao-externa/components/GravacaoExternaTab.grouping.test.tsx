import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let segmentItems: Array<Record<string, unknown>> = [];
let aguardandoItems: Array<Record<string, unknown>> = [];

vi.mock("@/api/hooks/useGravacaoExterna", () => ({
  GRAVACAO_EXTERNA_SAFETY_POLL_MS: 60_000,
  useGravacaoExternaOsList: () => ({
    data: { items: segmentItems, total: segmentItems.length },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGravacaoExternaDetails: (_ano: number, _nrOs: number, ids: number[]) => ({
    data: ids.map((id) => ({
      id,
      os_ano: 2026,
      os_nro: 1001,
      status: "pendente",
      lancado_por_ponto: "918.713",
      arquivos: [],
      mensagens: [],
    })),
    failed: ids.map(() => false),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGravacaoExternaAguardandoEntrega: () => ({
    data: { items: aguardandoItems, total: aguardandoItems.length },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useIniciarGravacaoExternaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConcluirGravacaoExternaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLancarEntregaChapasMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoverOsGravacaoExternaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoverOsAguardandoEntregaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

let isFornecedor = false;
vi.mock("@/features/auth/authStore", () => ({
  useAuthStore: (sel: (s: { user: { ponto: number; fornecedor: boolean } }) => unknown) =>
    sel({ user: { ponto: 100001, fornecedor: isFornecedor } }),
}));

vi.mock("@/features/auth/useAccessControl", () => ({
  useAccessControl: () => ({ can: () => true }),
}));

vi.mock("@/hooks/useMatchMedia", () => ({
  useMatchMedia: () => false,
}));

vi.mock("@/hooks/useDebouncedValue", () => ({
  useDebouncedValue: <T,>(v: T) => v,
}));

vi.mock("../hooks/useGravacaoExternaRealtime", () => ({
  useGravacaoExternaRealtime: () => ({ toast: null, clearToast: vi.fn() }),
}));

vi.mock("./GravacaoExternaPreview", () => ({
  GravacaoExternaArquivosPanel: () => null,
  GravacaoExternaPreview: () => null,
}));

vi.mock("./GravacaoExternaActions", () => ({
  GravacaoExternaActions: () => null,
  GravacaoExternaStatusBadge: () => <span>status</span>,
}));

const chatPanel = vi.fn();
vi.mock("./GravacaoExternaChatPanel", () => ({
  GravacaoExternaChatPanel: (props: { gravacaoExternaId: number | null }) => {
    chatPanel(props);
    return <div data-testid="chat">{`chat-${props.gravacaoExternaId}`}</div>;
  },
}));

vi.mock("./GravacaoQueueItemContextMenu", () => ({
  GravacaoQueueItemContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { GravacaoExternaTab } from "./GravacaoExternaTab";

const andamentoItems = () => [
  {
    nr_os: 1001,
    ano: 2026,
    solicitante: "A",
    componente: "capa",
    gravacao_externa_id: 1,
    gravacao_status: "pendente",
    fornecedor_ponto: "100.001",
    fornecedor_nome: "Zeta Gráfica",
  },
  {
    nr_os: 1002,
    ano: 2026,
    solicitante: "B",
    gravacao_externa_id: 2,
    gravacao_status: "pendente",
    fornecedor_ponto: "100.002",
    fornecedor_nome: "Alfa Birô",
  },
  {
    nr_os: 1001,
    ano: 2026,
    solicitante: "A",
    componente: "miolo",
    gravacao_externa_id: 5,
    gravacao_status: "iniciada",
    fornecedor_ponto: "100.002",
    fornecedor_nome: "Alfa Birô",
  },
  {
    nr_os: 1004,
    ano: 2026,
    solicitante: "D",
    gravacao_externa_id: null,
    gravacao_status: "sem_sessao",
    fornecedor_ponto: null,
  },
];

function cardOf(label: RegExp): HTMLElement {
  const button = screen.getByRole("button", { name: label });
  return button.closest("li") as HTMLElement;
}

describe("GravacaoExternaTab card por OS", () => {
  beforeEach(() => {
    isFornecedor = false;
    segmentItems = andamentoItems();
    aguardandoItems = [];
    chatPanel.mockReset();
  });

  it("mostra um card por OS, sem títulos de fornecedor, com badges de fornecedor", () => {
    render(<GravacaoExternaTab />);

    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /^01001\/26/ })).toHaveLength(1);
    expect(screen.queryByText("Capa")).toBeNull();
    expect(screen.queryByText("Miolo")).toBeNull();

    const os1001 = cardOf(/^01001\/26/);
    const badges = within(os1001).getAllByTitle("Exibir espelhos de chapa");
    expect(badges.map((b) => b.textContent)).toEqual(["Alfa Birô", "Zeta Gráfica"]);

    const os1002 = cardOf(/^01002\/26/);
    expect(within(os1002).getAllByTitle("Exibir espelhos de chapa")).toHaveLength(1);
    expect(within(cardOf(/^01004\/26/)).getByText("Sem fornecedor")).toBeTruthy();
  });

  it("badge de fornecedor seleciona a OS e filtra os envios; clicar de novo remove o filtro", () => {
    render(<GravacaoExternaTab />);

    const os1001 = cardOf(/^01001\/26/);
    const zeta = within(os1001).getByRole("button", { name: "Zeta Gráfica" });
    fireEvent.click(zeta);

    expect(zeta).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Envio Zeta Gráfica · Capa" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Envio Alfa Birô · Miolo" })).toBeNull();
    expect(screen.getByTestId("chat").textContent).toBe("chat-1");

    fireEvent.click(zeta);
    expect(zeta).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("region", { name: "Envio Zeta Gráfica · Capa" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Envio Alfa Birô · Miolo" })).toBeTruthy();
  });

  it("chat acompanha o envio em foco, sem badges na coluna de mensagens", () => {
    render(<GravacaoExternaTab />);
    fireEvent.click(screen.getByRole("button", { name: /^01001\/26/ }));

    expect(screen.queryByRole("group", { name: "Mensagens do envio" })).toBeNull();
    expect(screen.getByTestId("chat").textContent).toBe("chat-1");

    fireEvent.pointerDown(screen.getByRole("region", { name: "Envio Alfa Birô · Miolo" }));
    expect(screen.getByTestId("chat").textContent).toBe("chat-5");

    fireEvent.pointerDown(screen.getByRole("region", { name: "Envio Zeta Gráfica · Capa" }));
    expect(screen.getByTestId("chat").textContent).toBe("chat-1");
  });

  it("somente o fornecedor vê o botão Gravação concluída, sem Iniciar gravação", () => {
    const { unmount } = render(<GravacaoExternaTab />);
    fireEvent.click(screen.getByRole("button", { name: /^01002\/26/ }));
    expect(screen.queryByRole("button", { name: "Gravação concluída" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar gravação" })).toBeNull();
    unmount();

    isFornecedor = true;
    render(<GravacaoExternaTab />);
    fireEvent.click(screen.getByRole("button", { name: /^01002\/26/ }));
    expect(screen.getByRole("button", { name: "Gravação concluída" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Iniciar gravação" })).toBeNull();
  });

  it("badges clicáveis exibem o cursor de clique", () => {
    render(<GravacaoExternaTab />);
    for (const badge of screen.getAllByTitle("Exibir espelhos de chapa")) {
      expect(badge.className).toContain("cursor-pointer");
    }
  });

  it("não exibe badges de fornecedor quando o usuário logado é fornecedor", () => {
    isFornecedor = true;
    render(<GravacaoExternaTab />);

    expect(screen.queryAllByTitle("Exibir espelhos de chapa")).toHaveLength(0);
    expect(screen.queryByText("Zeta Gráfica")).toBeNull();
    expect(screen.getByRole("button", { name: /^01001\/26/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^01004\/26/ })).toBeInTheDocument();
  });

  it("aguardando retirada usa card por OS e recebimento por envio", () => {
    aguardandoItems = [
      {
        nr_os: 1001,
        ano: 2026,
        componente: "capa",
        gravacao_externa_id: 1,
        gravacao_status: "concluida",
        fornecedor_ponto: "100.001",
        fornecedor_nome: "Zeta Gráfica",
        chapas_por_maquina: [{ maquina: "Komori", quantidade: 2 }],
      },
      {
        nr_os: 1001,
        ano: 2026,
        componente: "miolo",
        gravacao_externa_id: 5,
        gravacao_status: "concluida",
        fornecedor_ponto: "100.002",
        fornecedor_nome: "Alfa Birô",
        chapas_por_maquina: [{ maquina: "Heidelberg", quantidade: 4 }],
      },
    ];
    render(<GravacaoExternaTab />);
    fireEvent.click(screen.getByRole("tab", { name: "Aguardando retirada" }));

    expect(screen.getAllByRole("button", { name: /^01001\/26/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^01001\/26/ }));
    expect(
      screen.getAllByRole("button", { name: "Lançar recebimento das chapas" }),
    ).toHaveLength(2);

    fireEvent.click(within(cardOf(/^01001\/26/)).getByRole("button", { name: "Alfa Birô" }));
    expect(
      screen.getAllByRole("button", { name: "Lançar recebimento das chapas" }),
    ).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Envio Alfa Birô · Miolo" })).toBeTruthy();
  });
});
