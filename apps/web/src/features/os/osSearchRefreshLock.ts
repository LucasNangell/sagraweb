const LOCK_KEY = "sagra-os-search-refresh";
const TAB_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Evita que várias abas disparem GET /os/search ao mesmo tempo. */
export function tryAcquireOsSearchRefreshLock(ttlMs = 2_500): boolean {
  if (typeof localStorage === "undefined") {
    return true;
  }
  const now = Date.now();
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabId?: string; at?: number };
      if (
        parsed.tabId &&
        parsed.tabId !== TAB_ID &&
        typeof parsed.at === "number" &&
        now - parsed.at < ttlMs
      ) {
        return false;
      }
    }
    localStorage.setItem(
      LOCK_KEY,
      JSON.stringify({ tabId: TAB_ID, at: now }),
    );
    return true;
  } catch {
    return true;
  }
}
