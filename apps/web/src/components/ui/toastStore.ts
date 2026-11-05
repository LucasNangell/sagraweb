import { create } from "zustand";

export type ToastVariant = "success" | "warning" | "error";

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastState {
  items: ToastItem[];
  push: (message: string, variant: ToastVariant) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

const TOAST_DURATION_MS = 3000;

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (message, variant) => {
    const id = nextId++;
    const text = String(message ?? "").trim();
    if (!text) return id;

    set((state) => ({
      items: [...state.items, { id, message: text, variant }],
    }));

    const prev = timers.get(id);
    if (prev) clearTimeout(prev);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        useToastStore.getState().dismiss(id);
      }, TOAST_DURATION_MS),
    );

    return id;
  },
  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    }));
  },
  clear: () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    set({ items: [] });
  },
}));

function show(message: string, variant: ToastVariant): number {
  return useToastStore.getState().push(message, variant);
}

/** API global de toasts — utilizável dentro e fora de componentes React. */
export const toast = {
  success: (message: string) => show(message, "success"),
  warning: (message: string) => show(message, "warning"),
  error: (message: string) => show(message, "error"),
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
};
