import { Settings, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { DashboardConfig, DashboardColumnConfig } from "../types";
import "../dashboard-setor.css";

interface DashboardSetorSettingsModalProps {
  open: boolean;
  config: DashboardConfig;
  setoresList: string[];
  andamentosList: string[];
  onClose: () => void;
  onSave: (config: DashboardConfig) => void;
  onClearCache: () => void;
}

function cloneConfig(config: DashboardConfig): DashboardConfig {
  return JSON.parse(JSON.stringify(config)) as DashboardConfig;
}

export function DashboardSetorSettingsModal({
  open,
  config,
  setoresList,
  andamentosList,
  onClose,
  onSave,
  onClearCache,
}: DashboardSetorSettingsModalProps) {
  const [tempConfig, setTempConfig] = useState(() => cloneConfig(config));

  useEffect(() => {
    if (open) {
      setTempConfig(cloneConfig(config));
    }
  }, [open, config]);

  if (!open) {
    return null;
  }

  const adjustColumns = (rawCount: number) => {
    let targetCount = Number.isFinite(rawCount) ? Math.floor(rawCount) : 1;
    if (targetCount < 1) {
      targetCount = 1;
    }
    if (targetCount > 6) {
      targetCount = 6;
    }

    setTempConfig((prev) => {
      const columns = [...prev.columns];
      while (columns.length < targetCount) {
        columns.push({
          id: `col_${Date.now()}_${columns.length}`,
          title: `Coluna ${columns.length + 1}`,
          statuses: [],
        });
      }
      while (columns.length > targetCount) {
        columns.pop();
      }
      return {
        ...prev,
        columnCount: columns.length,
        columns,
      };
    });
  };

  const toggleAndamento = (colIdx: number, andamento: string) => {
    setTempConfig((prev) => {
      const columns = prev.columns.map((col, idx) => {
        if (idx !== colIdx) {
          return col;
        }
        const statuses = [...col.statuses];
        const found = statuses.indexOf(andamento);
        if (found === -1) {
          statuses.push(andamento);
        } else {
          statuses.splice(found, 1);
        }
        return { ...col, statuses };
      });
      return { ...prev, columns };
    });
  };

  const addColumn = () => {
    setTempConfig((prev) => {
      if (prev.columns.length >= 6) {
        window.alert("Máximo de 6 colunas atingido!");
        return prev;
      }
      const columns: DashboardColumnConfig[] = [
        ...prev.columns,
        {
          id: `col_${Date.now()}`,
          title: `Coluna ${prev.columns.length + 1}`,
          statuses: [],
        },
      ];
      return { ...prev, columnCount: columns.length, columns };
    });
  };

  const removeColumn = (idx: number) => {
    setTempConfig((prev) => {
      if (prev.columns.length <= 1) {
        window.alert("É necessário ter pelo menos 1 coluna!");
        return prev;
      }
      const columns = prev.columns.filter((_, i) => i !== idx);
      return { ...prev, columnCount: columns.length, columns };
    });
  };

  const updateColumn = (
    idx: number,
    patch: Partial<DashboardColumnConfig>,
  ) => {
    setTempConfig((prev) => ({
      ...prev,
      columns: prev.columns.map((col, i) => {
        if (i !== idx) {
          return col;
        }
        const next: DashboardColumnConfig = { ...col, ...patch };
        if ("sector" in patch && !(patch.sector ?? "").trim()) {
          delete next.sector;
        }
        if ("hideWhenEmpty" in patch && patch.hideWhenEmpty !== true) {
          delete next.hideWhenEmpty;
        }
        return next;
      }),
    }));
  };

  const handleClearCache = () => {
    if (
      window.confirm(
        "Tem certeza que deseja limpar o cache e restaurar a configuração padrão?",
      )
    ) {
      onClearCache();
    }
  };

  return (
    <div
      className="dashboard-setor-modal-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="dashboard-setor-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-setor-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dashboard-setor-modal-header">
          <h2 id="dashboard-setor-settings-title">Configurações do Painel</h2>
          <button
            type="button"
            className="dashboard-setor-settings-btn"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="dashboard-setor-form-group">
          <label htmlFor="dashboard-sector">Setor Monitorado</label>
          <select
            id="dashboard-sector"
            className="dashboard-setor-form-control"
            value={tempConfig.sector}
            onChange={(e) =>
              setTempConfig((prev) => ({ ...prev, sector: e.target.value }))
            }
          >
            {setoresList.length === 0 ? (
              <option value={tempConfig.sector}>{tempConfig.sector}</option>
            ) : (
              setoresList.map((setor) => (
                <option key={setor} value={setor}>
                  {setor}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="dashboard-setor-form-group">
          <label htmlFor="dashboard-column-count">Quantidade de Colunas</label>
          <div className="dashboard-setor-column-count-row">
            <input
              id="dashboard-column-count"
              type="number"
              min={1}
              max={6}
              className="dashboard-setor-form-control dashboard-setor-column-count-input"
              value={tempConfig.columnCount}
              onChange={(e) => adjustColumns(Number(e.target.value))}
            />
            <span className="dashboard-setor-hint">Min: 1 | Max: 6</span>
          </div>
        </div>

        <div className="dashboard-setor-columns-config">
          <div className="dashboard-setor-columns-config-header">
            <h3>Configuração das Colunas</h3>
            <button
              type="button"
              className="dashboard-setor-btn dashboard-setor-btn-secondary dashboard-setor-btn-sm"
              onClick={addColumn}
              disabled={tempConfig.columns.length >= 6}
            >
              + Adicionar Coluna
            </button>
          </div>

          {tempConfig.columns.map((col, idx) => (
            <div key={col.id} className="dashboard-setor-column-block">
              <div className="dashboard-setor-column-block-header">
                <div className="dashboard-setor-column-title-field">
                  <label htmlFor={`col-title-${col.id}`}>
                    Título da Coluna {idx + 1}
                  </label>
                  <input
                    id={`col-title-${col.id}`}
                    type="text"
                    className="dashboard-setor-form-control dashboard-setor-column-title-input"
                    value={col.title}
                    placeholder="Ex: Em Execução"
                    onChange={(e) =>
                      updateColumn(idx, { title: e.target.value })
                    }
                  />
                </div>
                <div className="dashboard-setor-column-sector-field">
                  <label htmlFor={`col-sector-${col.id}`}>
                    Setor desta coluna
                  </label>
                  <select
                    id={`col-sector-${col.id}`}
                    className="dashboard-setor-form-control dashboard-setor-column-sector-input"
                    value={(col.sector ?? "").trim()}
                    onChange={(e) => {
                      const next = e.target.value.trim();
                      updateColumn(
                        idx,
                        next ? { sector: next } : { sector: undefined },
                      );
                    }}
                  >
                    <option value="">Mesmo do painel</option>
                    {(setoresList.length === 0 && (col.sector ?? "").trim()
                      ? [(col.sector ?? "").trim()]
                      : setoresList
                    ).map((setor) => (
                      <option key={setor} value={setor}>
                        {setor}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="dashboard-setor-btn dashboard-setor-btn-danger"
                  onClick={() => removeColumn(idx)}
                  disabled={tempConfig.columns.length <= 1}
                  title="Remover coluna"
                >
                  <Trash2 className="size-4" />
                  Remover
                </button>
              </div>

              <p className="dashboard-setor-andamentos-label">
                Andamentos desta coluna:
              </p>
              <div className="dashboard-setor-andamentos-grid">
                {andamentosList.map((andamento) => (
                  <label key={`${col.id}-${andamento}`}>
                    <input
                      type="checkbox"
                      checked={col.statuses.includes(andamento)}
                      onChange={() => toggleAndamento(idx, andamento)}
                    />
                    {andamento}
                  </label>
                ))}
              </div>

              <label className="dashboard-setor-hide-empty-option">
                <input
                  type="checkbox"
                  checked={col.hideWhenEmpty === true}
                  onChange={(e) =>
                    updateColumn(
                      idx,
                      e.target.checked
                        ? { hideWhenEmpty: true }
                        : { hideWhenEmpty: undefined },
                    )
                  }
                />
                Ocultar quando vazia
              </label>
            </div>
          ))}
        </div>

        <div className="dashboard-setor-modal-footer">
          <button
            type="button"
            className="dashboard-setor-btn dashboard-setor-btn-clear-cache"
            onClick={handleClearCache}
            title="Limpar cache e restaurar configuração padrão"
          >
            <Trash2 className="size-4" />
            Limpar Cache
          </button>
          <div className="dashboard-setor-modal-footer-actions">
            <button
              type="button"
              className="dashboard-setor-btn dashboard-setor-btn-secondary"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="dashboard-setor-btn dashboard-setor-btn-primary"
              onClick={() => onSave(tempConfig)}
            >
              Salvar e Recarregar
            </button>
          </div>
        </div>

        {setoresList.length === 0 && (
          <p className="dashboard-setor-settings-note">
            <Settings className="inline size-3.5" /> Lista de setores ainda
            carregando…
          </p>
        )}
      </div>
    </div>
  );
}
