import { Settings, Trash2, X } from "lucide-react";
import { useRef } from "react";

import { MultiSelect } from "@/components/ui/multi-select";

import { INBOX_COLUMN_SOURCE, INBOX_DISPLAY_SITUACAO } from "../constants";
import { showsAndamentoTime } from "../normalizeConfig";
import type { DashboardColumnConfig, DashboardConfig } from "../types";

function isGenericColumnTitle(title: string): boolean {
  return !title.trim() || /^Coluna\s+\d+$/i.test(title.trim());
}

const LANE_HEADER_COLORS = [
  "#8b5503",
  "#04618d",
  "#a30d0d",
  "#02461e",
  "#c92a2a",
  "#202024",
];
const LANE_HEADER_COLORS_2 = [
  "#b46d03",
  "#04628d",
  "#580404",
  "#01270a",
  "#ff6b6b",
  "#202024",
];

export interface DashboardSetorSettingsFormProps {
  config: DashboardConfig;
  setoresList: string[];
  andamentosList: string[];
  onChange: (config: DashboardConfig) => void;
  showTimeOption?: boolean;
  idPrefix?: string;
  variant?: "panel" | "admin";
}

const PANEL_UI = {
  root: "",
  intro: "hidden",
  topGrid: "",
  group: "dashboard-setor-form-group",
  label: "",
  control: "dashboard-setor-form-control",
  countRow: "dashboard-setor-column-count-row",
  countInput:
    "dashboard-setor-form-control dashboard-setor-column-count-input",
  hint: "dashboard-setor-hint",
  check: "dashboard-setor-hide-empty-option",
  columns: "dashboard-setor-columns-config",
  columnsHeader: "dashboard-setor-columns-config-header",
  columnsTitle: "",
  addBtn:
    "dashboard-setor-btn dashboard-setor-btn-secondary dashboard-setor-btn-sm",
  block: "dashboard-setor-column-block",
  blockHeader: "dashboard-setor-column-block-header",
  titleField: "dashboard-setor-column-title-field",
  sectorField: "dashboard-setor-column-sector-field",
  titleInput:
    "dashboard-setor-form-control dashboard-setor-column-title-input",
  sectorInput:
    "dashboard-setor-form-control dashboard-setor-column-sector-input",
  removeBtn: "dashboard-setor-btn dashboard-setor-btn-danger",
  andamentosLabel: "dashboard-setor-andamentos-label",
  andamentosGrid: "dashboard-setor-andamentos-grid",
  andamentoItem: "",
  inboxNote: "dashboard-setor-inbox-source-note",
  note: "dashboard-setor-settings-note",
  options: "dashboard-setor-column-options",
  selectedList: "hidden",
};

const ADMIN_UI = {
  root: "flex flex-col gap-4",
  intro: "block",
  topGrid: "grid gap-3 sm:grid-cols-2",
  group: "flex flex-col gap-1",
  label: "text-xs font-semibold text-slate-700",
  control:
    "rounded border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-800",
  countRow: "flex items-center gap-3",
  countInput:
    "w-24 rounded border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-800",
  hint: "text-xs text-slate-500",
  check: "inline-flex items-center gap-2 text-sm font-normal text-slate-700",
  columns: "flex flex-col gap-3",
  columnsHeader: "flex items-center justify-between gap-2",
  columnsTitle: "text-sm font-semibold text-slate-800",
  addBtn:
    "inline-flex items-center rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50",
  block: "relative overflow-visible rounded-md border border-slate-200 p-3",
  blockHeader: "mb-3 flex flex-wrap items-end justify-between gap-2",
  titleField: "flex min-w-[10rem] flex-1 flex-col gap-1",
  sectorField: "flex min-w-[9rem] flex-1 flex-col gap-1",
  titleInput:
    "rounded border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-800",
  sectorInput:
    "rounded border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-800",
  removeBtn:
    "inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50",
  andamentosLabel: "mb-1.5 text-xs font-semibold text-slate-700",
  andamentosGrid: "flex flex-wrap gap-x-3 gap-y-1.5",
  andamentoItem: "inline-flex items-center gap-1.5 text-sm text-slate-700",
  inboxNote: "mt-1 text-xs text-slate-500",
  note: "text-xs text-slate-500",
  options: "mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3",
  selectedList: "mt-2 flex flex-col gap-1",
};

