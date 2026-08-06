import { cn } from "@sagra/ui";
import { ChevronDown, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { MultiSelectOption } from "./multi-select";

interface SearchableMultiSelectProps {
  id?: string;
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  onOpen?: () => void;
  onSearchChange?: (query: string) => void;
  searchQuery?: string;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
}

export function SearchableMultiSelect({
  id,
  label,
  options,
  value,
  onChange,
  onOpen,
  onSearchChange,
  searchQuery = "",
  placeholder = "Selecione...",
  disabled = false,
  isLoading = false,
  className,
}: SearchableMultiSelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const searchId = `${fieldId}-search`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const summary =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? value[0]
        : `${value.length} selecionados`;

  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  const mergedOptions: MultiSelectOption[] = [...options];
  for (const selected of value) {
    if (!mergedOptions.some((o) => o.value === selected)) {
      mergedOptions.push({ value: selected, label: selected });
    }
  }
  mergedOptions.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  const handleOpen = () => {
    if (disabled) {
      return;
    }
    const next = !open;
    setOpen(next);
    if (next) {
      onOpen?.();
    }
  };

  return (
    <div ref={rootRef} className={cn("relative min-w-0 flex-1", className)}>
      <label htmlFor={fieldId} className="mb-1 block text-xs font-semibold text-neutral-600">
        {label}
      </label>
      <button
        id={fieldId}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded border border-sagra-border bg-white px-2 text-left text-sm",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className={cn("truncate", value.length === 0 && "text-neutral-400")}>
          {summary}
        </span>
        <ChevronDown className="size-4 shrink-0 text-neutral-500" />
      </button>

      {value.length > 0 && (
        <button
          type="button"
          className="absolute right-8 top-[1.65rem] text-neutral-400 hover:text-neutral-700"
          onClick={(e) => {
            e.stopPropagation();
            onChange([]);
          }}
          aria-label={`Limpar ${label}`}
        >
          <X className="size-3.5" />
        </button>
      )}

      {open && !disabled && (
        <div className="absolute z-40 mt-1 w-full rounded border border-sagra-border bg-white shadow-lg">
          <div className="border-b border-sagra-border/60 p-2">
            <input
              id={searchId}
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Digite para filtrar..."
              className="h-8 w-full rounded border border-sagra-border px-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green/30"
              autoComplete="off"
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {isLoading ? (
              <p className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-500">
                <Loader2 className="size-3.5 animate-spin" />
                Carregando...
              </p>
            ) : mergedOptions.length === 0 ? (
              <p className="px-3 py-2 text-sm text-neutral-500">Nenhuma opção</p>
            ) : (
              mergedOptions.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={value.includes(opt.value)}
                    onChange={() => toggle(opt.value)}
                    className="accent-primary-green"
                  />
                  <span className="truncate">{opt.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
