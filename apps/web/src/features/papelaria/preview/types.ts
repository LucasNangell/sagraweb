export type PapelariaPreviewTextAlign = "left" | "center" | "right";
export type PapelariaPreviewTextAnchor = "start" | "middle" | "end";

export type PreviewPositionSlotId =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/** Template pré-configurado no admin — não altera o .cdr original até a geração da prova. */
export type PapelariaPreviewDynamicFieldTemplate = {
  id?: string;
  variavel: string;
  label?: string;
  tipo?: "text" | "email" | "textarea";
  template?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  align?: PapelariaPreviewTextAlign;
  width?: number;
  height?: number;
  /** Posições onde o usuário pode colocar o campo na prévia (multiselect). */
  posicoesPermitidas?: PreviewPositionSlotId[];
  /** @deprecated use posicoesPermitidas */
  posicaoSlot?: PreviewPositionSlotId;
  grupo?: string;
  required?: boolean;
};

/** Posicionamento escolhido pelo usuário ao criar a prova. */
export type ActiveDynamicFieldPlacement = {
  templateId: string;
  faceId: string;
  posicaoSlot: PreviewPositionSlotId;
};

export type PapelariaPreviewTextElement = {
  id: string;
  tipo: "texto";
  template: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily?: string;
  fontSize: number;
  fontWeight?: number | string;
  fontStyle?: string;
  color?: string;
  align?: PapelariaPreviewTextAlign;
  anchor?: PapelariaPreviewTextAnchor;
  lineHeight?: number;
  letterSpacing?: number;
  posicaoSlot?: PreviewPositionSlotId;
  grupo?: string;
  /** Marca elemento inserido via template dinâmico na criação da prova */
  dinamico?: boolean;
};

export type PapelariaPreviewFace = {
  id: string;
  nome?: string;
  baseImage: string;
  pageIndex?: number;
  elementos: PapelariaPreviewTextElement[];
};

export type PapelariaPreviewConfig = {
  canvas: {
    width: number;
    height: number;
  };
  faces: PapelariaPreviewFace[];
  habilitarCamposDinamicos?: boolean;
  camposDinamicos?: PapelariaPreviewDynamicFieldTemplate[];
  gruposCampos?: Record<string, string[]>;
  /** Rótulos de campos gerados a partir de objetos Corel sem `{variavel}`. */
  campoLabels?: Record<string, string>;
};

export type PapelariaPreviewFaceMeta = {
  id: string;
  nome?: string;
  baseImage?: string;
  hasBaseImage?: boolean;
  url: string;
};

export const CAMPOS_DINAMICOS_LAYOUT_KEY = "__campos_dinamicos_layout";
