import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setNeedRefresh = vi.fn();
const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
let needRefreshValue = false;

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [needRefreshValue, setNeedRefresh] as [
      boolean,
      typeof setNeedRefresh,
    ],
    updateServiceWorker,
  }),
}));

vi.mock("@/components/pwa/pwaUpdateUtils", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/pwa/pwaUpdateUtils")
  >("@/components/pwa/pwaUpdateUtils");
  return {
    ...actual,
    resolveClientBuildId: () => "build_client",
    fetchServerBuildId: vi.fn(),
  };
});

import { fetchServerBuildId } from "@/components/pwa/pwaUpdateUtils";
import { PwaUpdatePrompt } from "@/components/pwa/PwaUpdatePrompt";

const fetchServerBuildIdMock = vi.mocked(fetchServerBuildId);

describe("PwaUpdatePrompt", () => {
  beforeEach(() => {
    needRefreshValue = false;
    setNeedRefresh.mockClear();
    updateServiceWorker.mockClear();
    fetchServerBuildIdMock.mockReset();
    fetchServerBuildIdMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("mostra o banner quando o build_id do servidor diverge", async () => {
    fetchServerBuildIdMock.mockResolvedValue("build_server");
    render(<PwaUpdatePrompt />);

    expect(
      await screen.findByText("Nova versão do SAGRA Web disponível."),
    ).toBeInTheDocument();
  });

  it("não mostra o banner quando o build_id é o mesmo", async () => {
    fetchServerBuildIdMock.mockResolvedValue("build_client");
    render(<PwaUpdatePrompt />);

    await waitFor(() => {
      expect(fetchServerBuildIdMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByText("Nova versão do SAGRA Web disponível."),
    ).not.toBeInTheDocument();
  });

  it("esconde com Depois e reaparece após remount (F5)", async () => {
    fetchServerBuildIdMock.mockResolvedValue("build_server");
    const { unmount } = render(<PwaUpdatePrompt />);

    expect(
      await screen.findByText("Nova versão do SAGRA Web disponível."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Depois" }));
    expect(
      screen.queryByText("Nova versão do SAGRA Web disponível."),
    ).not.toBeInTheDocument();

    unmount();
    render(<PwaUpdatePrompt />);

    expect(
      await screen.findByText("Nova versão do SAGRA Web disponível."),
    ).toBeInTheDocument();
  });

  it("mostra o banner quando needRefresh do SW é true", async () => {
    needRefreshValue = true;
    fetchServerBuildIdMock.mockResolvedValue("build_client");
    render(<PwaUpdatePrompt />);

    expect(
      await screen.findByText("Nova versão do SAGRA Web disponível."),
    ).toBeInTheDocument();
  });
});
