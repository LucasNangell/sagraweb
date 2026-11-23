import type { ProvaPdfRegiao } from "@/api/papelariaProvaPdf";
import { PapelariaLivePreview } from "@/features/papelaria/components/PapelariaLivePreview";
import {
  PapelariaPdfLivePreview,
  type FetchPreviaPdf,
} from "@/features/papelaria/components/PapelariaPdfLivePreview";
import {
  groupFieldsByFace,
  type PapelariaPreviewConfig,
  type PapelariaPreviewFace,
} from "@/features/papelaria/preview";
import type { PapelariaComposicao, PapelariaField } from "@/features/papelaria/types";
import { useMemo, type CSSProperties } from "react";

import { ClienteProofPapelariaFields } from "./ClienteProofPapelariaFields";
import "./ClienteProofPapelariaEditPanel.css";

type Props = {
  previewConfig: PapelariaPreviewConfig | null;
  camposFormulario: PapelariaField[];
  fieldValues: Record<string, string>;
  /** Valores enviados à prévia PDF (campos + `__textos` / `__redes`). */
  previaValues: Record<string, string>;
  modeloId: number;
  disabled?: boolean;
  resolvePreviewBaseUrl: (faceId: string) => string;
  onFieldChange: (key: string, value: string) => void;
  /** Quando true, usa a mesma prévia PDF ao vivo da Papelaria. */
  temProvaPdf?: boolean;
  composicao?: PapelariaComposicao | null;
  fetchPrevia?: FetchPreviaPdf;
  onEditarTextoPrevia?: (regiao: ProvaPdfRegiao, texto: string) => void;
  onRestaurarTextoPrevia?: (regiao: ProvaPdfRegiao) => void;
};

export function ClienteProofPapelariaEditPanel(props: Props) {
  if (props.temProvaPdf) {
    return <PdfEditLayout {...props} />;
  }
  return <LegacyFaceEditLayout {...props} />;
}

function PdfEditLayout({
  camposFormulario,
  fieldValues,
  previaValues,
  modeloId,
  disabled = false,
  onFieldChange,
  composicao = null,
  fetchPrevia,
  onEditarTextoPrevia,
  onRestaurarTextoPrevia,
}: Props) {
  return (
    <div className="cliente-proof-edit cliente-proof-edit--pdf">
      {camposFormulario.length > 0 ? (
        <section className="cliente-proof-edit__general">
          <p className="cliente-proof-edit__general-title">Informações do trabalho</p>
          <ClienteProofPapelariaFields
            fields={camposFormulario}
            values={fieldValues}
            disabled={disabled}
            compact
            onChange={onFieldChange}
          />
        </section>
      ) : null}
      <div className="cliente-proof-edit__pdf-preview">
        <PapelariaPdfLivePreview
          modeloId={modeloId}
          values={previaValues}
          composicao={composicao}
          fetchPrevia={fetchPrevia}
          queryKeyPrefix="portal"
          onEditarTexto={disabled ? undefined : onEditarTextoPrevia}
          onRestaurarTexto={disabled ? undefined : onRestaurarTextoPrevia}
          className="cliente-proof-edit-preview-pdf"
        />
      </div>
    </div>
  );
}

function LegacyFaceEditLayout({
  previewConfig,
  camposFormulario,
  fieldValues,
  modeloId,
  disabled = false,
  resolvePreviewBaseUrl,
  onFieldChange,
}: Props) {
  const groups = useMemo(
    () => (previewConfig ? groupFieldsByFace(camposFormulario, previewConfig) : []),
    [camposFormulario, previewConfig],
  );
  const generalFields = groups.find((g) => g.faceId === "_geral")?.fields ?? [];
  const fieldsByFaceId = useMemo(() => {
    const map = new Map<string, PapelariaField[]>();
    for (const group of groups) {
      if (group.faceId !== "_geral") map.set(group.faceId, group.fields);
    }
    return map;
  }, [groups]);

  const faces = previewConfig?.faces ?? [];
  const layoutVars = useMemo(() => {
    const vars: CSSProperties & Record<string, string | number> = {
      "--preview-face-count": Math.max(faces.length, 1),
    };
    if (generalFields.length > 0) {
      vars["--preview-chrome-extra"] = "15rem";
    }
    return vars;
  }, [faces.length, generalFields.length]);

  if (!previewConfig) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">
        Prévia indisponível para este modelo. Ajuste os campos e envie a solicitação — a equipe
        gerará uma nova prova.
      </p>
    );
  }

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
            <p className="text-[11px] text-neutral-500">Nenhum campo editável nesta face.</p>
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
