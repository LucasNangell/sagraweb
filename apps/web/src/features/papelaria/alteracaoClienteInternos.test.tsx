import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { camposClienteFormulario, internosCliente } from "./applyPapelariaPrefill";
import { PapelariaAlteracoesCliente } from "./components/PapelariaAlteracoesCliente";

describe("pedido de alteração do cliente: formulário x textos/redes", () => {
  it("o formulário recebe só os campos (sem __textos/__redes)", () => {
    expect(
      camposClienteFormulario({ nome_deputado: "Ana", __textos: "{}", __redes: "[]" }),
    ).toEqual({ nome_deputado: "Ana" });
    expect(camposClienteFormulario({ __textos: "{}" })).toBeNull();
    expect(camposClienteFormulario(null)).toBeNull();
  });

  it("lê textos editados, redes e estilo do pedido", () => {
    const r = internosCliente({
      __textos: JSON.stringify({ "7:1:NOME": "Ana Maria" }),
      __redes: JSON.stringify([{ chave: "Instagram", valor: "@ana" }]),
      __redes_estilo: "pb",
    });
    expect(r.textos).toEqual({ "7:1:NOME": "Ana Maria" });
    expect(r.redes).toEqual([{ chave: "instagram", valor: "@ana" }]);
    expect(r.redesEstilo).toBe("pb");
  });

  it("JSON inválido ou ausente não quebra", () => {
    expect(internosCliente({ __textos: "{", __redes: "x" })).toEqual({
      textos: null,
      redes: null,
      redesEstilo: null,
      camposExtrasRaw: null,
      camposEstiloRaw: null,
    });
    expect(internosCliente(null)).toEqual({
      textos: null,
      redes: null,
      redesEstilo: null,
      camposExtrasRaw: null,
      camposEstiloRaw: null,
    });
  });

  it("lê campos extras e estilo tipográfico", () => {
    const extras = JSON.stringify([
      {
        id: "extra_1",
        tipo: "texto",
        ancora_chave: "7:1:NOME",
        direcao: "abaixo",
        texto: "X",
      },
    ]);
    const r = internosCliente({
      __campos_extras: extras,
      __campos_estilo: JSON.stringify({ "7:1:NOME": { tamanho_pt: 12 } }),
    });
    expect(r.camposExtrasRaw).toBe(extras);
    expect(r.camposEstiloRaw).toContain("tamanho_pt");
  });
});

describe("PapelariaAlteracoesCliente", () => {
  it("lista campos, textos e redes alterados e a observação", () => {
    render(
      <PapelariaAlteracoesCliente
        alteracao={{
          observacao: "Trocar o telefone",
          versao: "2",
          campos_alterados: [{ key: "telefone", antes: "3215-5000", depois: "3215-5123" }],
          textos_alterados: [{ chave: "7:1:NOME", marcador: "NOME", antes: "Ana", depois: "Ana Maria" }],
          redes_alteradas: [
            { chave: "instagram", rede: "Instagram", antes: "", depois: "@ana" },
            { chave: "x", rede: "X (Twitter)", antes: "@velho", depois: "" },
          ],
        }}
        rotulos={{ telefone: "Telefone" }}
      />,
    );
    const resumo = screen.getByTestId("papelaria-alteracoes-cliente");
    expect(resumo).toHaveTextContent("prova v2");
    expect(resumo).toHaveTextContent("4 alterações aplicadas na prévia");
    expect(screen.getByTestId("papelaria-alteracao-campo")).toHaveTextContent("Telefone: 3215-5000 → 3215-5123");
    expect(screen.getByTestId("papelaria-alteracao-texto")).toHaveTextContent("Ana → Ana Maria");
    const redes = screen.getAllByTestId("papelaria-alteracao-rede");
    expect(redes[0]).toHaveTextContent("Instagram: incluída @ana");
    expect(redes[1]).toHaveTextContent("X (Twitter): retirada");
    expect(resumo).toHaveTextContent("Observação do cliente: Trocar o telefone");
    // Recolhe.
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByTestId("papelaria-alteracao-campo")).not.toBeInTheDocument();
  });

  it("negrito marcado com ** aparece em negrito, sem asteriscos", () => {
    render(
      <PapelariaAlteracoesCliente
        alteracao={{
          observacao: "",
          versao: "1",
          textos_alterados: [
            { chave: "1:1:G", marcador: "G", antes: "Gabinete do Deputado Ana", depois: "Gabinete do Deputado **Ana**" },
          ],
        }}
      />,
    );
    const item = screen.getByTestId("papelaria-alteracao-texto");
    expect(item).not.toHaveTextContent("**");
    expect(item.querySelector("b")).toHaveTextContent("Ana");
  });

  it("pedido só com observação", () => {
    render(<PapelariaAlteracoesCliente alteracao={{ observacao: "Mudar a cor do nome", versao: "1" }} />);
    expect(screen.getByTestId("papelaria-alteracoes-cliente")).toHaveTextContent("Mudar a cor do nome");
  });
});
