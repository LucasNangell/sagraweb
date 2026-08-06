import { Loader2 } from "lucide-react";

import type { PapelariaField } from "@/features/papelaria/types";

type Props = {
  fields: PapelariaField[] | undefined;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
  /** Layout compacto ao lado da prévia por face. */
  compact?: boolean;
};

export function ClienteProofPapelariaFields({
  fields,
  values,
  onChange,
  disabled = false,
  compact = false,
}: Props) {
  if (!fields?.length) {
    return (
      <p className="rounded-xl border border-dashed border-sagra-border px-3 py-4 text-xs text-neutral-500">
        Não há campos editáveis para este modelo.
      </p>
    );
  }

  return (
    <div className={compact ? "flex flex-col gap-2" : "flex flex-col gap-3"}>
      {fields.map((field) => (
        <label
          key={field.key}
          className={compact ? "flex flex-col gap-0.5 text-xs" : "flex flex-col gap-1 text-sm"}
        >
          <span className="font-medium text-neutral-700">
            {field.label}
            {field.required ? <span className="text-red-600"> *</span> : null}
          </span>
          {field.type === "textarea" ? (
            <textarea
              className={
                compact
                  ? "min-h-16 rounded-lg border border-sagra-border px-2 py-1.5 text-xs disabled:bg-slate-50"
                  : "min-h-20 rounded-xl border border-sagra-border px-3 py-2 text-sm disabled:bg-slate-50"
              }
              rows={compact ? Math.min(field.rows ?? 2, 3) : (field.rows ?? 2)}
              value={values[field.key] ?? ""}
              disabled={disabled}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          ) : (
            <input
              type={field.type === "email" ? "email" : "text"}
              className={
                compact
                  ? "min-h-9 rounded-lg border border-sagra-border px-2 py-1.5 text-xs disabled:bg-slate-50"
                  : "min-h-10 rounded-xl border border-sagra-border px-3 py-2 text-sm disabled:bg-slate-50"
              }
              value={values[field.key] ?? ""}
              disabled={disabled}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}

export function ClienteProofPapelariaFieldsLoading() {
  return (
    <p className="flex items-center gap-2 py-4 text-sm text-neutral-500">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Carregando campos do trabalho…
    </p>
  );
}
