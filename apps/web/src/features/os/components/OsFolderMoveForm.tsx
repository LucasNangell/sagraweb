import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import {
  executeOsFolderMove,
  previewOsFolderMove,
  type OsFolderMoveExecuteResponse,
  type OsFolderMovePreviewResponse,
} from "@/api/os";
import { formatDateBr } from "@/lib/format";
import { homeTestIds } from "@/lib/testId";

import { normalizeOsYear } from "../normalizeOsYear";

export type OsFolderMoveVariant = "mover" | "repeticao";

export interface OsFolderMoveFormProps {
  destAno: number;
  destId: number;
  variant: OsFolderMoveVariant;
  defaultOrigemNumero?: string;
  defaultOrigemAno?: string;
  onSuccess: (result: OsFolderMoveExecuteResponse) => void;
  onCancel: () => void;
  cancelLabel?: string;
}

export function OsFolderMoveForm({
  destAno,
  destId,
  variant,
  defaultOrigemNumero = "",
  defaultOrigemAno = "",
  onSuccess,
  onCancel,
  cancelLabel = "Cancelar",
}: OsFolderMoveFormProps) {
  const [origemNumero, setOrigemNumero] = useState(defaultOrigemNumero);
  const [origemAno, setOrigemAno] = useState(defaultOrigemAno);
  const [preview, setPreview] = useState<OsFolderMovePreviewResponse | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);

  useEffect(() => {
    setOrigemNumero(defaultOrigemNumero);
    setOrigemAno(defaultOrigemAno);
    setPreview(null);
    setPreviewError(null);
    setConfirmMismatch(false);
    setConfirmIncomplete(false);
  }, [defaultOrigemNumero, defaultOrigemAno, destAno, destId]);

  const resetPreview = () => {
    setPreview(null);
    setPreviewError(null);
    setConfirmMismatch(false);
    setConfirmIncomplete(false);
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      const origemId = Number(origemNumero.trim());
      const ano = normalizeOsYear(origemAno);
      if (!origemId || ano == null) {
        throw new Error("Informe o número e o ano da OS de origem.");
      }
      return previewOsFolderMove(destAno, destId, ano, origemId);
    },
    onSuccess: (data) => {
      setPreview(data);
      setPreviewError(null);
      setConfirmMismatch(false);
      setConfirmIncomplete(false);
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
      if (!preview) {
        throw new Error("Conferir os dados antes de mover.");
      }
      const origemId = Number(origemNumero.trim());
      const ano = normalizeOsYear(origemAno);
      if (!origemId || ano == null) {
        throw new Error("Informe o número e o ano da OS de origem.");
      }
      const origemNaoConcluida = preview.origem_concluida === false;
      return executeOsFolderMove(destAno, destId, {
        origem_ano: ano,
        origem_id: origemId,
        confirm_meta_mismatch: preview.meta_mismatch && confirmMismatch,
        append_repeticao_observ: variant === "repeticao",
        confirm_origem_nao_concluida:
          variant === "repeticao" && origemNaoConcluida && confirmIncomplete,
      });
    },
    onSuccess,
    onError: (error) => {
      window.alert(
        error instanceof Error ? error.message : "Falha ao mover pastas.",
      );
    },
  });

  const busy = previewMutation.isPending || moveMutation.isPending;
  const origemNaoConcluida =
    variant === "repeticao" && preview?.origem_concluida === false;
  const canMove =
    Boolean(preview?.can_execute) &&
    (!preview?.meta_mismatch || confirmMismatch) &&
    (!origemNaoConcluida || confirmIncomplete) &&
    !busy;

  return (
    <div>
      <p className="text-xs text-neutral-500">
        Informe a OS de origem. Todas as subpastas serão transferidas; Original e
        Sefoc serão renomeadas com o prefixo da OS de origem.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="font-medium">Nº OS origem</span>
          <input
            type="number"
            value={origemNumero}
            onChange={(e) => {
              setOrigemNumero(e.target.value);
              resetPreview();
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
              resetPreview();
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

      {origemNaoConcluida ? (
        <div
          className="mt-3 rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-amber-950 shadow-sm"
          role="alert"
        >
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-800">
            <AlertTriangle className="size-5 shrink-0" aria-hidden />
            Esta OS ainda não foi concluída
          </p>
          <p className="mt-1 text-sm">
            Andamento atual:{" "}
            <strong>{preview?.origem_situacao || "não informado"}</strong>.
            Confirme se deseja transferir os arquivos mesmo assim.
          </p>
          {(preview?.origem_andamentos?.length ?? 0) > 0 ? (
            <div className="mt-2 max-h-40 overflow-auto rounded border border-amber-200 bg-white/80">
              <table className="w-full text-left text-xs">
                <thead className="bg-amber-100/80 text-amber-900">
                  <tr>
                    <th className="px-2 py-1 font-semibold">Data</th>
                    <th className="px-2 py-1 font-semibold">Situação</th>
                    <th className="px-2 py-1 font-semibold">Setor</th>
                    <th className="px-2 py-1 font-semibold">Ponto</th>
                  </tr>
                </thead>
                <tbody>
                  {preview?.origem_andamentos?.map((row, index) => (
                    <tr
                      key={`${row.data ?? ""}-${row.situacao ?? ""}-${index}`}
                      className="border-t border-amber-100"
                    >
                      <td className="px-2 py-1">
                        {formatDateBr(row.data) || "-"}
                      </td>
                      <td className="px-2 py-1">{row.situacao || "-"}</td>
                      <td className="px-2 py-1">{row.setor || "-"}</td>
                      <td className="px-2 py-1">{row.ponto || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <label className="mt-3 flex items-start gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={confirmIncomplete}
              onChange={(e) => setConfirmIncomplete(e.target.checked)}
              className="mt-0.5"
            />
            Confirmo a transferência de arquivos desta OS ainda não concluída
          </label>
        </div>
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
              A pasta da OS destino será criada automaticamente (mesmo padrão de
              &quot;Abrir pasta&quot;).
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          disabled={busy}
          data-testid={
            variant === "repeticao"
              ? homeTestIds.osArquivosSkip
              : homeTestIds.osMoverCancel
          }
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => moveMutation.mutate()}
          disabled={!canMove}
          className="rounded bg-primary-green px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          data-testid={
            variant === "repeticao"
              ? homeTestIds.osArquivosConfirm
              : homeTestIds.osMoverConfirm
          }
        >
          {moveMutation.isPending ? "Movendo…" : "Mover pastas"}
        </button>
      </div>
    </div>
  );
}
