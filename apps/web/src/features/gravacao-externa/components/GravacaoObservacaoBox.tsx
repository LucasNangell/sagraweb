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
          Observações para o birô
        </h4>
        {editable && !editing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(observacao ?? "");
              setEditing(true);
            }}
            className="sagra-btn sagra-btn--warning sagra-btn--sm"
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
              className="sagra-btn sagra-btn--outline sagra-btn--sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="sagra-btn sagra-btn--primary sagra-btn--md"
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
