import type {
  PapelariaMockupBolsoConfig,
  PapelariaMockupConfig,
  PapelariaMockupFaceConfig,
} from "./types";

/**
 * Bolso interno da Pasta Avulso c/ Bolso (faca do bolso, `interna.pdf`):
 * painel interno da direita, 220 × 320 mm. Coordenadas em % do painel.
 * Boca curva subindo da esquerda para a direita, lateral reta a 95,5 %
 * (aba de cola fora do bolso) e duas fendas a 45° para o cartão de visita.
 */
export const BOLSO_PASTA_AVULSO: PapelariaMockupBolsoConfig = {
  contorno: "M 0 100 L 2.16 94.48 C 27.81 78.13 60.1 67.61 95.46 65.63 L 95.46 100 Z",
  boca: "M 0 100 L 2.16 94.48 C 27.81 78.13 60.1 67.61 95.46 65.63",
  cortes: [
    [75.32, 77.65, 84.64, 84.06],
    [43.46, 87.63, 52.77, 94.04],
  ],
  larguraMm: 220,
  alturaMm: 320,
  cartao: { larguraMm: 90, alturaMm: 50, texto: "Cartão de Visita" },
};

type Ponto = [number, number];

/** Posição do cartão encaixado: centro e rotação (graus), em mm da face. */
export type EncaixeCartao = {
  cx: number;
  cy: number;
  rotacaoGraus: number;
  largura: number;
  altura: number;
  /** Fendas em mm e a direção (unitária) para o lado do canto escondido. */
  fendas: Array<{ a: Ponto; b: Ponto; canto: Ponto }>;
};

/**
 * Encaixa um cartão L × A nas duas fendas: o canto inferior esquerdo entra na
 * fenda de baixo e o superior direito na de cima, o mesmo tanto em cada uma.
 * Resolve |(A − B) − 2t·n| = diagonal do cartão (n = normal da fenda, para
 * fora do cartão) e gira o cartão para a diagonal coincidir.
 */
export function encaixarCartao(
  cortesMm: Array<[number, number, number, number]>,
  largura: number,
  altura: number,
): EncaixeCartao | null {
  if (cortesMm.length < 2 || !(largura > 0) || !(altura > 0)) return null;
  const meio = (c: [number, number, number, number]): Ponto => [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2];
  const ordenados = [...cortesMm].sort((p, q) => meio(p)[1] - meio(q)[1]);
  const cima = ordenados[0]!;
  const baixo = ordenados[ordenados.length - 1]!;
  const A = meio(cima);
  const B = meio(baixo);
  const dx = baixo[2] - baixo[0];
  const dy = baixo[3] - baixo[1];
  const len = Math.hypot(dx, dy);
  if (!len) return null;
  // Normal da fenda de baixo apontando para baixo/esquerda (canto do cartão).
  let n: Ponto = [-dy / len, dx / len];
  if (n[0] > 0 || (n[0] === 0 && n[1] < 0)) n = [-n[0], -n[1]];
  const ax = A[0] - B[0];
  const ay = A[1] - B[1];
  const diag = Math.hypot(largura, altura);
  const a = 4 * (n[0] ** 2 + n[1] ** 2);
  const b = -4 * (ax * n[0] + ay * n[1]);
  const c = ax * ax + ay * ay - diag * diag;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b + Math.sqrt(disc)) / (2 * a);
  const bl: Ponto = [B[0] + t * n[0], B[1] + t * n[1]];
  const tr: Ponto = [A[0] - t * n[0], A[1] - t * n[1]];
  const rot = Math.atan2(tr[1] - bl[1], tr[0] - bl[0]) - Math.atan2(-altura, largura);
  return {
    cx: (bl[0] + tr[0]) / 2,
    cy: (bl[1] + tr[1]) / 2,
    rotacaoGraus: (rot * 180) / Math.PI,
    largura,
    altura,
    fendas: [
      { a: [baixo[0], baixo[1]], b: [baixo[2], baixo[3]], canto: n },
      { a: [cima[0], cima[1]], b: [cima[2], cima[3]], canto: [-n[0], -n[1]] },
    ],
  };
}

const BOLSOS_PADRAO: Record<string, PapelariaMockupBolsoConfig> = {
  pasta_avulso: BOLSO_PASTA_AVULSO,
};

/** Bolso a desenhar na face (`"pasta_avulso"`, objeto próprio ou nenhum). */
export function resolverBolso(
  face: Pick<PapelariaMockupFaceConfig, "bolso">,
): PapelariaMockupBolsoConfig | null {
  const b = face.bolso;
  if (!b) return null;
  if (typeof b === "string") return BOLSOS_PADRAO[b] ?? null;
  return typeof b.contorno === "string" && b.contorno.trim() ? b : null;
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Produto com bolso: «c/ Bolso», «com bolso» (e não «s/ Bolso», «sem bolso»). */
export function produtoTemBolso(produto?: string | null): boolean {
  const p = semAcento(produto ?? "");
  if (!p.includes("pasta")) return false;
  if (/\b(s\/|sem)\s*bolso/.test(p)) return false;
  return /(c\/|com)\s*bolso/.test(p);
}

/** Face interna (a que aparece quando a capa abre). */
function faceInterna(faces: PapelariaMockupFaceConfig[]): PapelariaMockupFaceConfig | undefined {
  return (
    faces.find((f) => f.className?.includes("mockup-face--back")) ??
    faces.find((f) => f.id === "interior" || f.id === "interna" || f.id === "base") ??
    faces
      .filter((f) => !f.abreComDobra && !f.espessuraMm)
      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))[0]
  );
}

/**
 * Pasta com bolso sem bolso configurado: desenha o bolso padrão na face
 * interna. Configuração explícita (`"bolso": false` ou outro bolso) vence;
 * o preset antigo com face recortada «bolso» fica como está.
 */
export function aplicarBolsoPadrao(
  config: PapelariaMockupConfig,
  produto?: string | null,
): PapelariaMockupConfig {
  if (!produtoTemBolso(produto)) return config;
  if (config.faces.some((f) => f.bolso !== undefined || f.id === "bolso")) return config;
  const alvo = faceInterna(config.faces);
  if (!alvo) return config;
  return {
    ...config,
    faces: config.faces.map((f) => (f === alvo ? { ...f, bolso: "pasta_avulso" } : f)),
  };
}
