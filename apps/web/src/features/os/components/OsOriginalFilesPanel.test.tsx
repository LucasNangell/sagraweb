import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OsOriginalFilesPanel } from "./OsOriginalFilesPanel";

const fetchOsFolderBrowse = vi.fn();
const tryOpenFileLocally = vi.fn();
const { allowed, openNetworkFolder } = vi.hoisted(() => ({
  allowed: new Set<string>(["ctx_abrir_pasta", "ctx_mover_pastas"]),
  openNetworkFolder: vi.fn(),
}));

vi.mock("@/api/os", () => ({
  fetchOsFolderBrowse: (...args: unknown[]) => fetchOsFolderBrowse(...args),
  fetchOsPath: async (ano: number, id: number) => ({ path: `\\\\rede\\${ano}\\${id}` }),
  osFolderFileUrl: (ano: number, id: number, relative: string) =>
    `/api/os/${ano}/${id}/folder-file?relative=${encodeURIComponent(relative)}`,
}));

vi.mock("@/lib/sagraLocalOpener", () => ({
  tryOpenFileLocally: (...args: unknown[]) => tryOpenFileLocally(...args),
}));

vi.mock("@/features/auth/useAccessControl", () => ({
  useAccessControl: () => ({
    can: (key: string) => allowed.has(key),
  }),
}));

vi.mock("../osFolderActions", () => ({
  openNetworkFolder: (...args: unknown[]) => openNetworkFolder(...args),
}));

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OsOriginalFilesPanel ano={2026} osId={3100} />
    </QueryClientProvider>,
  );
}

describe("OsOriginalFilesPanel", () => {
  beforeEach(() => {
    fetchOsFolderBrowse.mockReset();
    tryOpenFileLocally.mockReset();
    openNetworkFolder.mockReset();
    allowed.clear();
    allowed.add("ctx_abrir_pasta");
    allowed.add("ctx_mover_pastas");
    fetchOsFolderBrowse.mockImplementation(
      async (_ano: number, _id: number, relative = "") => {
        if (!relative) {
          return {
            root_path: "\\\\rede\\os",
            relative: "",
            entries: [
              { name: "Original", type: "folder", relative: "Original" },
              { name: "Original V2", type: "folder", relative: "Original V2" },
              { name: "Sefoc", type: "folder", relative: "Sefoc" },
            ],
          };
        }
        if (relative === "Original") {
          return {
            root_path: "\\\\rede\\os",
            relative,
            entries: [
              {
                name: "arte.pdf",
                type: "file",
                relative: "Original/arte.pdf",
                size: 1200,
              },
            ],
          };
        }
        return { root_path: "\\\\rede\\os", relative, entries: [] };
      },
    );
  });

  it("lista só pastas Original e ignora Sefoc", async () => {
    renderPanel();
    expect(await screen.findByText("Original")).toBeInTheDocument();
    expect(screen.getByText("Original V2")).toBeInTheDocument();
    expect(screen.queryByText("Sefoc")).not.toBeInTheDocument();
  });

  it("abre no navegador quando o Folder Opener não responde", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    tryOpenFileLocally.mockResolvedValue(false);

    renderPanel();
    fireEvent.click(await screen.findByText("Original"));
    expect(await screen.findByText("arte.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByText("arte.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));

    await waitFor(() => {
      expect(tryOpenFileLocally).toHaveBeenCalledWith(
        "\\\\rede\\os\\Original\\arte.pdf",
      );
    });
    expect(openSpy).toHaveBeenCalledWith(
      "/api/os/2026/3100/folder-file?relative=Original%2Farte.pdf",
      "_blank",
      "noopener",
    );
    openSpy.mockRestore();
  });

  it("mostra Mover pastas e Abrir pasta só com permissão", async () => {
    const first = renderPanel();
    expect(await screen.findByRole("button", { name: "Mover pastas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir pasta" })).toBeInTheDocument();
    first.unmount();

    allowed.delete("ctx_mover_pastas");
    allowed.delete("ctx_abrir_pasta");
    renderPanel();
    expect(screen.queryByRole("button", { name: "Mover pastas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir pasta" })).not.toBeInTheDocument();
  });

  it("dispara mover pastas e abre a pasta da OS", async () => {
    const moveSpy = vi.fn();
    window.addEventListener("sagra:os-mover-pastas", moveSpy);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Mover pastas" }));
    expect(moveSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Abrir pasta" }));
    await waitFor(() => {
      expect(openNetworkFolder).toHaveBeenCalled();
    });
    const firstArg = openNetworkFolder.mock.calls[0]?.[0] as { ano: number; nr_os: number };
    expect(firstArg).toEqual({ ano: 2026, nr_os: 3100 });
    window.removeEventListener("sagra:os-mover-pastas", moveSpy);
  });
});
