import { Download, Image as ImageIcon, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { processarManipularImagem } from "@/api/manipularImagem";

const ARTGURU_URL = "https://www.artguru.ai/image-enhancer/";
const ACCEPT = ".png,.jpg,.jpeg,image/png,image/jpeg";

export function ManipularImagemPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handleFile(file: File | undefined) {
    if (!file || loading) return;
    setError(null);
    setLoading(true);
    try {
      const result = await processarManipularImagem(file);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(result.blob);
      });
      setDownloadName(result.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao processar a imagem.");
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setDownloadName(null);
    } finally {
      setLoading(false);
    }
  }

  function downloadResult() {
    if (!previewUrl || !downloadName) return;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = downloadName;
    a.click();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
          <ImageIcon className="h-6 w-6 text-secondary-blue" aria-hidden />
          Manipular Imagem
        </h1>
        <p className="text-sm leading-relaxed text-slate-600">
          Para melhorar a qualidade da imagem, use o site{" "}
          <a
            href={ARTGURU_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-secondary-blue underline underline-offset-2 hover:opacity-90"
          >
            Artguru Image Enhancer
          </a>
          , baixe o resultado e arraste o arquivo para cá. O SAGRA remove a
          máscara 0 e mostra o preview para download.
        </p>
      </header>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!loading) inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          void handleFile(file);
        }}
        onClick={() => !loading && inputRef.current?.click()}
        className={[
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragOver
            ? "border-primary-green bg-green-50"
            : "border-slate-300 bg-white hover:border-secondary-blue",
          loading ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
      >
        {loading ? (
          <Loader2 className="h-8 w-8 animate-spin text-secondary-blue" />
        ) : (
          <Upload className="h-8 w-8 text-slate-400" />
        )}
        <p className="text-sm font-medium text-slate-700">
          {loading
            ? "Processando imagem…"
            : "Arraste uma imagem PNG ou JPG aqui"}
        </p>
        <p className="text-xs text-slate-500">ou clique para selecionar</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {previewUrl ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">
              Resultado (máscara 0 removida)
            </h2>
            <button
              type="button"
              onClick={downloadResult}
              className="inline-flex items-center gap-1.5 rounded bg-primary-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              <Download className="h-4 w-4" aria-hidden />
              Download
            </button>
          </div>
          <div className="overflow-auto rounded border border-slate-100 bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(-45deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e2e8f0_75%),linear-gradient(-45deg,transparent_75%,#e2e8f0_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0] p-3">
            <img
              src={previewUrl}
              alt="Pré-visualização após remoção da máscara"
              className="mx-auto max-h-[480px] max-w-full object-contain"
            />
          </div>
          {downloadName ? (
            <p className="text-xs text-slate-500">{downloadName}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
