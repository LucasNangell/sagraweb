import { cn } from "@sagra/ui";

import type { PapelariaViewMode } from "../papelariaViewMode";

type Props = {
  value: PapelariaViewMode;
  onChange: (mode: PapelariaViewMode) => void;
  className?: string;
};

const OPTIONS: ReadonlyArray<readonly [PapelariaViewMode, string]> = [
  ["previa", "Prévia"],
  ["prova", "Prova"],
  ["imposicao", "Imposição"],
];

export function PapelariaViewModeToggle({ value, onChange, className }: Props) {
  const index = Math.max(
    0,
    OPTIONS.findIndex(([id]) => id === value),
  );

  return (
    <div
      className={cn(
        "relative inline-flex rounded-full border border-sagra-border bg-slate-100 p-0.5",
        className,
      )}
      role="group"
      aria-label="Modo de visualização"
      data-testid="papelaria-view-mode-toggle"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 w-[calc(33.333%-2px)] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out"
        style={{
          transform: `translateX(calc(${index} * (100% + 2px) + 2px))`,
        }}
      />
      {OPTIONS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          data-testid={`papelaria-view-mode-${id}`}
          onClick={() => onChange(id)}
          className={cn(
            "relative z-10 min-w-[4.5rem] rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
            value === id
              ? "text-secondary-blue"
              : "text-neutral-500 hover:text-neutral-700",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
