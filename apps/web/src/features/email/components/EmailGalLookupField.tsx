import { cn } from "@sagra/ui";
import { Loader2, Search } from "lucide-react";
import { useState } from "react";

import { fetchGalResolve } from "@/api/email";
import type { GalContactItem } from "../types";
import { emailInputClass, emailLabelClass } from "./email-ui";

interface EmailGalLookupFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onToast?: (msg: string) => void;
  onError?: (msg: string) => void;
  /** Usado na busca se o campo estiver vazio ou com menos de 2 caracteres (ex.: P_918713). */
  fallbackQuery?: string;
  inputId?: string;
  /** `form` alinha estilos a formulários administrativos (ex.: cadastro de usuários). */
  variant?: "email" | "form";
  className?: string;
}

export function EmailGalLookupField({
  label,
  value,
  onChange,
  onToast,
  onError,
  fallbackQuery,
  inputId,
  variant = "email",
  className,
}: EmailGalLookupFieldProps) {
  const [searching, setSearching] = useState(false);
  const [options, setOptions] = useState<GalContactItem[]>([]);
  const [open, setOpen] = useState(false);

  const labelClass =
    variant === "form"
      ? "mb-1 block text-xs font-medium text-slate-600"
      : cn(emailLabelClass, "block");
  const inputClass =
    variant === "form"
      ? "mt-0 min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
      : cn(emailInputClass, "mt-0 min-w-0 flex-1 pr-2");

  const handleSearch = async () => {
    let q = value.trim();
    if (q.length < 2) {
      q = (fallbackQuery ?? "").trim();
    }
    if (q.length < 2) {
      onToast?.("Informe um ponto, nome ou e-mail para buscar no catálogo.");
      return;
    }

    setSearching(true);
    setOptions([]);
    try {
      const res = await fetchGalResolve(q);
      if (res.items.length === 0) {
        onToast?.("Nenhum contato encontrado no catálogo global.");
        setOpen(false);
        return;
      }
      if (res.items.length === 1) {
        onChange(res.items[0].email);
        setOpen(false);
        onToast?.(`${res.items[0].name} → ${res.items[0].email}`);
        return;
      }
      setOptions(res.items);
      setOpen(true);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Falha ao consultar o catálogo global.";
      if (onError) {
        onError(msg);
      } else {
        onToast?.(msg);
      }
      setOpen(false);
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = (item: GalContactItem) => {
    onChange(item.email);
    setOpen(false);
    setOptions([]);
  };

  return (
    <div className={cn("relative", className)}>
      <label className={labelClass}>
        {label}
        <div className={cn("relative flex gap-1", variant === "email" && "mt-1.5")}>
          <input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(false);
            }}
            className={inputClass}
            autoComplete="off"
          />
          <button
            type="button"
            title="Buscar no catálogo global do Exchange"
            aria-label={`Buscar ${label} no catálogo global`}
            disabled={searching}
            onClick={() => void handleSearch()}
            className="inline-flex h-[42px] w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-secondary-blue hover:text-secondary-blue disabled:opacity-60"
          >
            {searching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Search className="size-4" aria-hidden />
            )}
          </button>
        </div>
      </label>

      {open && options.length > 1 ? (
        <ul
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
          role="listbox"
        >
          {options.map((item) => {
            const meta = [item.cargo, item.departamento].filter(Boolean).join(" · ");
            return (
              <li key={`${item.email}-${item.name}`}>
                <button
                  type="button"
                  role="option"
                  className="w-full px-3 py-2.5 text-left hover:bg-slate-50"
                  onClick={() => handleSelect(item)}
                >
                  <span className="block font-medium text-slate-800">
                    {item.name || item.email}
                  </span>
                  {meta ? (
                    <span className="block text-xs text-slate-600">{meta}</span>
                  ) : null}
                  <span className="block text-xs text-slate-500">{item.email}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
