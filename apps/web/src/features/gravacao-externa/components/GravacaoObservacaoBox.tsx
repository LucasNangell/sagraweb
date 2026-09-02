import { Loader2, Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";

interface GravacaoObservacaoBoxProps {
  observacao?: string | null;
  editable?: boolean;
  saving?: boolean;
  onSave?: (text: string) => void | Promise<void>;
}

export function GravacaoObservacaoBox({
  observacao,
  editable = false,
  saving = false,
  onSave,
}: GravacaoObservacaoBoxProps) {
  const text = (observacao ?? "").trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(observacao ?? "");

  useEffect(() => {
    if (!editing) {
      setDraft(observacao ?? "");
    }
  }, [observacao, editing]);

  if (!editable && !text) {
    return null;
  }

  const handleSave = async () => {
    if (!onSave) {
      setEditing(false);
      return;
    }
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // Mantém o modo de edição para o usuário corrigir.
    }
  };

  return (
    <div
      className="max-h-40 shrink-0 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-black"
      role="note"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-black">
          Observação
        </h4>
        {editable && !editing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(observacao ?? "");
              setEditing(true);
            }}
            className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
          >
            {text ? <Pencil className="size-3" /> : <Plus className="size-3" />}
            {text ? "Editar" : "Adicionar"}
          </button>
        ) : null}
      </div>

      {editable && editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            disabled={saving}
            className="w-full resize-none rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm text-black"
            placeholder="Observações adicionais (opcional)"
            aria-label="Texto da observação"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(observacao ?? "");
                setEditing(false);
              }}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1 rounded bg-primary-green px-2 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3 animate-spin" /> : null}
              Salvar
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-snug text-black">
          {text || "Nenhuma observação."}
        </p>
      )}
    </div>
  );
}