export function DashboardSetorSettingsForm({
  config,
  setoresList,
  andamentosList,
  onChange,
  showTimeOption = false,
  idPrefix = "dashboard",
  variant = "panel",
}: DashboardSetorSettingsFormProps) {
  const ui = variant === "admin" ? ADMIN_UI : PANEL_UI;
  const configRef = useRef(config);
  configRef.current = config;
  const setConfig = (
    updater: DashboardConfig | ((prev: DashboardConfig) => DashboardConfig),
  ) => {
    const next =
      typeof updater === "function" ? updater(configRef.current) : updater;
    configRef.current = next;
    onChange(next);
  };

  const adjustColumns = (rawCount: number) => {
    let targetCount = Number.isFinite(rawCount) ? Math.floor(rawCount) : 1;
    if (targetCount < 1) {
      targetCount = 1;
    }
    if (targetCount > 6) {
      targetCount = 6;
    }

    setConfig((prev) => {
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

  const setColumnStatuses = (colIdx: number, statuses: string[]) => {
    setConfig((prev) => ({
      ...prev,
      columns: prev.columns.map((col, idx) =>
        idx === colIdx ? { ...col, statuses } : col,
      ),
    }));
  };

  const toggleAndamento = (colIdx: number, andamento: string) => {
    setConfig((prev) => {
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
    setConfig((prev) => {
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
    setConfig((prev) => {
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
    setConfig((prev) => ({
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
        if ("source" in patch && patch.source !== INBOX_COLUMN_SOURCE) {
          delete next.source;
        }
        if ("headerBg" in patch && !(patch.headerBg ?? "").trim()) {
          delete next.headerBg;
          delete next.headerBg2;
        }
        if ("headerBg2" in patch && !(patch.headerBg2 ?? "").trim()) {
          delete next.headerBg2;
        }
        return next;
      }),
    }));
  };

  const toggleInboxSource = (idx: number, enabled: boolean) => {
    setConfig((prev) => ({
      ...prev,
      columns: prev.columns.map((col, i) => {
        if (idx !== i) {
          return col;
        }
        if (!enabled) {
          const next = { ...col };
          delete next.source;
          return next;
        }
        const next: DashboardColumnConfig = {
          ...col,
          source: INBOX_COLUMN_SOURCE,
          title: isGenericColumnTitle(col.title)
            ? INBOX_DISPLAY_SITUACAO
            : col.title,
        };
        delete next.sector;
        return next;
      }),
    }));
  };

  const fields = (
    <>
      <div className={ui.intro}>
        <h3 className="text-sm font-semibold text-slate-800">
          {variant === "admin" ? "Colunas do painel" : "Layout do painel"}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Setor monitorado, colunas e situações exibidas em cada etapa.
        </p>
      </div>

      <div className={ui.topGrid || undefined}>
        <div className={ui.group}>
          <label className={ui.label || undefined} htmlFor={`${idPrefix}-sector`}>
            Setor monitorado
          </label>
          <select
            id={`${idPrefix}-sector`}
            className={ui.control}
            value={config.sector}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, sector: e.target.value }))
            }
          >
            {setoresList.length === 0 ? (
              <option value={config.sector}>{config.sector}</option>
            ) : (
              setoresList.map((setor) => (
                <option key={setor} value={setor}>
                  {setor}
                </option>
              ))
            )}
          </select>
        </div>

        <div className={ui.group}>
          <label
            className={ui.label || undefined}
            htmlFor={`${idPrefix}-column-count`}
          >
            Quantidade de colunas
          </label>
          <div className={ui.countRow}>
            <input
              id={`${idPrefix}-column-count`}
              type="number"
              min={1}
              max={6}
              className={ui.countInput}
              value={config.columnCount}
              onChange={(e) => adjustColumns(Number(e.target.value))}
            />
            <span className={ui.hint}>Mín. 1 · Máx. 6</span>
          </div>
        </div>
      </div>

      {showTimeOption && (
        <label className={ui.check}>
          <input
            type="checkbox"
            checked={showsAndamentoTime(config)}
            onChange={(event) =>
              setConfig((prev) => {
                const next = { ...prev };
                if (event.target.checked) delete next.showAndamentoTime;
                else next.showAndamentoTime = false;
                return next;
              })
            }
          />
          Exibir o tempo da OS nos cards
        </label>
      )}

      <div className={ui.columns}>
        <div className={ui.columnsHeader}>
          <h3 className={ui.columnsTitle || undefined}>Colunas e situações</h3>
          <button
            type="button"
            className={ui.addBtn}
            onClick={addColumn}
            disabled={config.columns.length >= 6}
          >
            + Adicionar coluna
          </button>
        </div>

        {config.columns.map((col, idx) => (
          <div key={col.id} className={ui.block}>
            <div className={ui.blockHeader}>
              <div className={ui.titleField}>
                <label
                  className={ui.label || undefined}
                  htmlFor={`${idPrefix}-col-title-${col.id}`}
                >
                  Título da coluna {idx + 1}
                </label>
                <input
                  id={`${idPrefix}-col-title-${col.id}`}
                  type="text"
                  className={ui.titleInput}
                  value={col.title}
                  placeholder="Ex: Em Execução"
                  onChange={(e) => updateColumn(idx, { title: e.target.value })}
                />
              </div>
              {col.source !== INBOX_COLUMN_SOURCE && (
                <div className={ui.sectorField}>
                  <label
                    className={ui.label || undefined}
                    htmlFor={`${idPrefix}-col-sector-${col.id}`}
                  >
                    Setor desta coluna
                  </label>
                  <select
                    id={`${idPrefix}-col-sector-${col.id}`}
                    className={ui.sectorInput}
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
              )}
              <button
                type="button"
                className={ui.removeBtn}
                onClick={() => removeColumn(idx)}
                disabled={config.columns.length <= 1}
                title="Remover coluna"
              >
                <Trash2 className="size-4" />
                Remover
              </button>
            </div>

            {col.source === INBOX_COLUMN_SOURCE ? (
              <p className={ui.inboxNote}>
                Mostra OSs identificadas no assunto dos e-mails não lidos. O
                card exibe "Novo e-mail" no lugar da situação.
              </p>
            ) : variant === "admin" ? (
              <div>
                <MultiSelect
                  id={`${idPrefix}-col-status-${col.id}`}
                  label="Situações desta coluna"
                  options={andamentosList}
                  value={col.statuses}
                  onChange={(statuses) => setColumnStatuses(idx, statuses)}
                  placeholder="Selecionar situações…"
                  dropdownClassName="z-50"
                  isLoading={andamentosList.length === 0}
                />
                <ul className={ui.selectedList}>
                  {col.statuses.length === 0 ? (
                    <li className="text-xs text-slate-500">
                      Nenhuma situação selecionada.
                    </li>
                  ) : (
                    col.statuses.map((andamento) => (
                      <li
                        key={`${col.id}-selected-${andamento}`}
                        className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-slate-800"
                      >
                        <span className="min-w-0 truncate">{andamento}</span>
                        <button
                          type="button"
                          className="inline-flex rounded p-0.5 text-slate-500 hover:bg-white hover:text-slate-800"
                          onClick={() => toggleAndamento(idx, andamento)}
                          aria-label={`Remover ${andamento}`}
                        >
                          <X className="size-3.5" />
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : (
              <>
                <p className={ui.andamentosLabel}>Andamentos desta coluna</p>
                <div className={ui.andamentosGrid}>
                  {andamentosList.map((andamento) => (
                    <label
                      key={`${col.id}-${andamento}`}
                      className={ui.andamentoItem || undefined}
                    >
                      <input
                        type="checkbox"
                        checked={col.statuses.includes(andamento)}
                        onChange={() => toggleAndamento(idx, andamento)}
                      />
                      {andamento}
                    </label>
                  ))}
                </div>
              </>
            )}

            <div className={ui.options}>
              {variant === "admin" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className={ui.label || undefined}>
                    Cor do head
                    <input
                      type="color"
                      className={`${ui.titleInput} mt-1 h-8 w-full`}
                      value={
                        col.headerBg ||
                        config.theme?.headerBg ||
                        LANE_HEADER_COLORS[idx % LANE_HEADER_COLORS.length]
                      }
                      onChange={(e) =>
                        updateColumn(idx, { headerBg: e.target.value })
                      }
                    />
                  </label>
                  <label className={ui.check}>
                    <input
                      type="checkbox"
                      checked={Boolean(
                        col.headerBg2 ||
                          (!col.headerBg && config.theme?.headerBg2),
                      )}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateColumn(idx, {
                            headerBg:
                              col.headerBg ||
                              config.theme?.headerBg ||
                              LANE_HEADER_COLORS[idx % LANE_HEADER_COLORS.length],
                            headerBg2:
                              col.headerBg2 ||
                              config.theme?.headerBg2 ||
                              LANE_HEADER_COLORS_2[
                                idx % LANE_HEADER_COLORS_2.length
                              ],
                          });
                        } else {
                          updateColumn(idx, { headerBg2: undefined });
                        }
                      }}
                    />
                    Usar gradiente
                  </label>
                  {col.headerBg2 ||
                  (!col.headerBg && config.theme?.headerBg2) ? (
                    <label className={ui.label || undefined}>
                      Segunda cor
                      <input
                        type="color"
                        className={`${ui.titleInput} mt-1 h-8 w-full`}
                        value={
                          col.headerBg2 ||
                          config.theme?.headerBg2 ||
                          LANE_HEADER_COLORS_2[
                            idx % LANE_HEADER_COLORS_2.length
                          ]
                        }
                        onChange={(e) =>
                          updateColumn(idx, {
                            headerBg:
                              col.headerBg ||
                              config.theme?.headerBg ||
                              LANE_HEADER_COLORS[
                                idx % LANE_HEADER_COLORS.length
                              ],
                            headerBg2: e.target.value,
                          })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
              <label className={ui.check}>
                <input
                  type="checkbox"
                  checked={col.source === INBOX_COLUMN_SOURCE}
                  onChange={(e) => toggleInboxSource(idx, e.target.checked)}
                />
                Fonte: caixa de entrada
              </label>
              <label className={ui.check}>
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
          </div>
        ))}
      </div>

      {setoresList.length === 0 && (
        <p className={ui.note}>
          <Settings className="inline size-3.5" /> Lista de setores ainda
          carregando…
        </p>
      )}
    </>
  );

  if (variant === "admin") {
    return <div className={ui.root}>{fields}</div>;
  }
  return fields;
}
