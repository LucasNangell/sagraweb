import { describe, expect, it } from "vitest";

import type { PapelariaField } from "../types";

import { groupFieldsByFace } from "./groupFieldsByFace";
import type { PapelariaPreviewConfig } from "./types";

const fields: PapelariaField[] = [
  { key: "nome_deputado", label: "Deputado", type: "text", required: true },
  { key: "nome_assessor", label: "Assessor", type: "text", required: true },
  { key: "email", label: "E-mail", type: "email", required: false },
];

const config: PapelariaPreviewConfig = {
  canvas: { width: 900, height: 500 },
  faces: [
    {
      id: "frente",
      nome: "Frente",
      baseImage: "frente_base.png",
      elementos: [
        {
          id: "nome",
          tipo: "texto",
          template: "{nome_deputado}",
          x: 0,
          y: 0,
          width: 100,
          height: 20,
          fontSize: 12,
        },
        {
          id: "mail",
          tipo: "texto",
          template: "{email}",
          x: 0,
          y: 20,
          width: 100,
          height: 20,
          fontSize: 12,
        },
      ],
    },
    {
      id: "verso",
      nome: "Verso",
      baseImage: "verso_base.png",
      elementos: [
        {
          id: "assessor",
          tipo: "texto",
          template: "{nome_assessor}",
          x: 0,
          y: 0,
          width: 100,
          height: 20,
          fontSize: 12,
        },
      ],
    },
  ],
};

describe("groupFieldsByFace", () => {
  it("agrupa campos por face conforme templates da prévia", () => {
    const groups = groupFieldsByFace(fields, config);
    const frente = groups.find((g) => g.faceId === "frente");
    const verso = groups.find((g) => g.faceId === "verso");

    expect(frente?.fields.map((f) => f.key)).toEqual(["nome_deputado", "email"]);
    expect(verso?.fields.map((f) => f.key)).toEqual(["nome_assessor"]);
  });
});
