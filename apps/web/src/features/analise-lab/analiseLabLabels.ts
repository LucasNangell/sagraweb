import type {
  AnaliseLabEdge,
  AnaliseLabMarkCor,
  AnaliseLabMarkTipo,
} from "@/api/analiseLab";

export const EDGE_LABELS: Record<string, string> = {
  top: "Superior",
  right: "Direita",
  bottom: "Inferior",
  left: "Esquerda",
  all: "Todas as bordas",
};

export const COLOR_LABELS: Record<string, string> = {
  red: "Vermelho",
  orange: "Laranja",
  yellow: "Amarelo",
  green: "Verde",
  blue: "Azul",
  purple: "Roxo",
  black: "Preto",
  white: "Branco",
};

export const TIPO_LABELS: Record<string, string> = {
  offset_corte: "Offset de corte",
  faixa: "Faixa",
  sangria: "Sangria",
  retangulo: "Retângulo",
  ponto: "Ponto",
  medida: "Medida",
  grade: "Grade",
  seta: "Seta",
  circulo: "Círculo",
  texto: "Texto",
  livre: "Livre",
};

export const EDGE_OPTIONS: AnaliseLabEdge[] = [
  "top",
  "right",
  "bottom",
  "left",
  "all",
];

export const EDGE_OPTIONS_SANGRIA: AnaliseLabEdge[] = [
  "top",
  "right",
  "bottom",
  "left",
];

export const COLOR_OPTIONS: AnaliseLabMarkCor[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "black",
  "white",
];

export function labelEdge(edge: string): string {
  return EDGE_LABELS[edge] || edge;
}

export function labelCor(cor: string): string {
  return COLOR_LABELS[cor] || cor;
}

export function labelTipo(tipo: string): string {
  return TIPO_LABELS[tipo] || tipo;
}

export type { AnaliseLabMarkTipo };
