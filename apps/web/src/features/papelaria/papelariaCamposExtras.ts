/** Campos de texto/rede extras na prévia PDF (só operador) — `dados.__campos_extras`. */

import type { PapelariaRedeEstilo } from "@/features/papelaria/types";

export const CAMPOS_EXTRAS_DADOS_KEY = "__campos_extras";
export const REDES_EXTRA_MAX = 8;
export const ESTILOS_LOGO_EXTRA: PapelariaRedeEstilo[] = [
  "quadrado_policromia",
  "quadrado_pb",
  "policromia",
  "pb",
];

export type CampoExtraDirecao = "acima" | "abaixo" | "esquerda" | "direita";
export type CampoExtraTipo = "texto" | "rede";
export type CampoExtraAlignH = "esquerda" | "centro" | "direita";
export type CampoExtraAlignV = "topo" | "meio" | "base";

export type CampoExtraRedeItem = { chave: string; valor: string };

export type CampoExtra = {
  id: string;
  tipo: CampoExtraTipo;
  ancora_chave: string;
  direcao: CampoExtraDirecao;
  texto: string;
  /** Compat / espelho do primeiro item de ``redes``. */
  rede_chave: string;
  rede_valor: string;
  /** Lista de redes no mesmo extra (vertical). Vazia quando tipo texto. */
  redes: CampoExtraRedeItem[];
  /** Variante da logo; null = herdar ``__redes_estilo``. */
  estilo: PapelariaRedeEstilo | null;
  /** Tamanho da logo em pt; null = ``tamanho_pt × 1.15``. */
  icone_pt: number | null;
  x_pt: number | null;
  y_pt: number | null;
  offset_x_pt: number;
  offset_y_pt: number;
  align_h: CampoExtraAlignH;
  align_v: CampoExtraAlignV;
  /** null = herdar da âncora. */
  tamanho_pt: number | null;
  /** Intervalos [inicio, fim) em negrito no texto. */
  negrito: Array<[number, number]>;
};

export const DIRECOES_EXTRA: Array<{ id: CampoExtraDirecao; label: string }> = [
  { id: "acima", label: "Acima" },
  { id: "abaixo", label: "Abaixo" },
  { id: "esquerda", label: "À esquerda" },
  { id: "direita", label: "À direita" },
];

export const PT_POR_MM = 72 / 25.4;

export function ptParaMm(pt: number): number {
  return pt / PT_POR_MM;
}

export function mmParaPt(mm: number): number {
  return mm * PT_POR_MM;
}

let _seq = 0;

export function novoIdCampoExtra(): string {
  _seq += 1;
  return `extra_${Date.now().toString(36)}_${_seq}`;
}

function numOuNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function numOuZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizarNegrito(raw: unknown, textoLen: number): Array<[number, number]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[number, number]> = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const a = Math.max(0, Math.min(textoLen, Math.floor(Number(item[0]))));
    const b = Math.max(0, Math.min(textoLen, Math.floor(Number(item[1]))));
    if (b > a) out.push([a, b]);
  }
  return out;
}

function alignH(v: unknown): CampoExtraAlignH {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "centro" || s === "direita") return s;
  return "esquerda";
}

function alignV(v: unknown): CampoExtraAlignV {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "meio" || s === "base") return s;
  return "topo";
}

function estiloLogo(v: unknown): PapelariaRedeEstilo | null {
  const s = String(v ?? "").trim().toLowerCase();
  if ((ESTILOS_LOGO_EXTRA as string[]).includes(s)) return s as PapelariaRedeEstilo;
  return null;
}

/** Lista de redes do extra (compat com ``rede_chave``/``rede_valor`` legados). */
export function normalizarRedesDoExtra(raw: unknown, fallbackChave = "", fallbackValor = ""): CampoExtraRedeItem[] {
  const out: CampoExtraRedeItem[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const chave = String(o.chave ?? "").trim().toLowerCase();
      const valor = String(o.valor ?? "").trim();
      if (!chave || chave.length > 64 || seen.has(chave)) continue;
      if (valor.length > 200) continue;
      seen.add(chave);
      out.push({ chave, valor });
      if (out.length >= REDES_EXTRA_MAX) break;
    }
  }
  if (!out.length) {
    const chave = String(fallbackChave ?? "").trim().toLowerCase();
    const valor = String(fallbackValor ?? "").trim();
    if (chave && chave.length <= 64 && valor.length <= 200) out.push({ chave, valor });
  }
  return out;
}

