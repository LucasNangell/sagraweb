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
    expect(payload.PapelDescricao).toBeNull();
    expect(payload.CoresDescricao).toBeNull();
  });

  it("preserva observações de PapelDescricao/CoresDescricao do formulário no save", () => {
    const form = {
      ...createEmptyGerenciaForm(),
      txt_papel_desc: "Usar reserva do almoxarifado",
      txt_cores_desc: "Pantone conforme amostra",
    };
    const payload = formToSavePayload(
      form,
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
    expect(payload.PapelDescricao).toBe("Usar reserva do almoxarifado");
    expect(payload.CoresDescricao).toBe("Pantone conforme amostra");
    expect(payload.PapelLink).toBe("Diversos");
    expect(payload.Cores).toBe("Diversas");
  });

  it("grava MaquinaLink só com a máquina real quando o outro lote é Ignorada", () => {
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
                papel_link: "",
                cores_link: "",
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
                maquina_link: "Ignorada",
                papel_link: "",
                cores_link: "",
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
    expect(payload.MaquinaLink).toBe("Offset");
  });

  it("grava MaquinaLink Digital Cor/PB a partir dos lotes Digital Cor e Digital PB", () => {
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
                maquina_link: "Digital Cor",
                papel_link: "",
                cores_link: "",
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
                maquina_link: "Digital PB",
                papel_link: "",
                cores_link: "",
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
    expect(payload.MaquinaLink).toBe("Digital Cor/PB");
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

describe("SetorAndamento na criação", () => {
  it("não envia SetorAndamento em edição", () => {
    const payload = formToSavePayload(
      createEmptyGerenciaForm(),
      { ano: "2025", id: "2465" },
      "1234",
      undefined,
      "SEORG",
    );
    expect(payload.SetorAndamento).toBeUndefined();
  });

  it("envia SetorAndamento em nova OS", () => {
    const payload = formToSavePayload(
      createEmptyGerenciaForm(),
      { action: "new", type: "normal" },
      "1234",
      undefined,
      "SEORG",
    );
    expect(payload.SetorAndamento).toBe("SEORG");
  });

  it("envia SetorAndamento em duplicata", () => {
    const payload = formToSavePayload(
      createEmptyGerenciaForm(),
      { action: "duplicate", ano: "2025", id: "10" },
      "1234",
      undefined,
      "  SECOG  ",
    );
    expect(payload.SetorAndamento).toBe("SECOG");
  });
});
