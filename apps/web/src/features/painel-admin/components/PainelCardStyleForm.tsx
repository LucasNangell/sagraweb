import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { CARD_MODELS } from "@/features/dashboard-setor-modern/cardModels";
import {
  CARD_FONT_OPTIONS,
  DEFAULT_CARD_STYLE,
  cardSlotStyleVars,
  normalizeCardStyle,
} from "@/features/dashboard-setor-modern/cardStyle";
import { LabVidroFoscoCard } from "@/features/dashboard-setor-modern/components/LabVidroFoscoCard";
import { isHtmlCardModel } from "@/features/dashboard-setor-modern/htmlCardModels";
import {
  animationSwatches,
  colorsFromSwatches,
  mergeSwatchValues,
  modelSwatches,
  type ColorSwatch,
} from "@/features/dashboard-setor-modern/colorSwatches";
import {
  ENTRY_ANIMATIONS,
  HIGHLIGHT_ANIMATIONS,
  type EntryAnimationDef,
} from "@/features/dashboard-setor-modern/entryAnimations";
import "@/features/dashboard-setor-modern/dashboard-setor-modern.css";
import "@/features/dashboard-setor-modern/dashboard-setor-modern-cards.css";
import type {
  DashboardCardSlot,
  DashboardCardStyle,
  DashboardCardTypography,
  DashboardTextStyle,
} from "@/features/dashboard-setor/types";

export type PainelCardStyleSection = "visual" | "animation" | "typography";

type PrioritySlot = "high" | "medium" | "normal";

const PRIORITY_TITLES: Record<PrioritySlot, string> = {
  high: "Prioridade alta (Prometido)",
  medium: "Prioridade média (Solicitado)",
  normal: "Prioridade normal",
};

function groupedModels() {
  const groups: { group: string; models: typeof CARD_MODELS }[] = [];
  for (const model of CARD_MODELS) {
    const last = groups[groups.length - 1];
    if (!last || last.group !== model.group) {
      groups.push({ group: model.group, models: [model] });
    } else {
      last.models.push(model);
    }
  }
  return groups;
}

function groupedAnimations(list: EntryAnimationDef[]) {
  const groups: { group: string; items: EntryAnimationDef[] }[] = [];
  for (const item of list) {
    if (item.id === "none") {
      continue;
    }
    const last = groups[groups.length - 1];
    if (!last || last.group !== item.group) {
      groups.push({ group: item.group, items: [item] });
    } else {
      last.items.push(item);
    }
  }
  return groups;
}

