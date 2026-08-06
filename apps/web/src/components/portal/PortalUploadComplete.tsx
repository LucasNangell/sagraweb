import { CheckCircle2 } from "lucide-react";

interface PortalUploadCompleteProps {
  osLabel: string;
  titulo: string;
}

export function PortalUploadComplete({ osLabel, titulo }: PortalUploadCompleteProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-lg rounded-xl border border-green-200 bg-white px-8 py-10 text-center shadow-lg">
        <CheckCircle2 className="mx-auto size-14 text-primary-green" aria-hidden />
        <h1 className="mt-4 text-xl font-bold text-slate-900">
          Arquivo(s) enviado(s) com sucesso
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          O material da OS <strong>{osLabel}</strong>
          {titulo ? (
            <>
              {" "}
              (<span className="font-medium">{titulo}</span>)
            </>
          ) : null}{" "}
          foi recebido e seguirá para análise pela equipe técnica.
        </p>
        <p className="mt-4 text-xs text-slate-500">
          Você pode fechar esta página. Em caso de dúvidas, entre em contato com o
          setor responsável.
        </p>
      </div>
    </div>
  );
}
