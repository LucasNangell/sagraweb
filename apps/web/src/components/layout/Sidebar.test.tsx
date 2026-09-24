import { render, screen, within } from "@testing-library/react";
import { Disc3, HardDrive, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar";
import type { NavItem } from "./nav-config";

let hasGravacaoPendente = false;
let canGravacaoPendente = true;
const gravacaoHookEnabled = vi.fn();

const navItems: NavItem[] = [
  { label: "E-mail", to: "/email", icon: Mail, permission: "sb_email" },
  {
    label: "Gravação",
    to: "/gravacao-externa",
    icon: HardDrive,
    permission: "sb_gravacao_externa",
  },
  { label: "Gravação", to: "/gravacao", icon: Disc3, permission: "sb_gravacao" },
];

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    activeOptions: _activeOptions,
    ...props
  }: {
    children: ReactNode;
    to: string;
    activeOptions?: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: (sel: (s: { location: { pathname: string } }) => unknown) =>
    sel({ location: { pathname: "/" } }),
}));

vi.mock("@/api/hooks/useEmailQueries", () => ({
  useEmailNotificationStatus: () => ({ data: { inbox_count: 0, pendencias_count: 0 } }),
}));

vi.mock("@/api/hooks/useGravacaoPendente", () => ({
  useGravacaoPendenteHasItems: (enabled: boolean) => {
    gravacaoHookEnabled(enabled);
    return { data: enabled ? hasGravacaoPendente : undefined };
  },
}));

vi.mock("@/features/auth/useAccessControl", () => ({
  useAccessControl: () => ({
    isReady: true,
    navItems,
    can: (key: string) => (key === "sb_gravacao_pendente" ? canGravacaoPendente : true),
  }),
}));

vi.mock("@/features/lombada/lombadaUiStore", () => ({
  useLombadaUiStore: (sel: (s: { openModal: () => void }) => unknown) =>
    sel({ openModal: vi.fn() }),
}));

vi.mock("@/features/os/osSelectionStore", () => ({
  useOsSelectionStore: (sel: (s: { selected: null }) => unknown) => sel({ selected: null }),
}));

vi.mock("@/features/support/components/SupportHelpMenu", () => ({
  SupportHelpMenu: () => null,
}));

function gravacaoLink() {
  return screen.getByTestId("sidebar-nav-gravacao-externa");
}

describe("Sidebar — sinalizador de gravação externa", () => {
  beforeEach(() => {
    hasGravacaoPendente = false;
    canGravacaoPendente = true;
    gravacaoHookEnabled.mockClear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true } as MediaQueryList),
    );
  });

  it("mostra o indicador quando há OSs na lista de gravação externa", () => {
    hasGravacaoPendente = true;
    render(<Sidebar collapsed onToggle={vi.fn()} />);

    expect(within(gravacaoLink()).getByTestId("sidebar-nav-indicator")).toBeInTheDocument();
    expect(gravacaoLink()).toHaveAttribute("title", "Gravação (OSs pendentes)");
    expect(
      within(screen.getByTestId("sidebar-nav-gravacao")).queryByTestId("sidebar-nav-indicator"),
    ).not.toBeInTheDocument();
  });

  it("não mostra o indicador quando a lista está vazia", () => {
    render(<Sidebar collapsed onToggle={vi.fn()} />);

    expect(
      within(gravacaoLink()).queryByTestId("sidebar-nav-indicator"),
    ).not.toBeInTheDocument();
    expect(gravacaoLink()).toHaveAttribute("title", "Gravação");
  });

  it("não consulta nem sinaliza sem permissão sb_gravacao_pendente", () => {
    hasGravacaoPendente = true;
    canGravacaoPendente = false;
    render(<Sidebar collapsed onToggle={vi.fn()} />);

    expect(gravacaoHookEnabled).toHaveBeenCalledWith(false);
    expect(
      within(gravacaoLink()).queryByTestId("sidebar-nav-indicator"),
    ).not.toBeInTheDocument();
  });
});