function CardThumb({
  modelId,
  entryId,
  highlightId,
  isAnim = false,
  label,
  active,
  styleVars,
  onClick,
}: {
  modelId?: string;
  entryId?: string;
  highlightId?: string;
  isAnim?: boolean;
  label: string;
  active: boolean;
  styleVars?: CSSProperties;
  onClick: (target: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className={`painel-card-model-thumb${isAnim ? " is-anim" : ""}${active ? " is-active" : ""}`}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={(e) => onClick(e.currentTarget)}
    >
      <span className="setor-modern">
        <div className="setor-modern-card-motion" data-entry={entryId || undefined}>
          <article
            className="setor-modern-card"
            data-model={modelId || undefined}
            data-highlight={highlightId || undefined}
            style={styleVars}
          >
            {isHtmlCardModel(modelId) ? (
              <LabVidroFoscoCard osLabel="1234/26" compact />
            ) : (
              <div className="setor-modern-card-top">
                <h3 data-text="1234/26">1234/26</h3>
              </div>
            )}
          </article>
        </div>
      </span>
      <span className="painel-card-model-thumb-label">{label}</span>
    </button>
  );
}

type AnchorRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type PaletteEditor =
  | { kind: "visual"; slot: PrioritySlot; id: string; title: string; anchor: AnchorRect }
  | { kind: "highlight"; slot: PrioritySlot; id: string; title: string; anchor: AnchorRect }
  | { kind: "entry"; id: string; title: string; anchor: AnchorRect };

function rectOf(el: HTMLElement): AnchorRect {
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

function overlapsAnchor(
  anchor: AnchorRect,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  return !(
    left >= anchor.right ||
    left + width <= anchor.left ||
    top >= anchor.bottom ||
    top + height <= anchor.top
  );
}

function placeBesideAnchor(anchor: AnchorRect, width: number, height: number) {
  const gap = 12;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (left: number, top: number) => ({
    left: Math.min(Math.max(pad, left), Math.max(pad, vw - width - pad)),
    top: Math.min(Math.max(pad, top), Math.max(pad, vh - height - pad)),
  });
  const candidates = [
    { left: anchor.right + gap, top: anchor.top },
    { left: anchor.left - gap - width, top: anchor.top },
    { left: anchor.left, top: anchor.bottom + gap },
    { left: anchor.left, top: anchor.top - gap - height },
    { left: anchor.right + gap, top: pad },
    { left: pad, top: anchor.bottom + gap },
  ];
  for (const candidate of candidates) {
    const pos = clamp(candidate.left, candidate.top);
    if (!overlapsAnchor(anchor, pos.left, pos.top, width, height)) {
      return pos;
    }
  }
  return clamp(anchor.right + gap, pad);
}

function PaletteModal({
  title,
  swatches,
  anchor,
  speed,
  onChange,
  onSpeed,
  onClose,
}: {
  title: string;
  swatches: ColorSwatch[];
  anchor: AnchorRect;
  speed?: number;
  onChange: (key: string, value: string) => void;
  onSpeed?: (value: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() =>
    placeBesideAnchor(anchor, 320, 220),
  );

  useLayoutEffect(() => {
    const el = dialogRef.current;
    if (!el) {
      return;
    }
    setPos(placeBesideAnchor(anchor, el.offsetWidth, el.offsetHeight));
  }, [anchor, swatches.length, onSpeed]);

  return (
    <div
      className="fixed inset-0 z-50"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Cores originais do modelo. Ajuste e veja no preview.
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Fechar"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {swatches.map((item) => (
            <ColorField
              key={item.key}
              label={item.label}
              value={item.value}
              onChange={(value) => onChange(item.key, value)}
            />
          ))}
        </div>
        {onSpeed ? (
          <label className="mt-3 flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
            Velocidade da luz ({(speed ?? 1).toFixed(1)}×)
            <input
              type="range"
              min={0.4}
              max={2.5}
              step={0.1}
              value={speed ?? 1}
              aria-label="Velocidade da luz"
              onChange={(e) => onSpeed(Number(e.target.value))}
            />
          </label>
        ) : null}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="sagra-btn sagra-btn--secondary sagra-btn--md"
            onClick={onClose}
          >
            Pronto
          </button>
        </div>
      </div>
    </div>
  );
}

function ScaleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
      {label} ({Math.round(value * 100)}%)
      <input
        type="range"
        min={0.7}
        max={1.5}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const hex =
    /^#([0-9a-fA-F]{6})$/.test(value)
      ? value
      : /^#([0-9a-fA-F]{3})$/.test(value)
        ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
        : "#000000";
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
      {label}
      <input
        type="color"
        className="h-8 w-full rounded border border-slate-300"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function fontIdFromStack(stack: string | undefined): string {
  return (
    CARD_FONT_OPTIONS.find(
      (item) => item.stack === stack || item.id === stack,
    )?.id ?? ""
  );
}

function FontSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (stack: string | undefined) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
      {label}
      <select
        className="rounded border border-slate-300 px-2 py-1.5 text-sm font-normal"
        value={fontIdFromStack(value)}
        onChange={(e) => {
          const next = CARD_FONT_OPTIONS.find((item) => item.id === e.target.value);
          onChange(next?.stack || undefined);
        }}
      >
        {CARD_FONT_OPTIONS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextStyleFields({
  value,
  defaultSpacing,
  defaultColor,
  onChange,
}: {
  value: DashboardTextStyle | undefined;
  defaultSpacing: number;
  defaultColor: string;
  onChange: (next: DashboardTextStyle) => void;
}) {
  const current = value ?? {};
  const patch = (partial: Partial<DashboardTextStyle>) =>
    onChange({ ...current, ...partial });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FontSelect
        label="Fonte"
        value={current.fontFamily}
        onChange={(fontFamily) => patch({ fontFamily })}
      />
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
        Tamanho ({Math.round((current.fontScale ?? 1) * 100)}%)
        <input
          type="range"
          min={0.7}
          max={1.5}
          step={0.05}
          value={current.fontScale ?? 1}
          onChange={(e) => patch({ fontScale: Number(e.target.value) })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
        Espaçamento das letras
        <input
          type="range"
          min={-0.08}
          max={0.12}
          step={0.005}
          value={current.letterSpacing ?? defaultSpacing}
          onChange={(e) => patch({ letterSpacing: Number(e.target.value) })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
        Cor da fonte
        <input
          type="color"
          className="h-8 w-full rounded border border-slate-300"
          value={current.color || defaultColor}
          onChange={(e) => patch({ color: e.target.value })}
        />
      </label>
    </div>
  );
}

interface PainelCardStyleFormProps {
  value: DashboardCardStyle | undefined;
  onChange: (next: DashboardCardStyle | undefined) => void;
  section?: PainelCardStyleSection;
}

export function PainelCardStyleForm({
  value,
  onChange,
  section,
}: PainelCardStyleFormProps) {
  const style = value ?? DEFAULT_CARD_STYLE;
  const [editor, setEditor] = useState<PaletteEditor | null>(null);
  const groups = useMemo(() => groupedModels(), []);
  const entryGroups = useMemo(() => groupedAnimations(ENTRY_ANIMATIONS), []);
  const highlightGroups = useMemo(
    () => groupedAnimations(HIGHLIGHT_ANIMATIONS),
    [],
  );
  const showVisual = !section || section === "visual";
  const showAnimation = !section || section === "animation";
  const showTypography = !section || section === "typography";

  useEffect(() => {
    setEditor(null);
  }, [section]);

  const patch = (partial: Partial<DashboardCardStyle>) => {
    const merged: DashboardCardStyle = {
      ...DEFAULT_CARD_STYLE,
      ...style,
      ...partial,
      models: { ...style.models, ...partial.models },
      typography: { ...style.typography, ...partial.typography },
    };
    if ("entryColors" in partial && !partial.entryColors) {
      delete merged.entryColors;
    }
    onChange(normalizeCardStyle(merged));
  };

  const updateSlot = (slot: PrioritySlot, next: DashboardCardSlot) => {
    patch({
      models: {
        ...style.models,
        [slot]: next,
      },
    });
  };

  const pickVisual = (
    slot: PrioritySlot,
    effect: string,
    title: string,
    target: HTMLElement,
  ) => {
    const current = style.models[slot];
    if (!effect) {
      updateSlot(slot, { ...current, effect: "" });
      setEditor(null);
      return;
    }
    const swatches = modelSwatches(effect);
    const colors =
      current.effect === effect
        ? current.colors
        : colorsFromSwatches(swatches);
    updateSlot(slot, { ...current, effect, ...(colors ? { colors } : {}) });
    if (swatches.length === 0) {
      setEditor(null);
      return;
    }
    setEditor({ kind: "visual", slot, id: effect, title, anchor: rectOf(target) });
  };

  const pickHighlight = (
    slot: PrioritySlot,
    highlight: string,
    title: string,
    target: HTMLElement,
  ) => {
    const current = style.models[slot];
    if (!highlight) {
      updateSlot(slot, { ...current, highlight: "" });
      setEditor(null);
      return;
    }
    const swatches = animationSwatches(highlight);
    const highlightColors =
      current.highlight === highlight
        ? current.highlightColors
        : colorsFromSwatches(swatches);
    updateSlot(slot, {
      ...current,
      highlight,
      ...(highlightColors ? { highlightColors } : { highlightColors: undefined }),
    });
    if (swatches.length === 0) {
      setEditor(null);
      return;
    }
    setEditor({
      kind: "highlight",
      slot,
      id: highlight,
      title,
      anchor: rectOf(target),
    });
  };

  const pickEntry = (
    entryAnimation: string,
    title: string,
    target: HTMLElement,
  ) => {
    if (!entryAnimation || entryAnimation === "none") {
      patch({ entryAnimation: "none" });
      setEditor(null);
      return;
    }
    const swatches = animationSwatches(entryAnimation);
    const entryColors =
      style.entryAnimation === entryAnimation
        ? style.entryColors
        : colorsFromSwatches(swatches);
    patch({
      entryAnimation,
      ...(entryColors ? { entryColors } : { entryColors: undefined }),
    });
    if (swatches.length === 0) {
      setEditor(null);
      return;
    }
    setEditor({ kind: "entry", id: entryAnimation, title, anchor: rectOf(target) });
  };

  const editorSwatches = useMemo(() => {
    if (!editor) {
      return [];
    }
    if (editor.kind === "visual") {
      return mergeSwatchValues(
        modelSwatches(editor.id),
        style.models[editor.slot].colors,
      );
    }
    if (editor.kind === "highlight") {
      return mergeSwatchValues(
        animationSwatches(editor.id),
        style.models[editor.slot].highlightColors,
      );
    }
    return mergeSwatchValues(animationSwatches(editor.id), style.entryColors);
  }, [editor, style]);

  const setEditorSpeed = (beamSpeed: number) => {
    if (!editor || editor.kind !== "visual") {
      return;
    }
    const current = style.models[editor.slot];
    updateSlot(editor.slot, { ...current, beamSpeed });
  };

  const setEditorColor = (key: string, value: string) => {
    if (!editor) {
      return;
    }
    if (editor.kind === "visual") {
      const current = style.models[editor.slot];
      updateSlot(editor.slot, {
        ...current,
        colors: { ...current.colors, [key]: value },
      });
      return;
    }
    if (editor.kind === "highlight") {
      const current = style.models[editor.slot];
      updateSlot(editor.slot, {
        ...current,
        highlightColors: { ...current.highlightColors, [key]: value },
      });
      return;
    }
    patch({ entryColors: { ...style.entryColors, [key]: value } });
  };

  const typo = style.typography ?? {};
  const setTypo = (partial: DashboardCardTypography) =>
    patch({ typography: { ...typo, ...partial } });

  const setPriorityText = (
    slot: PrioritySlot,
    key: "titleColor" | "situationColor" | "authorColor" | "timerColor",
    value: string,
  ) => {
    setTypo({
      priorities: {
        ...typo.priorities,
        [slot]: { ...typo.priorities?.[slot], [key]: value },
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {showVisual ? (
        <>
          {!section ? (
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Visual dos cards (painel moderno)
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Modelo por prioridade, animação de entrada única e tipografia. O
                preview atualiza na hora.
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Miniaturas na cor original do catálogo. Ao escolher um modelo,
              abre a paleta de cores dele.
            </p>
          )}

          {(["high", "medium", "normal"] as const).map((slot) => {
            const title =
              slot === "high"
                ? "Prioridade alta (Prometido)"
                : slot === "medium"
                  ? "Prioridade média (Solicitado)"
                  : "Prioridade normal";
            const slotValue = style.models[slot];
            return (
              <fieldset key={slot} className="rounded-md border border-slate-200 p-3">
                <legend className="px-1 text-xs font-semibold text-slate-700">
                  {title}
                </legend>
                <div className="mb-3">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Padrão
                  </p>
                  <div className="painel-card-model-grid">
                    <CardThumb
                      modelId=""
                      label="Padrão do painel"
                      active={!slotValue.effect}
                      onClick={(el) => pickVisual(slot, "", "Padrão do painel", el)}
                    />
                  </div>
                </div>
                {groups.map((group) => (
                  <div key={group.group} className="mb-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      {group.group}
                    </p>
                    <div className="painel-card-model-grid">
                      {group.models.map((model) => (
                        <CardThumb
                          key={model.id}
                          modelId={model.id}
                          label={model.label}
                          active={slotValue.effect === model.id}
                          styleVars={
                            model.id === "v37" && slotValue.effect === model.id
                              ? cardSlotStyleVars(slotValue)
                              : undefined
                          }
                          onClick={(el) => pickVisual(slot, model.id, model.label, el)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </fieldset>
            );
          })}
        </>
      ) : null}

      {showAnimation ? (
        <div className="flex flex-col gap-5">
          {section ? (
            <p className="text-xs text-slate-500">
              Miniaturas na cor original. Ao escolher uma animação, abre a
              paleta de cores dela. Entrada é igual para todos; realce varia
              por prioridade.
            </p>
          ) : null}

          <label className="flex max-w-xs flex-col gap-1 text-xs font-semibold text-slate-700">
            Velocidade das animações ({style.entrySpeed ?? 1}x)
            <input
              type="range"
              min={0.4}
              max={2.5}
              step={0.1}
              value={style.entrySpeed ?? 1}
              onChange={(e) => patch({ entrySpeed: Number(e.target.value) })}
            />
          </label>

          <fieldset className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-700">
              Animação de entrada (1x — igual para todos)
            </legend>
            <div className="mb-3">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Sem animação
              </p>
              <div className="painel-card-model-grid">
                <CardThumb
                  isAnim
                  label="Nenhuma"
                  active={
                    !style.entryAnimation || style.entryAnimation === "none"
                  }
                  onClick={(el) => pickEntry("none", "Nenhuma", el)}
                />
              </div>
            </div>
            {entryGroups.map((group) => (
              <div key={group.group} className="mb-2">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {group.group}
                </p>
                <div className="painel-card-model-grid">
                  {group.items.map((item) => (
                    <CardThumb
                      key={item.id}
                      isAnim
                      entryId={item.id}
                      label={item.label}
                      active={style.entryAnimation === item.id}
                      onClick={(el) => pickEntry(item.id, item.label, el)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </fieldset>

          <div className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold text-slate-800">
              Animação de realce (loop — por prioridade)
            </h4>
            <p className="text-[11px] text-slate-500">
              Fica rodando continuamente e pode ser diferente em cada
              prioridade.
            </p>
          </div>

          {(["high", "medium", "normal"] as const).map((slot) => {
            const title =
              slot === "high"
                ? "Prioridade alta (Prometido)"
                : slot === "medium"
                  ? "Prioridade média (Solicitado)"
                  : "Prioridade normal";
            const current = style.models[slot].highlight ?? "";
            return (
              <fieldset
                key={slot}
                className="rounded-md border border-slate-200 p-3"
              >
                <legend className="px-1 text-xs font-semibold text-slate-700">
                  {title}
                </legend>
                <div className="mb-3">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Sem realce
                  </p>
                  <div className="painel-card-model-grid">
                    <CardThumb
                      isAnim
                      label="Nenhum"
                      active={!current}
                      onClick={(el) => pickHighlight(slot, "", "Nenhum", el)}
                    />
                  </div>
                </div>
                {highlightGroups.map((group) => (
                  <div key={group.group} className="mb-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      {group.group}
                    </p>
                    <div className="painel-card-model-grid">
                      {group.items.map((item) => (
                        <CardThumb
                          key={item.id}
                          isAnim
                          highlightId={item.id}
                          label={item.label}
                          active={current === item.id}
                          onClick={(el) =>
                            pickHighlight(slot, item.id, item.label, el)
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </fieldset>
            );
          })}
        </div>
      ) : null}

      {showTypography ? (
        <div className="flex flex-col gap-4">
          {section ? (
            <p className="text-xs text-slate-500">
              Fonte, tamanho de cada elemento, espaçamento, cores por
              prioridade, e tipografia do título “OPs na …” e do head das
              colunas.
            </p>
          ) : null}

          <fieldset className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-700">
              Cards
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FontSelect
                label="Fonte"
                value={typo.fontFamily}
                onChange={(fontFamily) => setTypo({ fontFamily })}
              />
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                Espaçamento das letras
                <input
                  type="range"
                  min={-0.08}
                  max={0.12}
                  step={0.005}
                  value={typo.letterSpacing ?? -0.045}
                  onChange={(e) =>
                    setTypo({ letterSpacing: Number(e.target.value) })
                  }
                />
              </label>
              <ScaleField
                label="Tamanho do número da OS"
                value={typo.titleScale ?? typo.fontScale ?? 1}
                onChange={(titleScale) => setTypo({ titleScale })}
              />
              <ScaleField
                label="Tamanho da situação"
                value={typo.situationScale ?? typo.fontScale ?? 1}
                onChange={(situationScale) => setTypo({ situationScale })}
              />
              <ScaleField
                label="Tamanho do nome do usuário"
                value={typo.authorScale ?? typo.fontScale ?? 1}
                onChange={(authorScale) => setTypo({ authorScale })}
              />
              <ScaleField
                label="Tamanho do relógio"
                value={typo.timerScale ?? typo.fontScale ?? 1}
                onChange={(timerScale) => setTypo({ timerScale })}
              />
            </div>
          </fieldset>

          {(["high", "medium", "normal"] as const).map((slot) => {
            const titleColor =
              typo.priorities?.[slot]?.titleColor || typo.titleColor || "#edf3fa";
            const situationColor =
              typo.priorities?.[slot]?.situationColor ||
              typo.situationColor ||
              "#e1eaf4";
            const authorColor =
              typo.priorities?.[slot]?.authorColor || "#b5c6d7";
            const timerColor =
              typo.priorities?.[slot]?.timerColor || "#e1edf8";
            return (
              <fieldset
                key={slot}
                className="rounded-md border border-slate-200 p-3"
              >
                <legend className="px-1 text-xs font-semibold text-slate-700">
                  Cor da fonte · {PRIORITY_TITLES[slot]}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    Cor do número da OS
                    <input
                      type="color"
                      className="h-8 w-full rounded border border-slate-300"
                      value={titleColor}
                      onChange={(e) =>
                        setPriorityText(slot, "titleColor", e.target.value)
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    Cor da situação
                    <input
                      type="color"
                      className="h-8 w-full rounded border border-slate-300"
                      value={situationColor}
                      onChange={(e) =>
                        setPriorityText(slot, "situationColor", e.target.value)
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    Cor do nome do usuário
                    <input
                      type="color"
                      className="h-8 w-full rounded border border-slate-300"
                      value={authorColor}
                      onChange={(e) =>
                        setPriorityText(slot, "authorColor", e.target.value)
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    Cor do relógio
                    <input
                      type="color"
                      className="h-8 w-full rounded border border-slate-300"
                      value={timerColor}
                      onChange={(e) =>
                        setPriorityText(slot, "timerColor", e.target.value)
                      }
                    />
                  </label>
                </div>
              </fieldset>
            );
          })}

          <fieldset className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-700">
              Título da página (OPs na …)
            </legend>
            <TextStyleFields
              value={typo.heading}
              defaultSpacing={-0.045}
              defaultColor="#f0f5fa"
              onChange={(heading) => setTypo({ heading })}
            />
          </fieldset>

          <fieldset className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-700">
              Head das colunas
            </legend>
            <TextStyleFields
              value={typo.column}
              defaultSpacing={-0.02}
              defaultColor="#ffffff"
              onChange={(column) => setTypo({ column })}
            />
          </fieldset>
        </div>
      ) : null}

      {editor && editorSwatches.length > 0 ? (
        <PaletteModal
          title={editor.title}
          swatches={editorSwatches}
          anchor={editor.anchor}
          speed={
            editor.kind === "visual" && editor.id === "v37"
              ? (style.models[editor.slot].beamSpeed ?? 1)
              : undefined
          }
          onChange={setEditorColor}
          onSpeed={
            editor.kind === "visual" && editor.id === "v37"
              ? setEditorSpeed
              : undefined
          }
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
