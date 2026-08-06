import { apiFetch } from "@/api/client";

export const USER_PREFERENCE_KEYS = [
  "painel_global",
  "painel_setor",
  "os_filter_toggles",
  "painel_theme",
] as const;

export type UserPreferenceKey = (typeof USER_PREFERENCE_KEYS)[number];

interface PreferenceResponse<T = unknown> {
  payload: T | null;
}

export async function fetchUserPreference<T>(
  key: UserPreferenceKey,
): Promise<T | null> {
  const res = await apiFetch<PreferenceResponse<T>>(
    `/settings/preferences/${encodeURIComponent(key)}`,
  );
  return res?.payload ?? null;
}

export async function saveUserPreference<T>(
  key: UserPreferenceKey,
  payload: T,
): Promise<void> {
  await apiFetch<{ status: string }>(
    `/settings/preferences/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    },
  );
}
