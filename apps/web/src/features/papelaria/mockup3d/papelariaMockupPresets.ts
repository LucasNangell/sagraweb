import type { MockupConfig, MockupPreset } from "./types";

/** Arte de demonstração (SVG) quando só há PDF ou nenhuma imagem raster */
export const MOCKUP_DEMO_ARTE_URL =
  "data:image/svg+xml," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="l" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e3a5f"/>
      <stop offset="100%" stop-color="#3d7ab8"/>
    </linearGradient>
    <linearGradient id="r" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#l)"/>
  <rect x="600" width="600" height="800" fill="url(#r)"/>
  <line x1="600" y1="0" x2="600" y2="800" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8 6"/>
  <text x="300" y="400" fill="#fff" font-family="Arial,sans-serif" font-size="42" text-anchor="middle" font-weight="bold">CAPA</text>
  <text x="900" y="380" fill="#334155" font-family="Arial,sans-serif" font-size="36" text-anchor="middle" font-weight="bold">INTERIOR</text>
  <text x="900" y="430" fill="#64748b" font-family="Arial,sans-serif" font-size="20" text-anchor="middle">Arte aberta — preview</text>
</svg>`);

export const PAPELARIA_MOCKUP_PRESETS = {
  cartao_simples_90x50: {
    id: "cartao_simples_90x50",
    nome: "Cartão simples 90×50 mm",
    config: {
      tipo: "cartao_simples",
      larguraAbertaMm: 90,
      alturaAbertaMm: 50,
      larguraFechadaMm: 90,
      alturaFechadaMm: 50,
      orientacao: "paisagem",
      faces: [
        {
          id: "verso",
          nome: "Verso",
          crop: { x: 0, y: 0, width: 100, height: 100 },
          transform: { translateZ: -0.4 },
          zIndex: 1,
        },
        {
          id: "frente",
          nome: "Frente",
          crop: { x: 0, y: 0, width: 100, height: 100 },
          transform: { translateZ: 0.4 },
          zIndex: 2,
        },
        {
          id: "lateral",
          nome: "Lombada",
          crop: { x: 0, y: 0, width: 100, height: 100 },
          transform: {
            rotateY: 90,
            translateZ: 0.4,
            origin: "left center",
          },
          espessuraMm: 0.8,
          zIndex: 0,
        },
      ],
    } satisfies MockupConfig,
  },

  timbrado_a4: {
    id: "timbrado_a4",
    nome: "Timbrado A4",
    config: {
      tipo: "folha",
      larguraAbertaMm: 210,
      alturaAbertaMm: 297,
      larguraFechadaMm: 210,
      alturaFechadaMm: 297,
      orientacao: "retrato",
      faces: [
        {
          id: "frente",
          nome: "Frente",
          crop: { x: 0, y: 0, width: 100, height: 100 },
          transform: { rotateX: 2, translateZ: 0.3 },
          zIndex: 2,
        },
        {
          id: "sombra",
          nome: "Sombra",
          crop: { x: 0, y: 0, width: 100, height: 100 },
          transform: { translateZ: -0.5, rotateX: 2 },
          zIndex: 0,
        },
      ],
    } satisfies MockupConfig,
  },

  cartao_a6_retrato_dobrado: {
    id: "cartao_a6_retrato_dobrado",
    nome: "Cartão A6 retrato dobrado (A5 aberto)",
    config: {
      tipo: "cartao_dobrado",
      larguraAbertaMm: 210,
      alturaAbertaMm: 148,
      larguraFechadaMm: 105,
      alturaFechadaMm: 148,
      orientacao: "paisagem",
      dobras: [{ eixo: "vertical", posicao: 50, angulo: 28 }],
      faces: [
        {
          id: "interior",
          nome: "Interior",
          crop: { x: 50, y: 0, width: 50, height: 100 },
          transform: { translateZ: -0.2 },
          zIndex: 1,
        },
        {
          id: "sombra_dobra",
          nome: "Sombra dobra",
          crop: { x: 48, y: 0, width: 4, height: 100 },
          transform: { translateZ: 0.1 },
          zIndex: 2,
        },
        {
          id: "capa",
          nome: "Capa",
          crop: { x: 0, y: 0, width: 50, height: 100 },
          transform: {
            rotateY: 28,
            origin: "right center",
            translateZ: 0.6,
          },
          abreComDobra: true,
          zIndex: 3,
        },
        {
          id: "lombada",
          nome: "Lombada",
          crop: { x: 49, y: 0, width: 2, height: 100 },
          transform: {
            rotateY: 90,
            origin: "left center",
            translateZ: 0,
          },
          espessuraMm: 0.6,
          zIndex: 4,
        },
      ],
    } satisfies MockupConfig,
  },

  folder_2_dobras: {
    id: "folder_2_dobras",
    nome: "Folder — 2 dobras",
    config: {
      tipo: "folder",
      larguraAbertaMm: 297,
      alturaAbertaMm: 210,
      larguraFechadaMm: 99,
      alturaFechadaMm: 210,
      orientacao: "paisagem",
      dobras: [
        { eixo: "vertical", posicao: 33.33, angulo: 35 },
        { eixo: "vertical", posicao: 66.66, angulo: 35 },
      ],
      faces: [
        {
          id: "painel_esq",
          nome: "Painel esquerdo",
          crop: { x: 0, y: 0, width: 33.33, height: 100 },
          transform: { translateZ: -0.3 },
          zIndex: 1,
        },
        {
          id: "painel_centro",
          nome: "Painel central",
          crop: { x: 33.33, y: 0, width: 33.34, height: 100 },
          transform: { rotateY: 35, origin: "left center", translateZ: 0.2 },
          abreComDobra: true,
          zIndex: 2,
        },
        {
          id: "painel_dir",
          nome: "Painel direito",
          crop: { x: 66.66, y: 0, width: 33.34, height: 100 },
          transform: { rotateY: 35, origin: "left center", translateZ: 0.5 },
          abreComDobra: true,
          zIndex: 3,
        },
      ],
    } satisfies MockupConfig,
  },

  pasta_com_bolso: {
    id: "pasta_com_bolso",
    nome: "Pasta com bolso",
    config: {
      tipo: "pasta",
      larguraAbertaMm: 220,
      alturaAbertaMm: 310,
      larguraFechadaMm: 220,
      alturaFechadaMm: 310,
      orientacao: "retrato",
      faces: [
        {
          id: "base",
          nome: "Base",
          crop: { x: 0, y: 0, width: 100, height: 72 },
          transform: { translateZ: 0 },
          zIndex: 1,
        },
        {
          id: "bolso",
          nome: "Bolso",
          crop: { x: 5, y: 72, width: 90, height: 28 },
          transform: { rotateX: -55, origin: "top center", translateZ: 1.2 },
          abreComDobra: true,
          zIndex: 3,
        },
        {
          id: "tampa",
          nome: "Tampa",
          crop: { x: 0, y: 0, width: 100, height: 72 },
          transform: { rotateX: -12, origin: "bottom center", translateZ: 2 },
          abreComDobra: true,
          zIndex: 4,
        },
      ],
      dobras: [{ eixo: "horizontal", posicao: 72, angulo: 55 }],
    } satisfies MockupConfig,
  },
} as const satisfies Record<string, MockupPreset>;

export type PapelariaMockupPresetId = keyof typeof PAPELARIA_MOCKUP_PRESETS;

/** Resolve preset por nome de produto OS (heurística até MockupConfigJson no banco) */
export function resolveMockupPresetByProduto(
  produto: string,
): MockupPreset | null {
  const p = produto.toLowerCase();
  if (p.includes("a6") || p.includes("dobrado") || p.includes("duplo")) {
    return PAPELARIA_MOCKUP_PRESETS.cartao_a6_retrato_dobrado;
  }
  if (p.includes("timbrado") || p.includes("bloco")) {
    return PAPELARIA_MOCKUP_PRESETS.timbrado_a4;
  }
  if (p.includes("folder")) {
    return PAPELARIA_MOCKUP_PRESETS.folder_2_dobras;
  }
  if (p.includes("pasta")) {
    return PAPELARIA_MOCKUP_PRESETS.pasta_com_bolso;
  }
  if (p.includes("visita") || p.includes("cartão") || p.includes("cartao")) {
    return PAPELARIA_MOCKUP_PRESETS.cartao_simples_90x50;
  }
  return null;
}
