const SOFT = "soft";

type FlipPage = {
  setDensity?: (density: string) => void;
  setDrawingDensity?: (density: string) => void;
};

type FlipBook = {
  getPageCount?: () => number;
  getPage?: (index: number) => FlipPage;
};

/** Desfaz HARD imposto por `showCover` para a virada usar o mesmo efeito soft do miolo. */
export function softenFlipbookPages(flip: unknown): void {
  if (flip == null || typeof flip !== "object") {
    return;
  }
  const book = flip as FlipBook;
  const count = Math.max(0, Math.floor(Number(book.getPageCount?.()) || 0));
  for (let i = 0; i < count; i++) {
    const page = book.getPage?.(i);
    page?.setDensity?.(SOFT);
    page?.setDrawingDensity?.(SOFT);
  }
}
