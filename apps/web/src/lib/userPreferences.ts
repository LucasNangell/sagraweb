import {
  fetchUserPreference,
  saveUserPreference,
  type UserPreferenceKey,
} from "@/api/userPreferences";
import { PAINEL_CONFIG_STORAGE_KEY } from "@/features/painel-global/painelConfigStore";
import { MODERN_CONFIG_KEY } from "@/features/dashboard-setor-modern/configStorage";

const OS_TOGGLES_STORAGE_KEY = "sagra-os-filter-toggles";
const THEME_STORAGE_KEY = "theme";

const LOCAL_STORAGE_BY_KEY: Record<UserPreferenceKey, string> = {
  painel_global: PAINEL_CONFIG_STORAGE_KEY,
  painel_setor: PAINEL_CONFIG_STORAGE_KEY,
  painel_setor_moderno: MODERN_CONFIG_KEY,
  os_filter_toggles: OS_TOGGLES_STORAGE_KEY,
  painel_theme: THEME_STORAGE_KEY,
};

const saveTimers = new Map<UserPreferenceKey, ReturnType<typeof setTimeout>>();

export function writeLocalPreferencePayload(
  key: UserPreferenceKey,
  payload: unknown,
): void {
  const storageKey = LOCAL_STORAGE_BY_KEY[key];
  if (key === "os_filter_toggles") {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ state: { filters: payload }, version: 0 }),
    );
    return;
  }
  if (key === "painel_theme") {
    localStorage.setItem(
      storageKey,
      typeof payload === "string" ? payload : String(payload),
    );
    return;
  }
  localStorage.setItem(storageKey, JSON.stringify(payload));
}

export function schedulePreferenceSave(
  key: UserPreferenceKey,
  payload: unknown,
  debounceMs = 800,
): void {
  writeLocalPreferencePayload(key, payload);

  const pending = saveTimers.get(key);
  if (pending) {
    clearTimeout(pending);
  }

  saveTimers.set(
    key,
    setTimeout(() => {
      saveTimers.delete(key);
      void saveUserPreference(key, payload).catch((err) => {
        console.warn("[preferences] falha ao salvar", key, err);
      });
    }, debounceMs),
  );
}

export async function loadPreferenceFromServer<T>(
  key: UserPreferenceKey,
): Promise<T | null> {
  try {
    const remote = await fetchUserPreference<T>(key);
    if (remote != null) {
      writeLocalPreferencePayload(key, remote);
    }
    return remote;
  } catch (err) {
    console.warn("[preferences] falha ao carregar", key, err);
    return null;
  }
}
