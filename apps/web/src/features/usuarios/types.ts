export interface UsuarioRecord {
  Ponto: number;
  Nome: string | null;
  Setor?: string | null;
  Fornecedor?: number | boolean | null;
  UltimoAcesso: string | null;
  IPUltimoAcesso?: string | null;
  IpsCadastrados?: string[];
  Email?: string | null;
  EmailVerified?: number | boolean | null;
  AuthAtivo?: number | boolean | null;
  ContaInternet?: number | boolean | null;
}

export interface UsuarioRow extends UsuarioRecord {
  isOnline: boolean;
}

export interface ForceRefreshPayload {
  type: "force_refresh";
  action: "reload";
  id: number;
  ano: number;
  origem: string;
  overwriteConfig?: boolean;
}

export interface UsuariosMessage {
  type: "success" | "error";
  text: string;
}
