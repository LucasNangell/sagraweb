import { Plus, X } from "lucide-react";
import { useMemo } from "react";

import {
  defaultSlotForTemplate,
  getTemplateAllowedSlots,
  PREVIEW_POSITION_SLOTS,
  templateId,
  type ActiveDynamicFieldPlacement,
  type PapelariaPreviewConfig,
  type PapelariaPreviewDynamicFieldTemplate,
} from "@/features/papelaria/preview";

type Props = {
  previewConfig: PapelariaPreviewConfig;
  activeFaceId: string;
  activeFields: ActiveDynamicFieldPlacement[];
  fieldValues: Record<string, string>;
  onFieldValueChange: (key: string, value: string) => void;
  onChange: (next: ActiveDynamicFieldPlacement[]) => void;
};

export function PapelariaProofDynamicFields({
  previewConfig,
  activeFaceId,
  activeFields,
  fieldValues,
  onFieldValueChange,
  onChange,
}: Props) {
  const templates = useMemo(
    () =>
      previewConfig.habilitarCamposDinamicos
        ? (previewConfig.camposDinamicos ?? [])
        : [],
    [previewConfig],
  );

  if (templates.length === 0) return null;

  const activeIds = new Set(activeFields.map((f) => f.templateId));

  const addField = (tpl: PapelariaPreviewDynamicFieldTemplate) => {
    const id = templateId(tpl);
    if (activeIds.has(id)) return;
    const slot = defaultSlotForTemplate(getTemplateAllowedSlots(tpl));
    onChange([
      ...activeFields,
      { templateId: id, faceId: activeFaceId, posicaoSlot: slot },
    ]);
  };

  const removeField = (id: string) => {
    onChange(activeFields.filter((f) => f.templateId !== id));
  };

  return (
    <div className="shrink-0 rounded border border-slate-200 bg-slate-50/80 p-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
        Campos opcionais na prova
      </p>
      <p className="mt-0.5 text-[10px] text-neutral-500">
        Adicione campos pré-configurados e arraste na prévia para posicionar.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {templates.map((tpl) => {
          const id = templateId(tpl);
          const isActive = activeIds.has(id);
          return (
            <button
              key={id}
              type="button"
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] hover:bg-slate-50 disabled:opacity-50"
              disabled={isActive}
              onClick={() => addField(tpl)}
              title={
                tpl.posicoesPermitidas?.length
                  ? `Posições: ${tpl.posicoesPermitidas.map((s) => PREVIEW_POSITION_SLOTS.find((p) => p.id === s)?.label ?? s).join(", ")}`
                  : undefined
              }
            >
              <Plus className="size-3" aria-hidden />
              {tpl.label ?? tpl.variavel}
            </button>
          );
        })}
      </div>
      {activeFields.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {activeFields.map((f) => {
            const tpl = templates.find((t) => templateId(t) === f.templateId);
            const slotLabel =
              PREVIEW_POSITION_SLOTS.find((s) => s.id === f.posicaoSlot)?.label ??
              f.posicaoSlot;
            return (
              <li
                key={f.templateId}
                className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-[10px]"
              >
                <span>
                  <strong>{tpl?.label ?? f.templateId}</strong>
                  <span className="ml-1 text-neutral-500">— {slotLabel}</span>
                </span>
                {tpl ? (
                  <input
                    className="mx-2 min-w-0 flex-1 rounded border border-slate-200 px-1 py-0.5"
                    value={fieldValues[tpl.variavel] ?? ""}
                    placeholder={tpl.label ?? tpl.variavel}
                    onChange={(e) => onFieldValueChange(tpl.variavel, e.target.value)}
                  />
                ) : null}
                <button
                  type="button"
                  className="rounded p-0.5 text-neutral-500 hover:bg-red-50 hover:text-red-600"
                  onClick={() => removeField(f.templateId)}
                  aria-label={`Remover ${f.templateId}`}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
