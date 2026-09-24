import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmailConfigPanel } from "./EmailConfigPanel";

const mutateAsyncMock = vi.fn();

vi.mock("@/api/hooks/useEmailQueries", () => ({
  useEmailConfig: () => ({
    data: {
      ponto: "USR",
      ews_url: "https://ce.camara.leg.br/EWS/Exchange.asmx",
      verify_ssl: false,
      max_items_per_folder: 20,
      refresh_interval_sec: 5,
      only_unread: true,
      monitored_targets: [
        {
          mailbox: "sepim.deapa@camara.leg.br",
          folders: [{ id: "f-1", name: "Entrada de Provas", parent: "Inbox" }],
        },
      ],
      send_mailbox_os_lt_5000: "sepim.deapa@camara.leg.br",
      send_mailbox_os_gte_5000: "papelaria.deapa@camara.leg.br",
      configured: true,
    },
  }),
  useEmailConfigMutations: () => ({
    connectMutation: { isPending: false, mutateAsync: vi.fn() },
    foldersMutation: { isPending: false, mutateAsync: vi.fn() },
    saveMutation: { isPending: false, mutateAsync: mutateAsyncMock },
    sendPlanMutation: { isPending: false, mutateAsync: vi.fn() },
  }),
}));

describe("EmailConfigPanel", () => {
  it("salva payload V2 com monitoramento e roteamento", async () => {
    mutateAsyncMock.mockResolvedValueOnce({ success: true });

    render(<EmailConfigPanel open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Salvar configurações/i }));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        monitored_targets: expect.any(Array),
        send_routing: expect.objectContaining({ by_type: {} }),
        sent_folder_routing: expect.objectContaining({
          by_mailbox: expect.any(Object),
        }),
        config_version: 2,
      }),
    );
  });
});

