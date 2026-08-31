import { useMemo } from "react";

import type { FormatoLookupItem } from "../formatoDimensions";
import { gerenciaInputClass } from "./gerenciaFormUi";

interface FormatoComboboxProps {
  value: string;
  formatos: FormatoLookupItem[];
  readOnly: boolean;
  onChange: (formato: string) => void;
  /** id do datalist; único por campo para não colidir com o Formato da OS. */
  listId?: string;
  placeholder?: string;
  "aria-label"?: string;
}

/** Lista distinta de formatos (FormatoLink) para sugestões do combobox. */
export function distinctFormatoOptions(formatos: FormatoLookupItem[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const f of formatos) {
    const nome = f.formato.trim();
    if (!nome || seen.has(nome)) continue;
    seen.add(nome);
    list.push(nome);
  }
  return list.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function FormatoCombobox({
  value,
  formatos,
  readOnly,
  onChange,
  listId = "gerencia-formatos-list",
  placeholder = "Selecione ou digite...",
  "aria-label": ariaLabel = "Formato",
}: FormatoComboboxProps) {
  const options = useMemo(() => distinctFormatoOptions(formatos), [formatos]);

  return (
    <>
      <input
        readOnly={readOnly}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={gerenciaInputClass}
        aria-label={ariaLabel}
      />
      <datalist id={listId}>
        {options.map((nome) => (
          <option key={nome} value={nome} />
        ))}
      </datalist>
    </>
  );
}
