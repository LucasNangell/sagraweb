import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IpPermissionRecord } from "@/features/acesso/types";

import { IP_PERMISSION_KEYS } from "../permissionCatalog";
import { ConfirmProvider } from "./ConfirmDialog";
import { FeedbackProvider } from "./Feedback";
import { TerminalDrawer } from "./TerminalDrawer";

const mutations = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  delRequest: vi.fn(),
}));

vi.mock("@/api/hooks/useAdminIpsQueries", () => ({
  useAdminIpsMutations: () => ({
    addIpMutation: { mutateAsync: mutations.add },
    updateIpMutation: { mutateAsync: mutations.update },
    deleteIpMutation: { mutateAsync: mutations.del },
    deleteRequestMutation: { mutateAsync: mutations.delRequest },
  }),
}));

function record(id: number, ip: string, extra: Partial<IpPermissionRecord> = {}): IpPermissionRecord {
  const base = Object.fromEntries(IP_PERMISSION_KEYS.map((k) => [k, 0]));
  return { id, ip, descricao: null, grupo: "Sala", ativo: 1, ...base, ...extra } as IpPermissionRecord;
}

function wrap(ui: ReactNode) {
  return render(
    <FeedbackProvider>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </FeedbackProvider>,
  );
}

describe("TerminalDrawer", () => {
  beforeEach(() => {
    for (const fn of Object.values(mutations)) {
      fn.mockReset();
      fn.mockResolvedValue({ success: true });
    }
  });

  it("bloqueia cadastro de IP já existente (evita sobrescrever o terminal)", async () => {
    wrap(
      <TerminalDrawer
        mode="create"
        allTerminals={[record(1, "10.0.0.1", { descricao: "Recepção" })]}
        groups={[]}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Endereço IP/), { target: { value: "10.0.0.1" } });
    expect(screen.getByText(/Salvar aqui sobrescreveria aquele terminal/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Cadastrar terminal/ }));
    expect(await screen.findByText(/já está cadastrado/)).toBeInTheDocument();
    expect(mutations.add).not.toHaveBeenCalled();
  });

  it("aprovar solicitação cadastra com padrões, vincula usuário e remove a solicitação", async () => {
    const onClose = vi.fn();
    wrap(
      <TerminalDrawer
        mode="create"
        request={{
          id: 55,
          ip: "10.0.0.9",
          nome: "Fulano",
          ponto: 123,
          secao: "SEFOC",
          data_solicitacao: "2026-11-10T10:00:00",
        }}
        allTerminals={[]}
        groups={[]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Aprovar e cadastrar/ }));
    await waitFor(() => expect(mutations.add).toHaveBeenCalledTimes(1));
    const { payload, options } = mutations.add.mock.calls[0]![0];
    expect(payload).toMatchObject({
      ip: "10.0.0.9",
      descricao: "Fulano",
      grupo: "SEFOC",
      ativo: true,
      sb_inicio: true,
      sb_admin_ips: false,
    });
    expect(payload).not.toHaveProperty("id");
    expect(options).toEqual({ ponto: 123, nome_usuario: "Fulano" });
    await waitFor(() => expect(mutations.delRequest).toHaveBeenCalledWith(55));
    expect(onClose).toHaveBeenCalled();
  });

  it("editar envia metadados e todas as permissões do terminal", async () => {
    wrap(
      <TerminalDrawer
        mode="edit"
        record={record(3, "10.0.0.3", { sb_inicio: 1 })}
        allTerminals={[record(3, "10.0.0.3")]}
        groups={[]}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /^Gerência/ }));
    fireEvent.click(screen.getByRole("button", { name: /Salvar terminal/ }));
    await waitFor(() => expect(mutations.update).toHaveBeenCalledTimes(1));
    const payload = mutations.update.mock.calls[0]![0];
    expect(payload).toMatchObject({ id: 3, ip: "10.0.0.3", sb_inicio: true, sb_gerencia: true });
    expect(payload).not.toHaveProperty("ativo");
  });

  it("excluir exige confirmação", async () => {
    wrap(
      <TerminalDrawer
        mode="edit"
        record={record(3, "10.0.0.3")}
        allTerminals={[record(3, "10.0.0.3")]}
        groups={[]}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Excluir terminal/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(mutations.del).toHaveBeenCalledWith(3));
  });
});
