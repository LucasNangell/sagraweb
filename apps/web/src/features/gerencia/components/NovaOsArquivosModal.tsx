import { cn } from "@sagra/ui";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Mail, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchGerenciaSettings,
  finalizeOsArquivosInterno,
  sendOsArquivosClientEmail,
} from "@/api/osArquivos";
import { UploadProgressBar } from "@/components/UploadProgressBar";

export interface NovaOsArquivosModalProps {
  open: boolean;
  ano: number;
  osId: number;
  ponto: string;
  onDone: () => void;
  onClose: () => void;
}

type Mode = "choice" | "email" | "self";

export function NovaOsArquivosModal({
  open,
  ano,
  osId,
  ponto,
  onDone,
  onClose,
}: NovaOsArquivosModalProps) {
  const [mode, setMode] = useState<Mode>("choice");
  const [email, setEmail] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("Enviando arquivos…");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const settingsQuery = useQuery({
    queryKey: ["gerencia", "settings"],
    queryFn: fetchGerenciaSettings,
    enabled: open,
    staleTime: 60_000,
  });

  const emailToClientEnabled =
    settingsQuery.data?.os_arquivos_client_email_enabled ?? true;

  useEffect(() => {
    if (!open) {
      setMode("choice");
      setEmail("");
      setFiles([]);
      setDragOver(false);
      setError(null);
      return;
    }
    if (settingsQuery.isPending) return;
    setMode(emailToClientEnabled ? "choice" : "self");
  }, [open, emailToClientEnabled, settingsQuery.isPending]);

  const resetSelf = useCallback(() => {
    setFiles([]);
    setDragOver(false);
    setError(null);
  }, []);

  if (!open) {
    return null;
  }

  if (settingsQuery.isPending) {
    return (
      <div
        className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/55 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nova-os-arquivos-title"
      >
        <div className="flex items-center gap-2 rounded-lg bg-white px-6 py-4 text-sm text-slate-600 shadow-xl">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Carregando opções…
        </div>
      </div>
    );
  }

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

  const handleSendEmail = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Informe o e-mail do cliente.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await sendOsArquivosClientEmail(ano, osId, trimmed);
      window.alert(res.message || "E-mail enviado ao cliente.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao enviar e-mail.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmSelf = async () => {
    if (!files.length) {
      setError("Adicione pelo menos um arquivo.");
      return;
    }
    setBusy(true);
    setError(null);
    setUploadPct(0);
    setUploadLabel("Enviando arquivos…");
    try {
      const res = await finalizeOsArquivosInterno(ano, osId, files, ponto, (pct, label) => {
        setUploadPct(pct);
        if (label) setUploadLabel(label);
      });
      window.alert(
        `Arquivos enviados (${res.files?.length ?? 0}) para a pasta ${res.folder ?? "Original"}.`,
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao enviar arquivos.");
    } finally {
      setBusy(false);
      setUploadPct(0);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nova-os-arquivos-title"
    >
      <div
        className={cn(
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border-t-4 border-primary-green bg-white shadow-xl transition-all",
          mode === "self" ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2
              id="nova-os-arquivos-title"
              className="text-lg font-semibold text-secondary-blue"
            >
              Arquivos da OS {osId}/{ano}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {emailToClientEnabled
                ? "Envie os arquivos ao cliente por e-mail ou inclua você mesmo na pasta Original."
                : "Inclua os arquivos na pasta Original da OS."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {mode === "choice" && emailToClientEnabled ? (
            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium text-slate-700">
                E-mail do cliente
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="cliente@exemplo.gov.br"
                autoComplete="email"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSendEmail()}
                className="flex items-center justify-center gap-2 rounded-lg bg-secondary-blue px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Mail className="size-4" aria-hidden />
                )}
                Enviar e-mail ao cliente
              </button>
              <div className="relative py-1 text-center text-xs text-slate-400">
                <span className="bg-white px-2">ou</span>
                <div className="absolute inset-x-0 top-1/2 -z-10 border-t border-slate-200" />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  resetSelf();
                  setMode("self");
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-secondary-blue hover:bg-slate-50"
              >
                <Upload className="size-4" aria-hidden />
                Eu incluo os arquivos
              </button>
            </div>
          ) : null}

          {mode === "self" && busy ? (
            <UploadProgressBar pct={uploadPct} label={uploadLabel} />
          ) : null}

          {mode === "self" ? (
            <div className="space-y-4">
              {emailToClientEnabled ? (
                <button
                  type="button"
                  className="text-sm text-secondary-blue hover:underline"
                  onClick={() => {
                    resetSelf();
                    setMode("choice");
                  }}
                >
                  ← Voltar
                </button>
              ) : null}
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
                  if (e.dataTransfer.files?.length) {
                    addFiles(e.dataTransfer.files);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={cn(
                  "flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm text-slate-600",
                  dragOver
                    ? "border-primary-green bg-green-50"
                    : "border-slate-300 bg-slate-50 hover:border-secondary-blue",
                )}
              >
                <Upload className="size-8 text-secondary-blue/80" aria-hidden />
                <span>Arraste arquivos aqui ou clique para selecionar</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              {files.length > 0 ? (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                  {files.map((f) => (
                    <li key={f.name} className="truncate">
                      {f.name}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-slate-300 px-4 py-2 text-sm"
          >
            Pular por agora
          </button>
          {mode === "self" ? (
            <button
              type="button"
              disabled={busy || !files.length}
              onClick={() => void handleConfirmSelf()}
              className="flex items-center gap-2 rounded bg-primary-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Confirmar envio
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
