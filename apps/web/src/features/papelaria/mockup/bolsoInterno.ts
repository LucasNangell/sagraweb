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
};

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
