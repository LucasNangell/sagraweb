import { PapelariaLivePreview } from "@/features/papelaria/components/PapelariaLivePreview";
import {
  groupFieldsByFace,
  type PapelariaPreviewConfig,
  type PapelariaPreviewFace,
} from "@/features/papelaria/preview";
import type { PapelariaField } from "@/features/papelaria/types";
import { useMemo, type CSSProperties } from "react";

import { ClienteProofPapelariaFields } from "./ClienteProofPapelariaFields";
import "./ClienteProofPapelariaEditPanel.css";

type Props = {
  previewConfig: PapelariaPreviewConfig;
  camposFormulario: PapelariaField[];
  fieldValues: Record<string, string>;
  modeloId: number;
  disabled?: boolean;
  resolvePreviewBaseUrl: (faceId: string) => string;
  onFieldChange: (key: string, value: string) => void;
};

export function ClienteProofPapelariaEditPanel({
  previewConfig,
  camposFormulario,
  fieldValues,
  modeloId,
  disabled = false,
  resolvePreviewBaseUrl,
  onFieldChange,
}: Props) {
  const groups = groupFieldsByFace(camposFormulario, previewConfig);
  const generalFields = groups.find((g) => g.faceId === "_geral")?.fields ?? [];
  const fieldsByFaceId = new Map<string, PapelariaField[]>();
  for (const group of groups) {
    if (group.faceId !== "_geral") {
      fieldsByFaceId.set(group.faceId, group.fields);
    }
  }

  const faces = previewConfig.faces ?? [];

  const layoutVars = useMemo(() => {
    const vars: CSSProperties & Record<string, string | number> = {
      "--preview-face-count": Math.max(faces.length, 1),
    };
    if (generalFields.length > 0) {
      vars["--preview-chrome-extra"] = "15rem";
    }
    return vars;
  }, [faces.length, generalFields.length]);

  return (
    <div className="cliente-proof-edit" style={layoutVars}>
      {generalFields.length > 0 ? (
        <section className="cliente-proof-edit__general">
          <p className="cliente-proof-edit__general-title">Informações gerais</p>
          <ClienteProofPapelariaFields
            fields={generalFields}
            values={fieldValues}
            disabled={disabled}
            compact
            onChange={onFieldChange}
          />
        </section>
      ) : null}

      <div className="cliente-proof-edit__faces">
        {faces.map((face) => (
          <FaceEditSection
            key={face.id}
            face={face}
            fields={fieldsByFaceId.get(face.id) ?? []}
            fieldValues={fieldValues}
            modeloId={modeloId}
            previewConfig={previewConfig}
            disabled={disabled}
            resolvePreviewBaseUrl={resolvePreviewBaseUrl}
            onFieldChange={onFieldChange}
          />
        ))}
      </div>
    </div>
  );
}

type FaceSectionProps = {
  face: PapelariaPreviewFace;
  fields: PapelariaField[];
  fieldValues: Record<string, string>;
  modeloId: number;
  previewConfig: PapelariaPreviewConfig;
  disabled: boolean;
  resolvePreviewBaseUrl: (faceId: string) => string;
  onFieldChange: (key: string, value: string) => void;
};

function FaceEditSection({
  face,
  fields,
  fieldValues,
  modeloId,
  previewConfig,
  disabled,
  resolvePreviewBaseUrl,
  onFieldChange,
}: FaceSectionProps) {
  return (
    <section className="cliente-proof-edit__face" aria-labelledby={`face-${face.id}`}>
      <h4 id={`face-${face.id}`} className="cliente-proof-edit__face-title">
        {face.nome ?? face.id}
      </h4>
      <div className="cliente-proof-edit__face-body">
        <div className="cliente-proof-edit__fields">
          {fields.length > 0 ? (
            <ClienteProofPapelariaFields
              fields={fields}
              values={fieldValues}
              disabled={disabled}
              compact
              onChange={onFieldChange}
            />
          ) : (
            <p className="text-[11px] text-neutral-500">
              Nenhum campo editável nesta face.
            </p>
          )}
        </div>
        <div className="cliente-proof-edit__preview-wrap">
          <PapelariaLivePreview
            className="cliente-proof-edit-preview"
            previewConfig={previewConfig}
            values={fieldValues}
            modeloId={modeloId}
            faceId={face.id}
            mode="form"
            showDisclaimer={false}
            resolvePreviewBaseUrl={resolvePreviewBaseUrl}
          />
        </div>
      </div>
    </section>
  );
}