export function espelhoRedePrincipal(redes: CampoExtraRedeItem[]): {
  rede_chave: string;
  rede_valor: string;
} {
  const first = redes[0];
  return { rede_chave: first?.chave ?? "", rede_valor: first?.valor ?? "" };
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
    const texto = tipo === "texto" ? String(o.texto ?? "") : "";
    let tamanho = numOuNull(o.tamanho_pt);
    if (tamanho != null && (tamanho < 4 || tamanho > 72)) tamanho = null;
    let icone = numOuNull(o.icone_pt);
    if (icone != null && (icone < 4 || icone > 72)) icone = null;
    const redes =
      tipo === "rede"
        ? normalizarRedesDoExtra(o.redes, String(o.rede_chave ?? ""), String(o.rede_valor ?? ""))
        : [];
    if (tipo === "rede" && !redes.length) continue;
    const espelho = espelhoRedePrincipal(redes);
    out.push({
      id,
      tipo,
      ancora_chave: ancora,
      direcao: direcao as CampoExtraDirecao,
      texto,
      rede_chave: espelho.rede_chave,
      rede_valor: espelho.rede_valor,
      redes,
      estilo: tipo === "rede" ? estiloLogo(o.estilo) : null,
      icone_pt: tipo === "rede" ? icone : null,
      x_pt: numOuNull(o.x_pt),
      y_pt: numOuNull(o.y_pt),
      offset_x_pt: numOuZero(o.offset_x_pt),
      offset_y_pt: numOuZero(o.offset_y_pt),
      align_h: alignH(o.align_h),
      align_v: alignV(o.align_v),
      tamanho_pt: tamanho,
      negrito: tipo === "texto" ? normalizarNegrito(o.negrito, texto.length) : [],
    });
  }
  return out;
}

/** JSON para `dados.__campos_extras` (omitido se vazio). */
export function camposExtrasParaDados(extras: CampoExtra[]): string | null {
  if (!extras.length) return null;
  return JSON.stringify(
    extras.map((e) => {
      const redes = e.tipo === "rede" ? e.redes : [];
      const espelho = espelhoRedePrincipal(redes);
      return {
        id: e.id,
        tipo: e.tipo,
        ancora_chave: e.ancora_chave,
        direcao: e.direcao,
        texto: e.tipo === "texto" ? e.texto : "",
        rede_chave: e.tipo === "rede" ? espelho.rede_chave : "",
        rede_valor: e.tipo === "rede" ? espelho.rede_valor : "",
        ...(e.tipo === "rede" && redes.length
          ? { redes: redes.map((r) => ({ chave: r.chave, valor: r.valor })) }
          : {}),
        ...(e.tipo === "rede" && e.estilo ? { estilo: e.estilo } : {}),
        ...(e.tipo === "rede" && e.icone_pt != null ? { icone_pt: e.icone_pt } : {}),
        x_pt: e.x_pt,
        y_pt: e.y_pt,
        offset_x_pt: e.offset_x_pt,
        offset_y_pt: e.offset_y_pt,
        align_h: e.align_h,
        align_v: e.align_v,
        tamanho_pt: e.tamanho_pt,
        negrito: e.tipo === "texto" ? e.negrito : [],
      };
    }),
  );
}
export function extraIdDaRegiao(chave: string, extraId?: string): string | null {
  if (extraId) return extraId;
  if (chave.startsWith("extra:")) return chave.slice("extra:".length);
  return null;
}

export function celulaParaAlign(
  row: 0 | 1 | 2,
  col: 0 | 1 | 2,
): { align_h: CampoExtraAlignH; align_v: CampoExtraAlignV } {
  return {
    align_h: col === 0 ? "esquerda" : col === 1 ? "centro" : "direita",
    align_v: row === 0 ? "topo" : row === 1 ? "meio" : "base",
  };
}

export function alignParaCelula(
  align_h: CampoExtraAlignH,
  align_v: CampoExtraAlignV,
): { row: 0 | 1 | 2; col: 0 | 1 | 2 } {
  return {
    col: align_h === "esquerda" ? 0 : align_h === "centro" ? 1 : 2,
    row: align_v === "topo" ? 0 : align_v === "meio" ? 1 : 2,
  };
}

/**
 * Converte a área relativa da região (hitbox) no ponto âncora 3×3 em pt.
 * O backend grava ``x_pt``/``y_pt`` como âncora (não canto superior-esquerdo).
 */
