import { cn } from "@sagra/ui";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  size?: "sm" | "md";
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  size = "sm",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex rounded border border-sagra-border bg-slate-50 p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded px-2 font-medium transition-colors",
              size === "sm" ? "text-[10px] leading-tight py-0.5" : "text-xs py-1",
              active
                ? "bg-white text-secondary-blue shadow-sm"
                : "text-neutral-500 hover:text-neutral-700",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
