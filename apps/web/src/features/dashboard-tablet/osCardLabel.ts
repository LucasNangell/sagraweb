import type { CSSProperties } from "react";

import type { DashboardOsItem } from "@/features/dashboard-setor/types";
import { formatQueueDisplayLabel } from "@/features/dashboard-setor/utils";

export interface TabletOsCardLabel {
  label: string;
  /** Expõe `--os-chars` para o CSS dimensionar a fonte sem quebrar linha. */
  style: CSSProperties;
}

/** Mantém rótulo e métrica de largura derivados do mesmo texto renderizado. */
export function resolveOsCardLabel(item: DashboardOsItem): TabletOsCardLabel {
  const label = formatQueueDisplayLabel(item);
  return {
    label,
    style: { "--os-chars": label.length } as CSSProperties,
  };
}
