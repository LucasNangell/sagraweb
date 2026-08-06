import { cn } from "@sagra/ui";
import { List, Moon, Settings, Sun, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";

import { usePainelGlobalData } from "../hooks/usePainelGlobalData";
import { usePainelWakeLock } from "../hooks/usePainelWakeLock";
import {
  painelDisplayLabel,
  PAINEL_COLUMN_HEADER_CLASSES,
} from "../painelGlobalUtils";
import type { PainelColumnDisplay, PainelOpItem } from "../types";
import { PainelGlobalCharts } from "./PainelGlobalCharts";
import { PainelGlobalSettingsModal } from "./PainelGlobalSettingsModal";
import "../painel-global.css";

export function PainelGlobalPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  usePainelWakeLock();

  const {
    config,
    columns,
    allOpsList,
    isConnected,
    connectionStatusText,
    setoresList,
    andamentosList,
    showExpCorrespondencia,
    setShowExpCorrespondencia,
    includeOs,
    includeSp,
    patchOsFilters,
    listLoading,
    expandedOpKey,
    toggleExpand,
    selectedColumnDetail,
    showColumnDetail,
    closeColumnDetail,
    theme,
    toggleTheme,
    toggleMute,
    handleSaveSettings,
    handleClearCache,
    availableYears,
  } = usePainelGlobalData();

  return (
    <div
      ref={rootRef}
      className="painel-global-root -m-[calc(var(--spacing)*2)] flex h-full min-h-0 flex-col"
      data-theme={theme}
    >
      <header className="header">
        <div className="header-left">
          <div className="status-indicator">
            <div
              className={`connection-status ${isConnected ? "connected" : "disconnected"}`}
            />
            <span>{connectionStatusText}</span>
          </div>
        </div>

        <div className="header-center">
          <h1>OPs em andamento</h1>
        </div>

        <div className="header-right">
          <div className="header-actions">
            <button
              type="button"
              className={`settings-btn ${theme === "light" ? "is-light" : ""}`}
              title={theme === "dark" ? "Modo Claro" : "Modo Escuro"}
              onClick={toggleTheme}
            >
              <Sun className="theme-icon-sun size-[18px]" />
              <Moon className="theme-icon-moon size-[18px]" />
            </button>

            <button
              type="button"
              className="settings-btn"
              title="Configurações"
              onClick={() => setShowSettings(true)}
            >
              <Settings className="size-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <div className="layout-main">
        <div className="section-top">
          <div className="summary-column">
            <div className="summary-header">
              <div className="summary-header-title-row">
                <List className="size-4 shrink-0" />
                <span>Lista Geral de OPs</span>
              </div>
              <div className="summary-header-filters">
                <label className="summary-filter-label">
                  <input
                    type="checkbox"
                    className="summary-filter-checkbox"
                    checked={includeOs}
                    onChange={(e) =>
                      patchOsFilters({ includeOs: e.target.checked })
                    }
                  />
                  Exibir OSs
                </label>
                <label className="summary-filter-label">
                  <input
                    type="checkbox"
                    className="summary-filter-checkbox"
                    checked={includeSp}
                    onChange={(e) =>
                      patchOsFilters({ includeSp: e.target.checked })
                    }
                  />
                  Exibir SPs
                </label>
                <label className="summary-filter-label summary-filter-label-wide">
                  <input
                    type="checkbox"
                    className="summary-filter-checkbox"
                    checked={showExpCorrespondencia}
                    onChange={(e) => setShowExpCorrespondencia(e.target.checked)}
                  />
                  Exibir expedição/correspondência
                </label>
                <span className="summary-op-count">{allOpsList.length} OPs</span>
              </div>
            </div>
            <div className="summary-list-container" style={{ position: "relative" }}>
              {listLoading ? (
                <div className="list-loading-overlay">
                  <div className="loader-spinner" />
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "#fff",
                      fontWeight: "bold",
                    }}
                  >
                    Atualizando lista...
                  </span>
                </div>
              ) : null}
              <table className="summary-list-table">
                <tbody>
                  {allOpsList.map((os) => (
                    <PainelGlobalListRow key={os.uniqueKey} os={os} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="charts-column">
            <PainelGlobalCharts
              theme={theme}
              availableYears={availableYears}
              includeOs={includeOs}
              includeSp={includeSp}
              selectedColumnDetail={selectedColumnDetail}
              onCloseColumnDetail={closeColumnDetail}
              rootRef={rootRef}
            />
          </div>
        </div>

        <div className="section-bottom">
          <main className="board" data-columns={config.columnCount}>
            {columns.map((col, index) => (
              <PainelGlobalBoardColumn
                key={col.id}
                col={col}
                index={index}
                expandedOpKey={expandedOpKey}
                onToggleExpand={toggleExpand}
                onShowDetail={showColumnDetail}
                onToggleMute={toggleMute}
              />
            ))}
          </main>
        </div>
      </div>

      <PainelGlobalSettingsModal
        open={showSettings}
        setoresList={setoresList}
        andamentosList={andamentosList}
        config={config}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
        onClearCache={handleClearCache}
      />
    </div>
  );
}

function PainelGlobalListRow({ os }: { os: PainelOpItem }) {
  const isSubOs = os.row_kind === "sub_os";
  return (
    <tr className={cn(os.priorityType ?? undefined, isSubOs && "sub-os-row")}>
      <td style={{ width: 100, fontWeight: 950 }}>
        {painelDisplayLabel(os)}
      </td>
      <td>
        <div style={{ fontWeight: 900 }}>
          {os.titulo ?? os.Titulo ?? "Sem título"}
        </div>
        <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>
          {os.produto ?? os.Produto ?? os.prod_nome ?? "Prod. não inf."}
        </div>
      </td>
      <td style={{ width: 220 }}>
        <div style={{ fontWeight: 900, opacity: 0.9 }}>
          {os.normalizedSolicitante}
        </div>
      </td>
      <td style={{ width: 150 }}>
        <div style={{ fontWeight: 900 }}>{os.setor}</div>
        <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>
          {os.displaySituacao || os.situacao}
        </div>
      </td>
      <td style={{ width: 180, textAlign: "right" }}>
        <div style={{ fontWeight: 900, color: "var(--text-primary)" }}>
          {os.prioridade || "Normal"}
        </div>
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            whiteSpace: "nowrap",
          }}
        >
          Entrega: {os.normalizedEntrega || "Não inf."}{" "}
          {os.normalizedTurno ? `(${os.normalizedTurno})` : ""}
        </div>
      </td>
    </tr>
  );
}

