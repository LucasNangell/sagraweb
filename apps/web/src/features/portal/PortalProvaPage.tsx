import { useQuery } from "@tanstack/react-query";
import { FileText, Printer } from "lucide-react";

import { clientReportPdfUrl, fetchClientAnalysis } from "@/api/client-portal";

interface PortalProvaPageProps {
  token: string;
  osId: number;
  ano: number;
}

export function PortalProvaPage({ token, osId, ano }: PortalProvaPageProps) {
  const analysisQuery = useQuery({
    queryKey: ["portal", "prova", token, osId, ano],
    queryFn: () => fetchClientAnalysis(ano, osId, token),
    enabled: Boolean(token && osId && ano),
  });

  if (!osId || !ano || !token) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-red-800">
        Link inválido. Parâmetros os, ano e token são obrigatórios.
      </div>
    );
  }

  if (analysisQuery.isLoading) {
    return (
      <div className="py-16 text-center text-neutral-500">
        Carregando comprovante…
      </div>
    );
  }

  if (analysisQuery.isError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-red-800">
        {analysisQuery.error instanceof Error
          ? analysisQuery.error.message
          : "Erro ao carregar comprovante."}
      </div>
    );
  }

  const data = analysisQuery.data;
  const pdfUrl = clientReportPdfUrl(ano, osId, token);

  return (
    <div className="portal-prova mx-auto max-w-3xl px-4 py-8 print:max-w-none print:px-0">
      <header className="portal-prova-header mb-6 rounded-lg border-t-4 border-primary-green bg-secondary-blue p-6 text-white print:rounded-none print:border print:border-sagra-border print:bg-white print:text-black">
        <h1 className="flex items-center gap-2 text-xl font-bold print:text-secondary-blue">
          <FileText className="size-6 print:text-primary-green" />
          Comprovante — Problemas Técnicos
        </h1>
        <p className="mt-2 text-sm opacity-90 print:text-neutral-700">
          Visualização somente leitura para conferência e arquivo.
        </p>
      </header>

      <article className="rounded-lg border border-sagra-border bg-white p-6 shadow-sm print:shadow-none">
        <dl className="mb-6 grid grid-cols-2 gap-4 rounded-md bg-slate-100 p-4 text-sm print:bg-white print:border">
          <div>
            <dt className="text-xs uppercase text-neutral-500">Ordem de Serviço</dt>
            <dd className="font-semibold text-secondary-blue">
              {osId}/{ano}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-neutral-500">Componente</dt>
            <dd className="font-semibold">{data?.componente || "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs uppercase text-neutral-500">Título</dt>
            <dd>{data?.titulo || "—"}</dd>
          </div>
        </dl>

        <div className="space-y-4">
          {(data?.items ?? []).map((item) => (
            <div
              key={item.uniqueId}
              className="border-b border-sagra-border pb-4 last:border-0 print:break-inside-avoid"
            >
              <h3 className="text-base font-semibold text-[#8B0000]">
                {item.titulo || "Problema"}
              </h3>
              <p className="text-xs text-neutral-500">
                {item.componenteOrigem || "Geral"} —{" "}
                {item.desconsiderado
                  ? "Desconsiderado"
                  : item.resolver
                    ? "Resolvido"
                    : "Pendente"}
              </p>
              {item.html && (
                <div
                  className="snapshot-box mt-2 overflow-x-auto rounded bg-neutral-50 p-3 text-sm print:border"
                  dangerouslySetInnerHTML={{ __html: item.html }}
                />
              )}
              {item.obs && (
                <p className="mt-2 text-sm">
                  <strong>Observação:</strong> {item.obs}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="no-print mt-8 flex flex-wrap gap-2">
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded bg-secondary-blue px-4 py-2 text-sm font-semibold text-white"
          >
            Baixar PDF oficial
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded bg-neutral-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Printer className="size-4" />
            Imprimir
          </button>
        </div>
      </article>

      <p className="footer-note mt-8 text-center text-xs text-neutral-500 print:mt-4">
        SAGRA — Sistema de Acompanhamento Gráfico · Câmara dos Deputados / SEFOC
      </p>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .portal-prova-header {
            color: #24344D !important;
            background: #fff !important;
          }
        }
      `}</style>
    </div>
  );
}
