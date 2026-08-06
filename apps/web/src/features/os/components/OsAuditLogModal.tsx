import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Loader2, X } from "lucide-react";
import { useState } from "react";

import { fetchOsAuditLog } from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import { formatPonto } from "@/lib/format";

import type { OsSearchRow } from "../types";
import {
  formatAuditActionLabel,
  formatAuditClientIp,
  formatAuditEventDate,
  resolveAuditDetailText,
  splitAuditTextWithUrls,
} from "../auditLogFormat";

interface OsAuditLogModalProps {
  row: OsSearchRow | null;
  open: boolean;
  onClose: () => void;
}

export function OsAuditLogModal({ row, open, onClose }: OsAuditLogModalProps) {
  const ano = row?.ano ?? null;
  const id = row?.nr_os ?? null;

  const auditQuery = useQuery({
    queryKey:
      open && ano != null && id != null
        ? queryKeys.os.auditLog(ano, id)
        : ["os", "auditLog", "idle"],
    queryFn: () => fetchOsAuditLog(ano!, id!),
    enabled: open && ano != null && id != null,
  });

  if (!open || !row) {
    return null;
  }

  const rows = auditQuery.data ?? [];

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-log-title"
    >
      <div className="relative flex max-h-[85vh] w-full max-w-6xl min-w-0 flex-col overflow-hidden rounded-lg border-t-4 border-[#24344D] bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between border-b border-sagra-border px-5 py-4">
          <div>
            <h3
              id="audit-log-title"
              className="text-lg font-semibold text-secondary-blue"
            >
              Histórico completo da OS
            </h3>
            <p className="mt-1 text-sm text-neutral-600">
              OS {row.nr_os}/{row.ano} — registro de criação, alterações,
              andamentos e vínculos
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-800"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
          {auditQuery.isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-neutral-500">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              Carregando histórico...
            </div>
          )}

          {auditQuery.isError && (
            <p className="py-8 text-center text-sm text-red-600">
              Erro ao carregar histórico:{" "}
              {auditQuery.error instanceof Error
                ? auditQuery.error.message
                : "falha desconhecida"}
            </p>
          )}

          {!auditQuery.isLoading && !auditQuery.isError && rows.length === 0 && (
            <p className="py-8 text-center text-sm text-neutral-500">
              Nenhum registro encontrado para esta OS.
            </p>
          )}

          {!auditQuery.isLoading && rows.length > 0 && (
            <table className="w-full min-w-0 table-fixed border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  <th className="w-[15%] px-3 py-2 text-left font-semibold">
                    Data
                  </th>
                  <th className="w-[18%] px-3 py-2 text-left font-semibold">
                    Ação
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">Detalhes</th>
                  <th className="w-[12%] px-3 py-2 text-left font-semibold">
                    Ponto
                  </th>
                  <th className="w-[14%] px-3 py-2 text-left font-semibold">
                    IP
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-sagra-border/60 align-top hover:bg-slate-50/80"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-700">
                      {formatAuditEventDate(entry.evento_em)}
                    </td>
                    <td className="break-words px-3 py-2 font-medium text-secondary-blue">
                      {formatAuditActionLabel(entry.acao)}
                    </td>
                    <td className="break-words px-3 py-2 text-neutral-700">
                      <AuditDetailCell text={resolveAuditDetailText(entry)} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-700">
                      {entry.ponto ? formatPonto(entry.ponto) : "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-neutral-700">
                      {formatAuditClientIp(entry.client_ip)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function AuditDetailCell({ text }: { text: string }) {
  const parts = splitAuditTextWithUrls(text);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => setCopiedUrl(null), 1500);
    } catch {
      // clipboard indisponível
    }
  };

  return (
    <span className="inline-flex max-w-full flex-wrap items-start gap-1">
      {parts.map((part, index) =>
        part.type === "url" ? (
          <span
            key={`${index}-${part.value}`}
            className="inline-flex max-w-full items-center gap-1"
          >
            <a
              href={part.value}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-sagra-accent underline hover:opacity-80"
            >
              {part.value}
            </a>
            <button
              type="button"
              onClick={() => void handleCopy(part.value)}
              className="shrink-0 rounded border border-sagra-border p-0.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
              title="Copiar link"
              aria-label="Copiar link"
            >
              {copiedUrl === part.value ? (
                <Check className="size-3.5 text-primary-green" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
            </button>
          </span>
        ) : (
          <span key={`${index}-t`}>{part.value}</span>
        ),
      )}
    </span>
  );
}
