import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

import defaultPainelGlobalConfig from "./defaultPainelGlobalConfig.json";
import type { PainelColumnConfig, PainelConfig } from "./types";

/** Mesma chave do painel legado para compatibilidade com force_refresh. */
export const PAINEL_CONFIG_STORAGE_KEY = "sagra_dashboard_config";

export function defaultPainelColumns(): PainelColumnConfig[] {
  return defaultPainelConfig().columns;
}

export function defaultPainelConfig(): PainelConfig {
  return normalizePainelConfig(defaultPainelGlobalConfig as Partial<PainelConfig>);
}

function normalizeColumn(column: PainelColumnConfig): PainelColumnConfig {
  return {
    ...column,
    muted: column.muted ?? false,
    sectors:
      column.sectors && Array.isArray(column.sectors)
        ? column.sectors
        : column.sector
          ? [column.sector]
          : ["SEFOC"],
    statuses: Array.isArray(column.statuses) ? column.statuses : [],
  };
}

export function normalizePainelConfig(raw: Partial<PainelConfig>): PainelConfig {
  const columns =
    raw.columns && raw.columns.length > 0
      ? raw.columns.map(normalizeColumn)
      : defaultPainelColumns();

  return {
    columnCount: raw.columnCount ?? columns.length,
    columns,
  };
}

/** Compatível com o JSON legado `{ columnCount, columns }` em localStorage. */
const legacyPainelStorage: StateStorage = {
  getItem: (name) => {
    const raw = localStorage.getItem(name);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.columns && Array.isArray(parsed.columns)) {
        return JSON.stringify({
          state: { config: normalizePainelConfig(parsed as Partial<PainelConfig>) },
          version: 0,
        });
      }
      return raw;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      const parsed = JSON.parse(value) as {
        state?: { config?: PainelConfig };
      };
      if (parsed.state?.config) {
        localStorage.setItem(name, JSON.stringify(parsed.state.config));
        return;
      }
    } catch {
      /* fallback */
    }
    localStorage.setItem(name, value);
  },
  removeItem: (name) => {
    localStorage.removeItem(name);
  },
};

interface PainelConfigState {
  config: PainelConfig;
  setConfig: (config: PainelConfig) => void;
  patchColumnMute: (index: number, muted: boolean) => void;
  resetConfig: () => void;
}

export const usePainelConfigStore = create<PainelConfigState>()(
  persist(
    (set, get) => ({
      config: defaultPainelConfig(),
      setConfig: (config) =>
        set({
          config: normalizePainelConfig({
            ...config,
            columnCount: config.columns.length,
          }),
        }),
      patchColumnMute: (index, muted) => {
        const next = structuredClone(get().config);
        if (next.columns[index]) {
          next.columns[index].muted = muted;
          set({ config: next });
        }
      },
      resetConfig: () => set({ config: defaultPainelConfig() }),
    }),
    {
      name: PAINEL_CONFIG_STORAGE_KEY,
      storage: createJSONStorage(() => legacyPainelStorage),
      partialize: (state) => ({ config: state.config }),
      merge: (persisted, current) => {
        const stored = persisted as { config?: Partial<PainelConfig> } | undefined;
        if (stored?.config) {
          return {
            ...current,
            config: normalizePainelConfig(stored.config),
          };
        }
        return current;
      },
    },
  ),
);
