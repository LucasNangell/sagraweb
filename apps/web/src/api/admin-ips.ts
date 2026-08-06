import { apiFetch, apiUrl } from "@/api/client";
import type {
  AccessRequestRecord,
  IpPermissionPayload,
  IpPermissionRecord,
  IpPermissionUpdatePayload,
} from "@/features/admin-ips/types";

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

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res));
  }
  return res.json() as Promise<T>;
}

export async function fetchAdminIpList(): Promise<IpPermissionRecord[]> {
  return apiFetch<IpPermissionRecord[]>("/admin/ip/list");
}

export async function fetchAdminIpGroups(): Promise<string[]> {
  return apiFetch<string[]>("/admin/ip/groups");
}

export async function fetchAccessRequests(): Promise<AccessRequestRecord[]> {
  return apiFetch<AccessRequestRecord[]>("/admin/access-requests");
}

export interface AddAdminIpOptions {
  ponto?: number;
  nome_usuario?: string;
}

export async function addAdminIp(
  payload: IpPermissionPayload,
  options?: AddAdminIpOptions,
): Promise<{ success: boolean; message?: string }> {
  const params = new URLSearchParams();
  if (options?.ponto != null) {
    params.set("ponto", String(options.ponto));
  }
  if (options?.nome_usuario?.trim()) {
    params.set("nome_usuario", options.nome_usuario.trim());
  }
  const qs = params.toString();
  const path = qs ? `/admin/ip/add?${qs}` : "/admin/ip/add";
  return apiPost<{ success: boolean; message?: string }>(path, payload);
}

export async function updateAdminIp(
  payload: IpPermissionUpdatePayload,
): Promise<{ success: boolean; message?: string }> {
  return apiPost<{ success: boolean; message?: string }>("/admin/ip/update", payload);
}

export async function deleteAdminIp(id: number): Promise<{ success: boolean }> {
  return apiPost<{ success: boolean }>("/admin/ip/delete", { id });
}

export async function deleteAccessRequest(id: number): Promise<{ success: boolean }> {
  return apiPost<{ success: boolean }>("/admin/access-request/delete", { id });
}
