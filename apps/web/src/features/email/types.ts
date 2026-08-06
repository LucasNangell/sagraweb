export type EmailTab = "inbox" | "pendencias";

export interface InboxEmail {
  id: string;
  real_id: string;
  sender: string;
  email: string;
  subject: string;
  preview: string;
  body: string;
  date: string;
  read: boolean;
  hasAttachment: boolean;
  attachments: { name: string; index?: number }[];
  inline_images?: Record<string, number>;
  account: string;
  folder: string;
}

export type PendenciaSource = "db" | "apogee";

export interface PendenciaOs {
  os: number;
  ano: number;
  produto?: string | null;
  observacao?: string | null;
  situacao: string;
  setor: string;
  data: string;
  source?: PendenciaSource;
  email_entry_id?: string;
  subject?: string;
  body?: string;
  sender?: string;
  account?: string;
  folder?: string;
  email_date?: string;
  attachments?: { name: string; index?: number }[];
  inline_images?: Record<string, number>;
  has_attachment?: boolean;
}

export interface EmailNotificationStatus {
  inbox_count: number;
  pendencias_count: number;
  last_check: string;
}

export interface PtHtmlResponse {
  html: string;
  versao?: string | null;
  data?: string | null;
  type: "pt" | "proof";
  detected_attachment?: string | null;
  debug_path?: string | null;
  send_mode?: "portal" | "sem_portal" | "anexo" | string | null;
  anexar_pdf?: boolean;
  use_inline_body?: boolean;
  template_model_id?: number | null;
}

export interface ProtocoloLookup {
  NroProtocolo?: number | null;
  AnoProtocolo?: number | null;
  NomeUsuario?: string | null;
  CategoriaLink?: string | null;
  ContatoTrab?: string | null;
}

export interface DeputadoEmails {
  email_dep: string;
  email_gab: string;
  email_contato: string;
  ramal?: string;
  gabinete?: string;
}

export interface GalContactItem {
  name: string;
  email: string;
  cargo?: string;
  departamento?: string;
}

export interface GalResolveResponse {
  items: GalContactItem[];
}

export interface AndamentoResult {
  success: boolean;
  cod_status?: string;
  outlook_updated?: boolean;
  message?: string;
}

export interface SendPtResult {
  success: boolean;
  message: string;
  subject?: string;
  attachments?: string[];
  outlook_updated?: boolean;
  outlook_error?: string;
  routing?: {
    mailbox?: string;
    mailbox_source?: string;
    folder_name?: string;
    folder_source?: string;
    save_to_folder_id?: string | null;
    used_default_sent_items?: boolean;
    fallback_reason?: string | null;
  };
}

export interface EmailProofFileEntry {
  name: string;
  size: number;
  modified_at: string | null;
}

export interface EmailProofFilesResponse {
  os: number;
  ano: number;
  files: EmailProofFileEntry[];
  suggested: string | null;
}

export interface SaveEmailMhtResult {
  success: boolean;
  filename: string;
  path: string;
}

export interface EmailMonitoredFolder {
  id: string;
  name: string;
  parent: string;
}

export interface EmailMonitoredTarget {
  mailbox: string;
  folders: EmailMonitoredFolder[];
}

export interface EmailExchangeConfig {
  ponto: string;
  ews_username?: string;
  has_password?: boolean;
  ews_url: string;
  verify_ssl: boolean;
  max_items_per_folder: number;
  refresh_interval_sec: number;
  only_unread: boolean;
  monitored_targets: EmailMonitoredTarget[];
  send_mailbox_os_lt_5000: string;
  send_mailbox_os_gte_5000: string;
  send_routing?: {
    by_type?: Partial<Record<"pt" | "proof" | "apogee" | "reply", string>>;
  };
  sent_folder_routing?: {
    by_mailbox?: Record<
      string,
      Partial<
        Record<
          "pt" | "proof" | "apogee" | "reply",
          { id?: string; name: string; parent?: string }
        >
      >
    >;
  };
  config_version?: number;
  configured: boolean;
  updated_at?: string | null;
}

export interface EmailMailboxInfo {
  address: string;
  display_name: string;
  is_primary: boolean;
  accessible: boolean;
}

export interface EmailFolderInfo {
  id: string;
  change_key?: string;
  name: string;
  unread_count?: number | null;
  total_count?: number | null;
  parent_id?: string | null;
}

export interface EmailConnectResult {
  success: boolean;
  mailboxes: EmailMailboxInfo[];
  primary: string;
}

export interface EmailFoldersResult {
  mailbox: string;
  parent: string;
  folders: EmailFolderInfo[];
}

export interface EmailSendPlanResponse {
  success: boolean;
  plan: {
    type: "pt" | "proof" | "apogee" | "reply";
    mailbox: string;
    mailbox_source: string;
    target_folder: {
      id: string;
      name: string;
      parent: string;
    };
    folder_source: string;
  };
  save_to_folder_id?: string | null;
  fallback_reason?: string | null;
}
