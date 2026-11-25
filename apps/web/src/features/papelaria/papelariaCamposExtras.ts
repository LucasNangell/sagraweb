/** Campos de texto/rede extras na prévia PDF (só operador) — `dados.__campos_extras`. */

export const CAMPOS_EXTRAS_DADOS_KEY = "__campos_extras";

export type CampoExtraDirecao = "acima" | "abaixo" | "esquerda" | "direita";
export type CampoExtraTipo = "texto" | "rede";

export type CampoExtra = {
  id: string;
  tipo: CampoExtraTipo;
  ancora_chave: string;
  direcao: CampoExtraDirecao;
  texto: string;
  rede_chave: string;
  rede_valor: string;
};

export const DIRECOES_EXTRA: Array<{ id: CampoExtraDirecao; label: string }> = [
  { id: "acima", label: "Acima" },
  { id: "abaixo", label: "Abaixo" },
  { id: "esquerda", label: "À esquerda" },
  { id: "direita", label: "À direita" },
];

let _seq = 0;

export function novoIdCampoExtra(): string {
  _seq += 1;
  return `extra_${Date.now().toString(36)}_${_seq}`;
}

export function normalizarCamposExtras(raw: unknown): CampoExtra[] {
  if (raw == null || raw === "") return [];
  let lista: unknown = raw;
  if (typeof raw === "string") {
    try {
      lista = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(lista)) return [];
  const out: CampoExtra[] = [];
  const ids = new Set<string>();
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const tipo = String(o.tipo ?? "").trim().toLowerCase();
    const direcao = String(o.direcao ?? "").trim().toLowerCase();
    const ancora = String(o.ancora_chave ?? "").trim();
    if (!id || ids.has(id)) continue;
    if (tipo !== "texto" && tipo !== "rede") continue;
    if (!["acima", "abaixo", "esquerda", "direita"].includes(direcao)) continue;
    if (!ancora) continue;
    ids.add(id);
    out.push({
      id,
      tipo,
      ancora_chave: ancora,
      direcao: direcao as CampoExtraDirecao,
      texto: tipo === "texto" ? String(o.texto ?? "") : "",
      rede_chave: tipo === "rede" ? String(o.rede_chave ?? "").trim() : "",
      rede_valor: tipo === "rede" ? String(o.rede_valor ?? "").trim() : "",
    });
  }
  return out;
}

/** JSON para `dados.__campos_extras` (omitido se vazio). */
export function camposExtrasParaDados(extras: CampoExtra[]): string | null {
  if (!extras.length) return null;
  return JSON.stringify(
    extras.map((e) => ({
      id: e.id,
      tipo: e.tipo,
      ancora_chave: e.ancora_chave,
      direcao: e.direcao,
      texto: e.tipo === "texto" ? e.texto : "",
      rede_chave: e.tipo === "rede" ? e.rede_chave : "",
      rede_valor: e.tipo === "rede" ? e.rede_valor : "",
    })),
  );
}

export function extraIdDaRegiao(chave: string, extraId?: string): string | null {
  if (extraId) return extraId;
  if (chave.startsWith("extra:")) return chave.slice("extra:".length);
  return null;
}
