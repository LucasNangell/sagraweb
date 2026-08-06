import { useMemo } from "react";

import type { FormatoLookupItem } from "../formatoDimensions";
import { gerenciaInputClass } from "./gerenciaFormUi";

interface FormatoComboboxProps {
  value: string;
  formatos: FormatoLookupItem[];
  readOnly: boolean;
  onChange: (formato: string) => void;
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
}: FormatoComboboxProps) {
  const options = useMemo(() => distinctFormatoOptions(formatos), [formatos]);

  return (
    <>
      <input
        readOnly={readOnly}
        list="gerencia-formatos-list"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(e.target.value)}
        placeholder="Selecione ou digite..."
        className={gerenciaInputClass}
        aria-label="Formato"
      />
      <datalist id="gerencia-formatos-list">
        {options.map((nome) => (
          <option key={nome} value={nome} />
        ))}
      </datalist>
    </>
  );
}
