import { apiFetch } from "@/lib/api";

export interface EstoqueCategoria {
  id: number;
  nome: string;
  ativo: boolean;
}

export interface EstoqueSku {
  id: number;
  codigo: string;
  nome: string;
  descricao?: string | null;
  categoria_id?: number | null;
  categoria_nome?: string | null;
  unidade: string;
  papel_link?: string | null;
  estoque_minimo: number;
  ativo: boolean;
  quantidade: number;
  reservado: number;
  disponivel: number;
  alerta_baixo: boolean;
  custo_medio?: number;
  ultimo_custo?: number;
  moeda?: string;
  valor_estoque?: number;
}

export interface EstoquePedidoItem {
  id: number;
  sku_id: number;
  sku_codigo?: string;
  sku_nome?: string;
  unidade?: string;
  qtd_solicitada: number;
  qtd_atendida: number;
  custo_unitario_snapshot?: number | null;
}

export interface EstoquePedido {
  id: number;
  status: string;
  solicitante_ponto: string;
  observacao?: string | null;
  os_nro?: number | null;
  os_ano?: number | null;
  atendido_por?: string | null;
  atendido_em?: string | null;
  motivo_recusa?: string | null;
  criado_em?: string | null;
  itens: EstoquePedidoItem[];
}

export interface EstoqueMovimento {
  id: number;
  sku_id: number;
  sku_codigo?: string;
  sku_nome?: string;
  tipo: string;
  quantidade: number;
  custo_unitario?: number;
  custo_total?: number;
  saldo_apos: number;
  motivo?: string | null;
  pedido_id?: number | null;
  ponto?: string | null;
  criado_em?: string | null;
}

export interface EstoqueResumo {
  total_skus: number;
  skus_ativos: number;
  alertas: number;
  pedidos_pendentes: number;
  valor_estoque: number;
}

export function fetchEstoqueCategorias() {
  return apiFetch<{ items: EstoqueCategoria[] }>("/estoque/categorias");
}

export function fetchEstoqueSkus(params?: {
  q?: string;
  categoria_id?: number;
  include_inactive?: boolean;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.categoria_id != null) qs.set("categoria_id", String(params.categoria_id));
  if (params?.include_inactive) qs.set("include_inactive", "true");
  if (params?.limit != null) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiFetch<{ items: EstoqueSku[]; total: number }>(`/estoque/skus${suffix}`);
}

export function createEstoqueSku(body: {
  codigo: string;
  nome: string;
  descricao?: string;
  categoria_id?: number | null;
  unidade?: string;
  papel_link?: string;
  estoque_minimo?: number;
}) {
  return apiFetch<EstoqueSku>("/estoque/skus", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateEstoqueSku(
  id: number,
  body: Partial<{
    codigo: string;
    nome: string;
    descricao: string;
    categoria_id: number | null;
    clear_categoria: boolean;
    unidade: string;
    papel_link: string;
    estoque_minimo: number;
    ativo: boolean;
  }>,
) {
  return apiFetch<EstoqueSku>(`/estoque/skus/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function postEstoqueEntrada(body: {
  sku_id: number;
  quantidade: number;
  custo_unitario?: number;
  motivo?: string;
}) {
  return apiFetch<{ movimento_id: number; sku: EstoqueSku }>("/estoque/entradas", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postEstoqueSaida(body: {
  sku_id: number;
  quantidade: number;
  motivo?: string;
}) {
  return apiFetch<{ movimento_id: number; sku: EstoqueSku }>("/estoque/saidas", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postEstoqueAjuste(body: {
  sku_id: number;
  quantidade_nova: number;
  motivo: string;
}) {
  return apiFetch<{ movimento_id: number; sku: EstoqueSku }>("/estoque/ajustes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchEstoquePedidos(params?: { status?: string }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiFetch<{ items: EstoquePedido[]; total: number }>(`/estoque/pedidos${suffix}`);
}

export function createEstoquePedido(body: {
  itens: { sku_id: number; quantidade: number }[];
  observacao?: string;
  os_nro?: number;
  os_ano?: number;
}) {
  return apiFetch<EstoquePedido>("/estoque/pedidos", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function atenderEstoquePedido(id: number) {
  return apiFetch<EstoquePedido>(`/estoque/pedidos/${id}/atender`, { method: "POST" });
}

export function recusarEstoquePedido(id: number, motivo?: string) {
  return apiFetch<EstoquePedido>(`/estoque/pedidos/${id}/recusar`, {
    method: "POST",
    body: JSON.stringify({ motivo }),
  });
}

export function cancelarEstoquePedido(id: number) {
  return apiFetch<EstoquePedido>(`/estoque/pedidos/${id}/cancelar`, { method: "POST" });
}

export function fetchEstoqueMovimentos(params?: {
  sku_id?: number;
  tipo?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.sku_id != null) qs.set("sku_id", String(params.sku_id));
  if (params?.tipo) qs.set("tipo", params.tipo);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiFetch<{ items: EstoqueMovimento[]; total: number }>(
    `/estoque/movimentos${suffix}`,
  );
}

export function fetchEstoqueAlertas() {
  return apiFetch<{ items: EstoqueSku[] }>("/estoque/alertas");
}

export function fetchEstoqueResumo() {
  return apiFetch<EstoqueResumo>("/estoque/resumo");
}
