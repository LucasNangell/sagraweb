import { memo, type ReactNode } from "react";
import { cn } from "@sagra/ui";
import { RotateCcw } from "lucide-react";

export type PapelariaFieldRowProps = {
  fieldKey: string;
  label: string;
  value: string;
  /** Valor original (retrato do Corel / modelo) — exibe indicador de alteração. */
  original?: string;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  inputType?: "text" | "email";
  placeholder?: string;
  excluded?: boolean;
  alteracaoCliente?: { antes: string; depois: string } | null;
  hint?: ReactNode;
  trailing?: ReactNode;
  onChange: (key: string, value: string) => void;
  onReset?: (key: string) => void;
  onToggleExclude?: (key: string) => void;
};

function formatValor(value: string): string {
  return value.trim() || "—";
}

/**
 * Linha de campo memoizada: digitar em um campo não re-renderiza os demais
 * (handlers estáveis vindos do painel).
 */
export const PapelariaFieldRow = memo(function PapelariaFieldRow({
  fieldKey,
  label,
  value,
  original,
  multiline = false,
  rows,
  required = false,
  inputType = "text",
  placeholder,
  excluded = false,
  alteracaoCliente,
  hint,
  trailing,
  onChange,
  onReset,
  onToggleExclude,
}: PapelariaFieldRowProps) {
  const dirty = original !== undefined && value !== original;
  const inputId = `papelaria-field-${fieldKey}`;
  const inputClass = cn(
    "w-full rounded-md border bg-white px-2.5 py-1.5 text-xs text-neutral-900 shadow-[inset_0_1px_0_rgba(15,23,42,0.03)] outline-none transition",
    "placeholder:text-neutral-400 focus:border-secondary-blue focus:ring-2 focus:ring-secondary-blue/15",
    alteracaoCliente
      ? "border-amber-400 bg-amber-50/60"
      : dirty
        ? "border-secondary-blue/60 bg-sky-50/40"
        : "border-sagra-border",
    excluded && "border-neutral-200 bg-neutral-100 text-neutral-400 line-through",
  );

  return (
    <div
      className={cn(
        "group rounded-md px-1 py-1 transition-colors",
        alteracaoCliente && "bg-amber-50/50 ring-1 ring-amber-200",
        excluded && "opacity-70",
      )}
      data-field-key={fieldKey}
    >
      <div className="mb-0.5 flex min-h-5 items-center gap-1.5">
        <label
          htmlFor={inputId}
          className={cn(
            "min-w-0 flex-1 truncate text-[11px] font-semibold text-neutral-700",
            excluded && "text-neutral-400 line-through",
          )}
          title={label}
        >
          {label}
          {required && !excluded ? <span className="text-sagra-danger"> *</span> : null}
        </label>
        {dirty ? (
          <span
            className="size-1.5 shrink-0 rounded-full bg-secondary-blue"
            title="Alterado"
            aria-label="Alterado"
          />
        ) : null}
        {alteracaoCliente ? (
          <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-amber-800">
            Cliente
          </span>
        ) : null}
        {dirty && onReset ? (
          <button
            type="button"
            onClick={() => onReset(fieldKey)}
            className="shrink-0 rounded p-0.5 text-neutral-400 opacity-0 transition hover:bg-slate-100 hover:text-neutral-700 group-hover:opacity-100 focus:opacity-100"
            title="Desfazer alteração"
            aria-label={`Desfazer alteração em ${label}`}
          >
            <RotateCcw className="size-3" aria-hidden />
          </button>
        ) : null}
        {onToggleExclude ? (
          <button
            type="button"
            onClick={() => onToggleExclude(fieldKey)}
            className={cn(
              "shrink-0 rounded border px-1.5 py-px text-[9px] font-semibold transition-colors",
              excluded
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "border-transparent text-neutral-400 opacity-0 hover:border-red-200 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100",
            )}
            title={excluded ? "Restaurar campo no modelo" : "Excluir campo do modelo"}
          >
            {excluded ? "Restaurar" : "Excluir"}
          </button>
        ) : null}
        {trailing}
      </div>
      {multiline ? (
        <textarea
          id={inputId}
          className={cn(inputClass, "resize-y leading-snug")}
          rows={rows ?? Math.min(5, Math.max(2, value.split("\n").length))}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(fieldKey, e.target.value)}
          disabled={excluded}
        />
      ) : (
        <input
          id={inputId}
          type={inputType}
          className={inputClass}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(fieldKey, e.target.value)}
          disabled={excluded}
        />
      )}
      {alteracaoCliente && !excluded ? (
        <p className="mt-1 text-[10px] leading-relaxed text-amber-900/90">
          <span className="font-medium">Anterior:</span> {formatValor(alteracaoCliente.antes)}
          <span className="mx-1 text-amber-700">→</span>
          <span className="font-medium">Novo:</span> {formatValor(alteracaoCliente.depois)}
        </p>
      ) : null}
      {hint ? <div className="mt-0.5 text-[10px] text-neutral-500">{hint}</div> : null}
    </div>
  );
});
