import { describe, expect, it } from "vitest";

import { createEmptyGerenciaForm } from "./defaults";
import { formToSavePayload } from "./mappers";
import { detailsToForm } from "./utils";

describe("campos de Entrega", () => {
  it("detailsToForm lê turno, responsável e forma de tabProtocolos", () => {
    const form = detailsToForm({
      EntregPeriodo: "Noite",
      ResponsavelGrafLink: "Daniela",
      EntregaFormaLink: "Avisar Contato",
    });
    expect(form.val_turno).toBe("Noite");
    expect(form.val_resp_grafica).toBe("Daniela");
    expect(form.val_forma_entrega).toBe("Avisar Contato");
  });

  it("formToSavePayload grava os mesmos campos no payload da OS", () => {
    const payload = formToSavePayload(
      {
        ...createEmptyGerenciaForm(),
        val_turno: "Tarde",
        val_resp_grafica: "Daniela",
        val_forma_entrega: "Entreg. na SEDIR IV",
      },
      { ano: "2025", id: "2465" },
      "1234",
    );
    expect(payload.EntregPeriodo).toBe("Tarde");
    expect(payload.ResponsavelGrafLink).toBe("Daniela");
    expect(payload.EntregaFormaLink).toBe("Entreg. na SEDIR IV");
  });

  it("formToSavePayload deriva Pags, máquina e DescAcabamento do TechSpec", () => {
    const payload = formToSavePayload(
      createEmptyGerenciaForm(),
      { ano: "2025", id: "2465" },
      "1234",
      {
        version: 1,
        componentes: [
          {
            nome: "Miolo",
            tipo: "MIOLO",
            lotes: [
              {
                id: "l1",
                paginas: 16,
                maquina_link: "Offset",
                papel_link: "Pólen",
                cores_link: "P/B",
                papel_desc: "",
                cores_desc: "",
                frente_verso: false,
                acabamentos: [],
              },
            ],
            acabamentos: [{ catalog_id: 8, label: "Espiral" }],
          },
        ],
      },
    );
    expect(payload.Pags).toBe("16");
    expect(payload.MaquinaLink).toBe("Offset");
    expect(payload.PapelLink).toBe("Pólen");
    expect(payload.Tiragem).toBeNull();
    expect(payload.DescAcabamento).toBe("Miolo:\n  Espiral");
    expect(payload.TechSpec?.componentes?.[0]?.nome).toBe("Miolo");
    expect(payload.FrenteVerso).toBe(false);
  });

  it("formToSavePayload preserva texto editado manualmente em DescAcabamento", () => {
    const payload = formToSavePayload(
      {
        ...createEmptyGerenciaForm(),
        txt_acabamento: "Dobra manual\nRefile",
      },
      { ano: "2025", id: "2465" },
      "1234",
      {
        version: 1,
        componentes: [
          {
            nome: "Miolo",
            tipo: "MIOLO",
            lotes: [
              {
                id: "l1",
                paginas: 16,
                maquina_link: "Offset",
                papel_link: "Pólen",
                cores_link: "P/B",
                papel_desc: "",
                cores_desc: "",
                frente_verso: false,
                acabamentos: [],
              },
            ],
            acabamentos: [{ catalog_id: 8, label: "Espiral" }],
          },
        ],
      },
    );

    expect(payload.DescAcabamento).toBe("Dobra manual\nRefile");
  });

  it("grava MaquinaLink combinado e Papel/Cores Diversos quando os componentes divergem", () => {
    const payload = formToSavePayload(
      createEmptyGerenciaForm(),
      { ano: "2025", id: "2465" },
      "1234",
      {
        version: 1,
        componentes: [
          {
            nome: "Capa",
            tipo: "CAPA",
            lotes: [
              {
                id: "c",
                paginas: 4,
                maquina_link: "Offset",
                papel_link: "Couché 250g",
                cores_link: "4x4",
                papel_desc: "",
                cores_desc: "",
                frente_verso: false,
                acabamentos: [],
              },
            ],
          },
          {
            nome: "Miolo",
            tipo: "MIOLO",
            lotes: [
              {
                id: "m",
                paginas: 16,
                maquina_link: "Digital",
                papel_link: "Pólen 80g",
                cores_link: "1x1",
                papel_desc: "",
                cores_desc: "",
                frente_verso: false,
                acabamentos: [],
              },
            ],
          },
        ],
      },
    );
    expect(payload.MaquinaLink).toBe("Offset/Digital");
    expect(payload.PapelLink).toBe("Diversos");
    expect(payload.Cores).toBe("Diversas");
    expect(payload.PapelDescricao).toBe("Capa: Couché 250g | Miolo: Pólen 80g");
    expect(payload.CoresDescricao).toBe("Capa: 4x4 | Miolo: 1x1");
  });

  it("formToSavePayload grava FrenteVerso se algum lote for F/V", () => {
    const payload = formToSavePayload(
      createEmptyGerenciaForm(),
      { ano: "2025", id: "2465" },
      "1234",
      {
        version: 1,
        componentes: [
          {
            nome: "Capa",
            tipo: "CAPA",
            lotes: [
              {
                id: "l1",
                paginas: 4,
                maquina_link: "",
                papel_link: "",
                cores_link: "",
                papel_desc: "",
                cores_desc: "",
                frente_verso: true,
                acabamentos: [],
              },
            ],
          },
        ],
      },
    );
    expect(payload.FrenteVerso).toBe(true);
  });
});
