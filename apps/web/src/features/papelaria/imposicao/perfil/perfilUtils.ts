import type {
  Face,
  PerfilImposicao,
  PerfilSlot,
  Rotacao,
  SlotResolvido,
} from "./types";

/** Tamanhos de papel comuns (não são regras de produto). */
export const FOLHA_PRESETS: Array<{ id: string; label: string; largura: number; altura: number }> = [
  { id: "a4", label: "A4 (210 × 297)", largura: 210, altura: 297 },
  { id: "a3", label: "A3 (297 × 420)", largura: 297, altura: 420 },
  { id: "sra3", label: "SRA3 (320 × 450)", largura: 320, altura: 450 },
  { id: "330x480", label: "330 × 480", largura: 330, altura: 480 },
  { id: "660x480", label: "660 × 480", largura: 660, altura: 480 },
];

export const ROTACOES: Rotacao[] = [0, 90, 180, 270];

export function perfilVazio(): PerfilImposicao {
  return {
    versao: 2,
    folha: { largura_mm: null, altura_mm: null },
    pagina: { fonte: "fixa", largura_mm: null, altura_mm: null },
    sangria_mm: 0,
    faces: "frente",
    paginas_faltantes: "adaptar",
    posicionamento: "grade",
    grade: {
      colunas: 1,
      linhas: 1,
      espaco_h_mm: 0,
      espaco_v_mm: 0,
      alinhamento: "centro",
    },
    slots: { frente: [], verso: [] },
    marcas: { ativo: false, arquivo: null, nome_original: null, pdf_path: null, carimbar_op: false },
    arte: { fonte: "base_sefoc", rotacao: "no_jdf" },
    juntada: {
      ativo: false,
      situacao_candidatas: null,
      produtos_compativeis: [],
      regra_tiragem: "iguais",
      max_os: null,
      preencher_todos_slots: false,
    },
    saida: { destino_pdf: "digital", jdf_hotfolder: null },
  };
}

export function clonePerfil(perfil: PerfilImposicao): PerfilImposicao {
  return JSON.parse(JSON.stringify(perfil)) as PerfilImposicao;
}

export function perfilSnapshot(perfil: PerfilImposicao | null | undefined): string {
  return perfil ? JSON.stringify(perfil) : "";
}

