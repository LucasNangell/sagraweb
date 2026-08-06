import { apiUrl } from "@/lib/api";

export type AppVersionResponse = {
  build_id?: string | null;
};

/** True quando o client e o servidor reportam build_ids distintos e ambos existem. */
export function isClientBuildOutdated(
  clientBuildId: string | undefined | null,
  serverBuildId: string | undefined | null,
): boolean {
  const client = (clientBuildId ?? "").trim();
  const server = (serverBuildId ?? "").trim();
  if (!client || !server) return false;
  return client !== server;
}

export function resolveClientBuildId(): string {
  return (import.meta.env.VITE_SAGRA_BUILD_ID ?? "").trim();
}

/** Busca o build_id publicado no servidor (sem cache HTTP). */
export async function fetchServerBuildId(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(apiUrl("/app-version"), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AppVersionResponse;
    const id = (data.build_id ?? "").trim();
    return id || null;
  } catch {
    return null;
  }
}
