import { Download, Image as ImageIcon, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  analisarManipularImagem,
  processarManipularImagem,
  type ManipularImagemAnalise,
} from "@/api/manipularImagem";
import {
  useSyncedImageZoom,
  ZoomableImageFrame,
  ZoomControls,
} from "@/features/manipular-imagem/components/ZoomableImagePreview";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const ARTGURU_URL = "https://www.artguru.ai/image-enhancer/";
const ACCEPT = ".png,.jpg,.jpeg,image/png,image/jpeg";

export function ManipularImagemPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRequestId = useRef(0);

  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [analise, setAnalise] = useState<ManipularImagemAnalise | null>(null);

  const [mascaraIdx, setMascaraIdx] = useState(0);
  const [limiar, setLimiar] = useState(50);
  const [intensidade, setIntensidade] = useState(100);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const zoomView = useSyncedImageZoom();

  const debouncedLimiar = useDebouncedValue(limiar, 250);
  const debouncedIntensidade = useDebouncedValue(intensidade, 250);
  const debouncedMascaraIdx = useDebouncedValue(mascaraIdx, 150);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [previewUrl, sourceUrl]);

  useEffect(() => {
    if (!analise?.job_id || analise.mascaras.length === 0) return;

    const requestId = ++previewRequestId.current;
    setPreviewing(true);
    setError(null);

    void processarManipularImagem({
      jobId: analise.job_id,
      mascaraIdx: debouncedMascaraIdx,
      limiar: debouncedLimiar,
      intensidade: debouncedIntensidade,
      preview: true,
      previewGeneration: requestId,
    })
      .then((result) => {
        if (requestId !== previewRequestId.current) return;
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(result.blob);
        });
        setDownloadName(result.filename);
      })
      .catch((err) => {
        if (requestId !== previewRequestId.current) return;
        if (err instanceof Error && err.name === "PreviewStaleError") return;
        setError(
          err instanceof Error ? err.message : "Falha ao gerar o preview.",
        );
      })
      .finally(() => {
        if (requestId === previewRequestId.current) {
          setPreviewing(false);
        }
      });
  }, [
    analise,
    debouncedMascaraIdx,
    debouncedLimiar,
    debouncedIntensidade,
  ]);

  async function handleFile(file: File | undefined) {
    if (!file || analyzing) return;
    setError(null);
    setAnalyzing(true);
    setAnalise(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setDownloadName(null);
    setMascaraIdx(0);
    setLimiar(50);
    setIntensidade(100);
    zoomView.reset();

    try {
      const result = await analisarManipularImagem(file);
      if (!result.mascaras.length) {
        throw new Error("Nenhuma máscara detectada na imagem.");
      }
      setSourceFile(file);
      setSourceUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setAnalise(result);
    } catch (err) {
      setSourceFile(null);
      setSourceUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setAnalise(null);
      setError(err instanceof Error ? err.message : "Falha ao analisar a imagem.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function downloadResult() {
    if (!analise?.job_id || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const result = await processarManipularImagem({
        jobId: analise.job_id,
        mascaraIdx,
        limiar,
        intensidade,
        preview: false,
      });
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      setDownloadName(result.filename);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao gerar o download.",
      );
    } finally {
      setDownloading(false);
    }
  }

  const selected = analise?.mascaras.find((m) => m.indice === mascaraIdx);
  const limiarLabel =
    selected?.modo_limiar === "chroma"
      ? "Tolerância de cor"
      : selected?.modo_limiar === "fix"
        ? "Limiar (sem efeito neste tipo)"
        : "Limiar de seleção";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
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
          , baixe o resultado e arraste o arquivo para cá. Depois ajuste a
          máscara, o limiar e a intensidade no preview antes do download.
        </p>
      </header>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!analyzing) inputRef.current?.click();
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
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => !analyzing && inputRef.current?.click()}
        className={[
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragOver
            ? "border-primary-green bg-green-50"
            : "border-slate-300 bg-white hover:border-secondary-blue",
          analyzing ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
      >
        {analyzing ? (
          <Loader2 className="h-8 w-8 animate-spin text-secondary-blue" />
        ) : (
          <Upload className="h-8 w-8 text-slate-400" />
        )}
        <p className="text-sm font-medium text-slate-700">
          {analyzing
            ? "Analisando imagem…"
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

      {analise && sourceFile ? (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              Máscaras detectadas
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {analise.filename} — {analise.largura}×{analise.altura}px
            </p>
            <div className="mt-3 space-y-2">
              {analise.mascaras.map((m) => (
                <label
                  key={m.indice}
                  className={[
                    "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm",
                    mascaraIdx === m.indice
                      ? "border-secondary-blue bg-blue-50"
                      : "border-slate-200 hover:border-slate-300",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="mascara"
                    className="mt-1"
                    checked={mascaraIdx === m.indice}
                    onChange={() => setMascaraIdx(m.indice)}
                  />
                  <span>
                    <span className="font-medium text-slate-800">
                      [{m.indice}] {m.tipo}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-600">
                      {m.descricao} — cobertura {m.cobertura.toFixed(1)}%
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2">
              <span className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>{limiarLabel}</span>
                <span className="tabular-nums text-slate-500">{limiar}</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={limiar}
                onChange={(e) => setLimiar(Number(e.target.value))}
                className="w-full accent-secondary-blue"
              />
              <span className="block text-xs text-slate-500">
                0 = conservador · 100 = agressivo
              </span>
            </label>

            <label className="block space-y-2">
              <span className="flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Intensidade da remoção</span>
                <span className="tabular-nums text-slate-500">
                  {intensidade}%
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={intensidade}
                onChange={(e) => setIntensidade(Number(e.target.value))}
                className="w-full accent-primary-green"
              />
              <span className="block text-xs text-slate-500">
                0% = sem alteração · 100% = remoção total na área
              </span>
            </label>
          </div>

          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">
              Preview
              {previewing ? (
                <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-secondary-blue" />
              ) : null}
            </h2>
            <div className="flex items-center gap-3">
              <ZoomControls
                zoom={zoomView.zoom}
                onZoomIn={zoomView.zoomIn}
                onZoomOut={zoomView.zoomOut}
                onReset={zoomView.reset}
              />
              <button
                type="button"
                onClick={() => void downloadResult()}
                disabled={!analise?.job_id || downloading || previewing}
                className="inline-flex items-center gap-1.5 rounded bg-primary-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-4 w-4" aria-hidden />
                )}
                Download
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Use a roda do mouse para zoom e arraste para mover quando ampliado.
            Original e resultado ficam sincronizados.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <ZoomableImageFrame
              label="Original"
              zoom={zoomView.zoom}
              pan={zoomView.pan}
              setPan={zoomView.setPan}
              applyWheelDelta={zoomView.applyWheelDelta}
            >
              {sourceUrl ? (
                <img
                  src={sourceUrl}
                  alt="Original"
                  draggable={false}
                  className="max-h-[344px] max-w-full select-none object-contain"
                />
              ) : null}
            </ZoomableImageFrame>
            <ZoomableImageFrame
              label="Resultado"
              zoom={zoomView.zoom}
              pan={zoomView.pan}
              setPan={zoomView.setPan}
              applyWheelDelta={zoomView.applyWheelDelta}
              empty={
                <div className="flex h-full items-center justify-center text-xs text-slate-400">
                  Gerando preview…
                </div>
              }
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Pré-visualização com limiar e intensidade atuais"
                  draggable={false}
                  className="max-h-[344px] max-w-full select-none object-contain"
                />
              ) : null}
            </ZoomableImageFrame>
          </div>

          {downloadName ? (
            <p className="text-xs text-slate-500">{downloadName}</p>
          ) : null}
        </section>
      ) : null}
      </div>
    </div>
  );
}