function positive(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export function folhaMm(perfil: PerfilImposicao): { w: number; h: number } | null {
  const { largura_mm: w, altura_mm: h } = perfil.folha;
  return positive(w) && positive(h) ? { w, h } : null;
}

export function paginaMm(perfil: PerfilImposicao): { w: number; h: number } | null {
  if (perfil.pagina.fonte !== "fixa") return null;
  const { largura_mm: w, altura_mm: h } = perfil.pagina;
  return positive(w) && positive(h) ? { w, h } : null;
}

export function footprintMm(
  pageW: number,
  pageH: number,
  rotacao: number,
): { w: number; h: number } {
  return rotacao % 180 === 90 ? { w: pageH, h: pageW } : { w: pageW, h: pageH };
}

/**
 * Canto inferior esquerdo da célula (mesma conta do gerador de JDF,
 * `compute_cell_origin_mm`, que usa o tamanho da página sem rotação).
 */
function gradeCellOriginLl(
  perfil: PerfilImposicao,
  page: { w: number; h: number },
  col: number,
  row: number,
): { x: number; y: number } {
  const folha = folhaMm(perfil) ?? { w: 0, h: 0 };
  const { colunas, linhas, espaco_h_mm: gh, espaco_v_mm: gv, alinhamento } = perfil.grade;
  const totalW = colunas * page.w + Math.max(0, colunas - 1) * gh;
  const totalH = linhas * page.h + Math.max(0, linhas - 1) * gv;
  let ox = 0;
  let oy = Math.max(0, folha.h - totalH);
  if (alinhamento === "centro") {
    ox = Math.max(0, (folha.w - totalW) / 2);
    oy = Math.max(0, (folha.h - totalH) / 2);
  }
  return {
    x: ox + col * (page.w + gh),
    y: oy + (linhas - 1 - row) * (page.h + gv),
  };
}

/**
 * Slots com posição resolvida no sistema da tela. `pageEstimate` é usado
 * quando a página vem do PDF (só para desenhar o preview).
 */
export function resolverSlots(
  perfil: PerfilImposicao,
  face: Face = "frente",
  pageEstimate?: { w: number; h: number } | null,
): SlotResolvido[] {
  const folha = folhaMm(perfil);
  const page = paginaMm(perfil) ?? pageEstimate ?? null;
  if (!folha || !page) return [];
  const out: SlotResolvido[] = [];
  for (const slot of perfil.slots[face] ?? []) {
    const rot = (slot.rotacao ?? 0) as Rotacao;
    const fp = footprintMm(page.w, page.h, rot);
    let x: number;
    let y: number;
    if (perfil.posicionamento === "grade") {
      if (slot.col == null || slot.row == null) continue;
      const ll = gradeCellOriginLl(perfil, page, slot.col, slot.row);
      x = ll.x;
      y = folha.h - ll.y - fp.h;
    } else {
      if (slot.x_mm == null || slot.y_mm == null) continue;
      // X/Y manuais = centro da página.
      x = slot.x_mm - fp.w / 2;
      y = slot.y_mm - fp.h / 2;
    }
    out.push({
      id: slot.id,
      pagina: slot.pagina,
      rotacao: rot,
      x_mm: x,
      y_mm: y,
      cx_mm: x + fp.w / 2,
      cy_mm: y + fp.h / 2,
      largura_mm: fp.w,
      altura_mm: fp.h,
    });
  }
  return out;
}

/** Estimativa de página quando o tamanho vem do PDF (preenche a grade). */
export function estimarPaginaPelaGrade(perfil: PerfilImposicao): { w: number; h: number } | null {
  const folha = folhaMm(perfil);
  if (!folha) return null;
  const { colunas, linhas, espaco_h_mm: gh, espaco_v_mm: gv } = perfil.grade;
  const w = (folha.w - Math.max(0, colunas - 1) * gh) / Math.max(1, colunas);
  const h = (folha.h - Math.max(0, linhas - 1) * gv) / Math.max(1, linhas);
  return w > 0 && h > 0 ? { w, h } : null;
}

export function gerarSlotsPelaGrade(perfil: PerfilImposicao, pagina = 1): PerfilSlot[] {
  const out: PerfilSlot[] = [];
  let id = 1;
  for (let row = 0; row < perfil.grade.linhas; row += 1) {
    for (let col = 0; col < perfil.grade.colunas; col += 1) {
      out.push({ id, col, row, pagina, rotacao: 0 });
      id += 1;
    }
  }
  return out;
}

/**
 * Converte Y entre o sistema gravado (origem no topo da folha, Y para baixo)
 * e o que o usuário vê/digita (origem no canto INFERIOR esquerdo, Y para
 * cima). A função é a própria inversa. Só a tela usa o Y de baixo; o perfil
 * salvo e o JDF não mudam.
 */
export function yUsuario(y: number, folhaAltura: number): number {
  return arredondarMm(folhaAltura - y);
}

/** Arredonda para 0,01 mm (evita 69.49999999). */
export function arredondarMm(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Passa o perfil para posicionamento manual preservando as posições atuais
 * (cada slot recebe o centro que a grade calculava).
 */
export function converterParaManual(perfil: PerfilImposicao): PerfilImposicao {
  if (perfil.posicionamento === "manual") return perfil;
  const next = clonePerfil(perfil);
  for (const face of ["frente", "verso"] as const) {
    const resolved = new Map(resolverSlots(perfil, face).map((s) => [s.id, s]));
    next.slots[face] = perfil.slots[face].map((slot) => {
      const pos = resolved.get(slot.id);
      return {
        ...slot,
        x_mm: pos ? arredondarMm(pos.cx_mm) : 0,
        y_mm: pos ? arredondarMm(pos.cy_mm) : 0,
      };
    });
  }
  next.posicionamento = "manual";
  return next;
}

export function proximoSlotId(slots: PerfilSlot[]): number {
  return slots.reduce((max, s) => Math.max(max, s.id), 0) + 1;
}

export function resumoPerfil(perfil: PerfilImposicao | null | undefined): string | null {
  if (!perfil) return null;
  const parts: string[] = [];
  const folha = folhaMm(perfil);
  if (folha) parts.push(`${formatMm(folha.w)}×${formatMm(folha.h)} mm`);
  const n = perfil.slots.frente.length;
  if (perfil.faces === "frente_verso") {
    parts.push(`${n}+${perfil.slots.verso.length} slots (frente e verso)`);
  } else {
    parts.push(`${n} slot${n === 1 ? "" : "s"}`);
  }
  if (perfil.marcas.ativo) parts.push("marcas ✓");
  if (perfil.arte.fonte === "pre_impresso") parts.push("pré-impresso");
  if (perfil.juntada.ativo) parts.push("juntada");
  return parts.join(" · ");
}

export function formatMm(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

type ProblemaSlot = "fora" | "sobrepoe";

/** Checagem local e imediata (o servidor faz a validação completa). */
export function problemasDeSlots(
  perfil: PerfilImposicao,
  face: Face,
  pageEstimate?: { w: number; h: number } | null,
): Map<number, ProblemaSlot> {
  const out = new Map<number, ProblemaSlot>();
  const folha = folhaMm(perfil);
  if (!folha) return out;
  const slots = resolverSlots(perfil, face, pageEstimate);
  const s = perfil.sangria_mm || 0;
  const eps = 0.01;
  for (const slot of slots) {
    if (
      slot.x_mm - s < -eps ||
      slot.y_mm - s < -eps ||
      slot.x_mm + slot.largura_mm + s > folha.w + eps ||
      slot.y_mm + slot.altura_mm + s > folha.h + eps
    ) {
      out.set(slot.id, "fora");
    }
  }
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      const a = slots[i]!;
      const b = slots[j]!;
      const overlap =
        a.x_mm < b.x_mm + b.largura_mm - eps &&
        b.x_mm < a.x_mm + a.largura_mm - eps &&
        a.y_mm < b.y_mm + b.altura_mm - eps &&
        b.y_mm < a.y_mm + a.altura_mm - eps;
      if (overlap) {
        if (!out.has(a.id)) out.set(a.id, "sobrepoe");
        if (!out.has(b.id)) out.set(b.id, "sobrepoe");
      }
    }
  }
  return out;
}

/** Lê um JSON colado/importado; aceita só perfis v2. */
export function parsePerfilJson(text: string): PerfilImposicao {
  const data = JSON.parse(text) as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("O arquivo não contém um perfil de imposição.");
  }
  const obj = data as Record<string, unknown>;
  if (obj["versao"] !== 2) {
    throw new Error("Perfil de imposição deve ter versao = 2.");
  }
  const base = perfilVazio();
  const merged = {
    ...base,
    ...obj,
    folha: { ...base.folha, ...(obj["folha"] as object) },
    pagina: { ...base.pagina, ...(obj["pagina"] as object) },
    grade: { ...base.grade, ...(obj["grade"] as object) },
    slots: { ...base.slots, ...(obj["slots"] as object) },
    marcas: { ...base.marcas, ...(obj["marcas"] as object) },
    arte: { ...base.arte, ...(obj["arte"] as object) },
    juntada: { ...base.juntada, ...(obj["juntada"] as object) },
    saida: { ...base.saida, ...(obj["saida"] as object) },
  } as PerfilImposicao;
  return merged;
}

export const REGRA_TIRAGEM_INFO: Record<
  PerfilImposicao["juntada"]["regra_tiragem"],
  { label: string; descricao: string; exemplo: string }
> = {
  iguais: {
    label: "Tiragens iguais",
    descricao: "Todas as OSs precisam ter a mesma tiragem; cada uma ocupa 1 slot.",
    exemplo: "2 OSs de 500 → 1 slot cada, 500 folhas.",
  },
  proporcional_mdc: {
    label: "Proporcional à tiragem",
    descricao:
      "Cada OS ocupa slots proporcionais à tiragem; as folhas são o MDC das tiragens.",
    exemplo: "OSs de 500 e 1000 → 1 + 2 slots, 500 folhas.",
  },
  livre: {
    label: "Livre",
    descricao: "Cada OS ocupa 1 slot; as folhas são a maior tiragem (sobra nas menores).",
    exemplo: "OSs de 300 e 500 → 1 slot cada, 500 folhas.",
  },
};
