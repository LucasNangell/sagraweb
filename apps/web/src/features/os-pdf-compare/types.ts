export type ViewMode = "diff" | "blend" | "flicker" | "side";

export interface CompareOptions {
  dpi: number;
  threshold: number;
  includeUnchangedInReport: boolean;
}

export interface CompareBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComparePage {
  index: number;
  pageNumber: number;
  status: "compared" | "only-previous" | "only-current" | string;
  changedPercent: number;
  changedPixels: number;
  totalPixels: number;
  width: number;
  height: number;
  boxes: CompareBBox[];
  urls: {
    a?: string | null;
    b?: string | null;
    diff?: string | null;
    blend?: string | null;
    thumb?: string | null;
  };
}

export interface CompareResult {
  sessionId: string;
  hasResult: boolean;
  busy?: boolean;
  previousName?: string;
  currentName?: string;
  previousRelative?: string;
  currentRelative?: string;
  dpi: number;
  threshold: number;
  pageCountA: number;
  pageCountB: number;
  comparedPages: number;
  changedPages: number;
  summary: string;
  includeUnchangedInReport: boolean;
  assetBase: string;
  pages: ComparePage[];
}

export interface CompareProgress {
  sessionId: string;
  stage: string;
  current: number;
  total: number;
  message: string;
  pct: number;
  done: boolean;
  cancelled?: boolean;
  error?: string | null;
}
