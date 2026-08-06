export interface XposeTicket {
  id?: number;
  name?: string;
  nros?: string | number;
  anoos?: string | number;
  nr_os?: string | number;
  ano?: string | number;
  status?: string;
  created?: string | null;
  created_at?: string | null;
  priority?: string | number;
  machine?: string;
  source_file?: string;
  inicio?: string | null;
  fim?: string | null;
  last_updated?: string | null;
}

export interface XposePath {
  id?: number;
  ticket_name?: string;
  path_name?: string;
  status?: string;
  colour?: string;
  inicio?: string | null;
  fim?: string | null;
  printed_at?: string | null;
  last_updated?: string | null;
}

export interface GravacaoWsPayload {
  tickets?: XposeTicket[];
  paths?: XposePath[];
  meta?: {
    generated_at?: string | null;
    errors?: string[];
    source_paths?: Record<string, string>;
  };
  jobs?: unknown[];
  printed_jobs?: unknown[];
}

export interface GravacaoLogEntry {
  id: string;
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}
