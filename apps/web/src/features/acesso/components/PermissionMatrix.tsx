import { cn } from "@sagra/ui";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { PermissionKey } from "@/features/auth/types";

import {
  groupCatalogByCategory,
  isPermissionInScope,
  PERMISSION_CATALOG,
  type PermissionCatalogEntry,
  type PermissionTarget,
} from "../permissionCatalog";

export type PermissionValues = Partial<Record<PermissionKey, boolean>>;

interface PermissionMatrixProps {
  target: PermissionTarget;
  values: PermissionValues;
  onChange: (next: PermissionValues) => void;
  disabled?: boolean;
  /**
   * Valores de referência exibidos ao lado de cada chave
   * (ex.: permissões de um terminal, para comparar com as do usuário).
   */
  referenceValues?: PermissionValues | null;
  referenceLabel?: string;
  /** Chaves geridas fora da matriz (ex.: painéis do usuário) — exibidas desabilitadas. */
  externallyManaged?: ReadonlyArray<PermissionKey>;
  externallyManagedHint?: string;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function outOfScopeHint(
  item: PermissionCatalogEntry,
  target: PermissionTarget,
): string {
  if (item.hint) return item.hint;
  return target === "ip" ? "Concedida apenas por usuário." : "Definida apenas no terminal.";
}

/**
 * Editor único de permissões (usuário ou terminal): checkboxes agrupados por categoria,
 * busca, marcar/desmarcar categoria e contador. Chaves fora do escopo do alvo aparecem
 * desabilitadas com a explicação. Nunca exige rolagem horizontal — as categorias empilham.
 */
export function PermissionMatrix({
  target,
  values,
  onChange,
  disabled = false,
  referenceValues,
  referenceLabel = "Ref.",
  externallyManaged = [],
  externallyManagedHint,
}: PermissionMatrixProps) {
  const [query, setQuery] = useState("");

  const managedSet = useMemo(() => new Set(externallyManaged), [externallyManaged]);

  const isEditable = (item: PermissionCatalogEntry) =>
    isPermissionInScope(item, target) && !managedSet.has(item.key);

  const editableKeys = useMemo(
    () =>
      PERMISSION_CATALOG.filter(
        (item) => isPermissionInScope(item, target) && !managedSet.has(item.key),
      ).map((item) => item.key),
    [managedSet, target],
  );

  const activeCount = editableKeys.filter((key) => Boolean(values[key])).length;

  const groups = useMemo(() => {
    const q = normalize(query.trim());
    const entries = q
      ? PERMISSION_CATALOG.filter(
          (item) =>
            normalize(item.label).includes(q) ||
            normalize(item.shortLabel).includes(q) ||
            item.key.includes(q),
        )
      : PERMISSION_CATALOG;
    return groupCatalogByCategory(entries);
  }, [query]);

  const setMany = (keys: PermissionKey[], value: boolean) => {
    const next = { ...values };
    for (const key of keys) next[key] = value;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar permissão</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar permissão…"
            className="h-9 w-full rounded-md border border-slate-300 pl-8 pr-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
          />
        </label>
        <span
          className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"
          data-testid="permission-matrix-count"
        >
          {activeCount} de {editableKeys.length} ativas
        </span>
      </div>

      {referenceValues ? (
        <p className="text-xs text-slate-600">
          Coluna <strong>{referenceLabel}</strong>: valor de referência para comparação (somente
          leitura).
        </p>
      ) : null}

      {groups.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">Nenhuma permissão encontrada.</p>
      ) : null}

      {groups.map((group) => {
        const groupEditable = group.entries.filter(isEditable).map((item) => item.key);
        const allOn =
          groupEditable.length > 0 && groupEditable.every((key) => Boolean(values[key]));
        return (
          <fieldset
            key={group.id}
            className="rounded-lg border border-slate-200"
            aria-label={group.label}
          >
            <legend className="sr-only">{group.label}</legend>
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {group.label}
              </span>
              {groupEditable.length > 0 ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setMany(groupEditable, !allOn)}
                  className="text-xs font-semibold text-secondary-blue hover:underline disabled:opacity-50"
                >
                  {allOn ? "Desmarcar categoria" : "Marcar categoria"}
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-slate-100">
              {group.entries.map((item) => {
                const editable = isEditable(item);
                const managed = managedSet.has(item.key);
                const hint = managed
                  ? externallyManagedHint
                  : editable
                    ? undefined
                    : outOfScopeHint(item, target);
                const checked = editable ? Boolean(values[item.key]) : false;
                const ref = referenceValues ? referenceValues[item.key] : undefined;
                return (
                  <li key={item.key} className="flex items-center gap-3 px-3 py-1.5">
                    <label
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 text-sm",
                        editable && !disabled ? "cursor-pointer" : "cursor-not-allowed",
                        !editable && "text-slate-400",
                      )}
                      title={hint}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || !editable}
                        onChange={(e) => onChange({ ...values, [item.key]: e.target.checked })}
                        className="size-4 shrink-0 accent-primary-green"
                      />
                      <span className="min-w-0">
                        <span className="block truncate">{item.label}</span>
                        {hint ? (
                          <span className="block truncate text-[11px] text-slate-400">{hint}</span>
                        ) : null}
                      </span>
                    </label>
                    {referenceValues ? (
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold",
                          ref === undefined
                            ? "text-slate-300"
                            : ref
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500",
                        )}
                        title={`${referenceLabel}: ${ref === undefined ? "não se aplica" : ref ? "sim" : "não"}`}
                      >
                        {ref === undefined ? "—" : ref ? "Sim" : "Não"}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
