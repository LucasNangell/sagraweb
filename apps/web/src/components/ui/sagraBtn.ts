import { cn } from "@sagra/ui";

/**
 * Sistema de botões SAGRA
 * ----------------------------------------------------------------------------
 * MODELO 3D (relevo/pressão): edite `.sagra-btn` em `apps/web/src/index.css`.
 * CORES POR FINALIDADE: edite `--sagra-btn-<perfil>-*` em `:root` no mesmo CSS.
 *
 * Uso preferido (perfil semântico):
 *   className={sagraBtn("save", "md")}
 *   className={sagraBtn("cancel", "md")}
 *   className="sagra-btn sagra-btn--delete sagra-btn--sm"
 *
 * Perfis: confirm | save | next | update | edit | add | search |
 *         cancel | close | clear | back | delete | pending |
 *         download | success | outline | primary-outline
 *
 * Alias de tom (legado): primary | secondary | neutral | danger | info |
 *                        warning | amber | emerald | slate
 */

/** Finalidade do botão (define a família de cor centralizada). */
export type SagraBtnProfile =
  | "confirm"
  | "save"
  | "next"
  | "update"
  | "edit"
  | "add"
  | "search"
  | "cancel"
  | "close"
  | "clear"
  | "back"
  | "delete"
  | "pending"
  | "download"
  | "success"
  | "report"
  | "previa"
  | "prova"
  | "delete-outline"
  | "outline"
  | "primary-outline"
  /* tons / legado */
  | "primary"
  | "secondary"
  | "neutral"
  | "danger"
  | "info"
  | "warning"
  | "amber"
  | "emerald"
  | "slate";

export type SagraBtnSize = "xs" | "sm" | "md" | "lg" | "icon";

/** @deprecated Use SagraBtnProfile */
export type SagraBtnTone = SagraBtnProfile;

const PROFILE_CLASS: Record<SagraBtnProfile, string> = {
  confirm: "sagra-btn--confirm",
  save: "sagra-btn--save",
  next: "sagra-btn--next",
  update: "sagra-btn--update",
  edit: "sagra-btn--edit",
  add: "sagra-btn--add",
  search: "sagra-btn--search",
  cancel: "sagra-btn--cancel",
  close: "sagra-btn--close",
  clear: "sagra-btn--clear",
  back: "sagra-btn--back",
  delete: "sagra-btn--delete",
  pending: "sagra-btn--pending",
  download: "sagra-btn--download",
  success: "sagra-btn--success",
  report: "sagra-btn--report",
  previa: "sagra-btn--previa",
  prova: "sagra-btn--prova",
  "delete-outline": "sagra-btn--delete-outline",
  outline: "sagra-btn--outline",
  "primary-outline": "sagra-btn--primary-outline",
  primary: "sagra-btn--primary",
  secondary: "sagra-btn--secondary",
  neutral: "sagra-btn--neutral",
  danger: "sagra-btn--danger",
  info: "sagra-btn--info",
  warning: "sagra-btn--warning",
  amber: "sagra-btn--amber",
  emerald: "sagra-btn--emerald",
  slate: "sagra-btn--slate",
};

const SIZE_CLASS: Record<SagraBtnSize, string> = {
  xs: "sagra-btn--xs",
  sm: "sagra-btn--sm",
  md: "sagra-btn--md",
  lg: "sagra-btn--lg",
  icon: "sagra-btn--icon",
};

export function sagraBtn(
  profile: SagraBtnProfile = "confirm",
  size: SagraBtnSize = "md",
  ...extra: Array<string | false | null | undefined>
): string {
  return cn("sagra-btn", PROFILE_CLASS[profile], SIZE_CLASS[size], ...extra);
}
