import { apiFetch } from "@/lib/api";

import type { PermissionKey, PermissionsResponse } from "@/features/auth/types";

export interface AuthUserRow {
  Ponto: number;
  Nome?: string | null;
  Email?: string | null;
  EmailVerified?: number | boolean;
  AuthAtivo?: number | boolean;
  UltimoAcesso?: string | null;
}

export interface CreateAuthUserPayload {
  ponto: number;
  nome: string;
  email?: string | null;
  setor?: string | null;
  fornecedor?: boolean;
}

export interface CreateAuthUserResponse {
  status: string;
  ponto: number;
  email: string | null;
  /** Presente quando o cadastro foi feito sem e-mail. */
  activation_link?: string;
  expires_at?: string;
}

export async function createAuthUser(
  payload: CreateAuthUserPayload,
): Promise<CreateAuthUserResponse> {
  return apiFetch<CreateAuthUserResponse>("/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface PasswordLinkResponse {
  status: string;
  ponto: number;
  tipo: "reset" | "ativacao";
  link: string;
  expires_at?: string;
}

export async function generatePasswordLink(ponto: number): Promise<PasswordLinkResponse> {
  return apiFetch<PasswordLinkResponse>(`/admin/users/${ponto}/password-link`, {
    method: "POST",
  });
}

export async function deleteAuthUser(ponto: number): Promise<void> {
  await apiFetch(`/admin/users/${ponto}/delete`, { method: "POST" });
}

export async function resendActivation(ponto: number): Promise<void> {
  await apiFetch(`/admin/users/${ponto}/resend-activation`, { method: "POST" });
}

export async function fetchUserPermissions(ponto: number): Promise<PermissionsResponse> {
  return apiFetch<PermissionsResponse>(`/admin/users/${ponto}/permissions`);
}

export async function updateUserPermissions(
  ponto: number,
  perms: Partial<Record<PermissionKey, boolean>> & {
    auth_ativo?: boolean;
    painel_setores?: string[];
  },
): Promise<void> {
  await apiFetch(`/admin/users/${ponto}/permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(perms),
  });
}

export async function updateUserSetor(
  ponto: number,
  setor: string | null,
): Promise<void> {
  await apiFetch(`/admin/users/${ponto}/setor`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setor }),
  });
}

export interface UpdateUserProfilePayload {
  nome?: string;
  setor?: string | null;
  fornecedor?: boolean;
}

export async function updateUserProfile(
  ponto: number,
  payload: UpdateUserProfilePayload,
): Promise<void> {
  await apiFetch(`/admin/users/${ponto}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchUserIps(
  ponto: number,
): Promise<{ ponto: number; ips: Array<{ id: number; ip: string; descricao?: string | null }> }> {
  return apiFetch(`/admin/users/${ponto}/ips`);
}

export async function updateUserIps(ponto: number, ips: string[]): Promise<void> {
  await apiFetch(`/admin/users/${ponto}/ips`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ips }),
  });
}

export async function fetchSetorPainelDefault(
  setor: string,
): Promise<unknown | null> {
  const res = await apiFetch<{ payload: unknown | null }>(
    `/admin/setor-painel-defaults/${encodeURIComponent(setor)}`,
  );
  return res.payload ?? null;
}

export async function saveSetorPainelDefault(
  setor: string,
  payload: unknown,
): Promise<void> {
  await apiFetch(`/admin/setor-painel-defaults/${encodeURIComponent(setor)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
}
