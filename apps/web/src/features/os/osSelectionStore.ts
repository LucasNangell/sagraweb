import { create } from "zustand";

import { normalizeOsSelection } from "./osTableRows";
import type { OsSearchRow } from "./types";

interface OsSelectionState {
  selected: OsSearchRow | null;
  setSelected: (row: OsSearchRow | null) => void;
}

export const useOsSelectionStore = create<OsSelectionState>((set) => ({
  selected: null,
  setSelected: (row) =>
    set({ selected: row ? normalizeOsSelection(row) : null }),
}));
