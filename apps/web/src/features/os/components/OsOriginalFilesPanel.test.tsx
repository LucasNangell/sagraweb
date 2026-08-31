import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OsOriginalFilesPanel } from "./OsOriginalFilesPanel";

const fetchOsFolderBrowse = vi.fn();
const tryOpenFileLocally = vi.fn();

vi.mock("@/api/os", () => ({
  fetchOsFolderBrowse: (...args: unknown[]) => fetchOsFolderBrowse(...args),
  osFolderFileUrl: (ano: number, id: number, relative: string) =>
    `/api/os/${ano}/${id}/folder-file?relative=${encodeURIComponent(relative)}`,
}));

vi.mock("@/lib/sagraLocalOpener", () => ({
  tryOpenFileLocally: (...args: unknown[]) => tryOpenFileLocally(...args),
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
});
