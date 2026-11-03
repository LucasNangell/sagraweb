import { useEffect, useState } from "react";

import { DEFAULT_DASHBOARD_CONFIG } from "@/features/dashboard-setor/constants";
import type { DashboardConfig } from "@/features/dashboard-setor/types";
import { PainelLivePreviewBoard } from "@/features/painel-admin/components/PainelLivePreviewBoard";
import {
  readPreviewSnapshot,
  subscribePreviewConfig,
} from "@/features/painel-admin/previewChannel";

export function PainelAdminPreviewPage() {
  const [config, setConfig] = useState<DashboardConfig>(
    () => readPreviewSnapshot() ?? DEFAULT_DASHBOARD_CONFIG,
  );

  useEffect(() => subscribePreviewConfig(setConfig), []);

  return (
    <div className="painel-standalone h-dvh w-full overflow-hidden">
      <PainelLivePreviewBoard config={config} />
    </div>
  );
}
