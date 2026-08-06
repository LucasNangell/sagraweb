import { useEffect, useRef, useState } from "react";

import {
  defaultPainelConfig,
  normalizePainelConfig,
} from "../painelConfigStore";
import { validateImportedConfig } from "../painelGlobalUtils";
import type { PainelColumnConfig, PainelConfig } from "../types";

interface PainelGlobalSettingsModalProps {
  open: boolean;
  setoresList: string[];
  andamentosList: string[];
  config: PainelConfig;
  onClose: () => void;
  onSave: (config: PainelConfig) => void;
  onClearCache: () => void;
}

export function PainelGlobalSettingsModal({
  open,
  setoresList,
  andamentosList,
  config,
  onClose,
  onSave,
  onClearCache,
}: PainelGlobalSettingsModalProps) {
  const [tempConfig, setTempConfig] = useState<PainelConfig>(config);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTempConfig(structuredClone(config));
    }
  }, [config, open]);

  if (!open) {
    return null;
  }

  const adjustColumns = (targetCount: number) => {
    let count = targetCount;
    if (count < 1) {
      count = 1;
    }
    if (count > 8) {
      count = 8;
    }

    setTempConfig((prev) => {
      const next = structuredClone(prev);
      next.columnCount = count;

      while (next.columns.length < count) {
        next.columns.push({
          id: `col_${Date.now()}_${next.columns.length}`,
          title: `Coluna ${next.columns.length + 1}`,
          sectors: [setoresList[0] ?? "SEFOC"],
          statuses: [],
        });
      }

      while (next.columns.length > count) {
        next.columns.pop();
      }

      return next;
    });
  };

  const toggleAndamento = (colIdx: number, andamento: string) => {
    setTempConfig((prev) => {
      const next = structuredClone(prev);
      const col = next.columns[colIdx];
      if (!col) {
        return prev;
      }
      const idx = col.statuses.indexOf(andamento);
      if (idx === -1) {
        col.statuses.push(andamento);
      } else {
        col.statuses.splice(idx, 1);
      }
      return next;
    });
  };

  const toggleSector = (colIdx: number, sector: string) => {
    setTempConfig((prev) => {
      const next = structuredClone(prev);
      const col = next.columns[colIdx];
      if (!col) {
        return prev;
      }
      if (!col.sectors) {
        col.sectors = [];
      }
      const idx = col.sectors.indexOf(sector);
      if (idx === -1) {
        col.sectors.push(sector);
      } else {
        col.sectors.splice(idx, 1);
      }
      return next;
    });
  };

  const addColumn = () => {
    if (tempConfig.columns.length >= 8) {
      window.alert("Máximo de 8 colunas atingido!");
      return;
    }
    setTempConfig((prev) => {
      const next = structuredClone(prev);
      next.columns.push({
        id: `col_${Date.now()}`,
        title: `Coluna ${next.columns.length + 1}`,
        sectors: [setoresList[0] ?? "SEFOC"],
        statuses: [],
      });
      next.columnCount = next.columns.length;
      return next;
    });
  };

  const removeColumn = (idx: number) => {
    if (tempConfig.columns.length <= 1) {
      window.alert("É necessário ter pelo menos 1 coluna!");
      return;
    }
    setTempConfig((prev) => {
      const next = structuredClone(prev);
      next.columns.splice(idx, 1);
      next.columnCount = next.columns.length;
      return next;
    });
  };

  const exportConfig = () => {
    try {
      const dataStr = JSON.stringify(tempConfig, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date().toISOString().split("T")[0];
      link.href = url;
      link.download = `config_painel_global_${date}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Erro ao exportar configuração:", err);
      window.alert("Erro ao exportar configuração.");
    }
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedConfig = JSON.parse(String(e.target?.result ?? ""));
        validateImportedConfig(importedConfig);
        setTempConfig(normalizePainelConfig(importedConfig));
        window.alert(
          '✅ Configuração carregada com sucesso! \n\nClique em "Salvar e Recarregar" para aplicar as alterações ao painel.',
        );
      } catch (err) {
        console.error("Erro ao importar arquivo:", err);
        window.alert(
          `❌ Falha ao importar: ${err instanceof Error ? err.message : "Erro desconhecido"}`,
        );
      } finally {
        event.target.value = "";
      }
    };
    reader.onerror = () => {
      window.alert("Erro ao ler o arquivo.");
    };
    reader.readAsText(file);
  };

  const clearCache = () => {
    if (
      !window.confirm(
        "Tem certeza que deseja limpar o cache e restaurar a configuração padrão?",
      )
    ) {
      return;
    }
    onClearCache();
    setTempConfig(defaultPainelConfig());
    onClose();
    window.alert("✅ Cache limpo! Configuração padrão restaurada.");
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Configurações do Painel</h2>
          <button type="button" className="settings-btn" onClick={onClose}>
            X
          </button>
        </div>

        <div className="form-group">
          <label htmlFor="column-count">Quantidade de Colunas</label>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <input
              id="column-count"
              type="number"
              min={1}
              max={8}
              value={tempConfig.columnCount}
              className="form-control"
              style={{ width: 100 }}
              onChange={(e) => adjustColumns(Number(e.target.value))}
            />
            <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Min: 1 | Max: 8
            </span>
          </div>
        </div>

        <div style={{ marginTop: "2rem", maxHeight: 400, overflowY: "auto" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1rem",
            }}
          >
            <h3 style={{ color: "var(--text-primary)", margin: 0 }}>
              Configuração das Colunas
            </h3>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "0.3rem 0.8rem", fontSize: "0.9rem" }}
                disabled={tempConfig.columns.length >= 6}
                onClick={addColumn}
              >
                + Adicionar Coluna
              </button>
            </div>
          </div>

          {tempConfig.columns.map((col, idx) => (
            <ColumnEditor
              key={col.id}
              col={col}
              idx={idx}
              setoresList={setoresList}
              andamentosList={andamentosList}
              onToggleSector={toggleSector}
              onToggleAndamento={toggleAndamento}
              onTitleChange={(title) => {
                setTempConfig((prev) => {
                  const next = structuredClone(prev);
                  if (next.columns[idx]) {
                    next.columns[idx].title = title;
                  }
                  return next;
                });
              }}
              onRemove={() => removeColumn(idx)}
              canRemove={tempConfig.columns.length > 1}
            />
          ))}
        </div>

        <div className="modal-footer" style={{ textAlign: "right", marginTop: "2rem" }}>
          <button
            type="button"
            className="btn"
            style={{
              background: "#d32f2f",
              color: "white",
              float: "left",
              marginRight: "0.5rem",
            }}
            title="Limpar cache e restaurar configuração padrão"
            onClick={clearCache}
          >
            🗑️ Limpar
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: "#4caf50", color: "white", float: "left" }}
            title="Exportar configuração atual como arquivo JSON"
            onClick={exportConfig}
          >
            📥 Exportar
          </button>
          <button
            type="button"
            className="btn"
            style={{
              background: "#2196f3",
              color: "white",
              float: "left",
              marginLeft: "0.5rem",
            }}
            title="Importar configuração de um arquivo JSON"
            onClick={() => fileInputRef.current?.click()}
          >
            📤 Importar
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onSave(
                normalizePainelConfig({
                  ...tempConfig,
                  columnCount: tempConfig.columns.length,
                }),
              );
              onClose();
            }}
          >
            Salvar e Recarregar
          </button>
        </div>
      </div>
    </div>
  );
}

function ColumnEditor({
  col,
  idx,
  setoresList,
  andamentosList,
  onToggleSector,
  onToggleAndamento,
  onTitleChange,
  onRemove,
  canRemove,
}: {
  col: PainelColumnConfig;
  idx: number;
  setoresList: string[];
  andamentosList: string[];
  onToggleSector: (colIdx: number, sector: string) => void;
  onToggleAndamento: (colIdx: number, andamento: string) => void;
  onTitleChange: (title: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div
      style={{
        marginBottom: "1.5rem",
        padding: "1rem",
        background: "#29292e",
        borderRadius: 4,
        border: "1px solid var(--border-color)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <div style={{ flex: 1, marginRight: "1rem" }}>
          <label
            style={{
              display: "block",
              marginBottom: "0.3rem",
              color: "var(--text-secondary)",
              fontSize: "0.85rem",
            }}
          >
            Título da Coluna {idx + 1}
          </label>
          <input
            type="text"
            value={col.title}
            className="form-control"
            placeholder="Ex: Em Execução"
            style={{ fontWeight: "bold", marginBottom: "0.5rem" }}
            onChange={(e) => onTitleChange(e.target.value)}
          />

          <label
            style={{
              display: "block",
              marginBottom: "0.5rem",
              color: "var(--text-primary)",
              fontWeight: "bold",
              fontSize: "0.9rem",
            }}
          >
            Setores desta coluna:
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.5rem",
            }}
          >
            {setoresList.map((setor) => (
              <label
                key={`sec_${col.id}_${setor}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={col.sectors?.includes(setor) ?? false}
                  style={{ cursor: "pointer" }}
                  onChange={() => onToggleSector(idx, setor)}
                />
                {setor}
              </label>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{
            padding: "0.5rem 1rem",
            background: "var(--danger)",
            color: "white",
          }}
          disabled={!canRemove}
          title="Remover coluna"
          onClick={onRemove}
        >
          🗑️ Remover
        </button>
      </div>
      <label
        style={{
          display: "block",
          marginBottom: "0.5rem",
          color: "var(--text-primary)",
          fontWeight: "bold",
          fontSize: "0.9rem",
        }}
      >
        Andamentos desta coluna:
      </label>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.5rem",
        }}
      >
        {andamentosList.map((andamento) => (
          <label
            key={`and_${col.id}_${andamento}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            <input
              type="checkbox"
              checked={col.statuses.includes(andamento)}
              style={{ cursor: "pointer" }}
              onChange={() => onToggleAndamento(idx, andamento)}
            />
            {andamento}
          </label>
        ))}
      </div>
    </div>
  );
}
