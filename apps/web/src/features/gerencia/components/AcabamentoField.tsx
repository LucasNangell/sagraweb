import { cn } from "@sagra/ui";
import { Check, Plus, Scissors, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { AcabamentoCatalogItem } from "@/api/auxLookups";
import { LombadaCalculatorPanel } from "@/features/lombada/components/LombadaCalculatorForm";
import { isLombadaAcabamentoLabel } from "@/features/lombada/lombadaPapelMatch";
import { lombadaInputFromTechSpec } from "../lombadaFromTechSpec";
import {
  formatAcabamentoLabel,
  type TechSpec,
  type TechSpecAcabamento,
} from "../techSpec";
import { gerenciaInputClass, gerenciaLabelClass } from "./gerenciaFormUi";

function acabamentoKey(item: TechSpecAcabamento): string {
  if (item.variacao_id != null) return `v:${item.variacao_id}`;
  if (item.catalog_id != null) return `c:${item.catalog_id}`;
  return `l:${item.label}`;
}

function displayText(selected: TechSpecAcabamento[]): string {
  return selected.map(formatAcabamentoLabel).filter(Boolean).join(", ");
}

function isItemActive(
  item: AcabamentoCatalogItem,
  selectedKeys: Set<string>,
): boolean {
  if (item.variacoes.length === 0) return selectedKeys.has(`c:${item.id}`);
  return item.variacoes.some((v) => selectedKeys.has(`v:${v.id}`));
}

function itemSelectionSummary(
  item: AcabamentoCatalogItem,
  selectedKeys: Set<string>,
): string {
  if (item.variacoes.length === 0) {
    return selectedKeys.has(`c:${item.id}`) ? "Incluído" : "";
  }
  return item.variacoes
    .filter((v) => selectedKeys.has(`v:${v.id}`))
    .map((v) => v.label)
    .join(", ");
}

export function AcabamentoField({
  catalog,
  selected,
  readOnly,
  onChange,
  className,
  label = "Acabamento específico",
  displayValue,
  multiline = false,
  techSpec,
}: {
  catalog: AcabamentoCatalogItem[];
  selected: TechSpecAcabamento[];
  readOnly: boolean;
  onChange: (next: TechSpecAcabamento[]) => void;
  className?: string;
  label?: string;
  displayValue?: string;
  multiline?: boolean;
  /** Componentes da OS — preenche a calculadora de lombada. */
  techSpec?: TechSpec;
}) {
  const [open, setOpen] = useState(false);
  const fieldId = useId();
  const text = displayValue ?? displayText(selected);

  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={fieldId} className={gerenciaLabelClass}>
        {label}
      </label>
      <div className="mt-1 flex min-w-0 items-start gap-1.5">
        {multiline ? (
          <textarea
            id={fieldId}
            readOnly
            rows={4}
            value={text}
            placeholder="Nenhum"
            title={text || "Nenhum acabamento"}
            className={cn(
              gerenciaInputClass,
              "mt-0 min-h-[72px] min-w-0 flex-1 resize-y whitespace-pre-wrap",
            )}
            aria-label={label}
          />
        ) : (
          <input
            id={fieldId}
            readOnly
            value={text}
            placeholder="Nenhum"
            title={text || "Nenhum acabamento"}
            className={cn(gerenciaInputClass, "mt-0 min-w-0 flex-1 truncate")}
            aria-label={label}
          />
        )}
        {!readOnly ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="inline-flex h-[2.125rem] shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-secondary-blue/30 bg-white px-2.5 text-xs font-semibold text-secondary-blue shadow-sm transition hover:border-secondary-blue/50 hover:bg-slate-50"
          >
            <Plus className="size-3.5" aria-hidden />
            {selected.length || displayValue ? "Alterar" : "Incluir"}
          </button>
        ) : null}
      </div>
      {open
        ? createPortal(
            <AcabamentoModal
              catalog={catalog}
              selected={selected}
              techSpec={techSpec}
              onClose={() => setOpen(false)}
              onApply={(next) => {
                onChange(next);
                setOpen(false);
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function AcabamentoModal({
  catalog,
  selected,
  techSpec,
  onClose,
  onApply,
}: {
  catalog: AcabamentoCatalogItem[];
  selected: TechSpecAcabamento[];
  techSpec?: TechSpec;
  onClose: () => void;
  onApply: (next: TechSpecAcabamento[]) => void;
}) {
  const [draft, setDraft] = useState<TechSpecAcabamento[]>(selected);
  const [focusId, setFocusId] = useState<number | null>(() => {
    const keys = new Set(selected.map(acabamentoKey));
    const firstSelected = catalog.find((item) => isItemActive(item, keys));
    return firstSelected?.id ?? catalog[0]?.id ?? null;
  });

  const selectedKeys = useMemo(
    () => new Set(draft.map(acabamentoKey)),
    [draft],
  );
  const focused = catalog.find((item) => item.id === focusId) ?? null;
  const lombadaFocused = focused
    ? isLombadaAcabamentoLabel(focused.label)
    : false;
  const lombadaDefaults = lombadaInputFromTechSpec(techSpec);

  const applyLombadaObs = (obs: string) => {
    setDraft((prev) => {
      const hasLombada = prev.some((item) =>
        isLombadaAcabamentoLabel(item.label),
      );
      if (hasLombada) {
        return prev.map((item) =>
          isLombadaAcabamentoLabel(item.label) ? { ...item, obs } : item,
        );
      }
      if (!focused || !lombadaFocused) return prev;
      if (focused.variacoes.length > 0) return prev;
      return [
        ...prev,
        { catalog_id: focused.id, label: focused.label, obs },
      ];
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const togglePlain = (item: AcabamentoCatalogItem) => {
    const entry: TechSpecAcabamento = {
      catalog_id: item.id,
      label: item.label,
    };
    const key = acabamentoKey(entry);
    setDraft((prev) =>
      prev.some((s) => acabamentoKey(s) === key)
        ? prev.filter((s) => acabamentoKey(s) !== key)
        : [...prev, entry],
    );
  };

  const toggleVariacao = (
    item: AcabamentoCatalogItem,
    variacao: { id: number; label: string },
  ) => {
    const entry: TechSpecAcabamento = {
      catalog_id: item.id,
      label: item.label,
      variacao_id: variacao.id,
      variacao_label: variacao.label,
    };
    const key = acabamentoKey(entry);
    setDraft((prev) =>
      prev.some((s) => acabamentoKey(s) === key)
        ? prev.filter((s) => acabamentoKey(s) !== key)
        : [...prev, entry],
    );
  };

  const setObs = (key: string, obs: string) => {
    setDraft((prev) =>
      prev.map((item) =>
        acabamentoKey(item) === key ? { ...item, obs } : item,
      ),
    );
  };

  const draftByKey = (key: string) =>
    draft.find((item) => acabamentoKey(item) === key);

  const extras = draft.filter((item) => {
    if (item.variacao_id != null) {
      return !catalog.some((c) =>
        c.variacoes.some((v) => v.id === item.variacao_id),
      );
    }
    if (item.catalog_id != null) {
      const found = catalog.find((c) => c.id === item.catalog_id);
      return !found || found.variacoes.length > 0;
    }
    return true;
  });

  const dialog = (
    <div
      className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="acabamento-modal-title"
        className="flex max-h-[min(48rem,92vh)] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-slate-100 text-secondary-blue">
              <Scissors className="size-4" aria-hidden />
            </span>
            <div>
              <h2
                id="acabamento-modal-title"
                className="text-sm font-bold text-slate-800"
              >
                Incluir acabamentos
              </h2>
              <p className="text-[0.65rem] text-slate-500">
                Escolha o acabamento e, se houver, a variação.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <nav className="min-h-0 overflow-y-auto border-b border-slate-100 sm:border-b-0 sm:border-r">
            {catalog.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">
                Nenhum acabamento ativo no catálogo.
              </p>
            ) : (
              <ul className="p-1.5">
                {catalog.map((item) => {
                  const active = isItemActive(item, selectedKeys);
                  const focusedItem = item.id === focusId;
                  const summary = itemSelectionSummary(item, selectedKeys);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setFocusId(item.id)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition",
                          focusedItem
                            ? "bg-secondary-blue/10 text-secondary-blue"
                            : "text-slate-700 hover:bg-slate-50",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1.5 size-1.5 shrink-0 rounded-full",
                            active ? "bg-primary-green" : "bg-slate-200",
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate text-sm",
                              focusedItem ? "font-semibold" : "font-medium",
                            )}
                          >
                            {item.label}
                          </span>
                          <span className="block truncate text-[0.65rem] font-normal text-slate-500">
                            {item.variacoes.length > 0
                              ? summary ||
                                `${item.variacoes.length} variaç${item.variacoes.length === 1 ? "ão" : "ões"}`
                              : summary || "Sem variação"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>

          <div className="min-h-0 overflow-y-auto p-4">
            {!focused ? (
              <p className="text-sm text-slate-500">
                Escolha um acabamento à esquerda.
              </p>
            ) : focused.variacoes.length === 0 ? (
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {focused.label}
                </p>
                {lombadaFocused ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                    <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
                      Calculadora de lombada
                    </p>
                    <LombadaCalculatorPanel
                      compact
                      defaults={lombadaDefaults}
                      onUseInObs={applyLombadaObs}
                    />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Este item não possui variações. Inclua ou remova da OS.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => togglePlain(focused)}
                  className={cn(
                    "mt-4 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition",
                    selectedKeys.has(`c:${focused.id}`)
                      ? "bg-red-50 text-red-700 hover:bg-red-100"
                      : "bg-secondary-blue text-white hover:bg-secondary-blue/90",
                  )}
                >
                  {selectedKeys.has(`c:${focused.id}`) ? (
                    <>Remover da OS</>
                  ) : (
                    <>
                      <Check className="size-3.5" aria-hidden />
                      Incluir na OS
                    </>
                  )}
                </button>
                {selectedKeys.has(`c:${focused.id}`) ? (
                  <label className="mt-3 block">
                    <span className="text-[0.65rem] font-semibold text-slate-500">
                      Obs
                    </span>
                    <input
                      value={draftByKey(`c:${focused.id}`)?.obs ?? ""}
                      onChange={(e) => setObs(`c:${focused.id}`, e.target.value)}
                      placeholder="Observação deste acabamento"
                      className={cn(gerenciaInputClass, "mt-1")}
                      aria-label={`Obs ${focused.label}`}
                    />
                  </label>
                ) : null}
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {focused.label}
                </p>
                {lombadaFocused ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                    <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
                      Calculadora de lombada
                    </p>
                    <LombadaCalculatorPanel
                      compact
                      defaults={lombadaDefaults}
                      onUseInObs={applyLombadaObs}
                    />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Selecione uma ou mais variações. Cada uma pode ter uma obs.
                  </p>
                )}
                <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                  {focused.variacoes.map((variacao) => {
                    const key = `v:${variacao.id}`;
                    const checked = selectedKeys.has(key);
                    return (
                      <li key={variacao.id} className={checked ? "bg-secondary-blue/5" : undefined}>
                        <button
                          type="button"
                          onClick={() => toggleVariacao(focused, variacao)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition",
                            checked
                              ? "font-semibold text-secondary-blue"
                              : "text-slate-700 hover:bg-slate-50",
                          )}
                          aria-pressed={checked}
                        >
                          <span>{variacao.label}</span>
                          <span
                            className={cn(
                              "flex size-5 shrink-0 items-center justify-center rounded border",
                              checked
                                ? "border-secondary-blue bg-secondary-blue text-white"
                                : "border-slate-300 bg-white",
                            )}
                          >
                            {checked ? (
                              <Check className="size-3" aria-hidden />
                            ) : null}
                          </span>
                        </button>
                        {checked ? (
                          <div className="px-3 pb-2.5">
                            <label className="block">
                              <span className="text-[0.65rem] font-semibold text-slate-500">
                                Obs
                              </span>
                              <input
                                value={draftByKey(key)?.obs ?? ""}
                                onChange={(e) => setObs(key, e.target.value)}
                                placeholder={`Obs. ${variacao.label}`}
                                className={cn(gerenciaInputClass, "mt-1")}
                                aria-label={`Obs ${variacao.label}`}
                              />
                            </label>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {extras.length > 0 ? (
              <div className="mt-5 border-t border-slate-100 pt-3">
                <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
                  Já gravados (fora do catálogo)
                </p>
                <div className="mt-2 space-y-2">
                  {extras.map((item) => (
                    <div
                      key={acabamentoKey(item)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-700">
                          {formatAcabamentoLabel({ ...item, obs: undefined })}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((prev) =>
                              prev.filter(
                                (s) => acabamentoKey(s) !== acabamentoKey(item),
                              ),
                            )
                          }
                          className="rounded p-0.5 text-slate-400 hover:text-red-600"
                          title="Remover"
                          aria-label={`Remover ${formatAcabamentoLabel({ ...item, obs: undefined })}`}
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      </div>
                      <label className="mt-1.5 block">
                        <span className="text-[0.65rem] font-semibold text-slate-500">
                          Obs
                        </span>
                        <input
                          value={item.obs ?? ""}
                          onChange={(e) =>
                            setObs(acabamentoKey(item), e.target.value)
                          }
                          placeholder="Observação deste acabamento"
                          className={cn(gerenciaInputClass, "mt-1")}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-3">
          <p
            className="min-w-0 flex-1 truncate text-xs text-slate-600"
            title={displayText(draft) || undefined}
          >
            {displayText(draft) || "Nenhum acabamento selecionado"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onApply(draft)}
              className="rounded-md bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-secondary-blue/90"
            >
              Aplicar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  return dialog;
}
