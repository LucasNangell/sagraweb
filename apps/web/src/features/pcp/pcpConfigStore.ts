import { create } from "zustand";
import { persist } from "zustand/middleware";

const STORAGE_KEY = "sagra-pcp-config-v1";

export interface PcpConfig {
  selectedSetores: string[];
  filters: Record<string, string[]>;
}

const defaultConfig = (): PcpConfig => ({
  selectedSetores: [],
  filters: {},
});

interface PcpConfigState {
  config: PcpConfig;
  setConfig: (config: PcpConfig) => void;
  patchConfig: (patch: Partial<PcpConfig>) => void;
}

export const usePcpConfigStore = create<PcpConfigState>()(
  persist(
    (set, get) => ({
      config: defaultConfig(),
      setConfig: (config) => set({ config }),
      patchConfig: (patch) =>
        set({ config: { ...get().config, ...patch } }),
    }),
    { name: STORAGE_KEY },
  ),
);
