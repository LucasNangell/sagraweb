import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SincronizacaoSettingsSection } from "./SincronizacaoSettingsSection";

vi.mock("@/api/adminSync", () => ({
  fetchSyncAdminStatus: vi.fn(),
  fetchSyncPendingDeletes: vi.fn(),
  saveSyncPolicy: vi.fn(),
  approveSyncPendingDelete: vi.fn(),
  rejectSyncPendingDelete: vi.fn(),
  controlSyncService: vi.fn(),
}));

import {
  approveSyncPendingDelete,
  fetchSyncAdminStatus,
  fetchSyncPendingDeletes,
  saveSyncPolicy,
} from "@/api/adminSync";

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SincronizacaoSettingsSection />
    </QueryClientProvider>,
  );
}

describe("SincronizacaoSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchSyncAdminStatus).mockResolvedValue({
      services: {
        sync_andamentos: {
          service_name: "SAGRA-SyncAndamentos",
          exists: true,
          status: "Running",
          query_ok: true,
          healthy: true,
          heartbeat: {
            present: true,
            phase: "idle",
            age_sec: 5,
            cycles: 10,
            consecutive_errors: 0,
            last_error: null,
            last_cycle_at: null,
            written_at: null,
            stats: null,
            stale: false,
            tabandamento_bidi: true,
          },
        },
        monitor_sync: {
          service_name: "SAGRA-MonitorSyncAndamentos",
          exists: true,
          status: "Running",
          query_ok: true,
          healthy: true,
        },
      },
      divergencia: {
        data_stale: false,
        mdb_count: 1,
        mysql_count: 1,
        checked_at: null,
        status_fresh: true,
        phase: null,
      },
      policies: [
        {
          table_name: "tabProtocolos",
          enabled: true,
          mode: "uni",
          delete_policy: "dryrun",
        },
        {
          table_name: "tabDetalhesServico",
          enabled: true,
          mode: "uni",
          delete_policy: "dryrun",
        },
        {
          table_name: "tabAndamento",
          enabled: true,
          mode: "bi",
          delete_policy: "on",
        },
      ],
      pending_counts: { pending: 0, blocked: 1, approved: 0 },
    });
    vi.mocked(fetchSyncPendingDeletes).mockResolvedValue({
      items: [
        {
          nro: 886,
          ano: 2026,
          status: "blocked",
          andamentos_count: 3,
          titulo: "OS teste",
          motivo: "dryrun",
        },
      ],
      counts: { blocked: 1 },
    });
  });

  it("mostra badges Running e políticas", async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/tabProtocolos/)).toBeInTheDocument();
    expect(screen.getByText(/886\/2026/)).toBeInTheDocument();
  });

  it("salva política ao alterar e clicar", async () => {
    vi.mocked(saveSyncPolicy).mockResolvedValue({ policies: [] });
    window.alert = vi.fn();
    renderSection();
    await waitFor(() => {
      expect(screen.getByText(/tabProtocolos/)).toBeInTheDocument();
    });
    const checkbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: /Salvar política/ }));
    await waitFor(() => expect(saveSyncPolicy).toHaveBeenCalled());
  });

  it("aprova pendência", async () => {
    vi.mocked(approveSyncPendingDelete).mockResolvedValue({ ok: true });
    window.confirm = vi.fn(() => true);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText(/886\/2026/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Aprovar/ }));
    await waitFor(() =>
      expect(approveSyncPendingDelete).toHaveBeenCalledWith(886, 2026),
    );
  });
});
