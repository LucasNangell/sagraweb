/** Configuração de mockup 3D — futuro: MockupConfigJson em tabPapelariaModelos */

export type MockupTipo =
  | "folha"
  | "cartao_dobrado"
  | "folder"
  | "pasta"
  | "cartao_simples";

export type MockupOrientacao = "retrato" | "paisagem";

export type MockupFaceCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MockupFaceTransform = {
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  translateX?: number;
  translateY?: number;
  translateZ?: number;
  origin?: string;
};

export type MockupFaceConfig = {
  id: string;
  nome: string;
  crop: MockupFaceCrop;
  transform: MockupFaceTransform;
  zIndex?: number;
  /** Se true, rotateY da face é modulado pelo controle de abertura/dobra */
  abreComDobra?: boolean;
  /** Espessura visual (face lateral da folha), em mm */
  espessuraMm?: number;
};

export type MockupDobraConfig = {
  eixo: "vertical" | "horizontal";
  /** Posição da dobra na arte aberta (0–100 %) */
  posicao: number;
  /** Ângulo máximo de abertura em graus */
  angulo?: number;
};

export type MockupConfig = {
  tipo: MockupTipo;
  larguraAbertaMm: number;
  alturaAbertaMm: number;
  larguraFechadaMm?: number;
  alturaFechadaMm?: number;
  orientacao: MockupOrientacao;
  faces: MockupFaceConfig[];
  dobras?: MockupDobraConfig[];
};

export type MockupPreset = {
  id: string;
  nome: string;
  config: MockupConfig;
};
