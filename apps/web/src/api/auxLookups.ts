import { apiFetch, apiUrl } from "@/api/client";

interface SetorRow {
  Setor?: string | null;
}

interface SituacaoRow {
  Situacao?: string | null;
}

interface MaquinaRow {
  MaquinaLink?: string | null;
}

interface ProdutoRow {
  Produto?: string | null;
}

interface CategoriaRow {
  Categoria?: string | null;
}

interface PapelRow {
  Papel?: string | null;
}

export interface PapelLombadaItem {
  codPapel: number | null;
  papel: string;
  espessura: number;
}

interface PapelLombadaRow {
  CodPapel?: number | null;
  Papel?: string | null;
  Espessura?: number | null;
}

interface CorRow {
  Cor?: string | null;
}

interface FormatoRow {
  Formato?: string | null;
  altura_mm?: number | null;
  largura_mm?: number | null;
}

export interface FormatoAuxItem {
  formato: string;
  altura_mm?: number | null;
  largura_mm?: number | null;
}

export interface DeputadoLookup {
  id?: number | null;
  nome: string;
  nome_eleitoral?: string;
  gabinete: string;
  andar: string;
  local: string;
  ramal: string;
  foto: string;
  email?: string;
  partido?: string;
  uf?: string;
  partido_uf?: string;
  situacao?: string;
}

export async function fetchSetores(): Promise<string[]> {
  const rows = await apiFetch<SetorRow[]>("/aux/setores");
  const values = rows
    .map((r) => r.Setor)
    .filter((v): v is string => Boolean(v && v.trim()));
  if (!values.includes("Gravação")) {
    values.push("Gravação");
  }
  return values.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function fetchSituacoes(): Promise<string[]> {
  const rows = await apiFetch<SituacaoRow[]>("/aux/situacoes");
  return rows
    .map((r) => r.Situacao)
    .filter((v): v is string => Boolean(v && v.trim()))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function fetchMaquinas(): Promise<string[]> {
  const rows = await apiFetch<MaquinaRow[]>("/aux/maquinas");
  return rows
    .map((r) => r.MaquinaLink)
    .filter((v): v is string => Boolean(v?.trim()))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function fetchProdutos(): Promise<string[]> {
  const rows = await apiFetch<ProdutoRow[]>("/aux/produtos");
  return rows
    .map((r) => r.Produto)
    .filter((v): v is string => Boolean(v?.trim()))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function fetchCategorias(): Promise<string[]> {
  const rows = await apiFetch<CategoriaRow[]>("/aux/categorias");
  return rows
    .map((r) => r.Categoria)
    .filter((v): v is string => Boolean(v?.trim()))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function fetchPapeis(): Promise<string[]> {
  const rows = await apiFetch<PapelRow[]>("/aux/papeis");
  return rows
    .map((r) => r.Papel)
    .filter((v): v is string => Boolean(v?.trim()))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function fetchPapeisLombada(): Promise<PapelLombadaItem[]> {
  const rows = await apiFetch<PapelLombadaRow[]>("/aux/papeis-lombada");
  return rows
    .map((r) => {
      const papel = r.Papel?.trim() ?? "";
      const espessura = r.Espessura;
      if (!papel || espessura == null || Number.isNaN(Number(espessura))) {
        return null;
      }
      return {
        codPapel: r.CodPapel ?? null,
        papel,
        espessura: Number(espessura),
      };
    })
    .filter((r): r is PapelLombadaItem => r != null);
}

export async function fetchFormatos(): Promise<FormatoAuxItem[]> {
  const rows = await apiFetch<FormatoRow[]>("/aux/formatos");
  return rows
    .map((r) => ({
      formato: r.Formato?.trim() ?? "",
      altura_mm: r.altura_mm ?? null,
      largura_mm: r.largura_mm ?? null,
    }))
    .filter((r) => Boolean(r.formato));
}

export async function fetchCores(): Promise<string[]> {
  const rows = await apiFetch<CorRow[]>("/aux/cores");
  return rows
    .map((r) => r.Cor)
    .filter((v): v is string => Boolean(v?.trim()))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

interface FormaEntregaRow {
  FormaEntrega?: string | null;
}

interface ResponsavelGrafRow {
  ResponsavelGraf?: string | null;
}

export async function fetchFormasEntrega(): Promise<string[]> {
  const rows = await apiFetch<FormaEntregaRow[]>("/aux/formas-entrega");
  return rows
    .map((r) => r.FormaEntrega)
    .filter((v): v is string => Boolean(v?.trim()))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function fetchResponsaveisGrafica(): Promise<string[]> {
  const rows = await apiFetch<ResponsavelGrafRow[]>("/aux/responsaveis-grafica");
  return rows
    .map((r) => r.ResponsavelGraf)
    .filter((v): v is string => Boolean(v?.trim()))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export interface AcabamentoCatalogVariacao {
  id: number;
  label: string;
}

export interface AcabamentoCatalogItem {
  id: number;
  label: string;
  variacoes: AcabamentoCatalogVariacao[];
}

export async function fetchAcabamentos(): Promise<AcabamentoCatalogItem[]> {
  const rows = await apiFetch<AcabamentoCatalogItem[]>("/aux/acabamentos");
  return (rows ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    variacoes: (row.variacoes ?? []).map((v) => ({
      id: v.id,
      label: v.label,
    })),
  }));
}

export async function fetchDeputadoLookup(
  nome: string,
  deputadoId?: number,
): Promise<DeputadoLookup> {
  const q = new URLSearchParams();
  if (deputadoId != null && deputadoId > 0) {
    q.set("id", String(deputadoId));
  } else {
    q.set("nome", nome);
  }
  return apiFetch<DeputadoLookup>(`/aux/deputado/buscar?${q}`);
}

export interface SolicitanteFotoStatus {
  exists: boolean;
}

export function solicitanteFotoUrl(nome: string, cacheBust?: number): string {
  const q = new URLSearchParams();
  q.set("nome", nome);
  if (cacheBust != null) {
    q.set("t", String(cacheBust));
  }
  return apiUrl(`/aux/solicitante/foto?${q}`);
}

export async function fetchSolicitanteFotoStatus(
  nome: string,
): Promise<SolicitanteFotoStatus> {
  const q = new URLSearchParams();
  q.set("nome", nome);
  return apiFetch<SolicitanteFotoStatus>(`/aux/solicitante/foto-status?${q}`);
}

export async function uploadSolicitanteFoto(
  nome: string,
  file: File,
): Promise<SolicitanteFotoStatus> {
  const fd = new FormData();
  fd.append("nome", nome);
  fd.append("file", file);
  return apiFetch<SolicitanteFotoStatus>("/aux/solicitante/foto", {
    method: "POST",
    body: fd,
  });
}
