import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { DashboardConfig } from "../types";
import { DashboardSetorSettingsForm } from "./DashboardSetorSettingsForm";
import "../dashboard-setor.css";

function cloneConfig(config: DashboardConfig): DashboardConfig {
  return JSON.parse(JSON.stringify(config)) as DashboardConfig;
}

interface DashboardSetorSettingsModalProps {
  open: boolean;
  config: DashboardConfig;
  setoresList: string[];
  andamentosList: string[];
  onClose: () => void;
  onSave: (config: DashboardConfig) => void;
  onClearCache: () => void;
  /** Só o painel moderno oferece o relógio nos cards. */
  showTimeOption?: boolean;
}

export function DashboardSetorSettingsModal({
  open,
  config,
  setoresList,
  andamentosList,
  onClose,
  onSave,
  onClearCache,
  showTimeOption = false,
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

        <DashboardSetorSettingsForm
          config={tempConfig}
          setoresList={setoresList}
          andamentosList={andamentosList}
          onChange={setTempConfig}
          showTimeOption={showTimeOption}
        />

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
      </div>
    </div>
  );
}
