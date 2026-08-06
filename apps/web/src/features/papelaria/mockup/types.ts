/**
 * Configuração de mockup 3D da Papelaria.
 * Futuro: carregar de `tabPapelariaModelos.MockupConfigJson` (JSON compatível com este tipo).
 */

export type PapelariaMockupModo =
  | "folha_simples"
  | "cartao_simples"
  | "cartao_dobrado"
  | "folder"
  | "pasta"
  | "bloco";

export type PapelariaMockupOrientacao = "retrato" | "paisagem";

export type PapelariaMockupModoVisualizacao =
  | "perspectiva_esquerda"
  | "perspectiva_direita"
  | "frontal_leve";

export type PapelariaMockupCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PapelariaMockupFaceStyle3d = {
  widthMm?: number;
  heightMm?: number;
  leftMm?: number;
  topMm?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  translateX?: number;
  translateY?: number;
  translateZ?: number;
  transformOrigin?: string;
  /** Graus extras no hover (substitui rotateX/Y quando definido) */
  rotateXHover?: number;
  rotateYHover?: number;
};

export type PapelariaMockupFaceConfig = {
  id: string;
  nome: string;
  /** Índice 0-based na lista de PNGs do PDF */
  pageIndex: number;
  crop?: PapelariaMockupCrop;
  className?: string;
  style3d: PapelariaMockupFaceStyle3d;
  zIndex?: number;
  /** Face abre mais no hover (dobra) */
  abreComDobra?: boolean;
  espessuraMm?: number;
  sombra?: boolean;
  lombada?: boolean;
};

export type PapelariaMockupDobraConfig = {
  eixo: "vertical" | "horizontal";
  posicaoPercent: number;
  angulo?: number;
};

export type PapelariaMockupCenaConfig = {
  rotateX?: number;
  rotateY?: number;
  rotateXHover?: number;
  rotateYHover?: number;
  perspective?: number;
  perspectiveOrigin?: string;
  escalaBase?: number;
};

export type PapelariaMockupVincoConfig = {
  lado: "esquerdo" | "direito" | "topo" | "base";
  larguraPx?: number;
};

export type PapelariaMockupConfig = {
  id: string;
  nome: string;
  produtoMatch?: string[];
  arquivoModeloMatch?: string[];
  larguraAbertaMm: number;
  alturaAbertaMm: number;
  larguraFechadaMm?: number;
  alturaFechadaMm?: number;
  orientacao: PapelariaMockupOrientacao;
  modo: PapelariaMockupModo;
  modoVisualizacao?: PapelariaMockupModoVisualizacao;
  faces: PapelariaMockupFaceConfig[];
  dobras?: PapelariaMockupDobraConfig[];
  cena?: PapelariaMockupCenaConfig;
  vinco?: PapelariaMockupVincoConfig;
  /** Abertura inicial da dobra (0–1) quando há faces com abreComDobra */
  aberturaInicial?: number;
  /** Máximo de páginas PNG usadas pelo preset */
  maxPaginas?: number;
  isFallback?: boolean;
};

export type PapelariaMockupResolveInput = {
  produto?: string;
  arquivoModelo?: string;
  frenteVerso?: string;
  cores?: string;
  pageCount?: number;
  /** JSON salvo em tabPapelariaModelos.MockupConfigJson */
  mockupConfigJson?: string | null;
};

export type PapelariaMockupResolveResult = {
  config: PapelariaMockupConfig;
  isFallback: boolean;
};
