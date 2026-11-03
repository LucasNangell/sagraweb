import { ExternalLink, Play } from "lucide-react";
import { useState } from "react";

import { DEFAULT_DASHBOARD_CONFIG } from "@/features/dashboard-setor/constants";
import type { DashboardConfig } from "@/features/dashboard-setor/types";
import { PainelLivePreviewBoard } from "@/features/painel-admin/components/PainelLivePreviewBoard";
import { openPainelPreviewWindow } from "@/lib/painel-standalone";

export function PainelCardPreview({
  config,
}: {
  config: DashboardConfig;
}) {
  const [entryNonce, setEntryNonce] = useState(0);
  const resolved = {
    ...DEFAULT_DASHBOARD_CONFIG,
    ...config,
    columns: config.columns?.length
      ? config.columns
      : DEFAULT_DASHBOARD_CONFIG.columns,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <h3 className="text-sm font-semibold text-slate-800">Preview</h3>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => setEntryNonce((n) => n + 1)}
          >
            <Play className="size-3.5" />
            Repetir entrada
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => openPainelPreviewWindow()}
          >
            <ExternalLink className="size-3.5" />
            Janela separada
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <PainelLivePreviewBoard
          key={entryNonce}
          config={resolved}
          compact
        />
      </div>
    </div>
  );
}
