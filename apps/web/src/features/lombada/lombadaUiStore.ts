import { create } from "zustand";

interface LombadaUiState {
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
}

export const useLombadaUiStore = create<LombadaUiState>((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
}));
