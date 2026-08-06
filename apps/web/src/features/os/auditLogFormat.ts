import { formatDateBr } from "@/lib/format";

import type { OsAuditLogRow } from "./types";

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: "Criação",
  UPDATE: "Alteração",
  ANDAMENTO_ADD: "Andamento adicionado",
  ANDAMENTO_UPDATE: "Andamento alterado",
  ANDAMENTO_DELETE: "Andamento excluído",
  VINCULO_ADD: "Vínculo criado",
  VINCULO_DELETE: "Vínculo removido",
  DUPLICATE: "Duplicação",
  LINK_GENERATED: "Link gerado",
};

/** URL http(s) no texto — para linkificar detalhes do histórico. */
const URL_IN_TEXT_RE = /(https?:\/\/[^\s<>"']+)/gi;

export function formatAuditEventDate(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return formatDateBr(value);
  }
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAuditChange(row: OsAuditLogRow): string {
  if (row.campo && (row.valor_anterior || row.valor_novo)) {
    const from = row.valor_anterior?.trim() || "(vazio)";
    const to = row.valor_novo?.trim() || "(vazio)";
    return `${row.campo}: ${from} → ${to}`;
  }
  return row.descricao?.trim() || "-";
}

/** Prefere valor_novo quando for URL (links gerados); senão usa o texto de detalhes. */
export function resolveAuditDetailText(row: OsAuditLogRow): string {
  const novo = row.valor_novo?.trim() ?? "";
  if (
    row.acao === "LINK_GENERATED" &&
    (novo.startsWith("http://") || novo.startsWith("https://"))
  ) {
    const prefix = row.descricao?.split(": http")[0]?.trim();
    if (prefix && !prefix.startsWith("http")) {
      return `${prefix}: ${novo}`;
    }
    return novo;
  }
  return formatAuditChange(row);
}

export type AuditTextPart =
  | { type: "text"; value: string }
  | { type: "url"; value: string };

/** Divide o texto em partes de texto e URL para renderização. */
export function splitAuditTextWithUrls(text: string): AuditTextPart[] {
  const parts: AuditTextPart[] = [];
  let last = 0;
  const re = new RegExp(URL_IN_TEXT_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", value: text.slice(last, match.index) });
    }
    parts.push({ type: "url", value: match[1] });
    last = match.index + match[1].length;
  }
  if (last < text.length) {
    parts.push({ type: "text", value: text.slice(last) });
  }
  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}

export function formatAuditActionLabel(acao: string): string {
  return AUDIT_ACTION_LABELS[acao] ?? acao;
}

export function formatAuditClientIp(ip?: string | null): string {
  const value = ip?.trim();
  return value || "-";
}

export function isOsMovementAuditRow(row: OsAuditLogRow): boolean {
  if (row.entidade === "andamento") {
    return true;
  }
  return row.acao.startsWith("ANDAMENTO_");
}

export function filterOsMovementRows(rows: OsAuditLogRow[]): OsAuditLogRow[] {
  return rows.filter(isOsMovementAuditRow);
}
