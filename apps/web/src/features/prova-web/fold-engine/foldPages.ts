import type {
  FoldPanelPageAssignment,
  FoldPanelTopology,
} from "./foldTypes";

/** Default tipográfico editável: frente 1..N, verso 2N..N+1 (ordem L→R / T→B). */
export function defaultPanelPages(
  panels: FoldPanelTopology[],
  hasVerso: boolean,
): FoldPanelPageAssignment[] {
  const ordered = [...panels].sort(
    (a, b) => a.row - b.row || a.column - b.column,
  );
  const n = ordered.length;
  return ordered.map((p, i) => ({
    panelId: p.id,
    frontPage: i + 1,
    backPage: hasVerso ? 2 * n - i : null,
  }));
}

export function normalizePanelPages(
  raw: FoldPanelPageAssignment[] | null | undefined,
  panels: FoldPanelTopology[],
  hasVerso: boolean,
): FoldPanelPageAssignment[] {
  const fallback = defaultPanelPages(panels, hasVerso);
  if (!raw || raw.length === 0) return fallback;
  const byId = new Map(raw.map((r) => [r.panelId, r]));
  return fallback.map((f) => {
    const hit = byId.get(f.panelId);
    if (!hit) return f;
    return {
      panelId: f.panelId,
      frontPage:
        hit.frontPage != null && hit.frontPage > 0 ? hit.frontPage : f.frontPage,
      backPage: hasVerso
        ? hit.backPage != null && hit.backPage > 0
          ? hit.backPage
          : f.backPage
        : null,
      frontRotationDeg: hit.frontRotationDeg,
      backRotationDeg: hit.backRotationDeg,
    };
  });
}

export function isDefaultPanelPages(
  pages: FoldPanelPageAssignment[],
  panels: FoldPanelTopology[],
  hasVerso: boolean,
): boolean {
  const d = defaultPanelPages(panels, hasVerso);
  if (pages.length !== d.length) return false;
  return pages.every((p, i) => {
    const x = d[i]!;
    return (
      p.panelId === x.panelId &&
      p.frontPage === x.frontPage &&
      p.backPage === x.backPage
    );
  });
}
