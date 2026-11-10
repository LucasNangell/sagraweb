/**
 * Barramento leve de eventos de sessão — evita import circular entre
 * `lib/api.ts` (detecta o problema) e `features/auth` (recupera a sessão).
 */

/** Códigos enviados pelo backend no campo `code` do JSON de erro (APIAccessMiddleware). */
export const SESSION_ERROR_INVALID = "session_invalid";
export const SESSION_ERROR_IP_MISMATCH = "session_ip_mismatch";
/** Falha de rede (fetch rejeitado) — servidor inacessível. */
export const NETWORK_ERROR_CODE = "network";

export type SessionProblemCode =
  | typeof SESSION_ERROR_INVALID
  | typeof SESSION_ERROR_IP_MISMATCH;

const SESSION_CODES: ReadonlySet<string> = new Set([
  SESSION_ERROR_INVALID,
  SESSION_ERROR_IP_MISMATCH,
]);

export function isSessionProblemCode(code: unknown): code is SessionProblemCode {
  return typeof code === "string" && SESSION_CODES.has(code);
}

type Listener = (code: SessionProblemCode) => void;

const listeners = new Set<Listener>();

export function onSessionProblem(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportSessionProblem(code: SessionProblemCode): void {
  for (const listener of listeners) {
    try {
      listener(code);
    } catch {
      /* listener não deve quebrar o fluxo da requisição */
    }
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const detail = (error as { apiDetail?: { code?: unknown } }).apiDetail;
  return typeof detail?.code === "string" ? detail.code : undefined;
}

/** Erro de sessão expirada/inválida — será recuperado automaticamente. */
export function isSessionError(error: unknown): boolean {
  return isSessionProblemCode(errorCode(error));
}

/** Erro de rede (servidor inacessível / sem conexão). */
export function isNetworkError(error: unknown): boolean {
  return errorCode(error) === NETWORK_ERROR_CODE;
}