function PainelGlobalBoardColumn({
  col,
  index,
  expandedOpKey,
  onToggleExpand,
  onShowDetail,
  onToggleMute,
}: {
  col: PainelColumnDisplay;
  index: number;
  expandedOpKey: string | null;
  onToggleExpand: (os: PainelOpItem) => void;
  onShowDetail: (col: PainelColumnDisplay) => void;
  onToggleMute: (colIdx: number, muted: boolean) => void;
}) {
  const headerClass = PAINEL_COLUMN_HEADER_CLASSES[index] ?? "";

  return (
    <div className="column">
      <div
        className={`column-header ${headerClass}`}
        style={{ cursor: "pointer" }}
        onClick={() => onShowDetail(col)}
      >
        <span className="column-header-title">{col.title}</span>
        <button
          type="button"
          className={`mute-btn ${col.muted ? "is-muted" : ""}`}
          title={
            col.muted ? "Ativar som deste setor" : "Mutar som deste setor"
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggleMute(index, !col.muted);
          }}
        >
          <VolumeX className="mute-icon-muted size-4" />
          <Volume2 className="mute-icon-active size-4" />
        </button>
      </div>

      <div className="column-content">
        {col.items.map((os) => (
          <div
            key={os.uniqueKey}
            className={[
              "card",
              os.isNew ? "is-new" : "",
              expandedOpKey === os.uniqueKey ? "is-expanded" : "",
              os.priorityType ?? "",
              os.row_kind === "sub_os" ? "sub-os-card" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={
              expandedOpKey === os.uniqueKey
                ? "Clique para fechar"
                : String(os.Observaçao ?? "Clique para ver detalhes")
            }
            onClick={() => onToggleExpand(os)}
          >
            <div className="card-header">
              <span className="os-number">
                {painelDisplayLabel(os)}
              </span>
              <span className="os-situation">
                {os.displaySituacao || os.situacao}
              </span>
            </div>

            {expandedOpKey === os.uniqueKey ? (
              <div className="card-details">
                <div className="detail-item">
                  <span className="label">Solicitante:</span>{" "}
                  {os.normalizedSolicitante}
                </div>
                <div className="detail-item">
                  <span className="label">Produto:</span>{" "}
                  {os.TipoPublicacaoLink ??
                    os.produto ??
                    "Não informado"}
                </div>
                <div className="detail-item">
                  <span className="label">Título:</span>{" "}
                  {os.titulo ?? "Sem título"}
                </div>
                <div className="detail-item">
                  <span className="label">Observação:</span>
                  <div className="obs-content">
                    {os.Observaçao ?? "Sem observação"}
                  </div>
                </div>
                <div className="detail-item">
                  <span className="label">Prioridade:</span>{" "}
                  {os.EntregPrazoLink ?? os.prioridade ?? "Normal"}
                </div>
                {os.normalizedEntrega || os.normalizedTurno ? (
                  <div className="detail-item">
                    <span className="label">Data/Turno:</span>{" "}
                    {os.normalizedEntrega ?? "Data não inf."}{" "}
                    {os.normalizedTurno ? ` - ${os.normalizedTurno}` : ""}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="column-footer">
        <span className="column-footer-content">
          {col.items.length
            ? `${col.items.length} ${col.items.length === 1 ? "OP" : "OPs"}`
            : ""}
        </span>
      </div>
    </div>
  );
}
