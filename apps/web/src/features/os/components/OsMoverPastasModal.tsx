import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, FolderInput, X } from "lucide-react";
import { useEffect, useState } from "react";

import { executeOsFolderMove, previewOsFolderMove } from "@/api/os";
import { normalizeOsYear } from "../normalizeOsYear";
import type { OsSearchRow } from "../types";

interface OsMoverPastasModalProps {
  row: OsSearchRow | null;
  open: boolean;
  onClose: () => void;
}

export function OsMoverPastasModal({
  row,
  open,
  onClose,
}: OsMoverPastasModalProps) {
  const [origemNumero, setOrigemNumero] = useState("");
  const [origemAno, setOrigemAno] = useState("");
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewOsFolderMove>
  > | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmMismatch, setConfirmMismatch] = useState(false);

  useEffect(() => {
    if (!open) {
      setOrigemNumero("");
      setOrigemAno("");
      setPreview(null);
      setPreviewError(null);
      setConfirmMismatch(false);
    }
  }, [open]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!row) {
        throw new Error("Selecione uma OS de destino.");
      }
      const origemId = Number(origemNumero.trim());
      const ano = normalizeOsYear(origemAno);
      if (!origemId || ano == null) {
        throw new Error("Informe o número e o ano da OS de origem.");
      }
      return previewOsFolderMove(row.ano, row.nr_os, ano, origemId);
    },
    onSuccess: (data) => {
      setPreview(data);
      setPreviewError(null);
      setConfirmMismatch(false);
    },
    onError: (error) => {
      setPreview(null);
      setPreviewError(
        error instanceof Error ? error.message : "Não foi possível conferir.",
      );
    },
  });

  const moveMutation = useMutation({
    mutationFn: async () => {
      if (!row || !preview) {
        throw new Error("Conferir os dados antes de mover.");
      }
      const origemId = Number(origemNumero.trim());
      const ano = normalizeOsYear(origemAno);
      if (!origemId || ano == null) {
        throw new Error("Informe o número e o ano da OS de origem.");
      }
      return executeOsFolderMove(row.ano, row.nr_os, {
        origem_ano: ano,
        origem_id: origemId,
        confirm_meta_mismatch: preview.meta_mismatch && confirmMismatch,
      });
    },
    onSuccess: (result) => {
      const moved = result.moved_folders.map((item) => item.to_name).join(", ");
      window.alert(
        `Pastas movidas com sucesso para OS ${row?.nr_os}/${row?.ano}.\n\n` +
          `Itens: ${moved}\n` +
          (result.dest_folder_created
            ? "\nA pasta de destino foi criada na rede."
            : ""),
      );
      onClose();
    },
    onError: (error) => {
      window.alert(
        error instanceof Error ? error.message : "Falha ao mover pastas.",
      );
    },
  });

  if (!open) {
    return null;
  }

  const busy = previewMutation.isPending || moveMutation.isPending;
  const canMove =
    preview?.can_execute &&
    (!preview.meta_mismatch || confirmMismatch) &&
    !busy;

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mover-pastas-title"
    >
      <div className="relative w-full max-w-xl rounded-lg border-t-4 border-[#24344D] bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 text-neutral-500 hover:text-neutral-800"
          aria-label="Fechar"
        >
          <X className="size-5" />
        </button>

        <h3
          id="mover-pastas-title"
          className="flex items-center gap-2 text-lg font-semibold text-primary-green"
        >
          <FolderInput className="size-5" aria-hidden />
          Mover Pastas
        </h3>
        <p className="mt-1 text-sm text-neutral-600">
          OS destino (atual):{" "}
          <strong>
            {row?.nr_os}/{row?.ano}
          </strong>
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Informe a OS de origem. Todas as subpastas serão transferidas;
          Original e Sefoc serão renomeadas com o prefixo da OS de origem.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="font-medium">Nº OS origem</span>
            <input
              type="number"
              value={origemNumero}
              onChange={(e) => {
                setOrigemNumero(e.target.value);
                setPreview(null);
                setPreviewError(null);
                setConfirmMismatch(false);
              }}
              className="mt-1 h-9 w-full rounded border border-sagra-border px-2 text-sm"
              placeholder="Ex: 5024"
              disabled={busy}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium">Ano origem</span>
            <input
              type="number"
              value={origemAno}
              onChange={(e) => {
                setOrigemAno(e.target.value);
                setPreview(null);
                setPreviewError(null);
                setConfirmMismatch(false);
              }}
              className="mt-1 h-9 w-full rounded border border-sagra-border px-2 text-sm"
              placeholder="Ex: 26"
              disabled={busy}
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => previewMutation.mutate()}
          disabled={busy || !origemNumero.trim() || !origemAno.trim()}
          className="mt-3 rounded bg-secondary-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {previewMutation.isPending ? "Conferindo…" : "Conferir"}
        </button>

        {previewError ? (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {previewError}
          </p>
        ) : null}

        {preview?.meta_mismatch ? (
          <div
            className="mt-3 rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-amber-950 shadow-sm"
            role="alert"
          >
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-800">
              <AlertTriangle className="size-5 shrink-0" aria-hidden />
              Atenção — solicitante ou produto diferente
            </p>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded bg-white/70 p-2">
                <p className="text-xs font-semibold text-amber-900">Destino</p>
                <p>{preview.dest_solicitante}</p>
                <p className="text-xs text-amber-800">{preview.dest_produto}</p>
              </div>
              <div className="rounded bg-white/70 p-2">
                <p className="text-xs font-semibold text-amber-900">Origem</p>
                <p>{preview.origem_solicitante}</p>
                <p className="text-xs text-amber-800">{preview.origem_produto}</p>
              </div>
            </div>
            <label className="mt-3 flex items-start gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={confirmMismatch}
                onChange={(e) => setConfirmMismatch(e.target.checked)}
                className="mt-0.5"
              />
              Estou ciente e desejo continuar mesmo assim
            </label>
          </div>
        ) : null}

        {preview && !preview.origem_folder_exists ? (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Pasta da OS de origem não encontrada na rede.
          </p>
        ) : null}

        {preview && preview.dest_conflicts.length > 0 ? (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Conflito na pasta destino: {preview.dest_conflicts.join(", ")}
          </p>
        ) : null}

        {preview && preview.folders_to_move.length > 0 ? (
          <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-slate-800">Subpastas a mover</p>
            <ul className="mt-1 list-inside list-disc text-slate-700">
              {preview.folders_to_move.map((item) => (
                <li key={item.from_name}>
                  {item.from_name} → {item.to_name}
                </li>
              ))}
            </ul>
            {!preview.dest_folder_exists ? (
              <p className="mt-2 text-xs text-slate-600">
                A pasta da OS destino será criada automaticamente (mesmo padrão
                de &quot;Abrir pasta&quot;).
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => moveMutation.mutate()}
            disabled={!canMove}
            className="rounded bg-primary-green px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {moveMutation.isPending ? "Movendo…" : "Mover pastas"}
          </button>
        </div>
      </div>
    </div>
  );
}
