import { apiFetch, apiUrl } from "@/lib/api";

import type {
  PermissionsResponse,
  SessionCreateResponse,
  SessionMeResponse,
  SessionUser,
} from "./types";

export async function fetchUserNameByPonto(
  ponto: number,
): Promise<{ nome: string | null; requiresPassword: boolean }> {
  const res = await fetch(apiUrl(`/auth/user-name/${ponto}`), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    return { nome: null, requiresPassword: false };
  }
  const data = (await res.json()) as {
    nome?: string | null;
    requires_password?: boolean;
  };
  const nome = data.nome?.trim();
  return {
    nome: nome || null,
    requiresPassword: Boolean(data.requires_password),
  };
}

export async function createSession(
  ponto: number,
  nome: string,
  password?: string,
): Promise<SessionUser> {
  const res = await apiFetch<SessionCreateResponse>("/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ponto,
      nome,
      ...(password ? { password } : {}),
    }),
  });
  return res.user;
}

export async function loginWithPassword(
  login: string,
  password: string,
): Promise<SessionUser> {
  const res = await apiFetch<SessionCreateResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password }),
  });
  return res.user;
}

export async function activateAccount(
  token: string,
  password: string,
): Promise<void> {
  await apiFetch("/auth/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
}

export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  return apiFetch("/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
}

export async function checkResetPasswordToken(token: string): Promise<{
  valid: boolean;
  nome?: string;
  email?: string;
}> {
  return apiFetch(`/auth/reset-password/check?token=${encodeURIComponent(token)}`);
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await apiFetch("/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
}

export async function checkActivationToken(token: string): Promise<{
  valid: boolean;
  already_active?: boolean;
  nome?: string;
  email?: string;
  account_type?: "interno" | "cliente";
  redirect?: string;
  gabinete?: string;
}> {
  return apiFetch(`/auth/activate/check?token=${encodeURIComponent(token)}`);
}

export async function fetchCurrentSession(): Promise<SessionMeResponse | null> {
  const res = await fetch(apiUrl("/auth/me"), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    return null;
  }
  if (!res.ok) {
    return null;
  }
  return res.json() as Promise<SessionMeResponse>;
}

export async function fetchPermissions(): Promise<PermissionsResponse> {
  return apiFetch<PermissionsResponse>("/permissions");
}

export async function fetchPainelScopePermissions(): Promise<PermissionsResponse> {
  return apiFetch<PermissionsResponse>("/permissions/painel-scope");
}

export async function logoutSession(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
}
