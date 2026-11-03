import { apiFetch } from "@/lib/api";
import type {
  DashboardCardStyle,
  DashboardConfig,
} from "@/features/dashboard-setor/types";

export type PainelOsRoute = "setor" | "setor-moderno" | "tablet" | "celular";

export interface PainelRemoteInstance {
  clientId: string;
  online: boolean;
  nome: string;
  setor: string;
  descricao: string;
  ip: string;
  route: string;
  lastSeen: string | null;
}

export interface PainelRemoteConfigResponse {
  payload: DashboardConfig | null;
  updatedAt: string | null;
  updatedBy: string;
}

export function postPainelHello(body: {
  clientId: string;
  route: PainelOsRoute;
  sector: string;
}): Promise<{ status: string; clientId: string }> {
  return apiFetch("/painel/hello", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchPainelRemoteConfig(
  clientId: string,
): Promise<PainelRemoteConfigResponse> {
  const params = new URLSearchParams({ clientId });
  return apiFetch(`/painel/config?${params.toString()}`);
}

export function fetchPainelAdminInstances(): Promise<{
  instances: PainelRemoteInstance[];
}> {
  return apiFetch("/admin/painel/instances");
}

export function savePainelAdminInstance(
  clientId: string,
  body: { nome?: string; setor?: string; descricao?: string },
): Promise<{ status: string; instance: PainelRemoteInstance }> {
  return apiFetch(`/admin/painel/instances/${encodeURIComponent(clientId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function savePainelAdminConfig(
  clientId: string,
  payload: DashboardConfig,
): Promise<PainelRemoteConfigResponse & { status: string }> {
  return apiFetch(`/admin/painel/config/${encodeURIComponent(clientId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
}

export interface PainelCardPreset {
  id: number;
  nome: string;
  payload: DashboardConfig | DashboardCardStyle;
  updatedAt: string | null;
  updatedBy: string;
}

export function fetchPainelPresets(): Promise<{ presets: PainelCardPreset[] }> {
  return apiFetch("/admin/painel/presets");
}

export function createPainelPreset(
  nome: string,
  payload: DashboardConfig | DashboardCardStyle,
): Promise<{ status: string; preset: PainelCardPreset }> {
  return apiFetch("/admin/painel/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome, payload }),
  });
}

export function deletePainelPreset(
  id: number,
): Promise<{ status: string }> {
  return apiFetch(`/admin/painel/presets/${id}`, {
    method: "DELETE",
  });
}
