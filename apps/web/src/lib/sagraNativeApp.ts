import { apiUrl } from "@/lib/api";

/**
 * Ponte com o app Android "SAGRA Manutenção" (WebView nativa).
 * O app injeta `window.SagraApp` e acrescenta `SagraManutencaoApp/<versão>` ao user agent.
 */
export interface SagraAppBridge {
  versao(): string;
  /** "ativas" | "desativadas" | "bloqueadas" */
  statusNotificacoes(): string;
  abrirConfigNotificacoes(): void;
  /** Salva um arquivo (base64) em Downloads — usado no QR Code da máquina. */
  salvarArquivo(base64: string, nome: string, mime: string): void;
  /** Desconecta o aparelho (revoga o token) e volta ao login. */
  sair(): void;
}

const UA_MARK = "SagraManutencaoApp";

export function sagraAppBridge(): SagraAppBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { SagraApp?: SagraAppBridge }).SagraApp;
  return bridge && typeof bridge.versao === "function" ? bridge : null;
}

/** True quando a página está rodando dentro do app Android da Manutenção. */
export function isSagraManutencaoApp(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return ua.includes(UA_MARK) || sagraAppBridge() != null;
}

/** Navegador de celular Android (fora do app) — onde faz sentido oferecer o APK. */
export function isAndroidMobileBrowser(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return /Android/i.test(ua) && !isSagraManutencaoApp(ua);
}

export function manutencaoApkUrl(): string {
  return apiUrl("/manutencao/app/apk");
}

/** Converte data URL em download pelo app (WebView não baixa data:/blob: sozinha). */
export function salvarDataUrlNoApp(dataUrl: string, nome: string): boolean {
  const bridge = sagraAppBridge();
  if (!bridge) return false;
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return false;
  const mime = match[1] || "application/octet-stream";
  const payload = match[2] ? (match[3] ?? "") : btoa(decodeURIComponent(match[3] ?? ""));
  bridge.salvarArquivo(payload, nome, mime);
  return true;
}
