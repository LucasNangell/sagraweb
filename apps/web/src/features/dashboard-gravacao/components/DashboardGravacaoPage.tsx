import { useMemo, useState, type CSSProperties } from "react";

import { PainelOsInstallButton } from "@/components/pwa/PainelOsInstallButton";
import { useDashboardFreshness } from "@/features/dashboard-setor/hooks/useDashboardFreshness";
import { useScreenWakeLock } from "@/features/dashboard-setor/hooks/useScreenWakeLock";
import "@/features/dashboard-setor/dashboard-setor.css";
import "@/features/dashboard-tablet/dashboard-tablet.css";

import { cardFornecedorChapaBadges, formatGravacaoCardTitle } from "../groupCards";
import { useDashboardGravacaoData } from "../hooks/useDashboardGravacaoData";
import type { GravacaoDisplayCard } from "../types";
import { GravacaoAndamentoModal } from "./GravacaoAndamentoModal";
import "../dashboard-gravacao.css";

const COLUMN_HEADER_CLASSES = [
  "column-header-first",
  "column-header-second",
  "column-header-third",
  "column-header-fourth",
] as const;

function footerLabel(count: number): string {
  if (count === 0) return "";
  return `${count} ${count === 1 ? "OP" : "OPs"}`;
}

export function DashboardGravacaoPage() {
  useScreenWakeLock();
  const {
    columns,
    lastSyncAt,
    hasLoadedOnce,
    fetchError,
    fetchData,
    wsStatus,
  } = useDashboardGravacaoData();
  const [selected, setSelected] = useState<GravacaoDisplayCard | null>(null);

  const freshness = useDashboardFreshness({
    hasLoadedOnce,
    lastSyncAt,
    wsStatus,
    fetchError,
  });

  const boardColumns = useMemo(() => columns, [columns]);

  return (
    <div className="dashboard-setor-page dashboard-tablet-page dashboard-gravacao-page">
      <header className="dashboard-setor-header">
        <div className="dashboard-setor-header-left">
          <div className="dashboard-setor-status-indicator">
            <span
              className={`dashboard-setor-connection-status ${freshness.statusClass}`}
              aria-hidden
            />
            <span>{freshness.label}</span>
          </div>
        </div>
        <div className="dashboard-setor-header-center">
          <h1>OPs na Gravação</h1>
        </div>
        <div className="dashboard-setor-header-right">
          <PainelOsInstallButton />
        </div>
      </header>

      <main className="dashboard-setor-board" data-columns="4">
        {boardColumns.map((col, index) => (
          <div key={col.id} className="dashboard-setor-column">
            <div
              className={[
                "dashboard-setor-column-header",
                COLUMN_HEADER_CLASSES[index] ?? "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="dashboard-setor-column-title">{col.title}</span>
              {col.items.length > 0 ? (
                <span className="dashboard-setor-column-count">
                  {col.items.length}
                </span>
              ) : null}
            </div>
            <div className="dashboard-setor-column-content">
              {col.items.map((os) => {
                const { label: osLabel, tooltip } = formatGravacaoCardTitle(os);
                const badges = cardFornecedorChapaBadges(os);
                return (
                  <button
                    key={os.uniqueKey}
                    type="button"
                    className="dashboard-setor-card"
                    title={tooltip}
                    onClick={() => setSelected(os)}
                  >
                    <div className="dashboard-setor-card-header">
                      <span
                        className="dashboard-setor-os-number"
                        style={{ "--os-chars": osLabel.length } as CSSProperties}
                        title={tooltip}
                      >
                        {osLabel}
                      </span>
                    </div>
                    {badges.length > 0 ? (
                      <div className="dashboard-setor-fornecedor-badges">
                        {badges.map((badge) => (
                          <span
                            key={badge.key}
                            className="dashboard-setor-fornecedor-badge dashboard-gravacao-fornecedor-badge"
                            title={badge.label}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="dashboard-setor-column-footer">
              <span className="dashboard-setor-column-footer-content">
                {footerLabel(col.items.length)}
              </span>
            </div>
          </div>
        ))}
      </main>

      {selected ? (
        <GravacaoAndamentoModal
          card={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void fetchData();
          }}
        />
      ) : null}
    </div>
  );
}
