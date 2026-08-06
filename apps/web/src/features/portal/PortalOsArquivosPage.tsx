import { useMutation, useQuery } from "@tanstack/react-query";

import { cn } from "@sagra/ui";

import { Loader2, Upload } from "lucide-react";

import { useRef, useState } from "react";



import {

  clientOsArquivosUploadSmart,

  fetchOsArquivosPortal,

} from "@/api/osArquivos";

import { queryKeys } from "@/api/query-keys";

import { UploadProgressBar } from "@/components/UploadProgressBar";

import { PortalSystemHeader } from "@/components/portal/PortalSystemHeader";

import { PortalUploadComplete } from "@/components/portal/PortalUploadComplete";



interface PortalOsArquivosPageProps {

  token: string;

  osId: number;

  ano: number;

}



export function PortalOsArquivosPage({

  token,

  osId,

  ano,

}: PortalOsArquivosPageProps) {

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [clientNome, setClientNome] = useState("");

  const [clientPonto, setClientPonto] = useState("");

  const [files, setFiles] = useState<File[]>([]);

  const [dragOver, setDragOver] = useState(false);

  const [uploadDone, setUploadDone] = useState(false);
  const [successTitulo, setSuccessTitulo] = useState("");

  const [uploadPct, setUploadPct] = useState(0);

  const [uploadLabel, setUploadLabel] = useState("Enviando arquivos…");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);



  const infoQuery = useQuery({

    queryKey: queryKeys.portal.osArquivos(token, osId, ano),

    queryFn: () => fetchOsArquivosPortal(ano, osId, token),

    enabled: Boolean(token && osId && ano) && !uploadDone,

    refetchOnWindowFocus: false,

    retry: false,

  });



  const uploadMutation = useMutation({

    mutationFn: () =>

      clientOsArquivosUploadSmart({

        osId,

        ano,

        ponto: clientPonto.trim(),

        token,

        files,

        onProgress: (pct, label) => {

          setUploadPct(pct);

          if (label) setUploadLabel(label);

        },

      }),

    onSuccess: () => {
      setErrorMsg(null);
      setSuccessTitulo((prev) => prev || infoQuery.data?.osTitulo || "");
      setUploadDone(true);
    },

    onError: (e) => {

      setErrorMsg(e instanceof Error ? e.message : "Falha no envio.");

      setUploadPct(0);

    },

  });



  if (!osId || !ano || !token) {

    return (

      <div className="mx-auto max-w-lg px-4 py-16 text-red-800">

        Link inválido. Parâmetros os, ano e token são obrigatórios.

      </div>

    );

  }



  const portalComplete =

    uploadDone || Boolean(infoQuery.data?.portalComplete);

  const titulo = successTitulo || infoQuery.data?.osTitulo || "";



  if (portalComplete) {

    return (

      <div className="flex min-h-screen flex-col bg-slate-100">

        <PortalSystemHeader subtitle="Portal do Cliente — Envio de arquivos" />

        <PortalUploadComplete osLabel={`${osId}/${ano}`} titulo={titulo} />

      </div>

    );

  }



  if (infoQuery.isLoading) {

    return (

      <div className="flex min-h-screen flex-col bg-slate-100">

        <PortalSystemHeader subtitle="Portal do Cliente — Envio de arquivos" />

        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">

          <Loader2 className="size-10 animate-spin" aria-hidden />

          <p className="text-sm">Carregando dados da OS…</p>

        </div>

      </div>

    );

  }



  if (infoQuery.isError) {

    return (

      <div className="flex min-h-screen flex-col bg-slate-100">

        <PortalSystemHeader subtitle="Portal do Cliente — Envio de arquivos" />

        <div className="mx-auto max-w-lg px-4 py-16 text-red-800">

          {infoQuery.error instanceof Error

            ? infoQuery.error.message

            : "Não foi possível carregar a OS."}

        </div>

      </div>

    );

  }



  const data = infoQuery.data;

  const osTitulo = data?.osTitulo ?? "Sem título";

  const uploading = uploadMutation.isPending;



  const addFiles = (list: FileList | File[]) => {

    const next = Array.from(list);

    if (!next.length) return;

    setFiles((prev) => {

      const names = new Set(prev.map((f) => f.name));

      const merged = [...prev];

      for (const f of next) {

        if (!names.has(f.name)) {

          merged.push(f);

          names.add(f.name);

        }

      }

      return merged;

    });

  };



  const handleUpload = () => {

    if (!clientNome.trim() || !clientPonto.trim()) {

      setErrorMsg("Informe seu nome e ponto antes de enviar.");

      return;

    }

    if (!files.length) {

      setErrorMsg("Selecione pelo menos um arquivo.");

      return;

    }

    setErrorMsg(null);

    setUploadPct(0);

    setUploadLabel("Enviando arquivos…");

    uploadMutation.mutate();

  };



  return (

    <div className="relative flex min-h-screen flex-col bg-slate-100">

      <PortalSystemHeader subtitle="Portal do Cliente — Envio de arquivos" />



      {uploading ? (

        <div

          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"

          role="alertdialog"

          aria-busy="true"

          aria-label="Enviando arquivos"

        >

          <div className="w-full max-w-sm rounded-lg bg-white px-6 py-5 shadow-xl">

            <div className="mb-3 flex justify-center">

              <Loader2 className="size-8 animate-spin text-primary-green" aria-hidden />

            </div>

            <UploadProgressBar pct={uploadPct} label={uploadLabel} />

          </div>

        </div>

      ) : null}



      <section className="shrink-0 border-b border-sagra-border border-t-[3px] border-t-primary-green bg-white px-4 py-3 shadow-sm">

        <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">

          <div>

            <label className="text-xs font-semibold text-slate-600">OS</label>

            <div className="mt-1 flex gap-2">

              <input

                readOnly

                value={`${osId}/${ano}`}

                className="h-9 w-24 rounded border border-slate-200 bg-slate-100 px-2 text-sm font-bold"

              />

              <input

                readOnly

                value={osTitulo}

                className="h-9 min-w-0 flex-1 rounded border border-slate-200 bg-slate-100 px-2 text-sm"

              />

            </div>

          </div>

          <div>

            <label className="text-xs font-semibold text-slate-600">Produto</label>

            <input

              readOnly

              value={data?.osProduto ?? "—"}

              className="mt-1 h-9 w-full rounded border border-slate-200 bg-slate-100 px-2 text-sm"

            />

          </div>

          <div>

            <label className="text-xs font-semibold text-slate-600">Seu nome</label>

            <input

              value={clientNome}

              onChange={(e) => setClientNome(e.target.value)}

              disabled={uploading}

              className="mt-1 h-9 w-full rounded border border-slate-300 px-2 text-sm disabled:bg-slate-100"

            />

          </div>

          <div>

            <label className="text-xs font-semibold text-slate-600">Ponto</label>

            <input

              value={clientPonto}

              onChange={(e) => setClientPonto(e.target.value)}

              disabled={uploading}

              className="mt-1 h-9 w-full rounded border border-slate-300 px-2 text-sm disabled:bg-slate-100"

            />

          </div>

        </div>

      </section>



      {errorMsg ? (

        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">

          {errorMsg}

        </div>

      ) : null}



      <main className="mx-auto w-full max-w-3xl flex-1 p-4">

        <p className="mb-4 text-sm text-slate-600">

          Envie os arquivos solicitados para a ordem de serviço abaixo. Eles serão

          gravados na pasta Original no servidor da Câmara.

        </p>



        <div

          role="button"

          tabIndex={0}

          onDragOver={(e) => {

            e.preventDefault();

            setDragOver(true);

          }}

          onDragLeave={() => setDragOver(false)}

          onDrop={(e) => {

            e.preventDefault();

            setDragOver(false);

            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);

          }}

          onClick={() => !uploading && fileInputRef.current?.click()}

          className={cn(

            "flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center text-sm",

            dragOver

              ? "border-primary-green bg-green-50"

              : "border-slate-300 bg-white hover:border-secondary-blue",

            uploading && "pointer-events-none opacity-60",

          )}

        >

          <Upload className="size-10 text-secondary-blue" aria-hidden />

          <span>Arraste os arquivos ou clique para selecionar</span>

        </div>



        <input

          ref={fileInputRef}

          type="file"

          multiple

          className="hidden"

          disabled={uploading}

          onChange={(e) => {

            if (e.target.files?.length) addFiles(e.target.files);

            e.target.value = "";

          }}

        />



        {files.length > 0 ? (

          <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded border border-slate-200 bg-white p-2 text-xs">

            {files.map((f) => (

              <li key={f.name} className="truncate text-slate-700">

                {f.name}

              </li>

            ))}

          </ul>

        ) : null}



        <button

          type="button"

          disabled={uploading || !files.length}

          onClick={handleUpload}

          className="mt-4 w-full rounded-lg bg-primary-green py-3 text-sm font-semibold text-white disabled:opacity-60"

        >

          Enviar arquivos

        </button>

      </main>

    </div>

  );

}

