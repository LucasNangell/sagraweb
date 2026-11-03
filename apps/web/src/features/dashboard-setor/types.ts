import type { PcpQueueItem } from "@/api/pcp";

export type DashboardColumnSource = "inbox";

export interface DashboardColumnConfig {
  id: string;
  title: string;
  statuses: string[];
  /** Omitido/vazio = herda config.sector */
  sector?: string;
  /** Se true, coluna não aparece no board quando items.length === 0 */
  hideWhenEmpty?: boolean;
  /** `inbox` = e-mails não lidos; omitido = andamentos da OS */
  source?: DashboardColumnSource;
  /** Fundo do head desta coluna. Omitido herda `theme.headerBg`. */
  headerBg?: string;
  /** Segunda cor do gradiente do head. Ausente = fundo sólido. */
  headerBg2?: string;
}

export interface DashboardTextStyle {
  fontFamily?: string;
  fontScale?: number;
  letterSpacing?: number;
  color?: string;
}

export interface DashboardCardTextColors {
  titleColor?: string;
  situationColor?: string;
  authorColor?: string;
  timerColor?: string;
}

export interface DashboardCardTypography {
  fontFamily?: string;
  /** Fallback legado; usado quando o elemento não tem escala própria. */
  fontScale?: number;
  titleScale?: number;
  situationScale?: number;
  authorScale?: number;
  timerScale?: number;
  letterSpacing?: number;
  /** Fallback global (legado) quando a prioridade não define cor própria. */
  titleColor?: string;
  situationColor?: string;
  /** Cores do número/situação por prioridade. */
  priorities?: {
    high?: DashboardCardTextColors;
    medium?: DashboardCardTextColors;
    normal?: DashboardCardTextColors;
  };
  /** Título principal “OPs na …”. */
  heading?: DashboardTextStyle;
  /** Títulos das colunas (head da lane). */
  column?: DashboardTextStyle;
}

/** Cores do efeito/animação. Chaves comuns: bg, border, accent, extra, extra2. */
export interface DashboardCardColors {
  bg?: string;
  border?: string;
  accent?: string;
  extra?: string;
  extra2?: string;
  [key: string]: string | undefined;
}

/** Efeito do card (id do catálogo) + paleta + realce escolhidos para a prioridade. */
export interface DashboardCardSlot {
  /** Id do efeito (`v79`, `mod-aurora`, `txt-matrix`, …) ou "" para o visual padrão. */
  effect: string;
  colors?: DashboardCardColors;
  /** Animação de realce em loop (`fx-tesla`, `fx-matrix`, …) ou "" para nenhuma. */
  highlight?: string;
  /** Cores da animação de realce (independentes do efeito visual). */
  highlightColors?: DashboardCardColors;
}

export interface DashboardCardStyle {
  /** Efeito + paleta + realce por prioridade. */
  models: {
    high: DashboardCardSlot;
    medium: DashboardCardSlot;
    normal: DashboardCardSlot;
  };
  /** Animação de entrada (1x) compartilhada por todos os cards (`fx-iris`, `fx-meteor`, …) ou `none`. */
  entryAnimation: string;
  /** Cores da animação de entrada global. */
  entryColors?: DashboardCardColors;
  /** Multiplicador da duração das animações (1 = padrão). */
  entrySpeed?: number;
  typography?: DashboardCardTypography;
}

/** Aparência do board (espaçamento e fundos), independente do visual dos cards. */
export interface DashboardTheme {
  /** Espaçamento vertical entre cards, em pixels. */
  cardGap?: number;
  /** Fundo da página (sistema). */
  pageBg?: string;
  /** Fundo das colunas. */
  columnBg?: string;
  /** Fundo do head da coluna. */
  headerBg?: string;
  /** Segunda cor do gradiente do head. Ausente = fundo sólido. */
  headerBg2?: string;
}

export interface DashboardConfig {
  sector: string;
  columnCount: number;
  columns: DashboardColumnConfig[];
  /** Painel moderno. `false` oculta o relógio nos cards; omitido continua exibindo. */
  showAndamentoTime?: boolean;
  /** Visual dos cards do painel moderno (modelos, entrada, tipografia). */
  cardStyle?: DashboardCardStyle;
  /** Fundo, espaçamento e head das colunas (painel moderno). */
  theme?: DashboardTheme;
  /** Toque legado (todas as prioridades). Preferir `notificationSounds`. */
  notificationSound?: DashboardNotificationSound;
  /** Toque por prioridade da OS. Slot omitido herda `notificationSound` ou suave. */
  notificationSounds?: DashboardNotificationSounds;
}

export type DashboardSoundSlot = "high" | "medium" | "normal";

export interface DashboardNotificationSounds {
  high?: DashboardNotificationSound;
  medium?: DashboardNotificationSound;
  normal?: DashboardNotificationSound;
}

export interface DashboardNotificationSound {
  /** Preset do catálogo, `custom` (MP3 enviado) ou `none`. */
  preset: string;
  customName?: string;
  customDataUrl?: string;
}

export type DashboardPriorityType = "priority-high" | "priority-medium" | null;

export interface DashboardOsItem extends PcpQueueItem {
  uniqueKey: string;
  priorityType: DashboardPriorityType;
  isNew: boolean;
  displaySituacao: string;
  pcp_ordem: number | null;
  /** Coluna onde o card está exibido (detecta mudança de situação). */
  lastColumnId?: string | null;
  /** Timestamp até quando manter destaque verde. */
  highlightUntil?: number;
}

export interface DashboardDisplayColumn extends DashboardColumnConfig {
  items: DashboardOsItem[];
}

export interface DashboardWsMessage {
  type?: string;
  setor?: string;
  id?: number;
  ano?: number;
  action?: string;
  origem?: string;
  situacao?: string;
  sub_os_id?: number;
}
