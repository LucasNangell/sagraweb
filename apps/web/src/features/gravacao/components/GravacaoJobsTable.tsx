import { cn } from "@sagra/ui";

import type { XposePath, XposeTicket } from "../types";

interface GravacaoJobsTableProps {
  tickets: XposeTicket[];
  paths: XposePath[];
}

function statusClass(status: string | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s.includes("print") || s.includes("done") || s.includes("complete")) {
    return "bg-green-100 text-green-800";
  }
  if (s.includes("ready")) {
    return "bg-blue-100 text-blue-800";
  }
  if (s.includes("error") || s.includes("fail")) {
    return "bg-red-100 text-red-800";
  }
  return "bg-slate-100 text-slate-700";
}

export function GravacaoJobsTable({ tickets, paths }: GravacaoJobsTableProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-sagra-border bg-white shadow-sm">
        <h3 className="border-b border-sagra-border px-4 py-2 text-sm font-semibold text-secondary-blue">
          Xpose Jobs ({tickets.length})
        </h3>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-3 py-2">Job</th>
                <th className="px-3 py-2">OS</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Máquina</th>
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-neutral-400">
                    Nenhum ticket
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr key={t.id ?? t.name} className="border-t border-sagra-border/60">
                    <td className="max-w-[180px] truncate px-3 py-2 font-medium">
                      {t.name ?? "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {t.nr_os ?? t.nros}/{t.ano ?? t.anoos}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs",
                          statusClass(t.status),
                        )}
                      >
                        {t.status ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-600">
                      {t.machine ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-sagra-border bg-white shadow-sm">
        <h3 className="border-b border-sagra-border px-4 py-2 text-sm font-semibold text-secondary-blue">
          Chapas / Paths ({paths.length})
        </h3>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Chapa</th>
                <th className="px-3 py-2">Cor</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {paths.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-neutral-400">
                    Nenhuma chapa
                  </td>
                </tr>
              ) : (
                paths.slice(0, 200).map((p) => (
                  <tr
                    key={p.id ?? `${p.ticket_name}-${p.path_name}`}
                    className="border-t border-sagra-border/60"
                  >
                    <td className="max-w-[120px] truncate px-3 py-2 text-xs">
                      {p.ticket_name}
                    </td>
                    <td className="px-3 py-2">{p.path_name ?? "—"}</td>
                    <td className="px-3 py-2">{p.colour ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs",
                          statusClass(p.status),
                        )}
                      >
                        {p.status ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
