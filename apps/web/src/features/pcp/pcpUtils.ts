import type { PcpQueueItem } from "@/api/pcp";

export function pcpItemKey(item: PcpQueueItem): string {
  return `${item.nr_os}-${item.ano}`;
}

export function filterPcpQueue(
  items: PcpQueueItem[],
  setor: string,
  filters: Record<string, string[]>,
): PcpQueueItem[] {
  const excluded = new Set(["Entregue", "Cancelado", "Cancelada"]);
  const filterSet = filters[setor];
  return items.filter((item) => {
    if (item.situacao && excluded.has(item.situacao)) {
      return false;
    }
    if (filterSet?.length) {
      return filterSet.includes(item.situacao ?? "");
    }
    return true;
  });
}

export function parseDateLocal(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const match = `${value}`.match(
    /(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss ?? 0),
      0,
    );
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function extractLastUpdateMs(item: PcpQueueItem): number | null {
  let baseDate = parseDateLocal(item.last_update ?? undefined);
  const obsText = item.observacao ?? "";
  const timeMatch = obsText.match(/^\s*(\d{1,2})h(\d{2})/i);
  if (timeMatch && baseDate) {
    const hours = Number.parseInt(timeMatch[1]!, 10);
    const minutes = Number.parseInt(timeMatch[2]!, 10);
    const enriched = new Date(baseDate);
    enriched.setHours(hours, minutes, 0, 0);
    return enriched.getTime();
  }
  return baseDate?.getTime() ?? null;
}

export function formatElapsed(item: PcpQueueItem, nowMs: number): string {
  const ts = extractLastUpdateMs(item);
  if (!ts) {
    return "Sem registro";
  }
  const diffMs = Math.max(nowMs - ts, 0);
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} ${days === 1 ? "dia" : "dias"}`);
  }
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "hora" : "horas"}`);
  }
  parts.push(`${minutes} ${minutes === 1 ? "minuto" : "minutos"}`);
  return parts.join(" ");
}

export function elapsedTone(item: PcpQueueItem, nowMs: number): "ok" | "soon" | "late" | "muted" {
  const ts = extractLastUpdateMs(item);
  if (!ts) {
    return "muted";
  }
  const minutes = (nowMs - ts) / 60_000;
  if (minutes < 60) {
    return "ok";
  }
  if (minutes < 180) {
    return "soon";
  }
  return "late";
}

export function priorityTone(
  prioridade: string | null | undefined,
): "ok" | "warn" | "muted" {
  if (!prioridade) {
    return "muted";
  }
  if (prioridade.includes("Prometido")) {
    return "ok";
  }
  if (prioridade.includes("Solicitado")) {
    return "warn";
  }
  return "muted";
}

export function osLabel(nr_os: number, ano: number): string {
  const prefix = nr_os < 5000 ? "OS" : "SP";
  return `${prefix} ${nr_os}/${String(ano).slice(-2)}`;
}

export function formatPrevisaoDate(value: string | null | undefined): string | null {
  const dt = parseDateLocal(value ?? undefined);
  if (!dt) {
    return null;
  }
  return dt.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function previsaoConfiancaLabel(
  confianca: string | null | undefined,
): string | null {
  switch (confianca) {
    case "alta":
      return "alta confiança";
    case "media":
      return "média confiança";
    case "baixa":
      return "baixa confiança";
    default:
      return null;
  }
}
