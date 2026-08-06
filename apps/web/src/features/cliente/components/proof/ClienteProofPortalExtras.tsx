import { Loader2, MessageSquarePlus, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@sagra/ui";

interface ClienteProofAlteracoesAdicionaisModalProps {
  open: boolean;
  value: string;
  loading?: boolean;
  errorMsg?: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function ClienteProofAlteracoesAdicionaisModal({
  open,
  value,
  loading = false,
  errorMsg = null,
  onChange,
  onSubmit,
  onClose,
}: ClienteProofAlteracoesAdicionaisModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proof-alteracoes-adicionais-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-sagra-border bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="proof-alteracoes-adicionais-title"
            className="text-lg font-bold text-secondary-blue"
          >
            Alterações adicionais
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-1 text-neutral-500 hover:bg-slate-100 disabled:opacity-60"
            aria-label="Fechar"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <p className="mt-2 text-sm text-neutral-600">
          Descreva alterações que não estão disponíveis nos campos de edição da prova.
        </p>
        <label className="mt-4 flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">Alterações desejadas</span>
          <textarea
            className="min-h-32 rounded-xl border border-sagra-border px-3 py-2 text-sm"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Informe quais alterações você deseja."
            disabled={loading}
          />
        </label>
        {errorMsg ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {errorMsg}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="inline-flex min-h-11 items-center rounded-xl border border-sagra-border px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading || !value.trim()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Solicitar alterações
          </button>
        </div>
      </div>
    </div>
  );
}

interface ClienteProofExampleFileModalProps {
  open: boolean;
  loading?: boolean;
  errorMsg?: string | null;
  uploadedFiles: string[];
  onUpload: (files: FileList | File[]) => void;
  onClose: () => void;
}

export function ClienteProofExampleFileModal({
  open,
  loading = false,
  errorMsg = null,
  uploadedFiles,
  onUpload,
  onClose,
}: ClienteProofExampleFileModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proof-example-file-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-sagra-border bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="proof-example-file-title" className="text-lg font-bold text-secondary-blue">
            Enviar arquivo de exemplo
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-1 text-neutral-500 hover:bg-slate-100 disabled:opacity-60"
            aria-label="Fechar"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <p className="mt-2 text-sm text-neutral-600">
          Envie um arquivo de referência. Ele será salvo na pasta Original da ordem de serviço.
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
            if (e.dataTransfer.files?.length) onUpload(e.dataTransfer.files);
          }}
          onClick={() => !loading && fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!loading) fileInputRef.current?.click();
            }
          }}
          className={cn(
            "mt-4 flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm",
            dragOver
              ? "border-primary-green bg-green-50"
              : "border-slate-300 bg-white hover:border-secondary-blue",
            loading && "pointer-events-none opacity-60",
          )}
        >
          {loading ? (
            <Loader2 className="size-10 animate-spin text-secondary-blue" aria-hidden />
          ) : (
            <Upload className="size-10 text-secondary-blue" aria-hidden />
          )}
          <span>Arraste o arquivo ou clique para selecionar</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files);
            e.target.value = "";
          }}
        />
        {uploadedFiles.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm text-neutral-700">
            {uploadedFiles.map((name) => (
              <li key={name} className="rounded-lg bg-green-50 px-3 py-1.5 text-green-900">
                Arquivo enviado: {name}
              </li>
            ))}
          </ul>
        ) : null}
        {errorMsg ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {errorMsg}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="inline-flex min-h-11 items-center rounded-xl border border-sagra-border px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

interface ClienteProofPortalFloatingActionsProps {
  visible: boolean;
  onAlteracoesAdicionais: () => void;
  onExampleFile: () => void;
}

export function ClienteProofPortalFloatingActions({
  visible,
  onAlteracoesAdicionais,
  onExampleFile,
}: ClienteProofPortalFloatingActionsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!visible || !mounted) return null;

  return createPortal(
    <div
      role="group"
      aria-label="Ações de alteração da prova"
      className="pointer-events-none"
      style={{
        position: "fixed",
        right: "max(1.25rem, env(safe-area-inset-right, 0px))",
        bottom: "max(1.25rem, env(safe-area-inset-bottom, 0px))",
        zIndex: 120,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "0.5rem",
      }}
    >
      <button
        type="button"
        onClick={onExampleFile}
        className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-sagra-border bg-white px-4 py-2 text-sm font-semibold text-secondary-blue shadow-lg hover:bg-slate-50"
      >
        <Upload className="size-4" aria-hidden />
        Arquivo de exemplo
      </button>
      <button
        type="button"
        onClick={onAlteracoesAdicionais}
        className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full bg-secondary-blue px-5 py-2 text-sm font-semibold text-white shadow-lg hover:bg-secondary-blue/90"
      >
        <MessageSquarePlus className="size-4" aria-hidden />
        Alterações adicionais
      </button>
    </div>,
    document.body,
  );
}

export function ClienteProofPortalInstructionBanner() {
  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-4 text-sm leading-relaxed text-amber-950 sm:px-5">
      <p>
        Altere os dados do trabalho diretamente nos campos abaixo e veja uma prévia aproximada de
        como ficará o trabalho após as alterações.
      </p>
      <p className="mt-3 rounded-lg border border-amber-300/80 bg-amber-100/80 px-3 py-2.5 font-semibold text-amber-950">
        <span className="font-bold uppercase tracking-wide text-amber-900">Importante:</span>{" "}
        A prévia não constitui uma prova oficial. Ao solicitar as alterações você receberá uma nova
        prova para aprovação.
      </p>
      <p className="mt-3">
        Caso as alterações que você deseja não esteja disponível nos campo abaixo, clique no botão
        &quot;Alterações adicionais&quot; na parte inferior da tela e informe quais alterações
        deseja.
      </p>
    </div>
  );
}
