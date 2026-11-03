import { ChevronRight, LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";

import {
  boardRootStyle,
  laneBoardStyle,
} from "@/features/dashboard-setor-modern/cardStyle";
import { AndamentoClock } from "@/features/dashboard-setor-modern/components/AndamentoTimer";
import { ModernQueueCard } from "@/features/dashboard-setor-modern/components/ModernQueueCard";
import "@/features/dashboard-setor-modern/dashboard-setor-modern.css";
import "@/features/dashboard-setor-modern/dashboard-setor-modern-cards.css";
import { showsAndamentoTime } from "@/features/dashboard-setor/normalizeConfig";
import type {
  DashboardColumnConfig,
  DashboardConfig,
  DashboardOsItem,
  DashboardPriorityType,
} from "@/features/dashboard-setor/types";

const PREVIEW_PRIORITIES: DashboardPriorityType[] = [
  "priority-high",
  "priority-medium",
  null,
];

function sampleItems(
  col: DashboardColumnConfig,
  columnIndex: number,
): DashboardOsItem[] {
  const situacao = col.statuses[0] || col.title;
  return [0, 1, 2].map((n) => ({
    nr_os: 1400 + columnIndex * 10 + n,
    ano: 26,
    displaySituacao: n === 1 ? "Recebido" : n === 2 ? "Tramit. de Prévia p/" : situacao,
    andamento_usuario: n === 0 ? "João Lucas" : n === 1 ? "Ana Silva" : "Carlos",
    last_update: new Date(Date.now() - (n + 1) * 90_000).toISOString(),
    uniqueKey: `preview-${col.id}-${n}`,
    priorityType: PREVIEW_PRIORITIES[n % 3],
    isNew: false,
    pcp_ordem: null,
  }));
}

export function PainelLivePreviewBoard({
  config,
  compact = false,
}: {
  config: DashboardConfig;
  compact?: boolean;
}) {
  const [entryNonce, setEntryNonce] = useState(0);
  const showTime = showsAndamentoTime(config);
  const typo = config.cardStyle?.typography ?? {};
  const columns =
    config.columns.length > 0
      ? config.columns
      : [{ id: "col", title: "Coluna", statuses: [] }];

  useEffect(() => {
    setEntryNonce((n) => n + 1);
  }, [
    config.cardStyle?.models.high.effect,
    config.cardStyle?.models.medium.effect,
    config.cardStyle?.models.normal.effect,
    config.cardStyle?.entryAnimation,
  ]);

  const columnsToShow = compact ? columns.slice(0, 1) : columns;
  const heading = `OPs na ${config.sector}`;

  return (
    <div
      className={`setor-modern${compact ? " painel-card-preview" : ""}`}
      data-heading-color={typo.heading?.color ? "1" : undefined}
      data-column-color={typo.column?.color ? "1" : undefined}
      data-custom-header={config.theme?.headerBg ? "1" : undefined}
      style={boardRootStyle(config)}
    >
      {compact ? (
        <>
          <div className="setor-modern-heading">
            <h1 title={heading}>{heading}</h1>
          </div>
          <AndamentoClock enabled={showTime}>
            <div className="setor-modern-board" data-columns="1">
              {columnsToShow.map((col, index) => (
                <section
                  key={col.id}
                  className="setor-modern-lane"
                  style={laneBoardStyle(0, col, config.theme)}
                >
                  <header className="setor-modern-lane-header">
                    <div>
                      <i aria-hidden="true" />
                      <h2 title={col.title}>{col.title}</h2>
                    </div>
                  </header>
                  <div className="setor-modern-lane-content">
                    {sampleItems(col, index).map((item, cardIndex) => (
                      <ModernQueueCard
                        key={`${item.uniqueKey}-${entryNonce}`}
                        item={item}
                        index={cardIndex}
                        showTime={showTime}
                        cardStyle={config.cardStyle}
                        entryNonce={entryNonce}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </AndamentoClock>
        </>
      ) : (
        <>
          <header className="setor-modern-header">
            <div className="setor-modern-identity">
              <div className="setor-modern-mark" aria-hidden="true">
                <LayoutDashboard size={23} />
              </div>
              <div>
                <div className="setor-modern-eyebrow">
                  SAGRA <ChevronRight size={10} /> PREVIEW
                </div>
                <div className="setor-modern-connection is-live" role="status">
                  <i aria-hidden="true" />
                  <div>
                    <strong>Simulação</strong>
                    <span>Atualiza em tempo real</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="setor-modern-heading">
              <h1 title={heading}>{heading}</h1>
            </div>
            <div className="setor-modern-actions" />
          </header>
          <main className="setor-modern-main">
            <AndamentoClock enabled={showTime}>
              <div
                className="setor-modern-board"
                data-columns={String(Math.max(columnsToShow.length, 1))}
                style={boardRootStyle(config)}
                aria-label="Preview do painel"
              >
                {columnsToShow.map((col, index) => {
                  const items = sampleItems(col, index);
                  return (
                    <section
                      className="setor-modern-lane"
                      key={col.id}
                      style={laneBoardStyle(index, col, config.theme)}
                      aria-label={col.title}
                    >
                      <header className="setor-modern-lane-header">
                        <div>
                          <i aria-hidden="true" />
                          <h2 title={col.title}>{col.title}</h2>
                          <span className="setor-modern-lane-count">
                            {items.length}
                          </span>
                        </div>
                        <div className="setor-modern-lane-meter" aria-hidden="true">
                          <span style={{ width: "100%" }} />
                        </div>
                      </header>
                      <div
                        className="setor-modern-lane-content"
                        role="region"
                        aria-label={`OPs em ${col.title}`}
                      >
                        {items.map((item, cardIndex) => (
                          <ModernQueueCard
                            key={`${item.uniqueKey}-${entryNonce}`}
                            item={item}
                            index={cardIndex}
                            showTime={showTime}
                            cardStyle={config.cardStyle}
                            entryNonce={entryNonce}
                          />
                        ))}
                      </div>
                      <footer className="setor-modern-lane-footer">
                        <span>
                          {items.length} {items.length === 1 ? "OP" : "OPs"}
                        </span>
                      </footer>
                    </section>
                  );
                })}
              </div>
            </AndamentoClock>
          </main>
        </>
      )}
    </div>
  );
}
