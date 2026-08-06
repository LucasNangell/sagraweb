/**
 * Sondas de diagnóstico do painel tablet.
 *
 * Objetivo: distinguir bloqueio da rota `/ws` na borda pública de falta de
 * suporte a `Upgrade`, sem depender do console do dispositivo.
 */

export type WsProbeOutcome = "open" | "closed" | "error" | "timeout";

export interface WsProbeResult {
  url: string;
  outcome: WsProbeOutcome;
  code?: number;
  ms: number;
}

export interface HttpProbeResult {
  url: string;
  status: number | null;
  statusText: string;
  finalUrl: string;
  redirected: boolean;
  headers: string[];
  error?: string;
}

/** Converte a URL de WebSocket na equivalente HTTP para sondagem. */
export function toHttpProbeUrl(wsUrl: string): string {
  if (wsUrl.startsWith("wss://")) {
    return `https://${wsUrl.slice("wss://".length)}`;
  }
  if (wsUrl.startsWith("ws://")) {
    return `http://${wsUrl.slice("ws://".length)}`;
  }
  return wsUrl;
}

/**
 * URLs candidatas de WebSocket, começando pela que o app usa.
 * Inclui variação de barra final (WAF/proxy costuma tratar diferente) e os
 * caminhos alternativos aceitos pelo backend.
 */
export function buildWsProbeCandidates(wsUrl: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(wsUrl);
  } catch {
    return [wsUrl];
  }

  const origin = `${parsed.protocol}//${parsed.host}`;
  const current = parsed.pathname || "/";
  const toggledSlash = current.endsWith("/")
    ? current.slice(0, -1) || "/"
    : `${current}/`;

  const paths = [current, toggledSlash, "/sagra/api/ws/", "/api/ws/", "/ws"];
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const path of paths) {
    const normalized = path || "/";
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    candidates.push(`${origin}${normalized}${parsed.search}`);
  }
  return candidates;
}

export function describeWsProbe(result: WsProbeResult): string {
  const suffix = `${result.ms}ms`;
  switch (result.outcome) {
    case "open":
      return `conectou (${suffix})`;
    case "closed":
      return `fechou code=${result.code ?? "?"} (${suffix})`;
    case "timeout":
      return `sem resposta (${suffix})`;
    default:
      return `erro no handshake (${suffix})`;
  }
}

export function probeWebSocketUrl(
  url: string,
  timeoutMs = 6_000,
): Promise<WsProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let timer = 0;
    let ws: WebSocket | null = null;

    const finish = (outcome: WsProbeOutcome, code?: number) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      if (ws) {
        ws.onopen = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      resolve({ url, outcome, code, ms: Date.now() - started });
    };

    timer = window.setTimeout(() => finish("timeout"), timeoutMs);

    try {
      ws = new WebSocket(url);
    } catch {
      finish("error");
      return;
    }

    ws.onopen = () => finish("open");
    ws.onerror = () => finish("error");
    ws.onclose = (event) => finish("closed", event.code);
  });
}

export async function probeHttpUrl(url: string): Promise<HttpProbeResult> {
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });
    const headers: string[] = [];
    res.headers.forEach((value, key) => {
      headers.push(`${key}: ${value}`);
    });
    headers.sort();
    return {
      url,
      status: res.status,
      statusText: res.statusText,
      finalUrl: res.url || url,
      redirected: res.redirected,
      headers,
    };
  } catch (err) {
    return {
      url,
      status: null,
      statusText: "",
      finalUrl: url,
      redirected: false,
      headers: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
