import { apiFetch } from "@/api/client";

import type { DevFeaturesConfig } from "@/features/configuracoes/types";

export async function fetchDevFeatures(): Promise<DevFeaturesConfig> {
  return apiFetch<DevFeaturesConfig>("/dev-features");
}
