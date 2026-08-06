import { apiFetch } from "@/lib/api";

export interface PainelTabletPushPref {
  enabled: boolean;
  setor: string | null;
}

export async function fetchPainelTabletPushPref(): Promise<PainelTabletPushPref> {
  return apiFetch<PainelTabletPushPref>("/painel-tablet/push-pref");
}

export async function savePainelTabletPushPref(payload: {
  enabled: boolean;
  setor?: string | null;
}): Promise<PainelTabletPushPref> {
  return apiFetch<PainelTabletPushPref>("/painel-tablet/push-pref", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
