import { Copy, Download, ExternalLink, Loader2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { sagraBtn } from "@/components/ui/sagraBtn";
import { toast } from "@/components/ui/toastStore";

/** Página pública de abertura de chamado já com a máquina selecionada. */
export function linkChamadoMaquina(codigo: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL ?? "/"}`.replace(/\/+$/, "");
  return `${base}/chamado/${encodeURIComponent(codigo)}`;
}

const QR_OPTS = { errorCorrectionLevel: "M" as const, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } };

/** Gera um PNG em formato de etiqueta (título, QR, nome e código) para impressão. */
export async function gerarEtiquetaPng(nome: string, codigo: string): Promise<string> {
  const W = 800;
  const H = 1040;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, W - 24, H - 24);

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(12, 12, W - 24, 120);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "bold 44px Arial, sans-serif";
  ctx.fillText("MANUTENÇÃO", W / 2, 72);
  ctx.font = "26px Arial, sans-serif";
  ctx.fillText("Aponte a câmera para abrir um chamado", W / 2, 112);

  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, linkChamadoMaquina(codigo), { ...QR_OPTS, width: 600 });
  ctx.drawImage(qrCanvas, (W - 600) / 2, 160, 600, 600);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 46px Arial, sans-serif";
  let titulo = nome;
  while (ctx.measureText(titulo).width > W - 80 && titulo.length > 4) {
    titulo = `${titulo.slice(0, -2)}…`;
  }
  ctx.fillText(titulo, W / 2, 850);
  ctx.font = "bold 40px Consolas, 'Courier New', monospace";
  ctx.fillStyle = "#334155";
  ctx.fillText(codigo, W / 2, 920);
  ctx.font = "22px Arial, sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.fillText("SAGRA · Gráfica", W / 2, 985);
  return canvas.toDataURL("image/png");
}

export function MaquinaQrCode({ nome, codigo }: { nome: string; codigo: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);
  const link = linkChamadoMaquina(codigo);

  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(link, { ...QR_OPTS, width: 320 })
      .then((url) => {
        if (vivo) setSrc(url);
      })
      .catch(() => {
        if (vivo) setSrc(null);
      });
    return () => {
      vivo = false;
    };
  }, [link]);

  const baixar = async () => {
    setBaixando(true);
    try {
      const url = await gerarEtiquetaPng(nome, codigo);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qrcode-${codigo}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error("Não foi possível gerar a imagem do QR Code");
    } finally {
      setBaixando(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copiado");
    } catch {
      toast.warning(link);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-start">
      <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-lg bg-white p-2 shadow-sm ring-1 ring-slate-200">
        {src ? (
          <img src={src} alt={`QR Code da máquina ${codigo}`} className="h-full w-full" />
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
        <div>
          <p className="text-sm font-semibold text-slate-900">QR Code de identificação</p>
          <p className="text-xs text-slate-500">
            Cole na máquina. Ao escanear, abre direto a página de chamado desta máquina — sem
            precisar de login; o solicitante se identifica pelo ponto.
          </p>
        </div>
        <p className="break-all rounded bg-white px-2 py-1 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200">
          {link}
        </p>
        <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
          <button type="button" className={sagraBtn("download", "sm")} onClick={baixar} disabled={baixando}>
            <Download className="h-4 w-4" aria-hidden />
            {baixando ? "Gerando…" : "Baixar QR Code (PNG)"}
          </button>
          <button type="button" className={sagraBtn("outline", "sm")} onClick={copiar}>
            <Copy className="h-4 w-4" aria-hidden />
            Copiar link
          </button>
          <a href={link} target="_blank" rel="noreferrer" className={sagraBtn("outline", "sm")}>
            <ExternalLink className="h-4 w-4" aria-hidden />
            Abrir página
          </a>
        </div>
      </div>
    </div>
  );
}
