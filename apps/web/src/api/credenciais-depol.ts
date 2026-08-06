import { apiFetch, resolveSagraApiPrefix } from "@/lib/api";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export interface CredenciaisDepolSvgBox {
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
}

export interface CredenciaisDepolLayout {
  page_w_mm: number;
  page_h_mm: number;
  svgs: Record<string, CredenciaisDepolSvgBox>;
}

export interface CredenciaisDepolModelo {
  id?: number;
  nome: string;
  arquivo_jpg?: string;
  nome_exibicao?: string;
  ativo?: boolean;
  ordem?: number;
  layout?: CredenciaisDepolLayout;
  thumb_url: string;
}

export interface CredenciaisDepolItem {
  id?: number;
  pedido_id?: number;
  ordem: number;
  modelo_arquivo: string;
  linha1: string;
  linha2?: string | null;
  linha3?: string | null;
  num_linhas?: number;
}

export interface CredenciaisDepolPedido {
  id: number;
  titulo?: string | null;
  observacao?: string | null;
  status: string;
  criado_por: string;
  criado_em?: string | null;
  ano_protocolo?: number | null;
  nro_protocolo?: number | null;
  vinculado_por?: string | null;
  vinculado_em?: string | null;
  job_id?: number | null;
  itens: CredenciaisDepolItem[];
}

export interface CredenciaisDepolJob {
  id: number;
  status: string;
  erro?: string | null;
  arquivo_cdr?: string | null;
  arquivo_pdf?: string | null;
  prova_revisao?: string | null;
  solicitado_em?: string | null;
  concluido_em?: string | null;
}

export function modeloThumbUrl(nome: string): string {
  const prefix = resolveSagraApiPrefix();
  return `${prefix}/credenciais-depol/modelos/${encodeURIComponent(nome)}/thumb`;
}

export function modeloSvgUrl(nome: string): string {
  const prefix = resolveSagraApiPrefix();
  return `${prefix}/credenciais-depol/svgs/${encodeURIComponent(nome)}`;
}

export function fetchCredenciaisDepolModelos() {
  return apiFetch<{ modelos: CredenciaisDepolModelo[] }>(
    "/credenciais-depol/modelos",
  );
}

export function fetchCredenciaisDepolAdminModelos() {
  return apiFetch<{ modelos: CredenciaisDepolModelo[] }>(
    "/credenciais-depol/admin/modelos",
  );
}

export interface CredenciaisDepolAutoOsSettings {
  auto_criar_os: boolean;
  os_template_nro: number;
  os_template_ano: number;
  jpg_dir?: string;
  svg_dir?: string;
}

export function fetchCredenciaisDepolAdminSettings() {
  return apiFetch<CredenciaisDepolAutoOsSettings>(
    "/credenciais-depol/admin/settings",
  );
}

export function updateCredenciaisDepolAdminSettings(body: {
  auto_criar_os?: boolean;
  os_template_nro?: number;
  os_template_ano?: number;
}) {
  return apiFetch<CredenciaisDepolAutoOsSettings>(
    "/credenciais-depol/admin/settings",
    {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
}

export function syncCredenciaisDepolAdminModelos() {
  return apiFetch<{
    encontrados: number;
    inseridos: number;
    ja_existentes: number;
    modelos: CredenciaisDepolModelo[];
  }>("/credenciais-depol/admin/modelos/sync", { method: "POST" });
}

export function updateCredenciaisDepolAdminModelo(
  id: number,
  body: {
    nome_exibicao?: string;
    ativo?: boolean;
    ordem?: number;
    layout?: CredenciaisDepolLayout;
  },
) {
  return apiFetch<CredenciaisDepolModelo>(
    `/credenciais-depol/admin/modelos/${id}`,
    {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
}

export function fetchCredenciaisDepolPedidos(params?: {
  status?: string;
  abertos?: boolean;
  ano?: number;
  nro?: number;
}) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.abertos) q.set("abertos", "true");
  if (params?.ano != null) q.set("ano", String(params.ano));
  if (params?.nro != null) q.set("nro", String(params.nro));
  const qs = q.toString();
  return apiFetch<{ pedidos: CredenciaisDepolPedido[] }>(
    `/credenciais-depol/pedidos${qs ? `?${qs}` : ""}`,
  );
}

export function fetchCredenciaisDepolPedido(id: number) {
  return apiFetch<CredenciaisDepolPedido>(`/credenciais-depol/pedidos/${id}`);
}

export function createCredenciaisDepolPedido(body: {
  titulo?: string;
  observacao?: string;
  itens: Array<{
    modelo_arquivo: string;
    linha1: string;
    linha2?: string;
    linha3?: string;
    ordem?: number;
  }>;
}) {
  return apiFetch<CredenciaisDepolPedido>("/credenciais-depol/pedidos", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function cancelarCredenciaisDepolPedido(id: number) {
  return apiFetch<CredenciaisDepolPedido>(
    `/credenciais-depol/pedidos/${id}/cancelar`,
    { method: "POST" },
  );
}

export function vincularCredenciaisDepolPedido(
  id: number,
  ano: number,
  nro: number,
) {
  return apiFetch<CredenciaisDepolPedido>(
    `/credenciais-depol/pedidos/${id}/vincular`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ano, nro }),
    },
  );
}

export function desvincularCredenciaisDepolPedido(id: number) {
  return apiFetch<CredenciaisDepolPedido>(
    `/credenciais-depol/pedidos/${id}/desvincular`,
    { method: "POST" },
  );
}

export function executarCredenciaisDepolPedido(id: number) {
  return apiFetch<{
    pedido: CredenciaisDepolPedido | null;
    pedidos?: CredenciaisDepolPedido[];
    job: CredenciaisDepolJob;
    num_pedidos?: number;
    num_itens?: number;
  }>(`/credenciais-depol/pedidos/${id}/executar`, { method: "POST" });
}

export function executarCredenciaisDepolOs(ano: number, nro: number) {
  return apiFetch<{
    pedido: CredenciaisDepolPedido | null;
    pedidos?: CredenciaisDepolPedido[];
    job: CredenciaisDepolJob;
    num_pedidos?: number;
    num_itens?: number;
  }>(`/credenciais-depol/os/${ano}/${nro}/executar`, { method: "POST" });
}

export function fetchCredenciaisDepolPedidoJob(id: number) {
  return apiFetch<{
    pedido: CredenciaisDepolPedido;
    job: CredenciaisDepolJob | null;
  }>(`/credenciais-depol/pedidos/${id}/job`);
}

export function aprovarProvaCredenciaisDepol(id: number) {
  return apiFetch<{
    pedido: CredenciaisDepolPedido | null;
    proof_token?: string;
    job?: CredenciaisDepolJob;
  }>(`/credenciais-depol/pedidos/${id}/aprovar-prova`, { method: "POST" });
}

export function descartarProvaCredenciaisDepol(id: number) {
  return apiFetch<{
    pedido: CredenciaisDepolPedido | null;
    job?: CredenciaisDepolJob;
  }>(`/credenciais-depol/pedidos/${id}/descartar-prova`, { method: "POST" });
}
