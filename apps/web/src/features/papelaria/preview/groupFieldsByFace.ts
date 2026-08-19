import type { PapelariaField } from "../types";

import { isDerivedPreviewVariable } from "./templateEngine";

import type { PapelariaPreviewConfig, PapelariaPreviewFace } from "./types";

const FIELD_RE = /\{([^{}]+)\}/g;

function normalizeFieldKey(raw: string): string {
  const key = raw.trim();
  return key === "nome_acessor" ? "nome_assessor" : key;
}

export function extractFieldKeysFromTemplate(template: string): string[] {
  const keys: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(FIELD_RE.source, "g");
  while ((match = re.exec(template)) !== null) {
    const key = normalizeFieldKey(match[1]);
    if (isDerivedPreviewVariable(key)) continue;
    keys.push(key);
  }
  return keys;
}

export function extractFieldKeysFromFace(face: PapelariaPreviewFace): string[] {
  const keys = new Set<string>();
  for (const el of face.elementos ?? []) {
    if (el.tipo !== "texto" || !el.template) continue;
    for (const key of extractFieldKeysFromTemplate(el.template)) {
      keys.add(key);
    }
  }
  return [...keys];
}

export type FaceFieldGroup = {
  faceId: string;
  faceName: string;
  fields: PapelariaField[];
};

/** Agrupa campos do formulário pela face da prévia (frente/verso). */
export function groupFieldsByFace(
  fields: PapelariaField[],
  previewConfig: PapelariaPreviewConfig,
): FaceFieldGroup[] {
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const assigned = new Set<string>();
  const groups: FaceFieldGroup[] = [];

  for (const face of previewConfig.faces) {
    const faceFields: PapelariaField[] = [];
    for (const key of extractFieldKeysFromFace(face)) {
      const field = fieldByKey.get(key);
      if (field && !assigned.has(key)) {
        faceFields.push(field);
        assigned.add(key);
      }
    }
    groups.push({
      faceId: face.id,
      faceName: face.nome ?? face.id,
      fields: faceFields,
    });
  }

  const unassigned = fields.filter((f) => !assigned.has(f.key));
  if (unassigned.length > 0) {
    groups.unshift({
      faceId: "_geral",
      faceName: "Informações gerais",
      fields: unassigned,
    });
  }

  return groups;
}