export function ancoraPtDeAreaFrac(
  area: [number, number, number, number],
  pageW: number,
  pageH: number,
  align_h: CampoExtraAlignH = "esquerda",
  align_v: CampoExtraAlignV = "topo",
): { x_pt: number; y_pt: number } {
  const [x0, y0, x1, y1] = area;
  const left = x0 * pageW;
  const right = x1 * pageW;
  const top = y0 * pageH;
  const bottom = y1 * pageH;
  const x_pt =
    align_h === "direita" ? right : align_h === "centro" ? (left + right) / 2 : left;
  const y_pt =
    align_v === "base" ? bottom : align_v === "meio" ? (top + bottom) / 2 : top;
  return { x_pt, y_pt };
}

/** Segmentos consecutivos com flag de negrito (para preview tipográfico). */
export function segmentosComNegrito(
  texto: string,
  ranges: Array<[number, number]>,
): Array<{ texto: string; negrito: boolean }> {
  if (!texto) return [];
  const marks = new Array<boolean>(texto.length).fill(false);
  for (const [a, b] of ranges) {
    const x = Math.max(0, Math.min(texto.length, a));
    const y = Math.max(0, Math.min(texto.length, b));
    for (let i = x; i < y; i++) marks[i] = true;
  }
  const out: Array<{ texto: string; negrito: boolean }> = [];
  let i = 0;
  while (i < texto.length) {
    const flag = marks[i] ?? false;
    let j = i + 1;
    while (j < texto.length && (marks[j] ?? false) === flag) j += 1;
    out.push({ texto: texto.slice(i, j), negrito: flag });
    i = j;
  }
  return out;
}

/**
 * True quando o intervalo [start, end) está inteiro em negrito.
 * Com cursor (start === end), olha o caractere à esquerda (ou o da posição).
 */
export function selecaoEstaEmNegrito(
  ranges: Array<[number, number]>,
  start: number,
  end: number,
  textoLen: number,
): boolean {
  if (textoLen <= 0) return false;
  if (end <= start) {
    const i = Math.min(textoLen - 1, Math.max(0, start > 0 ? start - 1 : 0));
    return ranges.some(([a, b]) => i >= a && i < b);
  }
  const a = Math.max(0, Math.min(textoLen, start));
  const b = Math.max(0, Math.min(textoLen, end));
  if (b <= a) return false;
  let coberto = 0;
  for (const [x, y] of ranges) {
    coberto += Math.max(0, Math.min(y, b) - Math.max(x, a));
  }
  return coberto >= b - a;
}

/** Une intervalos de negrito e aplica/remove no range [start, end). */
export function toggleNegritoRange(
  ranges: Array<[number, number]>,
  start: number,
  end: number,
  textoLen: number,
): Array<[number, number]> {
  const a = Math.max(0, Math.min(textoLen, Math.floor(start)));
  const b = Math.max(0, Math.min(textoLen, Math.floor(end)));
  if (b <= a) return ranges;
  // Cobertura atual do intervalo
  let coberto = 0;
  for (const [x, y] of ranges) {
    coberto += Math.max(0, Math.min(y, b) - Math.max(x, a));
  }
  const marcar = coberto < b - a;
  const pontos: Array<{ p: number; d: number }> = [];
  for (const [x, y] of ranges) {
    pontos.push({ p: x, d: 1 }, { p: y, d: -1 });
  }
  if (marcar) {
    pontos.push({ p: a, d: 1 }, { p: b, d: -1 });
  } else {
    // Remove cobrindo: split — marca tudo, depois desmarca [a,b)
    // Mais simples: rebuild sem [a,b)
    const next: Array<[number, number]> = [];
    for (const [x, y] of ranges) {
      if (y <= a || x >= b) {
        next.push([x, y]);
        continue;
      }
      if (x < a) next.push([x, a]);
      if (y > b) next.push([b, y]);
    }
    return next.filter(([x, y]) => y > x);
  }
  pontos.sort((u, v) => u.p - v.p || u.d - v.d);
  const merged: Array<[number, number]> = [];
  let depth = 0;
  let startAt: number | null = null;
  for (const { p, d } of pontos) {
    const prev = depth;
    depth += d;
    if (prev === 0 && depth > 0) startAt = p;
    if (prev > 0 && depth === 0 && startAt != null) {
      merged.push([startAt, p]);
      startAt = null;
    }
  }
  return merged.filter(([x, y]) => y > x);
}
