export function queryTourTarget(tourId: string): HTMLElement | null {
  return document.querySelector(`[data-tour="${tourId}"]`);
}

export function isTourTargetVisible(tourId: string): boolean {
  const el = queryTourTarget(tourId);
  if (!el) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function readTourControlValue(tourId: string): string {
  const el = queryTourTarget(tourId);
  if (!el) {
    return "";
  }
  if (
    el instanceof HTMLSelectElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement
  ) {
    return el.value.trim();
  }
  const inner = el.querySelector("select, input, textarea");
  if (
    inner instanceof HTMLSelectElement ||
    inner instanceof HTMLInputElement ||
    inner instanceof HTMLTextAreaElement
  ) {
    return inner.value.trim();
  }
  return "";
}

export function readTourPanelAttr(attr: string): string | null {
  const el = queryTourTarget("os-history-panel");
  return el?.getAttribute(attr) ?? null;
}
