import { apiUrl } from "@/lib/api";

export type ClienteTipoConta = "gabinete" | "orgao";

export interface ClienteUser {
  id: number;
  nome: string;
  email: string;
  gabinete: string;
  tipo_conta: ClienteTipoConta;
  is_principal: boolean;
  nav_credencial_depol?: boolean;
}

export interface ClienteOsItem {
  nr_os: number;
  ano: number;
  titulo: string;
  produto: string;
  situacao: string;
  setor: string;
  observacao?: string;
  data_andamento?: string | null;
  pendencia_tipo?: string | null;
  pendencia_url?: string | null;
  pendencia_label?: string;
  versao?: string;
}

export interface ClienteDashboardResponse {
  gabinete: string;
  tipo_conta: ClienteTipoConta;
  vinculo_label: string;
  solicitante?: string;
  deputado_ou_orgao?: string;
  em_andamento: ClienteOsItem[];
  pendencias_pt: ClienteOsItem[];
  pendencias_aprovacao: ClienteOsItem[];
  pendencias_envio_arquivo: ClienteOsItem[];
  pendencias_usuario: ClienteOsItem[];
}

export interface ClienteTimelineStep {
  ordem: number;
  situacao: string;
  setor: string;
  concluido: boolean;
  data?: string | null;
  pendencia_tipo?: string | null;
  pendencia_url?: string | null;
  pendencia_label?: string | null;
  pendencia_mensagem?: string | null;
}

export interface ClienteOsTimelineResponse {
  steps: ClienteTimelineStep[];
  maquina?: string | null;
  produto?: string | null;
  referencia_os_count: number;
}

export async function clienteFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    try {
      const data = JSON.parse(text) as { detail?: string };
      if (typeof data.detail === "string" && data.detail.trim()) {
        throw new Error(data.detail);
      }
    } catch (parseErr) {
      if (parseErr instanceof Error && !parseErr.message.startsWith("API ")) {
        throw parseErr;
      }
    }
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function clienteLogin(email: string, password: string): Promise<{ user: ClienteUser }> {
  return clienteFetch("/auth/cliente/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function clienteLogout(): Promise<void> {
  await clienteFetch("/auth/cliente/logout", { method: "POST" });
}

export async function fetchClienteMe(): Promise<ClienteUser> {
  return clienteFetch("/cliente/me");
}

export async function fetchClienteDashboard(): Promise<ClienteDashboardResponse> {
  return clienteFetch("/cliente/dashboard");
}

export async function fetchClienteOsTimeline(
  ano: number,
  nrOs: number,
): Promise<ClienteOsTimelineResponse> {
  return clienteFetch(`/cliente/os/${ano}/${nrOs}/andamentos`);
}

export async function fetchClienteContas(): Promise<ClienteUser[]> {
  return clienteFetch("/cliente/contas");
}

export async function createClienteSubConta(body: {
  nome: string;
  email: string;
}): Promise<{ status: string; email: string }> {
  return clienteFetch("/cliente/contas", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function checkClienteActivationToken(token: string): Promise<{
  nome?: string;
  email?: string;
  gabinete?: string;
  tipo_conta?: ClienteTipoConta;
  vinculo_label?: string;
}> {
  const params = new URLSearchParams({ token });
  return clienteFetch(`/auth/cliente/activate/check?${params}`);
}

export async function activateClienteAccount(
  token: string,
  password: string,
): Promise<{ status: string; message: string }> {
  return clienteFetch("/auth/cliente/activate", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export async function adminCreateCliente(body: {
  nome: string;
  email: string;
  tipo_conta: ClienteTipoConta;
  vinculo: string;
}): Promise<{ status: string; email: string; gabinete: string; tipo_conta: ClienteTipoConta }> {
  return clienteFetch("/admin/clientes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminFetchClienteVinculoOpcoes(
  tipo: ClienteTipoConta,
): Promise<string[]> {
  const params = new URLSearchParams({ tipo });
  return clienteFetch(`/admin/clientes/vinculo-opcoes?${params}`);
}

export async function adminListClientes(): Promise<
  Array<{
    ID: number;
    Nome: string;
    Email: string;
    Gabinete: string;
    TipoConta?: string;
    ParentID: number | null;
    EmailVerified: number;
    AuthAtivo: number;
    NavCredencialDepol?: number;
  }>
> {
  return clienteFetch("/admin/clientes");
}

export async function adminUpdateClienteNav(
  clienteId: number,
  body: { nav_credencial_depol: boolean },
): Promise<{ status: string; id: number; nav_credencial_depol: boolean }> {
  return clienteFetch(`/admin/clientes/${clienteId}/nav`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function adminResendClienteActivation(clienteId: number): Promise<{ status: string }> {
  return clienteFetch(`/admin/clientes/${clienteId}/resend-activation`, {
    method: "POST",
  });
}

export async function adminDeleteCliente(clienteId: number): Promise<{ status: string; id: number }> {
  return clienteFetch(`/admin/clientes/${clienteId}/delete`, {
    method: "POST",
  });
}

/** Credenciais DEPOL — portal cliente */
export function clienteDepolModeloThumbUrl(nome: string): string {
  return apiUrl(`/cliente/credenciais-depol/modelos/${encodeURIComponent(nome)}/thumb`);
}

export function clienteDepolModeloSvgUrl(nome: string): string {
  return apiUrl(`/cliente/credenciais-depol/svgs/${encodeURIComponent(nome)}`);
}

export async function fetchClienteCredenciaisDepolModelos() {
  return clienteFetch<{
    modelos: Array<{
      nome: string;
      arquivo_jpg?: string;
      nome_exibicao?: string;
      thumb_url: string;
      layout?: unknown;
    }>;
  }>("/cliente/credenciais-depol/modelos");
}

export async function createClienteCredenciaisDepolPedido(body: {
  titulo?: string;
  observacao?: string;
  itens: Array<{
    ordem: number;
    modelo_arquivo: string;
    linha1: string;
    linha2?: string;
    linha3?: string;
  }>;
}) {
  return clienteFetch<{ id: number; itens: unknown[] }>("/cliente/credenciais-depol/pedidos", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
