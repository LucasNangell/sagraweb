/** Logs de diagnóstico WebSocket do chat — apenas em desenvolvimento. */

export function supportWsLog(
  scope: string,
  message: string,
  data?: Record<string, unknown> | unknown,
): void {
  if (!import.meta.env.DEV) {
    return;
  }
  if (data !== undefined) {
    console.info(`[${scope}] ${message}`, data);
    return;
  }
  console.info(`[${scope}] ${message}`);
}

export function supportWsLogSend(
  scope: string,
  payload: Record<string, unknown>,
  sent: boolean,
): void {
  supportWsLog(scope, sent ? "WS SEND ok" : "WS SEND falhou (socket fechado)", payload);
}
