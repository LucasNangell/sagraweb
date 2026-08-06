import { KeepAwake } from "@capacitor-community/keep-awake";
import { Capacitor } from "@capacitor/core";
import { Loader2, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { canUseTablet, useAuthStore } from "@/auth/authStore";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { OsSheet } from "@/os/OsSheet";

import { ColumnTabs } from "./ColumnTabs";
import { KanbanBoard } from "./KanbanBoard";
import { OsCard } from "./OsCard";
import type { DashboardOsItem } from "./types";
import { useBoardConfig } from "./useBoardConfig";
import { useBoardData } from "./useBoardData";

function formatClock(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function BoardScreen() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const logout = useAuthStore((s) => s.logout);
  const bp = useBreakpoint();

  const {
    config,
    setSector,
    allowedSectors,
    loading: configLoading,
    error: configError,
  } = useBoardConfig();

  const {
    columns,
    lastUpdated,
    loading,
    error,
    connectionStatus,
    fetchData,
  } = useBoardData(config);

  const [activeCol, setActiveCol] = useState(0);
  const [selected, setSelected] = useState<DashboardOsItem | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void KeepAwake.keepAwake();
    return () => {
      void KeepAwake.allowSleep();
    };
  }, []);

  useEffect(() => {
    setActiveCol(0);
  }, [config.sector, config.columnCount]);

  const phoneColumn = columns[activeCol] ?? columns[0];
  const totalOps = useMemo(
    () => columns.reduce((acc, c) => acc + c.items.length, 0),
    [columns],
  );

  if (!canUseTablet(permissions)) {
    return (
      <div className="deny-page">
        <h1>Sem permissão</h1>
        <p>
          Seu usuário não tem acesso ao painel tablet (
          <code>sb_dashboard_tablet</code>).
        </p>
        <button type="button" className="btn-secondary" onClick={() => void logout()}>
          Sair
        </button>
      </div>
    );
  }

  return (
    <div className="board-page">
      <header className="board-header">
        <div className="board-header-left">
          <span
            className={
              connectionStatus === "connected"
                ? "conn-dot conn-dot--on"
                : "conn-dot conn-dot--off"
            }
            title={connectionStatus}
          />
          <div>
            <div className="board-status">
              {loading && !lastUpdated
                ? "Carregando dados…"
                : `Atualizado às ${formatClock(lastUpdated ?? now)}`}
            </div>
            <h1 className="board-title">OPs na {config.sector}</h1>
          </div>
        </div>

        <div className="board-header-right">
          {allowedSectors.length > 1 ? (
            <select
              className="sector-select"
              value={config.sector}
              onChange={(e) => setSector(e.target.value)}
              aria-label="Setor"
            >
              {allowedSectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            onClick={() => void fetchData()}
            aria-label="Atualizar"
          >
            <RefreshCw size={20} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void logout()}
            aria-label="Sair"
            title={user?.nome}
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {(configError || error) && (
        <div className="alert-error board-alert">{configError || error}</div>
      )}

      {configLoading || (loading && totalOps === 0) ? (
        <div className="board-loading">
          <Loader2 className="spin" size={32} />
          <span>Carregando painel…</span>
        </div>
      ) : bp === "phone" ? (
        <>
          <ColumnTabs
            columns={columns}
            activeIndex={Math.min(activeCol, Math.max(0, columns.length - 1))}
            onChange={setActiveCol}
          />
          <div className="phone-list">
            {(phoneColumn?.items ?? []).map((item) => (
              <OsCard key={item.uniqueKey} item={item} onSelect={setSelected} />
            ))}
            {(phoneColumn?.items.length ?? 0) === 0 ? (
              <div className="kanban-empty">Nenhuma OP nesta coluna</div>
            ) : null}
          </div>
        </>
      ) : (
        <KanbanBoard columns={columns} onSelect={setSelected} />
      )}

      {selected ? (
        <OsSheet
          item={selected}
          panelSector={config.sector}
          onClose={() => setSelected(null)}
          onAndamentoSaved={() => {
            setSelected(null);
            void fetchData();
          }}
        />
      ) : null}
    </div>
  );
}
