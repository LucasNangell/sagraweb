import { apiFetch, apiUrl } from "@/api/client";
import type {
  ForceRefreshPayload,
  UsuarioRecord,
} from "@/features/usuarios/types";

async function parseApiError(res: Response): Promise<string> {
  const text = await res.text().catch(() => res.statusText);
  try {
    const data = JSON.parse(text) as { detail?: string | { msg?: string }[] };
    if (typeof data.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
    if (Array.isArray(data.detail) && data.detail[0]?.msg) {
      return data.detail[0].msg;
    }
  } catch {
    /* ignore */
  }
  return text || res.statusText;
}

export async function fetchUsuarios(): Promise<UsuarioRecord[]> {
  return apiFetch<UsuarioRecord[]>("/users");
}

export async function fetchUsuariosOnline(): Promise<Array<string | number>> {
  return apiFetch<Array<string | number>>("/users/online");
}

export async function postForceRefresh(
  payload: ForceRefreshPayload,
): Promise<{ status: string; detail?: string }> {
  const res = await fetch(apiUrl("/realtime/notify"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => null)) as {
    status?: string;
    detail?: string;
  } | null;

  if (!res.ok) {
    throw new Error(await parseApiError(res));
  }

  if (data?.status === "error") {
    throw new Error(data.detail || "Erro ao enviar comando.");
  }

  return data ?? { status: "queued" };
}
