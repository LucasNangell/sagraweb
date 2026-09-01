import { cn } from "@sagra/ui";
import { ChevronDown, Loader2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

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
  /** `top` (padrão) = rótulo acima; `left` = rótulo à esquerda com ":". */
  labelSide?: "top" | "left";
  hideLabel?: boolean;
  "aria-label"?: string;
  /** Playwright/Testing Library `data-testid` on the trigger only. */
  testId?: string;
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
  labelSide = "top",
  hideLabel = false,
  "aria-label": ariaLabel,
  testId,
}: SearchableMultiSelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const searchId = `${fieldId}-search`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const isLeft = labelSide === "left";
  const showLabel = !hideLabel && Boolean(label);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const focusSearch = () => searchRef.current?.focus({ preventScroll: true });
    focusSearch();
    const t = window.setTimeout(focusSearch, 0);
    return () => window.clearTimeout(t);
  }, [open]);

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

  const control = (
    <div className="relative min-w-0 flex-1">
      <button
        id={fieldId}
        type="button"
        disabled={disabled}
        data-testid={testId}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (disabled || e.ctrlKey || e.metaKey || e.altKey) {
            return;
          }
          if (e.key.length === 1 && e.key !== " ") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              onOpen?.();
            }
            onSearchChange?.((open ? searchQuery : "") + e.key);
          }
        }}
        aria-label={ariaLabel ?? (hideLabel || !showLabel ? label || undefined : undefined)}
        className={cn(
          "flex h-9 w-full items-center gap-1 rounded border border-sagra-border bg-white pl-2 pr-2 text-left text-sm",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            value.length === 0 && "text-neutral-400",
          )}
        >
          {summary}
        </span>
        {value.length > 0 ? (
          <span className="size-3.5 shrink-0" aria-hidden />
        ) : null}
        <ChevronDown className="size-4 shrink-0 text-neutral-500" />
      </button>

      {value.length > 0 && (
        <button
          type="button"
          className="absolute right-7 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
          onClick={(e) => {
            e.stopPropagation();
            onChange([]);
          }}
          aria-label={`Limpar ${label || ariaLabel || "seleção"}`}
        >
          <X className="size-3.5" />
        </button>
      )}

      {open && !disabled && (
        <div className="absolute z-40 mt-1 w-full rounded border border-sagra-border bg-white shadow-lg">
          <div className="border-b border-sagra-border/60 p-2">
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Digite para filtrar..."
              className="h-8 w-full rounded border border-sagra-border px-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green/30"
              autoComplete="off"
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
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

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative min-w-0",
        isLeft ? "flex items-center gap-2" : "flex-1",
        className,
      )}
    >
      {showLabel ? (
        <label
          htmlFor={fieldId}
          className={cn(
            "text-xs font-semibold text-neutral-600",
            isLeft ? "mb-0 shrink-0 whitespace-nowrap" : "mb-1 block",
          )}
        >
          {isLeft ? `${label}:` : label}
        </label>
      ) : null}
      {control}
    </div>
  );
}
