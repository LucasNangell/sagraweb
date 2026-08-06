import { cn } from "@sagra/ui";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  id?: string;
  label: string;
  options: string[] | MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** `top` (padrão) = rótulo acima; `left` = rótulo à esquerda com ":". */
  labelSide?: "top" | "left";
  /** Quando true, não renderiza o rótulo (use aria-label no botão). */
  hideLabel?: boolean;
  "aria-label"?: string;
}

function normalizeOptions(
  options: string[] | MultiSelectOption[],
): MultiSelectOption[] {
  return options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );
}

function matchesQuery(opt: MultiSelectOption, query: string): boolean {
  const q = query.trim().toLocaleLowerCase("pt-BR");
  if (!q) {
    return true;
  }
  return (
    opt.label.toLocaleLowerCase("pt-BR").includes(q) ||
    opt.value.toLocaleLowerCase("pt-BR").includes(q)
  );
}

export function MultiSelect({
  id,
  label,
  options,
  value,
  onChange,
  placeholder = "Selecione...",
  disabled = false,
  className,
  labelSide = "top",
  hideLabel = false,
  "aria-label": ariaLabel,
}: MultiSelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const searchId = `${fieldId}-search`;
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const normalized = normalizeOptions(options);
  const isLeft = labelSide === "left";
  const showLabel = !hideLabel && Boolean(label);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setSearchQuery("");
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
    // Garantir após o clique do botão (alguns browsers devolvem o foco ao trigger).
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

  const visibleOptions = (() => {
    const merged: MultiSelectOption[] = [...normalized];
    for (const selected of value) {
      if (!merged.some((o) => o.value === selected)) {
        merged.push({ value: selected, label: selected });
      }
    }
    return merged.filter(
      (opt) => value.includes(opt.value) || matchesQuery(opt, searchQuery),
    );
  })();

  const handleOpen = () => {
    if (disabled) {
      return;
    }
    const next = !open;
    setOpen(next);
    if (!next) {
      setSearchQuery("");
    }
  };

  const control = (
    <div className="relative min-w-0 flex-1">
      <button
        id={fieldId}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (disabled || e.ctrlKey || e.metaKey || e.altKey) {
            return;
          }
          if (e.key.length === 1 && e.key !== " ") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
            }
            setSearchQuery((prev) => (open ? prev : "") + e.key);
          }
        }}
        aria-label={ariaLabel ?? (hideLabel || !showLabel ? label || undefined : undefined)}
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
          className="absolute right-8 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
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
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Digite para filtrar..."
              className="h-8 w-full rounded border border-sagra-border px-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green/30"
              autoComplete="off"
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              disabled={normalized.length === 0}
              onClick={(e) => {
                e.stopPropagation();
                if (value.length > 0) {
                  onChange([]);
                } else {
                  onChange(normalized.map((o) => o.value));
                }
              }}
              className="mt-1.5 text-xs font-semibold text-primary-green hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
            >
              {value.length > 0 ? "Limpar seleção" : "Selecionar tudo"}
            </button>
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {normalized.length === 0 ? (
              <p className="px-3 py-2 text-sm text-neutral-500">Carregando...</p>
            ) : visibleOptions.length === 0 ? (
              <p className="px-3 py-2 text-sm text-neutral-500">Nenhuma opção</p>
            ) : (
              visibleOptions.map((opt) => (
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
