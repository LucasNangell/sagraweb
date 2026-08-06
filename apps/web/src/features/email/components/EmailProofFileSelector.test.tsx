import { fireEvent, render, screen } from "@testing-library/react";

import { describe, expect, it, vi } from "vitest";



import {

  EmailProofFileSelector,

  isProofSendBlocked,

} from "./EmailProofFileSelector";



describe("EmailProofFileSelector", () => {

  const files = [

    { name: "prova_v1.pdf", size: 1024, modified_at: "2026-06-08T10:00:00Z" },

    { name: "prova_v2.pdf", size: 2048, modified_at: "2026-06-08T11:00:00Z" },

  ];



  it("exibe arquivo selecionado com botão alterar", () => {

    const onChangeFile = vi.fn();

    render(

      <EmailProofFileSelector

        files={files}

        suggested="prova_v2.pdf"

        selectedFilename="prova_v2.pdf"

        onSelect={vi.fn()}

        onChangeFile={onChangeFile}

        isLoading={false}

        isError={false}

      />,

    );

    expect(screen.getByText("prova_v2.pdf")).toBeInTheDocument();

    expect(screen.getByText(/Sugerido/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Alterar" }));

    expect(onChangeFile).toHaveBeenCalled();

  });



  it("alerta quando não há PDF e oferece alterar", () => {

    const onChangeFile = vi.fn();

    render(

      <EmailProofFileSelector

        files={[]}

        suggested={null}

        selectedFilename=""

        onSelect={vi.fn()}

        onChangeFile={onChangeFile}

        isLoading={false}

        isError={false}

      />,

    );

    expect(

      screen.getByText(/Nenhum PDF de prova foi encontrado/i),

    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Alterar" }));

    expect(onChangeFile).toHaveBeenCalled();

  });



  it("mostra loading", () => {

    render(

      <EmailProofFileSelector

        files={[]}

        suggested={null}

        selectedFilename=""

        onSelect={vi.fn()}

        isLoading

        isError={false}

      />,

    );

    expect(screen.getByText(/Carregando PDFs/i)).toBeInTheDocument();

  });

});



describe("isProofSendBlocked", () => {

  it("não bloqueia modo pt", () => {

    expect(isProofSendBlocked("pt", false, false, 0, "")).toBe(false);

  });



  it("bloqueia proof sem PDF selecionado", () => {

    expect(isProofSendBlocked("proof", false, false, 2, "")).toBe(true);

  });



  it("libera proof com PDF selecionado manualmente", () => {

    expect(isProofSendBlocked("proof", false, false, 0, "Offset/prova.pdf")).toBe(

      false,

    );

  });



  it("bloqueia proof durante loading", () => {

    expect(isProofSendBlocked("proof", true, false, 1, "prova.pdf")).toBe(true);

  });

});


